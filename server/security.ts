import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { query } from './db/connection.ts';
import { ensureSecuritySchema } from './securitySchema.ts';

/* ------------------------------------------------------------------------------------------------
 * Environment & configuration
 * ---------------------------------------------------------------------------------------------- */

export const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Secrets that must exist in production. The process refuses to start without them. */
const REQUIRED_PRODUCTION_ENV = ['DATABASE_URL', 'LBANK_API_KEY', 'LBANK_SECRET_KEY', 'LBANK_USDT_TRC20_ADDRESS'];
const RECOMMENDED_PRODUCTION_ENV = ['PUBLIC_APP_URL', 'SECURITY_PEPPER'];

export interface EnvValidationResult {
  missing: string[];
  warnings: string[];
}

/**
 * Validates production configuration. Only variable NAMES are ever reported - never values.
 * Throws in production when an essential secret is missing (fail secure).
 */
export function validateProductionEnvironment(env: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const missing = REQUIRED_PRODUCTION_ENV.filter((k) => !(env[k] || '').trim());
  const warnings = RECOMMENDED_PRODUCTION_ENV.filter((k) => !(env[k] || '').trim()).map(
    (k) => `${k} is not set; a safe default will be used`
  );
  if ((env.PUBLIC_APP_URL || env.APP_URL || '').trim() && !/^https:\/\//i.test((env.PUBLIC_APP_URL || env.APP_URL || '').trim())) {
    warnings.push('PUBLIC_APP_URL is not https:// - session cookies cannot be marked Secure and HSTS stays disabled');
  }
  if (isProduction() && missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
  return { missing, warnings };
}

function pepper(): string {
  return process.env.SECURITY_PEPPER || 'pv-default-pepper-change-me';
}

export function publicAppUrl(): string {
  return (process.env.PUBLIC_APP_URL || process.env.APP_URL || '').trim().replace(/\/+$/, '');
}

/** Secure cookies only when the deployment is actually served over HTTPS (otherwise login would break). */
export function cookiesSecure(): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return isProduction() && /^https:\/\//i.test(publicAppUrl());
}

export const SESSION_IDLE_TIMEOUT_MS = 6 * 60 * 60 * 1000; // six hours of inactivity
export const SESSION_ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // hard cap regardless of activity
export const SESSION_COOKIE_NAME = 'pv_session';
export const CSRF_COOKIE_NAME = 'pv_csrf';

/* ------------------------------------------------------------------------------------------------
 * Request metadata (request id, client ip) and log-safe helpers
 * ---------------------------------------------------------------------------------------------- */

const requestIds = new WeakMap<object, string>();

export function getRequestId(req: IncomingMessage): string {
  let id = requestIds.get(req);
  if (!id) {
    const inbound = req.headers?.['x-request-id'];
    id =
      typeof inbound === 'string' && /^[A-Za-z0-9._-]{8,64}$/.test(inbound)
        ? inbound
        : crypto.randomBytes(8).toString('hex');
    requestIds.set(req, id);
  }
  return id;
}

function isLoopbackOrPrivate(addr: string): boolean {
  const a = addr.replace(/^::ffff:/, '');
  return (
    a === '127.0.0.1' || a === '::1' || a.startsWith('10.') || a.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(a)
  );
}

/**
 * Client IP. X-Forwarded-For is trusted ONLY when the TCP peer is a local/private reverse proxy
 * (our own nginx). We then use the right-most entry, which is the one the trusted proxy appended -
 * anything to its left is attacker-controlled and ignored.
 */
export function getClientIp(req: IncomingMessage): string {
  const peer = (req.socket?.remoteAddress || '').trim();
  if (peer && process.env.TRUST_PROXY !== 'false' && isLoopbackOrPrivate(peer)) {
    const xff = req.headers?.['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff.join(',') : xff;
    if (raw) {
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const candidate = parts[parts.length - 1];
      if (candidate && /^[0-9a-fA-F:.]{3,45}$/.test(candidate)) return candidate.replace(/^::ffff:/, '');
    }
  }
  return (peer || 'unknown').replace(/^::ffff:/, '');
}

export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(`${pepper()}|ip|${ip}`).digest('hex').slice(0, 32);
}

/** Minimised IP for audit logs: IPv4 /24, IPv6 /48. */
export function maskIp(ip: string): string {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip.replace(/\.\d+$/, '.0');
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::';
  return ip.slice(0, 45);
}

export function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.normalize('NFKC').trim().toLowerCase().slice(0, 254) : '';
}

/** Stable per-account key for lockout tracking; identical for existing and non-existing accounts. */
export function accountKeyFor(email: string): string {
  return crypto.createHash('sha256').update(`${pepper()}|acct|${normalizeEmail(email)}`).digest('hex');
}

export function maskEmail(email: string): string {
  const e = normalizeEmail(email);
  const [local, domain] = e.split('@');
  if (!domain) return '';
  return `${local.slice(0, 1)}***@${domain}`.slice(0, 120);
}

/** Strips control characters/newlines (log injection) and bounds the length. */
export function sanitizeForLog(value: unknown, max = 200): string {
  const s = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  return s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').slice(0, max);
}

/* ------------------------------------------------------------------------------------------------
 * Cookies
 * ---------------------------------------------------------------------------------------------- */

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers?.cookie;
  const out: Record<string, string> = {};
  if (!header || typeof header !== 'string' || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        // ignore malformed cookie values
      }
    }
  }
  return out;
}

export function buildSessionCookie(token: string, maxAgeSec: number): string {
  const attrs = [`${SESSION_COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (cookiesSecure()) attrs.push('Secure');
  return attrs.join('; ');
}

/** CSRF companion cookie: readable by the SPA (NOT HttpOnly) so it can echo it in X-CSRF-Token. */
export function buildCsrfCookie(token: string, maxAgeSec: number): string {
  const attrs = [`${CSRF_COOKIE_NAME}=${token}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (cookiesSecure()) attrs.push('Secure');
  return attrs.join('; ');
}

export function buildClearCookies(): string[] {
  const secure = cookiesSecure() ? '; Secure' : '';
  return [
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `${CSRF_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
  ];
}

/* ------------------------------------------------------------------------------------------------
 * Headers, CORS and origin checks
 * ---------------------------------------------------------------------------------------------- */

export function applyApiSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}

export function applyPageSecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto === 'https' || (req.socket as any)?.encrypted) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export function allowedOrigins(): Set<string> {
  const set = new Set<string>();
  for (const raw of (process.env.CORS_ALLOWED_ORIGINS || '').split(',')) {
    const t = raw.trim().replace(/\/+$/, '');
    if (t && t !== '*') set.add(t);
  }
  const pub = publicAppUrl();
  if (pub) {
    try {
      set.add(new URL(pub).origin);
    } catch {
      // ignore malformed config
    }
  }
  return set;
}

/** True when the Origin header equals the host the request was addressed to, or is explicitly allowlisted. */
export function isTrustedOrigin(req: IncomingMessage, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (allowedOrigins().has(parsed.origin)) return true;
  const host = req.headers?.host;
  if (host && parsed.host.toLowerCase() === String(host).toLowerCase()) return true;
  if (!isProduction() && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(parsed.host)) return true;
  return false;
}

/**
 * Applies CORS headers ONLY for allowlisted origins (never `*`, never reflected blindly).
 * Same-origin browser requests do not need CORS at all.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers?.origin;
  res.setHeader('Vary', 'Origin');
  if (typeof origin !== 'string' || !origin) return;
  let parsedOrigin = '';
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    return;
  }
  if (allowedOrigins().has(parsedOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', parsedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-PV-Client, X-Request-Id');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

export const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/* ------------------------------------------------------------------------------------------------
 * In-memory sliding-window rate limiter (bounded memory)
 * ---------------------------------------------------------------------------------------------- */

const rateBuckets = new Map<string, number[]>();
const MAX_RATE_KEYS = 50_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (process.env.SECURITY_DISABLE_RATE_LIMITS === 'true') {
    return { allowed: true, retryAfterSec: 0, remaining: limit };
  }
  const now = Date.now();
  const cutoff = now - windowMs;
  let hits = rateBuckets.get(key);
  if (!hits) {
    if (rateBuckets.size >= MAX_RATE_KEYS) {
      // Evict the oldest key (Map preserves insertion order) so attackers cannot exhaust memory.
      const first = rateBuckets.keys().next().value;
      if (first !== undefined) rateBuckets.delete(first);
    }
    hits = [];
    rateBuckets.set(key, hits);
  }
  while (hits.length && hits[0] <= cutoff) hits.shift();
  if (hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec, remaining: 0 };
  }
  hits.push(now);
  return { allowed: true, retryAfterSec: 0, remaining: limit - hits.length };
}

export function resetRateLimits(): void {
  rateBuckets.clear();
}

setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of rateBuckets) {
    if (!hits.length || hits[hits.length - 1] < now - 3600_000) rateBuckets.delete(k);
  }
}, 60_000).unref();

/* ------------------------------------------------------------------------------------------------
 * Security audit events
 * ---------------------------------------------------------------------------------------------- */

export type SecurityEventType =
  | 'login_success'
  | 'login_failure'
  | 'login_blocked'
  | 'login_blocked_locked'
  | 'account_locked'
  | 'account_unlocked'
  | 'logout'
  | 'session_created'
  | 'session_expired'
  | 'session_revoked'
  | 'session_reuse_suspected'
  | 'session_storage_failure'
  | 'password_changed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'password_rehashed'
  | 'registration'
  | 'unauthorized_access'
  | 'forbidden_access'
  | 'idor_blocked'
  | 'ssrf_blocked'
  | 'csrf_rejected'
  | 'origin_rejected'
  | 'rate_limited'
  | 'suspicious_scan'
  | 'role_changed'
  | 'admin_action'
  | 'payment_status_change'
  | 'security_setting_change'
  | 'api_key_rejected';

export interface SecurityEventInput {
  type: SecurityEventType;
  outcome: 'success' | 'failure' | 'blocked' | 'info';
  userId?: string | null;
  accountHint?: string;
  actorRole?: string | null;
  req?: IncomingMessage;
  details?: Record<string, unknown> | string;
  /** When true the promise resolves only after the DB write finished (used for critical events). */
  awaitWrite?: boolean;
}

const SECRET_LIKE = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|hash)/i;

function sanitizeDetails(details: SecurityEventInput['details']): string {
  if (!details) return '';
  if (typeof details === 'string') return sanitizeForLog(details, 500);
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(details)) {
    safe[sanitizeForLog(k, 40)] = SECRET_LIKE.test(k) ? '[redacted]' : sanitizeForLog(v, 200);
  }
  return JSON.stringify(safe).slice(0, 800);
}

export async function logSecurityEvent(input: SecurityEventInput): Promise<void> {
  const ts = new Date().toISOString(); // always UTC
  const ip = input.req ? maskIp(getClientIp(input.req)) : '';
  const ua = input.req ? sanitizeForLog(input.req.headers?.['user-agent'], 120) : '';
  const requestId = input.req ? getRequestId(input.req) : '';
  const details = sanitizeDetails(input.details);
  const id = `sev_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;

  // 1) Structured line on stdout/journald, separate channel from ordinary debug logs.
  try {
    process.stdout.write(
      JSON.stringify({
        channel: 'security_audit',
        ts,
        id,
        event: input.type,
        outcome: input.outcome,
        userId: input.userId || undefined,
        account: input.accountHint || undefined,
        role: input.actorRole || undefined,
        ip: ip || undefined,
        requestId: requestId || undefined,
        details: details || undefined,
      }) + '\n'
    );
  } catch {
    // never let log failures break request handling
  }

  // 2) Durable copy in PostgreSQL.
  const write = (async () => {
    await ensureSecuritySchema();
    await query(
      `INSERT INTO security_events (id, ts, event_type, outcome, user_id, account_hint, actor_role, ip, user_agent, request_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        ts,
        input.type,
        input.outcome,
        input.userId || null,
        input.accountHint || null,
        input.actorRole || null,
        ip || null,
        ua || null,
        requestId || null,
        details || null,
      ]
    );
  })().catch((err) => {
    // Failure of the durable log must not disable controls nor leak details.
    console.error('[SecurityAudit] durable write failed:', sanitizeForLog(err?.message, 120));
  });

  if (input.awaitWrite) await write;
}

export interface SecurityEventRow {
  id: string;
  ts: string;
  eventType: string;
  outcome: string;
  userId: string | null;
  accountHint: string | null;
  actorRole: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  details: string | null;
}

export async function listSecurityEvents(opts: {
  page?: number;
  pageSize?: number;
  type?: string;
}): Promise<{ events: SecurityEventRow[]; page: number; pageSize: number; total: number }> {
  await ensureSecuritySchema();
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 50, 1), 200);
  const page = Math.max(Number(opts.page) || 1, 1);
  const offset = (page - 1) * pageSize;
  const type = opts.type && /^[a-z_]{1,40}$/.test(opts.type) ? opts.type : null;

  const where = type ? 'WHERE event_type = $1' : '';
  const countRes = await query(`SELECT COUNT(*) AS c FROM security_events ${where}`, type ? [type] : []);
  const params: any[] = type ? [type, pageSize, offset] : [pageSize, offset];
  const rows = await query(
    `SELECT * FROM security_events ${where} ORDER BY ts DESC LIMIT $${type ? 2 : 1} OFFSET $${type ? 3 : 2}`,
    params
  );
  return {
    events: rows.rows.map((r: any) => ({
      id: r.id,
      ts: new Date(r.ts).toISOString(),
      eventType: r.event_type,
      outcome: r.outcome,
      userId: r.user_id,
      accountHint: r.account_hint,
      actorRole: r.actor_role,
      ip: r.ip,
      userAgent: r.user_agent,
      requestId: r.request_id,
      details: r.details,
    })),
    page,
    pageSize,
    total: Number(countRes.rows[0]?.c || 0),
  };
}

/** Retention: keeps security tables bounded. Intended to run hourly. */
export async function pruneSecurityData(): Promise<void> {
  await ensureSecuritySchema();
  const days = Math.max(Number(process.env.SECURITY_LOG_RETENTION_DAYS) || 180, 7);
  const cutoffEvents = new Date(Date.now() - days * 86400_000).toISOString();
  const cutoffAttempts = new Date(Date.now() - 3 * 86400_000).toISOString();
  const cutoffMisc = new Date(Date.now() - 7 * 86400_000).toISOString();
  const nowIso = new Date().toISOString();
  const jobs: Array<[string, any[]]> = [
    ['DELETE FROM security_events WHERE ts < $1', [cutoffEvents]],
    ['DELETE FROM login_attempts WHERE created_at < $1', [cutoffAttempts]],
    ['DELETE FROM password_reset_tokens WHERE expires_at < $1', [cutoffMisc]],
    ['DELETE FROM account_lockouts WHERE expires_at < $1', [cutoffMisc]],
    ['DELETE FROM sessions WHERE expires_at < $1', [cutoffMisc]],
    ['DELETE FROM sessions WHERE revoked_at IS NOT NULL AND revoked_at < $1', [cutoffMisc]],
  ];
  void nowIso;
  for (const [sql, params] of jobs) {
    try {
      await query(sql, params);
    } catch (err: any) {
      console.error('[SecurityPrune] failed:', sanitizeForLog(err?.message, 120));
    }
  }
}
