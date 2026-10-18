import crypto from 'node:crypto';
import { query } from './connection.ts';
import { ensureSecuritySchema } from '../securitySchema.ts';
import type { User, Organization } from '../db.ts';

/**
 * Server-side session store (PostgreSQL only - there is intentionally NO in-memory fallback).
 *
 * Lifecycle rules enforced on EVERY protected request:
 *  - idle timeout: a session is rejected 6 hours after its last authenticated activity;
 *  - absolute lifetime: a session is rejected 7 days after creation no matter how active it is;
 *  - revocation: logout / lockout / password change / role change set `revoked_at`; revoked tokens
 *    are never accepted again and presenting one is reported as suspicious reuse;
 *  - tokens are stored only as SHA-256 hashes, so a database leak does not yield usable tokens.
 */
export const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** Activity timestamps are refreshed at most this often to bound write amplification. */
const TOUCH_GRANULARITY_MS = 30 * 1000;

export interface PersistentSession {
  userId: string;
  orgId: string;
  expiresAt: number;
  user: User;
  org: Organization;
  csrfToken: string;
  tokenHash: string;
  lastActivityAt: number;
  absoluteExpiresAt: number;
}

export type SessionLookup =
  | { status: 'valid'; session: PersistentSession }
  | { status: 'expired' | 'revoked' | 'unknown'; userId?: string };

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return `pv_sess_${crypto.randomBytes(32).toString('hex')}`;
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export async function createSession(
  token: string,
  userId: string,
  orgId: string,
  expiresAtMs: number,
  opts: { csrfToken?: string; ipHash?: string; userAgent?: string } = {}
): Promise<{ csrfToken: string; expiresAtMs: number; absoluteExpiresAtMs: number }> {
  await ensureSecuritySchema();
  const tokenHash = hashSessionToken(token);
  const id = `sess_${crypto.randomBytes(12).toString('hex')}`;
  const now = Date.now();
  const idleDeadline = Math.min(expiresAtMs, now + SESSION_IDLE_MS);
  const absolute = now + SESSION_ABSOLUTE_MS;
  const csrf = opts.csrfToken || generateCsrfToken();

  // No ON CONFLICT ... DO UPDATE: a colliding/replayed token must never silently extend or revive a session.
  await query(
    `INSERT INTO sessions (id, token_hash, user_id, org_id, expires_at, created_at,
                           last_activity_at, absolute_expires_at, csrf_token, ip_hash, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      tokenHash,
      userId,
      orgId,
      new Date(idleDeadline).toISOString(),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      new Date(absolute).toISOString(),
      csrf,
      opts.ipHash || null,
      opts.userAgent ? opts.userAgent.slice(0, 160) : null,
    ]
  );
  return { csrfToken: csrf, expiresAtMs: idleDeadline, absoluteExpiresAtMs: absolute };
}

function toMs(v: any): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Looks a token up and classifies it. Pure read - callers decide whether to touch/refresh.
 */
export async function lookupSession(token: string): Promise<SessionLookup> {
  if (!token || typeof token !== 'string' || token.length > 200 || !/^pv_sess_[0-9a-f]{16,128}$/.test(token)) {
    return { status: 'unknown' };
  }
  await ensureSecuritySchema();
  const tokenHash = hashSessionToken(token);

  const res = await query(
    `SELECT s.user_id, s.org_id, s.expires_at, s.created_at, s.last_activity_at, s.absolute_expires_at,
            s.revoked_at, s.csrf_token,
            u.id as u_id, u.email as u_email, u.name as u_name, u.password_hash as u_password_hash,
            u.role as u_role, u.org_id as u_org_id, u.avatar_url as u_avatar_url,
            u.email_verified as u_email_verified, u.referral_code as u_referral_code,
            u.referred_by_user_id as u_referred_by_user_id, u.referred_by_code as u_referred_by_code,
            u.referred_at as u_referred_at, u.created_at as u_created_at,
            o.id as o_id, o.name as o_name, o.plan_id as o_plan_id, o.billing_interval as o_billing_interval,
            o.currency as o_currency, o.owner_id as o_owner_id, o.trial_started_at as o_trial_started_at,
            o.trial_ends_at as o_trial_ends_at, o.trial_used as o_trial_used, o.white_label as o_white_label,
            o.clients as o_clients, o.created_at as o_created_at
     FROM sessions s
     INNER JOIN users u ON s.user_id = u.id
     INNER JOIN organizations o ON s.org_id = o.id
     WHERE s.token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  if (res.rows.length === 0) return { status: 'unknown' };
  const row = res.rows[0];
  const now = Date.now();

  if (row.revoked_at) return { status: 'revoked', userId: row.user_id };

  const createdAt = toMs(row.created_at) ?? now;
  const lastActivity = toMs(row.last_activity_at) ?? createdAt;
  const absolute = toMs(row.absolute_expires_at) ?? createdAt + SESSION_ABSOLUTE_MS;
  const expiresAt = toMs(row.expires_at) ?? lastActivity + SESSION_IDLE_MS;

  if (now >= absolute || now >= expiresAt || now - lastActivity >= SESSION_IDLE_MS) {
    return { status: 'expired', userId: row.user_id };
  }

  const user: User = {
    id: row.u_id,
    email: row.u_email,
    name: row.u_name,
    passwordHash: row.u_password_hash,
    role: row.u_role,
    orgId: row.u_org_id,
    avatarUrl: row.u_avatar_url || undefined,
    emailVerified: Boolean(row.u_email_verified),
    referralCode: row.u_referral_code || undefined,
    referredByUserId: row.u_referred_by_user_id || undefined,
    referredByCode: row.u_referred_by_code || undefined,
    referredAt: row.u_referred_at ? new Date(row.u_referred_at).toISOString() : undefined,
    createdAt: new Date(row.u_created_at).toISOString(),
  };

  const org: Organization = {
    id: row.o_id,
    name: row.o_name,
    planId: row.o_plan_id,
    billingInterval: row.o_billing_interval,
    currency: row.o_currency,
    ownerId: row.o_owner_id,
    trialStartedAt: row.o_trial_started_at ? new Date(row.o_trial_started_at).toISOString() : undefined,
    trialEndsAt: row.o_trial_ends_at ? new Date(row.o_trial_ends_at).toISOString() : undefined,
    trialUsed: Boolean(row.o_trial_used),
    whiteLabel:
      typeof row.o_white_label === 'string'
        ? JSON.parse(row.o_white_label)
        : row.o_white_label || { enabled: false, brandName: '' },
    clients: typeof row.o_clients === 'string' ? JSON.parse(row.o_clients) : row.o_clients || [],
    createdAt: new Date(row.o_created_at).toISOString(),
  };

  return {
    status: 'valid',
    session: {
      userId: row.user_id,
      orgId: row.org_id,
      expiresAt,
      user,
      org,
      csrfToken: row.csrf_token || '',
      tokenHash,
      lastActivityAt: lastActivity,
      absoluteExpiresAt: absolute,
    },
  };
}

/** Back-compatible helper: returns the session only when it is currently valid. */
export async function findSessionByToken(token: string): Promise<PersistentSession | null> {
  const r = await lookupSession(token);
  return r.status === 'valid' ? r.session : null;
}

/**
 * Refreshes the inactivity deadline after valid authenticated activity. The deadline never moves
 * beyond the absolute lifetime. Returns the new idle deadline.
 */
export async function touchSession(session: PersistentSession): Promise<number> {
  const now = Date.now();
  if (now - session.lastActivityAt < TOUCH_GRANULARITY_MS) return session.expiresAt;
  const newExpiry = Math.min(now + SESSION_IDLE_MS, session.absoluteExpiresAt);
  await query(
    `UPDATE sessions SET last_activity_at = $1, expires_at = $2
     WHERE token_hash = $3 AND revoked_at IS NULL`,
    [new Date(now).toISOString(), new Date(newExpiry).toISOString(), session.tokenHash]
  );
  return newExpiry;
}

/** Revokes one session (logout). Returns true when an active session was revoked. */
export async function revokeSessionByToken(token: string, reason = 'logout'): Promise<boolean> {
  if (!token) return false;
  await ensureSecuritySchema();
  const res = await query(
    `UPDATE sessions SET revoked_at = $1, revoked_reason = $2
     WHERE token_hash = $3 AND revoked_at IS NULL`,
    [new Date().toISOString(), reason, hashSessionToken(token)]
  );
  return (res.rowCount || 0) > 0;
}

/** Revokes every active session of a user (password change/reset, lockout, role change). */
export async function revokeAllUserSessions(userId: string, reason: string, exceptTokenHash?: string): Promise<number> {
  await ensureSecuritySchema();
  const params: any[] = [new Date().toISOString(), reason, userId];
  let sql = 'UPDATE sessions SET revoked_at = $1, revoked_reason = $2 WHERE user_id = $3 AND revoked_at IS NULL';
  if (exceptTokenHash) {
    sql += ' AND token_hash <> $4';
    params.push(exceptTokenHash);
  }
  const res = await query(sql, params);
  return res.rowCount || 0;
}

/** Back-compatible name: deleting == revoking, so replay of the old token is detectable. */
export async function deleteSessionByToken(token: string): Promise<void> {
  await revokeSessionByToken(token, 'logout');
}

export async function cleanupExpiredSessions(): Promise<number> {
  const res = await query('DELETE FROM sessions WHERE expires_at <= $1', [
    new Date(Date.now() - 7 * 86400_000).toISOString(),
  ]);
  return res.rowCount || 0;
}
