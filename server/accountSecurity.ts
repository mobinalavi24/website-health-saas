import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { query } from './db/connection.ts';
import { ensureSecuritySchema } from './securitySchema.ts';
import { db, hashPasswordAsync, type User } from './db.ts';
import { revokeAllUserSessions } from './db/sessionRepo.ts';
import {
  accountKeyFor,
  getClientIp,
  hashIp,
  logSecurityEvent,
  maskEmail,
  normalizeEmail,
  publicAppUrl,
  rateLimit,
  sanitizeForLog,
} from './security.ts';

/* ================================================================================================
 * LOGIN ATTEMPT TRACKING & ACCOUNT LOCKOUT POLICY
 *
 *  - Failures are counted per *normalised account identifier* (sha256(pepper|email)), identically for
 *    existing and non-existing accounts, so behaviour never reveals whether an account exists.
 *  - Window: rolling 24 hours. More than FIVE incorrect passwords inside the window -> the SIXTH failed
 *    attempt locks the account.
 *  - Every attempt RESERVES a slot (outcome 'pending') in PostgreSQL *before* the slow password check,
 *    under a per-account mutex, so a burst of concurrent guesses cannot exceed the threshold.
 *  - A lock lasts until (a) the owner completes the emailed recovery flow, (b) a super_admin unlocks it
 *    with step-up verification, or (c) LOCKOUT_DURATION (24h) elapses. (c) bounds attacker-induced
 *    denial of service: locking an account requires sustained, rate-limited, IP-throttled effort and
 *    gives the attacker at most five guesses per 24h.
 *  - Successful logins do NOT erase earlier failures (no counter reset by unrelated successes); failures
 *    simply age out of the 24h window. Attempts rejected because the account is already locked are not
 *    counted, so a lock cannot be extended indefinitely by hammering it.
 *  - Per-IP (persistent + in-memory) and global limiters sit in front of the per-account logic.
 * ============================================================================================== */

export const MAX_FAILED_LOGINS = 5; // the (MAX+1)th = sixth failure triggers the lock
export const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000;

const accountMutexes = new Map<string, Promise<void>>();

async function withAccountMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = accountMutexes.get(key) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => gate);
  accountMutexes.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (accountMutexes.get(key) === chained) accountMutexes.delete(key);
  }
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export type LoginGateResult =
  | { allowed: true; attemptId: string; accountKey: string }
  | { allowed: false; reason: 'locked' | 'ip_limited' | 'global_limited'; retryAfterSec?: number; accountKey: string };

async function isLocked(accountKey: string): Promise<boolean> {
  const res = await query(
    'SELECT expires_at, unlocked_at FROM account_lockouts WHERE account_key = $1 LIMIT 1',
    [accountKey]
  );
  const row = res.rows[0];
  if (!row || row.unlocked_at) return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

export async function isAccountLockedByEmail(email: string): Promise<boolean> {
  await ensureSecuritySchema();
  return isLocked(accountKeyFor(email));
}

/**
 * Called BEFORE verifying a password. Reserves an attempt slot or refuses the attempt.
 */
export async function beginLoginAttempt(email: string, req: IncomingMessage): Promise<LoginGateResult> {
  await ensureSecuritySchema();
  const accountKey = accountKeyFor(email);
  const ip = getClientIp(req);
  const ipH = hashIp(ip);

  const global = rateLimit('login:global', num('LOGIN_GLOBAL_PER_MINUTE', 600), 60_000);
  if (!global.allowed) {
    void logSecurityEvent({ type: 'rate_limited', outcome: 'blocked', req, details: { scope: 'login_global' } });
    return { allowed: false, reason: 'global_limited', retryAfterSec: global.retryAfterSec, accountKey };
  }
  const perIp = rateLimit(`login:ip:${ipH}`, num('LOGIN_IP_LIMIT', 20), 15 * 60_000);
  if (!perIp.allowed) {
    void logSecurityEvent({ type: 'rate_limited', outcome: 'blocked', req, details: { scope: 'login_ip' } });
    return { allowed: false, reason: 'ip_limited', retryAfterSec: perIp.retryAfterSec, accountKey };
  }

  // Persistent per-IP failure ceiling (survives restarts / multiple instances)
  if (process.env.SECURITY_DISABLE_RATE_LIMITS !== 'true') {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const ipFailures = await query(
      `SELECT COUNT(*) AS c FROM login_attempts WHERE ip_hash = $1 AND outcome = 'failure' AND created_at > $2`,
      [ipH, since]
    );
    if (Number(ipFailures.rows[0]?.c || 0) >= num('LOGIN_IP_FAILURE_LIMIT', 40)) {
      void logSecurityEvent({ type: 'rate_limited', outcome: 'blocked', req, details: { scope: 'login_ip_failures' } });
      return { allowed: false, reason: 'ip_limited', retryAfterSec: 900, accountKey };
    }
  }

  return withAccountMutex(accountKey, async () => {
    const now = Date.now();
    if (await isLocked(accountKey)) {
      await query(
        `INSERT INTO login_attempts (id, account_key, ip_hash, outcome, created_at) VALUES ($1, $2, $3, 'blocked', $4)`,
        [`la_${now.toString(36)}_${crypto.randomBytes(4).toString('hex')}`, accountKey, ipH, new Date(now).toISOString()]
      );
      return { allowed: false as const, reason: 'locked' as const, accountKey };
    }

    const since = new Date(now - FAILURE_WINDOW_MS).toISOString();
    const counted = await query(
      `SELECT COUNT(*) AS c FROM login_attempts
       WHERE account_key = $1 AND outcome IN ('pending', 'failure') AND created_at > $2`,
      [accountKey, since]
    );
    if (Number(counted.rows[0]?.c || 0) >= MAX_FAILED_LOGINS + 1) {
      // Defensive: threshold already reached (e.g. crashed in-flight attempts) -> lock now.
      await lockAccount(accountKey, undefined, req, 'threshold_reached_on_reserve');
      return { allowed: false as const, reason: 'locked' as const, accountKey };
    }

    const attemptId = `la_${now.toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
    await query(
      `INSERT INTO login_attempts (id, account_key, ip_hash, outcome, created_at) VALUES ($1, $2, $3, 'pending', $4)`,
      [attemptId, accountKey, ipH, new Date(now).toISOString()]
    );
    return { allowed: true as const, attemptId, accountKey };
  });
}

async function lockAccount(accountKey: string, userId: string | undefined, req: IncomingMessage | undefined, reason: string) {
  const now = Date.now();
  const expires = new Date(now + LOCKOUT_DURATION_MS).toISOString();
  const existing = await query('SELECT account_key FROM account_lockouts WHERE account_key = $1', [accountKey]);
  if (existing.rows.length > 0) {
    await query(
      `UPDATE account_lockouts SET locked_at = $1, expires_at = $2, reason = $3, unlocked_at = NULL,
              unlocked_by = NULL, unlock_method = NULL, user_id = COALESCE($4, user_id)
       WHERE account_key = $5`,
      [new Date(now).toISOString(), expires, reason, userId || null, accountKey]
    );
  } else {
    await query(
      `INSERT INTO account_lockouts (account_key, user_id, locked_at, expires_at, reason) VALUES ($1, $2, $3, $4, $5)`,
      [accountKey, userId || null, new Date(now).toISOString(), expires, reason]
    );
  }
  if (userId) {
    await revokeAllUserSessions(userId, 'account_locked').catch(() => 0);
  }
  await logSecurityEvent({
    type: 'account_locked',
    outcome: 'blocked',
    userId: userId || null,
    req,
    details: { reason, accountKeyPrefix: accountKey.slice(0, 8), lockedForMinutes: LOCKOUT_DURATION_MS / 60000 },
    awaitWrite: true,
  });
}

/**
 * Called AFTER the password check. Returns whether this failure caused the lockout.
 */
export async function completeLoginAttempt(
  gate: { attemptId: string; accountKey: string },
  success: boolean,
  opts: { userId?: string; email?: string; req?: IncomingMessage }
): Promise<{ lockedNow: boolean }> {
  return withAccountMutex(gate.accountKey, async () => {
    await query('UPDATE login_attempts SET outcome = $1 WHERE id = $2', [success ? 'success' : 'failure', gate.attemptId]);
    if (success) return { lockedNow: false };

    const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString();
    const res = await query(
      `SELECT COUNT(*) AS c FROM login_attempts WHERE account_key = $1 AND outcome = 'failure' AND created_at > $2`,
      [gate.accountKey, since]
    );
    const failures = Number(res.rows[0]?.c || 0);
    if (failures > MAX_FAILED_LOGINS) {
      if (!(await isLocked(gate.accountKey))) {
        await lockAccount(gate.accountKey, opts.userId, opts.req, 'too_many_failed_logins');
        void sendLockoutNotice(opts.email, opts.userId);
        return { lockedNow: true };
      }
    }
    return { lockedNow: false };
  });
}

export async function getFailedAttemptCount(email: string): Promise<number> {
  await ensureSecuritySchema();
  const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString();
  const res = await query(
    `SELECT COUNT(*) AS c FROM login_attempts WHERE account_key = $1 AND outcome = 'failure' AND created_at > $2`,
    [accountKeyFor(email), since]
  );
  return Number(res.rows[0]?.c || 0);
}

async function clearLockAndCounters(accountKey: string, unlockedBy: string, method: string) {
  const nowIso = new Date().toISOString();
  await query(
    `UPDATE account_lockouts SET unlocked_at = $1, unlocked_by = $2, unlock_method = $3
     WHERE account_key = $4 AND unlocked_at IS NULL`,
    [nowIso, unlockedBy, method, accountKey]
  );
  await query(
    `UPDATE login_attempts SET outcome = 'cleared' WHERE account_key = $1 AND outcome IN ('pending', 'failure')`,
    [accountKey]
  );
}

/** Super-admin unlock. Caller MUST already have verified authorization and step-up (password). */
export async function adminUnlockAccount(target: User, admin: User, req: IncomingMessage): Promise<void> {
  await ensureSecuritySchema();
  await clearLockAndCounters(accountKeyFor(target.email), admin.id, 'admin');
  await logSecurityEvent({
    type: 'account_unlocked',
    outcome: 'success',
    userId: target.id,
    accountHint: maskEmail(target.email),
    actorRole: admin.role,
    req,
    details: { method: 'admin', adminId: admin.id },
    awaitWrite: true,
  });
}

/* ================================================================================================
 * PASSWORD RECOVERY  (also the verified unlock path for locked accounts)
 *
 *  - request: always answers identically, never reveals whether the account exists, throttled per
 *    IP / account, token is 256-bit random, stored only as a SHA-256 hash, valid 60 minutes, single use.
 *  - confirm: validates the token, enforces the password policy, stores a fresh scrypt hash, unlocks the
 *    account, revokes ALL sessions and invalidates every outstanding reset token.
 * ============================================================================================== */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function validatePasswordPolicy(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (password.length > 128) return 'Password must be at most 128 characters long.';
  if (/^\s+$/.test(password)) return 'Password cannot consist only of whitespace.';
  return null;
}

async function sendSecurityEmail(to: string, subject: string, text: string): Promise<boolean> {
  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  const sendgridApiKey = (process.env.SENDGRID_API_KEY || '').trim();
  const webhook = (process.env.SUPPORT_EMAIL_WEBHOOK_URL || process.env.EMAIL_WEBHOOK_URL || '').trim();
  const from = process.env.SUPPORT_EMAIL_FROM || process.env.EMAIL_FROM || 'PulseVanguarde Security <support@pulsevanguard.com>';
  try {
    if (resendApiKey) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok;
    }
    if (sendgridApiKey) {
      const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sendgridApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from.includes('<') ? from.split('<')[1].replace('>', '').trim() : from },
          subject,
          content: [{ type: 'text/plain', value: text }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok || r.status === 202;
    }
    if (webhook) {
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, from, subject, text, eventType: 'security_notice' }),
        signal: AbortSignal.timeout(8000),
      });
      return r.ok;
    }
  } catch {
    // swallow: delivery failure is reported through the boolean, never through exceptions or secrets
  }
  return false;
}

async function sendLockoutNotice(email: string | undefined, userId: string | undefined) {
  if (!email || !userId) return;
  const base = publicAppUrl();
  await sendSecurityEmail(
    email,
    'PulseVanguarde: your account was temporarily locked',
    `We detected more than ${MAX_FAILED_LOGINS} failed sign-in attempts on your account, so it has been locked for up to 24 hours.\n\n` +
      `If this was you, or you want to regain access immediately, use "Forgot password" on the sign-in screen${base ? ` (${base})` : ''} to reset your password; completing the reset unlocks the account.\n\n` +
      `If this was not you, resetting your password is strongly recommended.`
  ).catch(() => false);
}

export interface ResetRequestOutcome {
  /** Only populated in non-production when explicitly enabled for automated tests. Never in production. */
  debugToken?: string;
}

export async function requestPasswordReset(emailRaw: unknown, req: IncomingMessage): Promise<ResetRequestOutcome> {
  await ensureSecuritySchema();
  const email = normalizeEmail(emailRaw);
  const ipH = hashIp(getClientIp(req));
  const out: ResetRequestOutcome = {};

  // Same response regardless of outcome; throttling is silent to avoid becoming an oracle.
  const ipOk = rateLimit(`reset:ip:${ipH}`, num('RESET_IP_LIMIT', 5), 60 * 60_000).allowed;
  const acctOk = email ? rateLimit(`reset:acct:${accountKeyFor(email)}`, 3, 60 * 60_000).allowed : false;

  await logSecurityEvent({
    type: 'password_reset_requested',
    outcome: 'info',
    accountHint: maskEmail(email),
    req,
    details: { throttled: !(ipOk && acctOk) },
  });
  if (!email || !ipOk || !acctOk) return out;

  const user = db.findUserByEmail(email);
  if (!user) return out;

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  await query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, ip_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      `prt_${now.toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      user.id,
      tokenHash,
      new Date(now + RESET_TOKEN_TTL_MS).toISOString(),
      ipH,
      new Date(now).toISOString(),
    ]
  );

  const base = publicAppUrl();
  // The token is carried in the URL *fragment* so it never reaches server logs or Referer headers.
  const link = base ? `${base}/#reset=${token}` : '';
  const delivered = await sendSecurityEmail(
    user.email,
    'PulseVanguarde password reset',
    `A password reset was requested for your account.\n\n` +
      (link ? `Open this link within 60 minutes to choose a new password:\n${link}\n\n` : `Reset token: ${token}\n\n`) +
      `If you did not request this, you can ignore this email. Completing a reset also unlocks a locked account.`
  );
  if (!delivered) {
    console.warn('[Recovery] No email provider delivered the reset message for a request (token not logged).');
  }
  if (!isProductionEnv() && process.env.SECURITY_EXPOSE_RESET_TOKEN_FOR_TESTS === 'true') {
    out.debugToken = token;
  }
  return out;
}

function isProductionEnv() {
  return process.env.NODE_ENV === 'production';
}

export async function confirmPasswordReset(
  tokenRaw: unknown,
  newPassword: unknown,
  req: IncomingMessage
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensureSecuritySchema();
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) return { ok: false, error: policyError };
  if (typeof tokenRaw !== 'string' || tokenRaw.length < 20 || tokenRaw.length > 200) {
    return { ok: false, error: 'This reset link is invalid or has expired.' };
  }
  const ipOk = rateLimit(`reset-confirm:ip:${hashIp(getClientIp(req))}`, 10, 60 * 60_000).allowed;
  if (!ipOk) return { ok: false, error: 'Too many attempts. Please try again later.' };

  const tokenHash = crypto.createHash('sha256').update(tokenRaw).digest('hex');
  const generic = { ok: false as const, error: 'This reset link is invalid or has expired.' };

  const res = await query('SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1 LIMIT 1', [tokenHash]);
  const row = res.rows[0];
  if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return generic;

  // Atomically consume the token (single use even under concurrent submissions).
  const consumed = await query(
    'UPDATE password_reset_tokens SET used_at = $1 WHERE id = $2 AND used_at IS NULL',
    [new Date().toISOString(), row.id]
  );
  if ((consumed.rowCount || 0) !== 1) return generic;

  const user = db.findUserById(row.user_id);
  if (!user) return generic;

  const newHash = await hashPasswordAsync(newPassword as string);
  await db.setUserPasswordHash(user.id, newHash);

  // Invalidate all other outstanding tokens for this user, unlock, revoke every session.
  await query('UPDATE password_reset_tokens SET used_at = $1 WHERE user_id = $2 AND used_at IS NULL', [
    new Date().toISOString(),
    user.id,
  ]);
  await clearLockAndCounters(accountKeyFor(user.email), user.id, 'password_reset');
  const revoked = await revokeAllUserSessions(user.id, 'password_reset');

  await logSecurityEvent({
    type: 'password_reset_completed',
    outcome: 'success',
    userId: user.id,
    accountHint: maskEmail(user.email),
    req,
    details: { sessionsRevoked: revoked },
    awaitWrite: true,
  });
  await logSecurityEvent({ type: 'account_unlocked', outcome: 'success', userId: user.id, req, details: { method: 'password_reset' } });
  return { ok: true };
}

export { sanitizeForLog };
