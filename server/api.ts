import 'dotenv/config';
import { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { db, hashPasswordAsync, verifyPasswordAsync, burnDummyPasswordVerification, needsPasswordRehash, type User, type Website, type Organization, type AlertNotification, type ReportItem, type SupportTicket, type ApiKey } from './db.ts';
import { performWebsiteScan, normalizeInputUrl, validateTargetSecurity } from './scanner.ts';
import { performPageSpeedAnalysis } from './pagespeed.ts';
import type { CombinedPageSpeedResult } from './pagespeedTypes.ts';
import { getAccountTrialStatus, TRIAL_EXPIRED_RESPONSE } from './trial.ts';
import { monitorEngine } from './monitor.ts';
import { createCryptoPaymentOrder, verifyPaymentOrder, testLBankConnection } from './lbank.ts';
import { approvePaymentOrder, rejectPaymentOrder, cancelPaymentOrder } from './paymentApproval.ts';
import { UserRepo, OrgRepo } from './db/repositories.ts';
import {
  generateUniqueReferralCodeForUser,
  ensureUserReferralCode,
  validateReferralCodeForRegistration,
  applyReferralCodeToUser,
  getUserReferralSummary,
  createWithdrawalRequest,
  getUserWithdrawalRequests,
  getAdminWithdrawalRequests,
  approveWithdrawalForPayout,
  markWithdrawalAsPaid,
  rejectWithdrawalRequest,
  cancelWithdrawalRequest,
  getAdminReferralOverview,
} from './referrals.ts';
import {
  createSession as createDbSession,
  lookupSession,
  touchSession,
  revokeSessionByToken,
  revokeAllUserSessions,
  generateSessionToken,
  generateCsrfToken,
  hashSessionToken,
  SESSION_IDLE_MS,
  type PersistentSession,
} from './db/sessionRepo.ts';
import {
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  STATE_CHANGING_METHODS,
  accountKeyFor,
  applyApiSecurityHeaders,
  applyCors,
  buildClearCookies,
  buildCsrfCookie,
  buildSessionCookie,
  getClientIp,
  getRequestId,
  hashIp,
  isTrustedOrigin,
  listSecurityEvents,
  logSecurityEvent,
  maskEmail,
  normalizeEmail,
  parseCookies,
  rateLimit,
  sanitizeForLog,
  isProduction,
} from './security.ts';
import {
  adminUnlockAccount,
  beginLoginAttempt,
  completeLoginAttempt,
  confirmPasswordReset,
  requestPasswordReset,
  validatePasswordPolicy,
} from './accountSecurity.ts';
import { SsrfBlockedError, safeFetch } from './ssrf.ts';
import {
  createSupportTicket,
  listCustomerSupportTickets,
  listAdminSupportTickets,
  getSupportTicketDetail,
  replyToSupportTicket,
  updateSupportTicketStatus,
  isAdminUser,
  TicketValidationError,
  TicketAccessDeniedError,
  TicketNotFoundError,
} from './tickets.ts';
import {
  getOrganizationEntitlementSummary,
  backfillSubscriptionEntitlements,
  isExemptSuperAdmin,
  reconcileOrganizationWebsiteAllocations,
  cleanupOverdueExpiredWebsites,
  allocateEntitlementForNewWebsite,
  verifyWebsiteAccessAndEntitlement,
  sanitizeWebsiteForList,
} from './entitlements.ts';
import {
  performWhoisLookup,
  validateAndNormalizeWhoisDomain,
} from './whois.ts';

function getPublicOrigin(req: IncomingMessage): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.VITE_APP_URL;
  if (configured && configured.trim() && /^https?:\/\//i.test(configured.trim())) {
    return configured.trim().replace(/\/+$/, '');
  }
  // Never trust Origin / X-Forwarded-* for building links (host-header injection). Fall back to a
  // syntactically valid Host header only when no public URL is configured (development).
  const host = String(req.headers['host'] || '');
  if (/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return `http://${host}`;
  return 'http://localhost:3000';
}

/** Error with a status code and a message that is safe to return to the public client. */
class HttpError extends Error {
  status: number;
  extraHeaders?: Record<string, string>;
  constructor(status: number, message: string, extraHeaders?: Record<string, string>) {
    super(message);
    this.status = status;
    this.extraHeaders = extraHeaders;
  }
}

const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES) || 256 * 1024;

// ------------------------------------------------------------------------------------------------
// Authentication / session resolution (PostgreSQL-backed sessions only; no in-memory fallback)
// ------------------------------------------------------------------------------------------------
interface AuthContext {
  user: User;
  org: Organization;
  session: PersistentSession;
  via: 'cookie' | 'bearer';
}
type AuthState =
  | { kind: 'none' }
  | { kind: 'invalid'; via: 'cookie' | 'bearer' }
  | { kind: 'csrf'; via: 'cookie' }
  | { kind: 'ok'; ctx: AuthContext };

const authCache = new WeakMap<object, AuthState>();

function extractCredentials(req: IncomingMessage): { token: string; via: 'cookie' | 'bearer' } | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && /^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token.startsWith('pv_sess_')) return { token, via: 'bearer' };
    // pv_live_* values are developer API keys, handled by the /api/v1 handlers - not sessions.
    return null;
  }
  const cookieToken = parseCookies(req)[SESSION_COOKIE_NAME];
  if (cookieToken) return { token: cookieToken, via: 'cookie' };
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length || ab.length === 0) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function authenticate(req: IncomingMessage): Promise<AuthState> {
  const cached = authCache.get(req);
  if (cached) return cached;

  const creds = extractCredentials(req);
  if (!creds) {
    const s: AuthState = { kind: 'none' };
    authCache.set(req, s);
    return s;
  }

  let lookup;
  try {
    lookup = await lookupSession(creds.token);
  } catch (err: any) {
    // Persistent session storage unavailable -> fail closed. Never fall back to in-memory sessions.
    void logSecurityEvent({ type: 'session_storage_failure', outcome: 'failure', req, details: { op: 'lookup' } });
    throw new HttpError(503, 'Service temporarily unavailable. Please try again shortly.');
  }

  if (lookup.status !== 'valid') {
    if (lookup.status === 'expired') {
      void logSecurityEvent({ type: 'session_expired', outcome: 'info', userId: lookup.userId, req });
    } else if (lookup.status === 'revoked') {
      void logSecurityEvent({ type: 'session_reuse_suspected', outcome: 'blocked', userId: lookup.userId, req, details: { reason: 'revoked_token_presented' } });
    }
    const s: AuthState = { kind: 'invalid', via: creds.via };
    authCache.set(req, s);
    return s;
  }

  const session = lookup.session;
  const cleanEmail = (session.user.email || '').trim().toLowerCase();
  if (cleanEmail === 'admin@pulsevanguard.com' || cleanEmail === 'agency@acmedigital.com') {
    await revokeSessionByToken(creds.token, 'decommissioned_account').catch(() => false);
    const s: AuthState = { kind: 'invalid', via: creds.via };
    authCache.set(req, s);
    return s;
  }

  // CSRF: cookie-authenticated state-changing requests must echo the per-session token.
  const method = (req.method || 'GET').toUpperCase();
  if (creds.via === 'cookie' && STATE_CHANGING_METHODS.has(method)) {
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || !constantTimeEqual(header, session.csrfToken)) {
      void logSecurityEvent({ type: 'csrf_rejected', outcome: 'blocked', userId: session.userId, req });
      const s: AuthState = { kind: 'csrf', via: 'cookie' };
      authCache.set(req, s);
      return s;
    }
  }

  // Valid authenticated activity: slide the inactivity deadline (never past the absolute lifetime).
  try {
    session.expiresAt = await touchSession(session);
  } catch {
    // Non-fatal: the existing deadline still applies.
  }

  // Prefer the shared in-memory entities (existing routes mutate them) but take the ROLE from the
  // database row so privilege changes apply immediately and cannot be stale.
  const memUser = db.findUserById(session.userId);
  const memOrg = db.findOrgById(session.orgId);
  let user: User = session.user;
  if (memUser) user = memUser.role === session.user.role ? memUser : { ...memUser, role: session.user.role };
  const org: Organization = memOrg || session.org;

  const s: AuthState = { kind: 'ok', ctx: { user, org, session, via: creds.via } };
  authCache.set(req, s);
  return s;
}

async function resolveSession(req: IncomingMessage): Promise<{ user: User; org: Organization } | null> {
  const state = await authenticate(req);
  return state.kind === 'ok' ? { user: state.ctx.user, org: state.ctx.org } : null;
}

/**
 * Creates and PERSISTS a session. Throws (HTTP 503) if persistence fails - a session is never
 * handed out unless it was durably stored.
 */
async function issueSession(
  req: IncomingMessage,
  res: ServerResponse,
  user: User,
  includeTokenInBody: boolean
): Promise<{ token?: string; csrfToken: string }> {
  const token = generateSessionToken();
  let csrfToken: string;
  let expiresAtMs: number;
  try {
    await db.ensureSchema();
    const created = await createDbSession(token, user.id, user.orgId, Date.now() + SESSION_IDLE_MS, {
      csrfToken: generateCsrfToken(),
      ipHash: hashIp(getClientIp(req)),
      userAgent: sanitizeForLog(req.headers['user-agent'], 160),
    });
    csrfToken = created.csrfToken;
    expiresAtMs = created.expiresAtMs;
  } catch (err: any) {
    void logSecurityEvent({ type: 'session_storage_failure', outcome: 'failure', userId: user.id, req, details: { op: 'create' } });
    throw new HttpError(503, 'Sign-in is temporarily unavailable. Please try again shortly.');
  }
  const maxAgeSec = Math.max(60, Math.floor((expiresAtMs - Date.now()) / 1000));
  res.setHeader('Set-Cookie', [buildSessionCookie(token, maxAgeSec), buildCsrfCookie(csrfToken, maxAgeSec)]);
  void logSecurityEvent({ type: 'session_created', outcome: 'success', userId: user.id, actorRole: user.role, req });
  return { token: includeTokenInBody ? token : undefined, csrfToken };
}

/** Browser SPA sends X-PV-Client: web and never receives the raw token (cookie only). */
function isWebClient(req: IncomingMessage): boolean {
  return String(req.headers['x-pv-client'] || '').toLowerCase() === 'web';
}

// Helper to read JSON body (size capped, prototype-pollution keys stripped)
async function readJsonBody(req: IncomingMessage): Promise<any> {
  if ((req as any).body && typeof (req as any).body === 'object') {
    return (req as any).body;
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer | string) => {
      if (tooLarge) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > MAX_JSON_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Request body too large.', { Connection: 'close' }));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      if (tooLarge) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        if (!raw.trim()) return resolve({});
        const parsed = JSON.parse(raw, (key, value) =>
          key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value
        );
        if (parsed === null || typeof parsed !== 'object') {
          return reject(new HttpError(400, 'Request body must be a JSON object.'));
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, 'Invalid JSON format.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'Request could not be read.')));
  });
}

// JSON responder helper (CORS/security headers are applied once by the gateway)
function sendJson(res: ServerResponse, status: number, data: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

// ------------------------------------------------------------------------------------------------
// Input validation helpers
// ------------------------------------------------------------------------------------------------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function cleanString(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Maps scan failures to messages that are safe to show publicly (no internals). */
function publicScanError(err: any, fallback: string): string {
  const msg = String(err?.message || '').replace(/([?&]key=)[^&]+/gi, '$1[REDACTED]');
  if (
    /blocked|private|reserved|protected|Only http|valid website URL|Invalid URL|credentials|port|scheme|disallowed|PageSpeed|Lighthouse|NO_FCP|DNS_FAILURE|WHOIS|RDAP|Registry|domain|not registered|API key|rate limit|quota|timed out|Unable to analyze/i.test(
      msg
    )
  ) {
    return msg.slice(0, 320);
  }
  return fallback;
}

function isAdminRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'super_admin';
}

// Routes reachable without a session. EVERYTHING else under /api is denied by default at the gateway.
const PUBLIC_EXACT_PATHS = new Set([
  '/api/healthz',
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/reset-password',
  '/api/auth/reset-password/confirm',
  '/api/scan',
  '/api/scanner/pagespeed',
  '/api/billing/plans',
  '/api/referrals/validate',
]);
const PUBLIC_PREFIXES = ['/api/reports/share/', '/api/v1/'];

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

// Concurrent unauthenticated scans per client IP (resource exhaustion guard)
const activeScansByIp = new Map<string, number>();

export async function handleApiRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const reqUrl = req.url || (req as any).originalUrl || '';
  if (!reqUrl.startsWith('/api/')) return false;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(reqUrl, 'http://localhost');
  } catch {
    sendJson(res, 400, { error: 'Bad request.' });
    return true;
  }
  const path = parsedUrl.pathname;
  const method = req.method?.toUpperCase() || 'GET';

  // ---- Gateway: request id, headers, CORS, method/content-type policy, throttling ----------------
  const requestId = getRequestId(req);
  res.setHeader('X-Request-Id', requestId);
  applyApiSecurityHeaders(res);
  applyCors(req, res);

  if (!ALLOWED_METHODS.has(method)) {
    res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    sendJson(res, 405, { error: 'Method not allowed.' });
    return true;
  }

  // Handle CORS preflight: only allowlisted origins receive CORS headers (see applyCors)
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);

  const globalIp = rateLimit(`api:ip:${ipHash}`, Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 600, 60_000);
  if (!globalIp.allowed) {
    void logSecurityEvent({ type: 'rate_limited', outcome: 'blocked', req, details: { scope: 'api_global_ip' } });
    res.setHeader('Retry-After', String(globalIp.retryAfterSec));
    sendJson(res, 429, { error: 'Too many requests. Please slow down.' });
    return true;
  }

  // Browser CSRF defence layer 1: cross-origin state-changing requests are rejected outright.
  if (STATE_CHANGING_METHODS.has(method)) {
    const origin = req.headers['origin'];
    if (typeof origin === 'string' && origin && !isTrustedOrigin(req, origin)) {
      void logSecurityEvent({ type: 'origin_rejected', outcome: 'blocked', req, details: { origin: sanitizeForLog(origin, 100) } });
      sendJson(res, 403, { error: 'Cross-origin request rejected.' });
      return true;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site' && !(typeof origin === 'string' && isTrustedOrigin(req, origin))) {
      void logSecurityEvent({ type: 'origin_rejected', outcome: 'blocked', req, details: { reason: 'sec-fetch-site' } });
      sendJson(res, 403, { error: 'Cross-origin request rejected.' });
      return true;
    }
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const hasBody =
      Number(req.headers['content-length'] || 0) > 0 || Boolean(req.headers['transfer-encoding']);
    if (hasBody && !contentType.startsWith('application/json')) {
      sendJson(res, 415, { error: 'Content-Type must be application/json.' });
      return true;
    }
    if (Number(req.headers['content-length'] || 0) > MAX_JSON_BODY_BYTES) {
      res.setHeader('Connection', 'close');
      sendJson(res, 413, { error: 'Request body too large.' });
      return true;
    }
  }

  try {
    // ---- Gateway: authentication, CSRF, deny-by-default, admin namespace ---------------------------
    const isPublic = PUBLIC_EXACT_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
    const authState = await authenticate(req);

    if (authState.kind === 'csrf') {
      sendJson(res, 403, { error: 'Invalid or missing CSRF token.' });
      return true;
    }
    if (authState.kind === 'invalid' && authState.via === 'cookie') {
      // Dead cookie session: clear it so the browser stops sending it.
      res.setHeader('Set-Cookie', buildClearCookies());
    }
    if (authState.kind === 'ok' && authState.ctx.via === 'cookie') {
      // Keep the cookie lifetime aligned with the server-side sliding deadline.
      const remaining = Math.max(
        60,
        Math.floor((Math.min(authState.ctx.session.expiresAt, authState.ctx.session.absoluteExpiresAt) - Date.now()) / 1000)
      );
      res.setHeader('Set-Cookie', [
        buildSessionCookie(parseCookies(req)[SESSION_COOKIE_NAME] || '', remaining),
        buildCsrfCookie(authState.ctx.session.csrfToken, remaining),
      ]);
    }
    if (!isPublic && authState.kind !== 'ok') {
      void logSecurityEvent({ type: 'unauthorized_access', outcome: 'blocked', req, details: { method, path: sanitizeForLog(path, 120) } });
      sendJson(res, 401, { error: 'Unauthenticated' });
      return true;
    }
    if (path.startsWith('/api/admin/') && authState.kind === 'ok' && !isAdminRole(authState.ctx.user.role)) {
      void logSecurityEvent({
        type: 'forbidden_access',
        outcome: 'blocked',
        userId: authState.ctx.user.id,
        actorRole: authState.ctx.user.role,
        req,
        details: { method, path: sanitizeForLog(path, 120) },
      });
      sendJson(res, 403, { error: 'Admin privilege required' });
      return true;
    }

    // 0. HEALTH CHECK
    if ((path === '/api/healthz' || path === '/api/health') && method === 'GET') {
      sendJson(res, 200, { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
      return true;
    }

    // 1. FREE PUBLIC SCANNER & PAGESPEED INSIGHTS / AUTHENTICATED SCANNER
    if ((path === '/api/scan' || path === '/api/scanner/run') && method === 'POST') {
      const session = await resolveSession(req);
      if (path === '/api/scanner/run' && !session) {
        sendJson(res, 401, { error: 'Unauthenticated. Please log in to run scans.' });
        return true;
      }

      // Per-IP scan rate limit + concurrent scan ceiling
      const maxScansPerHour = Math.max(5, Number(db.getSettings()?.maxFreeScansPerHour) || 25);
      const scanLimit = rateLimit(`scan:ip:${ipHash}`, session ? maxScansPerHour * 4 : maxScansPerHour, 60 * 60_000);
      if (!scanLimit.allowed) {
        void logSecurityEvent({ type: 'rate_limited', outcome: 'blocked', userId: session?.user.id, req, details: { scope: 'scanner' } });
        res.setHeader('Retry-After', String(scanLimit.retryAfterSec));
        sendJson(res, 429, { error: 'Scan rate limit reached. Please wait before running another scan.' });
        return true;
      }
      const inFlight = activeScansByIp.get(ipHash) || 0;
      if (inFlight >= 3) {
        sendJson(res, 429, { error: 'Too many concurrent scans in progress from your connection.' });
        return true;
      }

      if (session && session.org.planId === 'free' && !isExemptSuperAdmin(session.user, session.org)) {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }
      }

      const body = await readJsonBody(req);
      let target = typeof body.url === 'string' ? body.url.trim() : '';
      if (body?.websiteId && !session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session && body?.websiteId) {
        const site = db.findWebsiteById(String(body.websiteId));
        const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
        if (!access.allowed) {
          if (access.isIdor) {
            void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'scan_website', websiteId: body.websiteId } });
          }
          sendJson(res, access.status || 403, access.body);
          return true;
        }
        if (!target && access.site) target = access.site.url;
      }
      if (!target || target.length > 2048) {
        sendJson(res, 400, { error: 'Please provide a valid website URL.' });
        return true;
      }

      if (session && !isExemptSuperAdmin(session.user, session.org)) {
        await reconcileOrganizationWebsiteAllocations(session.org.id).catch(() => {});
        let normalizedTargetUrl = target.toLowerCase();
        let normalizedTargetDomain = '';
        try {
          const norm = normalizeInputUrl(target);
          normalizedTargetUrl = norm.url.toLowerCase();
          normalizedTargetDomain = norm.domain.toLowerCase();
        } catch {}
        const matchingSite = db.getWebsites().find(
          (w) =>
            w.orgId === session.org.id &&
            (w.url.toLowerCase() === normalizedTargetUrl ||
              (normalizedTargetDomain && w.domain.toLowerCase() === normalizedTargetDomain) ||
              target.toLowerCase().includes(w.domain.toLowerCase()))
        );
        if (matchingSite) {
          const access = await verifyWebsiteAccessAndEntitlement(matchingSite, session.user, session.org);
          if (!access.allowed) {
            sendJson(res, access.status || 403, access.body);
            return true;
          }
        }
      }

      activeScansByIp.set(ipHash, inFlight + 1);
      try {
        const scanResult = await performWebsiteScan(target);
        try {
          scanResult.whois = await performWhoisLookup(scanResult.domain);
        } catch {
          // Non-fatal if WHOIS lookup fails during quick scan
        }

        try {
          const pageSpeedData = await performPageSpeedAnalysis(target);
          scanResult.pageSpeed = pageSpeedData;

          if (pageSpeedData.mobile) {
            db.addPageSpeedRecord({
              id: `ps_mob_${Date.now()}`,
              url: pageSpeedData.url,
              domain: pageSpeedData.domain,
              device: 'mobile',
              performance: pageSpeedData.mobile.scores.performance,
              accessibility: pageSpeedData.mobile.scores.accessibility,
              bestPractices: pageSpeedData.mobile.scores.bestPractices,
              seo: pageSpeedData.mobile.scores.seo,
              lcp: pageSpeedData.mobile.metrics.lcp,
              inp: pageSpeedData.mobile.metrics.inp,
              cls: pageSpeedData.mobile.metrics.cls,
              fcp: pageSpeedData.mobile.metrics.fcp,
              ttfb: pageSpeedData.mobile.metrics.ttfb,
              speedIndex: pageSpeedData.mobile.metrics.speedIndex,
              opportunities: pageSpeedData.mobile.opportunities,
              scannedAt: pageSpeedData.scannedAt,
            });
          }
          if (pageSpeedData.desktop) {
            db.addPageSpeedRecord({
              id: `ps_desk_${Date.now()}`,
              url: pageSpeedData.url,
              domain: pageSpeedData.domain,
              device: 'desktop',
              performance: pageSpeedData.desktop.scores.performance,
              accessibility: pageSpeedData.desktop.scores.accessibility,
              bestPractices: pageSpeedData.desktop.scores.bestPractices,
              seo: pageSpeedData.desktop.scores.seo,
              lcp: pageSpeedData.desktop.metrics.lcp,
              inp: pageSpeedData.desktop.metrics.inp,
              cls: pageSpeedData.desktop.metrics.cls,
              fcp: pageSpeedData.desktop.metrics.fcp,
              ttfb: pageSpeedData.desktop.metrics.ttfb,
              speedIndex: pageSpeedData.desktop.metrics.speedIndex,
              opportunities: pageSpeedData.desktop.opportunities,
              scannedAt: pageSpeedData.scannedAt,
            });
          }
        } catch (psErr: any) {
          console.warn('[PageSpeed Background Notice]', psErr.message);
          scanResult.pageSpeed = {
            url: scanResult.url,
            domain: scanResult.domain,
            scannedAt: new Date().toISOString(),
            mobile: null,
            desktop: null,
            error: publicScanError(psErr, 'PageSpeed analysis is temporarily unavailable.'),
          };
        }

        sendJson(res, 200, scanResult);
      } catch (err: any) {
        if (err instanceof SsrfBlockedError || /blocked|private|reserved|protected|disallowed/i.test(String(err?.message))) {
          void logSecurityEvent({
            type: 'ssrf_blocked',
            outcome: 'blocked',
            userId: session?.user.id,
            req,
            details: { endpoint: path, target: sanitizeForLog(target, 160), reason: sanitizeForLog(err?.message, 160) },
          });
        }
        sendJson(res, 422, { error: publicScanError(err, 'Scan failed for the requested URL.') });
      } finally {
        const rem = (activeScansByIp.get(ipHash) || 1) - 1;
        if (rem <= 0) activeScansByIp.delete(ipHash);
        else activeScansByIp.set(ipHash, rem);
      }
      return true;
    }

    // Dedicated PageSpeed endpoint (Mobile + Desktop, Core Web Vitals, Opportunities)
    if (path === '/api/scanner/pagespeed' && (method === 'POST' || method === 'GET')) {
      const session = await resolveSession(req);
      if (session && session.org.planId === 'free' && session.user.role !== 'super_admin') {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }
      }

      const psLimit = rateLimit(`pagespeed:ip:${ipHash}`, session ? 60 : 20, 60 * 60_000);
      if (!psLimit.allowed) {
        void logSecurityEvent({ type: 'rate_limited', outcome: 'blocked', userId: session?.user.id, req, details: { scope: 'pagespeed' } });
        res.setHeader('Retry-After', String(psLimit.retryAfterSec));
        sendJson(res, 429, { error: 'PageSpeed rate limit reached. Please wait before trying again.' });
        return true;
      }

      let target = '';
      let websiteId = '';
      let forceRefresh = false;
      let requestedStrategy: 'mobile' | 'desktop' | 'both' = 'both';

      if (method === 'POST') {
        const body = await readJsonBody(req);
        target = typeof body?.url === 'string' ? body.url.trim() : '';
        websiteId = typeof body?.websiteId === 'string' ? body.websiteId.trim() : '';
        forceRefresh = Boolean(body?.forceRefresh);
        if (body?.strategy === 'mobile' || body?.strategy === 'desktop') {
          requestedStrategy = body.strategy;
        }
      } else {
        target = (parsedUrl.searchParams.get('url') || '').trim();
        websiteId = (parsedUrl.searchParams.get('websiteId') || '').trim();
        forceRefresh = parsedUrl.searchParams.get('forceRefresh') === 'true';
        const strat = parsedUrl.searchParams.get('strategy');
        if (strat === 'mobile' || strat === 'desktop') {
          requestedStrategy = strat;
        }
      }

      if (websiteId && !session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      let authorizedSite: Website | undefined;
      if (session && websiteId) {
        const site = db.findWebsiteById(websiteId);
        const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
        if (!access.allowed) {
          if (access.isIdor) {
            void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'website_pagespeed', websiteId } });
          }
          sendJson(res, access.status || 403, access.body);
          return true;
        }
        authorizedSite = access.site;
        if (!target && authorizedSite) target = authorizedSite.url;
      }

      if (!target || target.length > 2048) {
        sendJson(res, 400, { error: 'Please provide a valid website URL.' });
        return true;
      }

      if (session && !isExemptSuperAdmin(session.user, session.org)) {
        await reconcileOrganizationWebsiteAllocations(session.org.id).catch(() => {});
        let normalizedTargetUrl = target.toLowerCase();
        let normalizedTargetDomain = '';
        try {
          const norm = normalizeInputUrl(target);
          normalizedTargetUrl = norm.url.toLowerCase();
          normalizedTargetDomain = norm.domain.toLowerCase();
        } catch {}
        const matchingSite = db.getWebsites().find(
          (w) =>
            w.orgId === session.org.id &&
            (w.url.toLowerCase() === normalizedTargetUrl ||
              (normalizedTargetDomain && w.domain.toLowerCase() === normalizedTargetDomain) ||
              target.toLowerCase().includes(w.domain.toLowerCase()))
        );
        if (matchingSite) {
          const access = await verifyWebsiteAccessAndEntitlement(matchingSite, session.user, session.org);
          if (!access.allowed) {
            sendJson(res, access.status || 403, access.body);
            return true;
          }
          if (!authorizedSite) authorizedSite = access.site;
        }
      }

      const startTimeMs = Date.now();
      try {
        const pageSpeedResult = await performPageSpeedAnalysis(target, {
          forceRefresh,
          strategy: requestedStrategy,
        });

        if (pageSpeedResult.mobile) {
          db.addPageSpeedRecord({
            id: `ps_mob_${Date.now()}`,
            websiteId: authorizedSite?.id,
            url: pageSpeedResult.url,
            domain: pageSpeedResult.domain,
            device: 'mobile',
            performance: pageSpeedResult.mobile.scores.performance,
            accessibility: pageSpeedResult.mobile.scores.accessibility,
            bestPractices: pageSpeedResult.mobile.scores.bestPractices,
            seo: pageSpeedResult.mobile.scores.seo,
            lcp: pageSpeedResult.mobile.metrics.lcp,
            inp: pageSpeedResult.mobile.metrics.inp,
            cls: pageSpeedResult.mobile.metrics.cls,
            fcp: pageSpeedResult.mobile.metrics.fcp,
            ttfb: pageSpeedResult.mobile.metrics.ttfb,
            speedIndex: pageSpeedResult.mobile.metrics.speedIndex,
            opportunities: pageSpeedResult.mobile.opportunities,
            scannedAt: pageSpeedResult.scannedAt,
          });
        }
        if (pageSpeedResult.desktop) {
          db.addPageSpeedRecord({
            id: `ps_desk_${Date.now()}`,
            websiteId: authorizedSite?.id,
            url: pageSpeedResult.url,
            domain: pageSpeedResult.domain,
            device: 'desktop',
            performance: pageSpeedResult.desktop.scores.performance,
            accessibility: pageSpeedResult.desktop.scores.accessibility,
            bestPractices: pageSpeedResult.desktop.scores.bestPractices,
            seo: pageSpeedResult.desktop.scores.seo,
            lcp: pageSpeedResult.desktop.metrics.lcp,
            inp: pageSpeedResult.desktop.metrics.inp,
            cls: pageSpeedResult.desktop.metrics.cls,
            fcp: pageSpeedResult.desktop.metrics.fcp,
            ttfb: pageSpeedResult.desktop.metrics.ttfb,
            speedIndex: pageSpeedResult.desktop.metrics.speedIndex,
            opportunities: pageSpeedResult.desktop.opportunities,
            scannedAt: pageSpeedResult.scannedAt,
          });
        }

        // Sync PageSpeed result to monitored websites while preserving any previously valid device strategy data
        let finalReturnedResult: CombinedPageSpeedResult = pageSpeedResult;
        for (const site of db.getWebsites()) {
          const isTargetSite =
            (authorizedSite && site.id === authorizedSite.id) ||
            site.domain.toLowerCase() === pageSpeedResult.domain.toLowerCase() ||
            site.url.toLowerCase() === pageSpeedResult.url.toLowerCase();

          if (!isTargetSite) continue;

          const prevPs = site.lastScanResult?.pageSpeed;
          const mergedPs: CombinedPageSpeedResult = {
            ...pageSpeedResult,
            mobile: pageSpeedResult.mobile || prevPs?.mobile || null,
            desktop: pageSpeedResult.desktop || prevPs?.desktop || null,
          };

          if (authorizedSite && site.id === authorizedSite.id) {
            finalReturnedResult = mergedPs;
          }

          if (site.lastScanResult) {
            db.updateWebsite(site.id, {
              lastScanResult: {
                ...site.lastScanResult,
                pageSpeed: mergedPs,
              },
            });
          } else if (authorizedSite && site.id === authorizedSite.id) {
            // Initialize lastScanResult if website had not run a Full Health Audit yet
            try {
              const baseScan = await performWebsiteScan(site.url);
              baseScan.pageSpeed = mergedPs;
              db.updateWebsite(site.id, {
                lastScanResult: baseScan,
              });
            } catch {
              // Keep pageSpeedResult even if full scan initialization is skipped
            }
          }
        }

        sendJson(res, 200, finalReturnedResult);
      } catch (err: any) {
        const durationMs = Date.now() - startTimeMs;
        console.warn(
          `[PageSpeed Error] websiteId=${authorizedSite?.id || websiteId || 'none'} strategy=${requestedStrategy} duration=${durationMs}ms code=${err?.code || 'PAGESPEED_ERROR'} status=${err?.upstreamStatus || 422}: ${sanitizeForLog(err?.message || 'PageSpeed failed', 200)}`
        );
        if (err instanceof SsrfBlockedError || /blocked|private|reserved|protected|disallowed/i.test(String(err?.message))) {
          void logSecurityEvent({
            type: 'ssrf_blocked',
            outcome: 'blocked',
            userId: session?.user.id,
            req,
            details: { endpoint: path, target: sanitizeForLog(target, 160), reason: sanitizeForLog(err?.message, 160) },
          });
        }
        const safeErrMessage = publicScanError(err, 'PageSpeed analysis failed.');
        sendJson(res, 422, {
          success: false,
          error: safeErrMessage,
          code: err?.code || 'PAGESPEED_ERROR',
          message: safeErrMessage,
          retryable: Boolean(err?.retryable),
        });
      }
      return true;
    }

    // 2. PUBLIC SHARED REPORT
    if (path.startsWith('/api/reports/share/') && method === 'GET') {
      const token = path.replace('/api/reports/share/', '').trim();
      const report = db.getReports().find((r) => r.shareToken === token && r.isPublic);
      if (!report) {
        sendJson(res, 404, { error: 'Report not found or private.' });
        return true;
      }
      sendJson(res, 200, report);
      return true;
    }

    // 3. AUTHENTICATION ENDPOINTS
    if (path === '/api/auth/register' && method === 'POST') {
      const regLimit = rateLimit(`register:ip:${ipHash}`, Number(process.env.REGISTER_IP_LIMIT_PER_HOUR) || 15, 60 * 60_000);
      if (!regLimit.allowed) {
        void logSecurityEvent({ type: 'rate_limited', outcome: 'blocked', req, details: { scope: 'register_ip' } });
        res.setHeader('Retry-After', String(regLimit.retryAfterSec));
        sendJson(res, 429, { error: 'Too many registration attempts. Please try again later.' });
        return true;
      }

      const body = await readJsonBody(req);
      const rawRefCode = body.referralCode || body.ref || parsedUrl.searchParams.get('ref') || '';
      const cleanEmail = normalizeEmail(body.email);
      const cleanPassword = typeof body.password === 'string' ? body.password : '';
      const cleanName = cleanString(body.name, 100);
      const cleanOrgName = cleanString(body.orgName, 120);

      if (!cleanEmail || !cleanPassword || !cleanName) {
        sendJson(res, 400, { error: 'Name, email, and password are required.' });
        return true;
      }
      if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 254) {
        sendJson(res, 400, { error: 'Please provide a valid email address.' });
        return true;
      }
      const pwErr = validatePasswordPolicy(cleanPassword);
      if (pwErr) {
        sendJson(res, 400, { error: pwErr });
        return true;
      }
      if (cleanEmail === 'admin@pulsevanguard.com' || cleanEmail === 'agency@acmedigital.com') {
        sendJson(res, 400, { error: 'Registration with this reserved email address is not permitted.' });
        return true;
      }
      if (db.findUserByEmail(cleanEmail)) {
        sendJson(res, 409, { error: 'An account with this email address already exists.' });
        return true;
      }

      await db.ensureSchema();

      // Validate referral code if provided during registration
      let referredByUserId: string | undefined;
      let referredByCode: string | undefined;
      if (typeof rawRefCode === 'string' && rawRefCode.trim().length > 0) {
        const refValidation = await validateReferralCodeForRegistration(rawRefCode, cleanEmail);
        if (!refValidation.valid) {
          sendJson(res, 400, { error: refValidation.error || 'Invalid referral code.' });
          return true;
        }
        if (refValidation.referrer) {
          referredByUserId = refValidation.referrer.id;
          referredByCode = refValidation.referrer.referralCode;
        }
      }

      const orgId = `org_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const userId = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const nowIso = new Date().toISOString();
      const trialEndsIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const newOrg: Organization = {
        id: orgId,
        name: cleanOrgName || `${cleanName}'s Workspace`,
        planId: 'free',
        billingInterval: 'monthly',
        currency: 'USDT',
        ownerId: userId,
        trialStartedAt: nowIso,
        trialEndsAt: trialEndsIso,
        trialUsed: true,
        whiteLabel: { enabled: false, brandName: cleanOrgName || cleanName },
        clients: [],
        createdAt: nowIso,
      };

      const uniqueReferralCode = await generateUniqueReferralCodeForUser(userId, cleanEmail);
      const isTargetSuperAdmin = cleanEmail === 'mobinalavi7491@gmail.com';
      const passwordHash = await hashPasswordAsync(cleanPassword);
      const newUser: User = {
        id: userId,
        email: cleanEmail,
        name: cleanName,
        passwordHash,
        role: isTargetSuperAdmin ? 'super_admin' : 'team_member',
        orgId,
        emailVerified: true,
        referralCode: uniqueReferralCode,
        referredByUserId,
        referredByCode,
        referredAt: referredByUserId ? nowIso : undefined,
        createdAt: nowIso,
      };

      db.addOrganization(newOrg);
      db.addUser(newUser);
      // Await PostgreSQL persistence so the new user + org exist before issuing a session FK.
      await OrgRepo.insert(newOrg);
      await UserRepo.insert(newUser);

      const issued = await issueSession(req, res, newUser, !isWebClient(req));
      const entitlementSummary = await getOrganizationEntitlementSummary(orgId);
      sendJson(res, 201, {
        ...(issued.token ? { token: issued.token } : {}),
        csrfToken: issued.csrfToken,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          orgId,
          referralCode: newUser.referralCode,
          referredByUserId: newUser.referredByUserId,
          referredByCode: newUser.referredByCode,
          referredAt: newUser.referredAt,
        },
        organization: {
          ...newOrg,
          entitlementSummary,
        },
      });
      return true;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const body = await readJsonBody(req);
      const cleanEmail = normalizeEmail(body.email);
      const cleanPassword = typeof body.password === 'string' ? body.password : '';

      if (!cleanEmail || !cleanPassword || cleanPassword.length > 256) {
        sendJson(res, 400, { error: 'Email and password are required.' });
        return true;
      }

      const GENERIC_LOGIN_ERROR = 'Invalid credentials. Please verify your email and password.';

      // Reserve attempt slot / check lockout and per-IP throttles BEFORE running scrypt.
      const gate = await beginLoginAttempt(cleanEmail, req);
      if (!gate.allowed) {
        // Burn a dummy scrypt derivation so response timing does not distinguish locked vs unlocked.
        await burnDummyPasswordVerification(cleanPassword);
        if (gate.reason === 'ip_limited' || gate.reason === 'global_limited') {
          if (gate.retryAfterSec) res.setHeader('Retry-After', String(gate.retryAfterSec));
          sendJson(res, 429, { error: 'Too many sign-in attempts. Please wait before trying again.' });
          return true;
        }
        await logSecurityEvent({
          type: 'login_blocked_locked',
          outcome: 'blocked',
          accountHint: maskEmail(cleanEmail),
          req,
          awaitWrite: true,
        });
        sendJson(res, 401, { error: GENERIC_LOGIN_ERROR });
        return true;
      }

      // Decommissioned demo accounts never authenticate; still run dummy hash + record failure.
      const isDecommissioned =
        cleanEmail === 'admin@pulsevanguard.com' || cleanEmail === 'agency@acmedigital.com';
      const user = isDecommissioned ? undefined : db.findUserByEmail(cleanEmail);

      let isValidPassword = false;
      if (user) {
        isValidPassword = await verifyPasswordAsync(cleanPassword, user.passwordHash);
      } else {
        await burnDummyPasswordVerification(cleanPassword);
      }

      const completion = await completeLoginAttempt(gate, isValidPassword && Boolean(user), {
        userId: user?.id,
        email: user?.email,
        req,
      });

      if (!user || !isValidPassword) {
        await logSecurityEvent({
          type: 'login_failure',
          outcome: 'failure',
          userId: user?.id || null,
          accountHint: maskEmail(cleanEmail),
          req,
          details: { lockedNow: completion.lockedNow },
          awaitWrite: true,
        });
        sendJson(res, 401, { error: GENERIC_LOGIN_ERROR });
        return true;
      }

      // Transparently upgrade legacy PBKDF2 / SHA-2 hashes to scrypt on valid login.
      if (needsPasswordRehash(user.passwordHash)) {
        try {
          const upgraded = await hashPasswordAsync(cleanPassword);
          await db.setUserPasswordHash(user.id, upgraded);
        } catch {}
      }

      // Ensure target account has super_admin role
      if (user.email.toLowerCase() === 'mobinalavi7491@gmail.com' && user.role !== 'super_admin') {
        user.role = 'super_admin';
        db.updateUserRole(user.id, 'super_admin');
      }

      if (!user.referralCode) {
        try {
          user.referralCode = await ensureUserReferralCode(user.id);
        } catch {}
      }

      // Session fixation defence: if the client already held a session cookie/header, revoke it.
      const priorCreds = extractCredentials(req);
      if (priorCreds) {
        await revokeSessionByToken(priorCreds.token, 'reauthenticated').catch(() => false);
      }

      await backfillSubscriptionEntitlements().catch(() => {});
      await cleanupOverdueExpiredWebsites().catch(() => {});
      await reconcileOrganizationWebsiteAllocations(user.orgId).catch(() => {});
      const entitlementSummary = await getOrganizationEntitlementSummary(user.orgId);
      const org = db.findOrgById(user.orgId);
      const issued = await issueSession(req, res, user, !isWebClient(req));

      void logSecurityEvent({
        type: 'login_success',
        outcome: 'success',
        userId: user.id,
        accountHint: maskEmail(user.email),
        actorRole: user.role,
        req,
      });

      sendJson(res, 200, {
        ...(issued.token ? { token: issued.token } : {}),
        csrfToken: issued.csrfToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId,
          avatarUrl: user.avatarUrl,
          referralCode: user.referralCode,
          referredByUserId: user.referredByUserId,
          referredByCode: user.referredByCode,
          referredAt: user.referredAt,
        },
        organization: org ? { ...org, currency: 'USDT', entitlementSummary } : null,
      });
      return true;
    }

    if (path === '/api/auth/me' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (!session.user.referralCode) {
        try {
          session.user.referralCode = await ensureUserReferralCode(session.user.id);
        } catch {}
      }
      await backfillSubscriptionEntitlements().catch(() => {});
      await cleanupOverdueExpiredWebsites().catch(() => {});
      await reconcileOrganizationWebsiteAllocations(session.org.id).catch(() => {});
      const entitlementSummary = await getOrganizationEntitlementSummary(session.org.id);
      const isUnlimitedAdmin = isExemptSuperAdmin(session.user);
      const trialStatus = getAccountTrialStatus(session.org);
      sendJson(res, 200, {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role,
          orgId: session.user.orgId,
          avatarUrl: session.user.avatarUrl,
          referralCode: session.user.referralCode,
          referredByUserId: session.user.referredByUserId,
          referredByCode: session.user.referredByCode,
          referredAt: session.user.referredAt,
        },
        organization: {
          ...session.org,
          currency: 'USDT',
          entitlementSummary,
        },
        accountStatus: {
          plan: isUnlimitedAdmin ? 'pro' : session.org.planId,
          isUnlimited: isUnlimitedAdmin,
          trial: {
            startedAt: trialStatus.trialStartedAt || session.org.createdAt,
            endsAt: trialStatus.trialEndsAt || session.org.createdAt,
            expired: isUnlimitedAdmin ? false : trialStatus.isExpired,
            remainingMs: isUnlimitedAdmin ? 0 : trialStatus.remainingMs,
          },
          entitlements: entitlementSummary,
        },
      });
      return true;
    }

    if (path === '/api/account/status' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      await backfillSubscriptionEntitlements().catch(() => {});
      await cleanupOverdueExpiredWebsites().catch(() => {});
      await reconcileOrganizationWebsiteAllocations(session.org.id).catch(() => {});
      const entitlementSummary = await getOrganizationEntitlementSummary(session.org.id);
      const isUnlimitedAdmin = isExemptSuperAdmin(session.user);
      const trialStatus = getAccountTrialStatus(session.org);
      sendJson(res, 200, {
        plan: isUnlimitedAdmin ? 'pro' : session.org.planId,
        isUnlimited: isUnlimitedAdmin,
        trial: {
          startedAt: trialStatus.trialStartedAt || session.org.createdAt,
          endsAt: trialStatus.trialEndsAt || session.org.createdAt,
          expired: isUnlimitedAdmin ? false : trialStatus.isExpired,
          remainingMs: isUnlimitedAdmin ? 0 : trialStatus.remainingMs,
        },
        entitlements: entitlementSummary,
      });
      return true;
    }

    if (path === '/api/auth/reset-password' && method === 'POST') {
      const body = await readJsonBody(req);
      const outcome = await requestPasswordReset(body?.email, req);
      sendJson(res, 200, {
        message: 'If an account matches that address, password reset instructions have been sent.',
        ...(outcome.debugToken ? { resetToken: outcome.debugToken } : {}),
      });
      return true;
    }

    if (path === '/api/auth/reset-password/confirm' && method === 'POST') {
      const body = await readJsonBody(req);
      const result = await confirmPasswordReset(body?.token, body?.newPassword ?? body?.password, req);
      if (!result.ok) {
        sendJson(res, 400, { error: result.error });
        return true;
      }
      res.setHeader('Set-Cookie', buildClearCookies());
      sendJson(res, 200, {
        success: true,
        message: 'Your password has been updated and your account has been unlocked. Please sign in with your new password.',
      });
      return true;
    }

    if (path === '/api/auth/change-password' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const body = await readJsonBody(req);
      const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
      if (!currentPassword || !newPassword) {
        sendJson(res, 400, { error: 'Current password and new password are required.' });
        return true;
      }
      const pwErr = validatePasswordPolicy(newPassword);
      if (pwErr) {
        sendJson(res, 400, { error: pwErr });
        return true;
      }
      const validCurrent = await verifyPasswordAsync(currentPassword, session.user.passwordHash);
      if (!validCurrent) {
        await logSecurityEvent({ type: 'password_changed', outcome: 'failure', userId: session.user.id, req, details: { reason: 'wrong_current_password' } });
        sendJson(res, 401, { error: 'Current password is incorrect.' });
        return true;
      }
      const newHash = await hashPasswordAsync(newPassword);
      await db.setUserPasswordHash(session.user.id, newHash);
      await revokeAllUserSessions(session.user.id, 'password_changed');
      const issued = await issueSession(req, res, session.user, !isWebClient(req));
      await logSecurityEvent({ type: 'password_changed', outcome: 'success', userId: session.user.id, req, awaitWrite: true });
      sendJson(res, 200, {
        success: true,
        ...(issued.token ? { token: issued.token } : {}),
        csrfToken: issued.csrfToken,
        message: 'Password changed successfully. All other active sessions have been signed out.',
      });
      return true;
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const authHeader = req.headers['authorization'];
      const bearerToken = typeof authHeader === 'string' ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
      const cookieToken = parseCookies(req)[SESSION_COOKIE_NAME] || '';
      let userId: string | undefined;
      if (authState.kind === 'ok') userId = authState.ctx.user.id;
      if (bearerToken) await revokeSessionByToken(bearerToken, 'logout').catch(() => false);
      if (cookieToken && cookieToken !== bearerToken) {
        await revokeSessionByToken(cookieToken, 'logout').catch(() => false);
      }
      res.setHeader('Set-Cookie', buildClearCookies());
      void logSecurityEvent({ type: 'logout', outcome: 'success', userId: userId || null, req });
      sendJson(res, 200, { success: true, message: 'Logged out successfully' });
      return true;
    }

    // 4. WEBSITES RESOURCE & WHOIS
    if (path === '/api/websites' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      await cleanupOverdueExpiredWebsites().catch(() => {});
      await reconcileOrganizationWebsiteAllocations(session.org.id).catch(() => {});

      const rawWebsites = isExemptSuperAdmin(session.user, session.org)
        ? db.getWebsites()
        : db.getWebsites().filter((w) => w.orgId === session.org.id);

      const websites = rawWebsites.map((w) => sanitizeWebsiteForList(w, session.user, session.org));
      sendJson(res, 200, websites);
      return true;
    }

    if (path === '/api/websites' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const body = await readJsonBody(req);
      const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
      if (!rawUrl) {
        sendJson(res, 400, { error: 'Website URL is required' });
        return true;
      }

      let normalized: { url: string; domain: string };
      try {
        normalized = normalizeInputUrl(rawUrl);
        await validateTargetSecurity(normalized.domain);
      } catch (err: any) {
        if (err instanceof SsrfBlockedError || /blocked|private|reserved|protected|disallowed/i.test(String(err?.message))) {
          void logSecurityEvent({
            type: 'ssrf_blocked',
            outcome: 'blocked',
            userId: session.user.id,
            req,
            details: { endpoint: path, target: sanitizeForLog(rawUrl, 160), reason: sanitizeForLog(err?.message, 160) },
          });
        }
        sendJson(res, 400, { error: publicScanError(err, 'Invalid or disallowed website URL.') });
        return true;
      }
      const { url, domain } = normalized;

      await backfillSubscriptionEntitlements().catch(() => {});
      await cleanupOverdueExpiredWebsites().catch(() => {});
      const allocation = await allocateEntitlementForNewWebsite(session.org.id, session.user);
      const entitlementSummary = allocation.summary;

      if (!allocation.allowed) {
        if (entitlementSummary.totalActiveCapacity <= 0) {
          if (entitlementSummary.allPaidEntitlementsExpired) {
            sendJson(res, 403, {
              error: 'SUBSCRIPTION_EXPIRED',
              code: 'SUBSCRIPTION_EXPIRED',
              message: 'Your subscription entitlements have expired. Purchase a Pro Plan entitlement (5 USDT/month) to monitor websites.',
            });
            return true;
          }
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }

        const activeLabel =
          entitlementSummary.activeEntitlementCount > 0
            ? `${entitlementSummary.activeEntitlementCount} active Pro entitlement${entitlementSummary.activeEntitlementCount === 1 ? '' : 's'}`
            : 'Free Trial';
        sendJson(res, 403, {
          error: `Your active capacity limit is ${entitlementSummary.totalActiveCapacity} website${entitlementSummary.totalActiveCapacity === 1 ? '' : 's'} (${entitlementSummary.usedWebsiteSlots}/${entitlementSummary.totalActiveCapacity} slots used across ${activeLabel}). Purchase an additional Pro Plan entitlement (+5 website slots) to monitor more websites.`,
        });
        return true;
      }

      const plan = db.getPlans().find((p) => p.id === session.org.planId) || db.getPlans()[0];

      const minInterval = isExemptSuperAdmin(session.user, session.org)
        ? 1
        : Math.max(plan.limits.minIntervalMinutes, 1);
      const requestedInterval = Number(body.intervalMinutes);
      const intervalMinutes = Number.isFinite(requestedInterval)
        ? Math.min(1440, Math.max(minInterval, Math.floor(requestedInterval)))
        : Math.max(minInterval, 5);

      const newSite: Website = {
        id: `site_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        orgId: session.org.id,
        clientId: typeof body.clientId === 'string' ? cleanString(body.clientId, 64) : undefined,
        name: cleanString(body.name, 120) || domain,
        url,
        domain,
        status: 'ONLINE',
        intervalMinutes,
        lastCheckedAt: new Date().toISOString(),
        lastResponseTimeMs: 180,
        healthScore: 90,
        uptime24h: 100.0,
        uptime7d: 100.0,
        uptime30d: 100.0,
        verification: {
          verified: false,
          token: `pv-verify-${crypto.randomBytes(6).toString('hex')}`,
          method: 'dns_txt',
        },
        tags: Array.isArray(body.tags)
          ? body.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => cleanString(t, 40)).slice(0, 12)
          : ['Production'],
        groupName: cleanString(body.groupName, 80) || 'Default Project',
        enabledChecks: {
          uptime: true,
          ssl: true,
          dns: true,
          seo: true,
          security: true,
          brokenLinks: false,
          ...(isPlainObject(body.enabledChecks) ? {
            uptime: Boolean(body.enabledChecks.uptime ?? true),
            ssl: Boolean(body.enabledChecks.ssl ?? true),
            dns: Boolean(body.enabledChecks.dns ?? true),
            seo: Boolean(body.enabledChecks.seo ?? true),
            security: Boolean(body.enabledChecks.security ?? true),
            brokenLinks: Boolean(body.enabledChecks.brokenLinks ?? false),
          } : {}),
        },
        notificationSettings: {
          email: true,
          alertEmail: session.user.email,
          alertOnDown: true,
          alertOnRecovery: true,
          alertOnSslExpiry: true,
          latencyThresholdMs: 1200,
          ...(isPlainObject(body.notificationSettings) ? {
            email: Boolean(body.notificationSettings.email ?? true),
            alertEmail: EMAIL_RE.test(String(body.notificationSettings.alertEmail || ''))
              ? String(body.notificationSettings.alertEmail).trim()
              : session.user.email,
            alertOnDown: Boolean(body.notificationSettings.alertOnDown ?? true),
            alertOnRecovery: Boolean(body.notificationSettings.alertOnRecovery ?? true),
            alertOnSslExpiry: Boolean(body.notificationSettings.alertOnSslExpiry ?? true),
            latencyThresholdMs: Math.min(30000, Math.max(100, Number(body.notificationSettings.latencyThresholdMs) || 1200)),
          } : {}),
        },
        entitlementId: allocation.entitlementId || null,
        subscriptionExpiresAt: allocation.subscriptionExpiresAt || null,
        expiredAt: null,
        scheduledDeletionAt: null,
        accessStatus: 'active',
        isSubscriptionExpired: false,
        deletionRemainingMs: null,
        createdAt: new Date().toISOString(),
      };

      db.addWebsite(newSite);
      monitorEngine.checkWebsite(newSite).catch(() => {});

      sendJson(res, 201, newSite);
      return true;
    }

    // Protected WHOIS endpoint (both /api/websites/:id/whois and /api/whois)
    if (
      (path.match(/^\/api\/websites\/[^/]+\/whois$/) || path === '/api/whois') &&
      (method === 'GET' || method === 'POST')
    ) {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const whoisLimit = rateLimit(`whois:ip:${ipHash}`, 30, 60 * 60_000);
      if (!whoisLimit.allowed) {
        void logSecurityEvent({ type: 'rate_limited', outcome: 'blocked', userId: session.user.id, req, details: { scope: 'whois' } });
        res.setHeader('Retry-After', String(whoisLimit.retryAfterSec));
        sendJson(res, 429, { error: 'WHOIS rate limit reached. Please wait before trying again.' });
        return true;
      }

      let body: any = {};
      if (method === 'POST') {
        body = await readJsonBody(req);
      }

      const siteIdFromPath = path.startsWith('/api/websites/') ? path.split('/')[3] : '';
      const siteId = siteIdFromPath || (typeof body?.websiteId === 'string' ? body.websiteId.trim() : '') || (parsedUrl.searchParams.get('websiteId') || '').trim();
      const rawDomainParam = (typeof body?.domain === 'string' ? body.domain.trim() : '') || (parsedUrl.searchParams.get('domain') || '').trim();
      const forceRefresh = Boolean(body?.forceRefresh) || parsedUrl.searchParams.get('forceRefresh') === 'true';

      // If caller passed a raw domain parameter, validate it strictly first (reject URLs, paths, IPs, malformed input)
      let validatedParamDomain = '';
      if (rawDomainParam) {
        try {
          validatedParamDomain = validateAndNormalizeWhoisDomain(rawDomainParam);
        } catch (domErr: any) {
          sendJson(res, 400, { error: domErr?.message || 'Invalid domain name for WHOIS lookup.' });
          return true;
        }
      }

      let site: Website | undefined;
      if (siteId) {
        site = db.findWebsiteById(siteId);
      } else if (validatedParamDomain) {
        site = db
          .getWebsites()
          .find((w) => {
            if (w.orgId !== session.org.id && !isExemptSuperAdmin(session.user, session.org)) return false;
            try {
              return validateAndNormalizeWhoisDomain(w.domain) === validatedParamDomain;
            } catch {
              return false;
            }
          });
      }

      if (!site) {
        sendJson(res, 404, { error: 'Website not found' });
        return true;
      }

      const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
      if (!access.allowed) {
        if (access.isIdor) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'website_whois', siteId: site.id } });
        }
        sendJson(res, access.status || 403, access.body);
        return true;
      }

      const activeSite = access.site!;
      let targetDomain: string;
      try {
        const siteDomainNormalized = validateAndNormalizeWhoisDomain(activeSite.domain);
        if (validatedParamDomain && validatedParamDomain !== siteDomainNormalized && !isExemptSuperAdmin(session.user, session.org)) {
          sendJson(res, 403, { error: 'Requested domain does not match the authorized website domain.' });
          return true;
        }
        targetDomain = validatedParamDomain || siteDomainNormalized;
      } catch (domErr: any) {
        sendJson(res, 400, {
          success: false,
          error: domErr?.message || 'Invalid domain name.',
          code: 'WHOIS_INVALID_DOMAIN',
          message: domErr?.message || 'Invalid domain name.',
          retryable: false,
        });
        return true;
      }

      const whoisStartMs = Date.now();
      try {
        const whoisResult = await performWhoisLookup(targetDomain, { forceRefresh });
        db.updateWebsite(activeSite.id, { lastWhoisResult: whoisResult });
        sendJson(res, 200, whoisResult);
      } catch (err: any) {
        const durationMs = Date.now() - whoisStartMs;
        const safeErr = publicScanError(err, 'WHOIS lookup failed for the requested domain.');
        console.warn(
          `[WHOIS Error] websiteId=${activeSite.id} domain=${targetDomain} duration=${durationMs}ms code=${err?.code || 'WHOIS_ERROR'}: ${sanitizeForLog(err?.message || safeErr, 200)}`
        );
        sendJson(res, 422, {
          success: false,
          error: safeErr,
          code: err?.code || 'WHOIS_ERROR',
          message: safeErr,
          retryable: Boolean(err?.retryable),
        });
      }
      return true;
    }

    if (path.startsWith('/api/websites/') && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const parts = path.split('/');
      const siteId = parts[3];
      const site = db.findWebsiteById(siteId);
      const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
      if (!access.allowed) {
        if (access.isIdor) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'website', siteId } });
        }
        sendJson(res, access.status || 403, access.body);
        return true;
      }

      if (parts[4] === 'metrics') {
        const metrics = db.getMetrics().filter((m) => m.websiteId === siteId).slice(-48);
        sendJson(res, 200, metrics);
        return true;
      }

      sendJson(res, 200, access.site);
      return true;
    }

    if (path.startsWith('/api/websites/') && method === 'PATCH') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const siteId = path.split('/')[3];
      const site = db.findWebsiteById(siteId);
      const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
      if (!access.allowed) {
        if (access.isIdor) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'website_patch', siteId } });
        }
        sendJson(res, access.status || 403, access.body);
        return true;
      }
      const activeSite = access.site!;

      const body = await readJsonBody(req);
      const safeUpdates: Partial<Website> = {};
      if (typeof body.name === 'string' && body.name.trim()) safeUpdates.name = cleanString(body.name, 120);
      if (typeof body.groupName === 'string') safeUpdates.groupName = cleanString(body.groupName, 80);
      if (typeof body.clientId === 'string') safeUpdates.clientId = cleanString(body.clientId, 64);
      if (typeof body.status === 'string' && (body.status === 'ONLINE' || body.status === 'PAUSED')) {
        safeUpdates.status = body.status;
      }
      if (Array.isArray(body.tags)) {
        safeUpdates.tags = body.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => cleanString(t, 40)).slice(0, 12);
      }
      if (typeof body.intervalMinutes === 'number' && Number.isFinite(body.intervalMinutes)) {
        safeUpdates.intervalMinutes = Math.min(1440, Math.max(1, Math.floor(body.intervalMinutes)));
      }
      if (isPlainObject(body.enabledChecks)) {
        safeUpdates.enabledChecks = {
          ...activeSite.enabledChecks,
          uptime: Boolean(body.enabledChecks.uptime ?? activeSite.enabledChecks.uptime),
          ssl: Boolean(body.enabledChecks.ssl ?? activeSite.enabledChecks.ssl),
          dns: Boolean(body.enabledChecks.dns ?? activeSite.enabledChecks.dns),
          seo: Boolean(body.enabledChecks.seo ?? activeSite.enabledChecks.seo),
          security: Boolean(body.enabledChecks.security ?? activeSite.enabledChecks.security),
          brokenLinks: Boolean(body.enabledChecks.brokenLinks ?? activeSite.enabledChecks.brokenLinks),
        };
      }
      if (isPlainObject(body.notificationSettings)) {
        safeUpdates.notificationSettings = {
          ...activeSite.notificationSettings,
          email: Boolean(body.notificationSettings.email ?? activeSite.notificationSettings.email),
          alertEmail: EMAIL_RE.test(String(body.notificationSettings.alertEmail || ''))
            ? String(body.notificationSettings.alertEmail).trim()
            : activeSite.notificationSettings.alertEmail,
          alertOnDown: Boolean(body.notificationSettings.alertOnDown ?? activeSite.notificationSettings.alertOnDown),
          alertOnRecovery: Boolean(body.notificationSettings.alertOnRecovery ?? activeSite.notificationSettings.alertOnRecovery),
          alertOnSslExpiry: Boolean(body.notificationSettings.alertOnSslExpiry ?? activeSite.notificationSettings.alertOnSslExpiry),
          latencyThresholdMs: Math.min(
            30000,
            Math.max(100, Number(body.notificationSettings.latencyThresholdMs) || activeSite.notificationSettings.latencyThresholdMs)
          ),
        };
      }
      if (typeof body.url === 'string' && body.url.trim()) {
        try {
          const norm = normalizeInputUrl(body.url);
          await validateTargetSecurity(norm.domain);
          safeUpdates.url = norm.url;
          safeUpdates.domain = norm.domain;
        } catch (err: any) {
          sendJson(res, 400, { error: publicScanError(err, 'Invalid or disallowed website URL.') });
          return true;
        }
      }

      const updated = db.updateWebsite(siteId, safeUpdates);
      sendJson(res, 200, updated);
      return true;
    }

    if (path.startsWith('/api/websites/') && method === 'DELETE') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const siteId = path.split('/')[3];
      const site = db.findWebsiteById(siteId);
      if (!site || (site.orgId !== session.org.id && session.user.role !== 'super_admin')) {
        if (site) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'website_delete', siteId } });
        }
        sendJson(res, 404, { error: 'Website not found' });
        return true;
      }
      db.removeWebsite(siteId);
      sendJson(res, 200, { success: true, message: 'Website removed from monitoring.' });
      return true;
    }

    // Trigger on-demand rapid check
    if (path.match(/\/api\/websites\/[^/]+\/check-now/) && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const siteId = path.split('/')[3];
      const site = db.findWebsiteById(siteId);
      const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
      if (!access.allowed) {
        if (access.isIdor) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'website_check', siteId } });
        }
        sendJson(res, access.status || 403, access.body);
        return true;
      }
      const updated = await monitorEngine.checkWebsite(access.site!);
      sendJson(res, 200, updated);
      return true;
    }

    // Trigger full deep health audit
    if (path.match(/\/api\/websites\/[^/]+\/audit-now/) && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const siteId = path.split('/')[3];
      const site = db.findWebsiteById(siteId);
      const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
      if (!access.allowed) {
        if (access.isIdor) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'website_audit', siteId } });
        }
        sendJson(res, access.status || 403, access.body);
        return true;
      }
      try {
        const fullResult = await monitorEngine.runFullAudit(siteId);
        sendJson(res, 200, fullResult);
      } catch (err: any) {
        if (err?.code === 'SUBSCRIPTION_EXPIRED') {
          sendJson(res, 403, { error: 'SUBSCRIPTION_EXPIRED', code: 'SUBSCRIPTION_EXPIRED', message: err.message });
          return true;
        }
        sendJson(res, 422, { error: publicScanError(err, 'Audit failed for the requested website.') });
      }
      return true;
    }

    // Verify domain ownership
    if (path.match(/\/api\/websites\/[^/]+\/verify/) && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const siteId = path.split('/')[3];
      const site = db.findWebsiteById(siteId);
      const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
      if (!access.allowed) {
        if (access.isIdor) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'website_verify', siteId } });
        }
        sendJson(res, access.status || 403, access.body);
        return true;
      }
      const activeSite = access.site!;

      let verified = false;
      let checkDetail = '';
      try {
        await validateTargetSecurity(activeSite.domain);
        const txts = await dns.resolveTxt(activeSite.domain).catch(() => []);
        const flattened = txts.map((r) => r.join(''));
        for (const t of flattened) {
          if (t.includes(activeSite.verification.token) || t.includes('pulsevanguard-verify')) {
            verified = true;
            checkDetail = `Found matching TXT record: ${t.slice(0, 120)}`;
            break;
          }
        }
      } catch (e: any) {
        checkDetail = 'DNS TXT record check did not find the verification token.';
      }

      if (!verified) {
        try {
          const resp = await safeFetch(activeSite.url, { method: 'GET', timeoutMs: 4000, maxBytes: 256 * 1024 });
          const text = await resp.text();
          if (text.includes(activeSite.verification.token)) {
            verified = true;
            checkDetail = 'Found matching HTML meta verification tag.';
          }
        } catch {
          // Meta tag not found or target blocked
        }
      }

      if (verified) {
        db.updateWebsite(siteId, {
          verification: {
            ...activeSite.verification,
            verified: true,
            verifiedAt: new Date().toISOString(),
          },
        });
        sendJson(res, 200, { verified: true, message: 'Domain ownership successfully verified!' });
      } else {
        sendJson(res, 400, {
          verified: false,
          error: `Could not verify domain ownership. Please ensure your DNS TXT record contains "${activeSite.verification.token}" or add <meta name="pulsevanguard-verify" content="${activeSite.verification.token}"> to your site head. (${checkDetail || 'No record found'})`,
        });
      }
      return true;
    }

    // 5. INCIDENTS & ALERTS
    if (path === '/api/incidents' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      await reconcileOrganizationWebsiteAllocations(session.org.id).catch(() => {});
      const expiredSiteIds = new Set(
        db
          .getWebsites()
          .filter((w) => w.orgId === session.org.id && (w.accessStatus === 'expired_grace_period' || w.isSubscriptionExpired))
          .map((w) => w.id)
      );
      const incidents = isExemptSuperAdmin(session.user, session.org)
        ? db.getIncidents()
        : db.getIncidents().filter((i) => i.orgId === session.org.id && !expiredSiteIds.has(i.websiteId));
      sendJson(res, 200, incidents);
      return true;
    }

    if (path === '/api/alerts' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const alerts = isExemptSuperAdmin(session.user, session.org)
        ? db.getAlerts()
        : db.getAlerts().filter((a) => a.orgId === session.org.id);
      sendJson(res, 200, alerts);
      return true;
    }

    if (path.match(/\/api\/alerts\/[^/]+\/read/) && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const alertId = path.split('/')[3];
      const alert = db.getAlerts().find((a) => a.id === alertId);
      if (!alert || (alert.orgId !== session.org.id && session.user.role !== 'super_admin')) {
        if (alert) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'alert_read', alertId } });
        }
        sendJson(res, 404, { error: 'Alert not found' });
        return true;
      }
      db.markAlertRead(alertId);
      sendJson(res, 200, { success: true });
      return true;
    }

    // 6. REPORTS
    if (path === '/api/reports' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      await reconcileOrganizationWebsiteAllocations(session.org.id).catch(() => {});
      const expiredSiteIds = new Set(
        db
          .getWebsites()
          .filter((w) => w.orgId === session.org.id && (w.accessStatus === 'expired_grace_period' || w.isSubscriptionExpired))
          .map((w) => w.id)
      );
      const reports = isExemptSuperAdmin(session.user, session.org)
        ? db.getReports()
        : db.getReports().filter((r) => r.orgId === session.org.id && !expiredSiteIds.has(r.websiteId));
      sendJson(res, 200, reports);
      return true;
    }

    if (path === '/api/reports/generate' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const body = await readJsonBody(req);
      const site = db.findWebsiteById(body.websiteId);
      const access = await verifyWebsiteAccessAndEntitlement(site, session.user, session.org);
      if (!access.allowed) {
        if (access.isIdor) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'report_generate', websiteId: body.websiteId } });
        }
        sendJson(res, access.status || 403, access.body);
        return true;
      }
      const activeSite = access.site!;

      const report: ReportItem = {
        id: `rep_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        orgId: session.org.id,
        websiteId: activeSite.id,
        websiteName: activeSite.name,
        title: cleanString(body.title, 160) || `${activeSite.name} Performance & Health Report`,
        type: body.type === 'seo' || body.type === 'security' || body.type === 'executive' ? body.type : 'health',
        shareToken: `pv_rep_${crypto.randomBytes(16).toString('hex')}`,
        isPublic: true,
        generatedAt: new Date().toISOString(),
        data: {
          website: { name: activeSite.name, url: activeSite.url, domain: activeSite.domain },
          healthScore: activeSite.healthScore,
          uptime24h: activeSite.uptime24h,
          uptime7d: activeSite.uptime7d,
          uptime30d: activeSite.uptime30d,
          responseTimeMs: activeSite.lastResponseTimeMs,
          scanData: activeSite.lastScanResult || null,
          whiteLabel: session.org.whiteLabel,
        },
      };

      db.addReport(report);
      sendJson(res, 201, report);
      return true;
    }

    // 7. AGENCY WORKSPACE & CLIENTS
    if (path === '/api/agency/clients' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      sendJson(res, 200, session.org.clients || []);
      return true;
    }

    if (path === '/api/agency/clients' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.org.planId === 'free' && session.user.role !== 'super_admin') {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }
      }
      const body = await readJsonBody(req);
      const name = cleanString(body.name, 120);
      if (!name) {
        sendJson(res, 400, { error: 'Client name is required' });
        return true;
      }

      const newClient = {
        id: `client_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        name,
        contactEmail: cleanString(body.contactEmail, 160),
        notes: cleanString(body.notes, 1000),
        createdAt: new Date().toISOString(),
      };

      session.org.clients.push(newClient);
      db.persist();
      sendJson(res, 201, newClient);
      return true;
    }

    if (path === '/api/agency/branding' && method === 'PATCH') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const body = await readJsonBody(req);
      const current = session.org.whiteLabel || { enabled: false, brandName: session.org.name };
      session.org.whiteLabel = {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
        brandName: typeof body.brandName === 'string' && body.brandName.trim() ? cleanString(body.brandName, 120) : current.brandName,
        customDomain: typeof body.customDomain === 'string' ? cleanString(body.customDomain, 160) : current.customDomain,
        reportFooterText: typeof body.reportFooterText === 'string' ? cleanString(body.reportFooterText, 300) : current.reportFooterText,
        logoUrl: typeof body.logoUrl === 'string' && /^https?:\/\//i.test(body.logoUrl.trim())
          ? cleanString(body.logoUrl, 500)
          : current.logoUrl,
      };
      db.persist();
      sendJson(res, 200, session.org.whiteLabel);
      return true;
    }

    // 8. BILLING & SUBSCRIPTIONS
    if (path === '/api/billing/plans' && method === 'GET') {
      sendJson(res, 200, db.getPlans());
      return true;
    }

    if (path === '/api/billing/entitlements' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      await backfillSubscriptionEntitlements().catch(() => {});
      const summary = await getOrganizationEntitlementSummary(session.org.id);
      sendJson(res, 200, summary);
      return true;
    }

    if (path === '/api/billing/change-plan' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const { planId, interval } = await readJsonBody(req);
      const plan = db.getPlans().find((p) => p.id === planId);
      if (!plan) {
        sendJson(res, 400, { error: 'Invalid plan selected' });
        return true;
      }

      // Security rule: Prevent trial reactivation or resetting trialUsed.
      if (planId === 'free' && session.org.trialUsed) {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, {
            error: 'TRIAL_EXPIRED',
            message: 'Your 24-hour free trial has already been used and cannot be restarted. Please upgrade to Pro to continue.',
          });
          return true;
        }
      }

      // Security rule: Paid plans can NEVER be activated directly through change-plan by a non-admin.
      // Paid entitlements must be granted only through verified crypto payment orders or admin approval.
      const pricingTier = plan.pricing.USDT || plan.pricing.USD || { monthly: 0, annual: 0 };
      const amount = interval === 'annual' ? pricingTier.annual : pricingTier.monthly;
      if (planId !== 'free' && amount > 0 && session.user.role !== 'super_admin') {
        await backfillSubscriptionEntitlements().catch(() => {});
        const currentSummary = await getOrganizationEntitlementSummary(session.org.id);
        if (currentSummary.activeEntitlementCount <= 0) {
          void logSecurityEvent({
            type: 'forbidden_access',
            outcome: 'blocked',
            userId: session.user.id,
            actorRole: session.user.role,
            req,
            details: { reason: 'unpaid_plan_upgrade_attempt', planId, interval: interval || 'monthly' },
          });
          sendJson(res, 402, {
            error: 'PAYMENT_REQUIRED',
            message: 'Paid plans require a verified USDT TRC20 payment order. Please complete checkout via /api/crypto/create-order.',
          });
          return true;
        }
      }

      session.org.planId = planId;
      if (interval === 'monthly' || interval === 'annual') session.org.billingInterval = interval;
      session.org.currency = 'USDT';
      db.persist();

      if (amount > 0 && session.user.role === 'super_admin') {
        db.addInvoice({
          id: `inv_${Date.now()}`,
          orgId: session.org.id,
          invoiceNumber: `INV-2026-${Math.floor(100 + Math.random() * 900)}`,
          date: new Date().toISOString(),
          amount,
          currency: 'USDT',
          status: 'paid',
          planName: `${plan.name} (${interval === 'annual' ? 'Annual' : 'Monthly'})`,
        });
      }

      const entitlementSummary = await getOrganizationEntitlementSummary(session.org.id);
      sendJson(res, 200, {
        success: true,
        organization: {
          ...session.org,
          currency: 'USDT',
          entitlementSummary,
        },
      });
      return true;
    }

    if (path === '/api/billing/invoices' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const invoices = db.getInvoices()
        .filter((inv) => inv.orgId === session.org.id)
        .map((inv) => ({ ...inv, currency: 'USDT' }));
      sendJson(res, 200, invoices);
      return true;
    }

    // --- CRYPTO PAYMENT SYSTEM (USDT TRC20 / LBank Integration) ---
    if (path === '/api/crypto/create-order' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const orderLimit = rateLimit(`crypto:create:${session.user.id}`, 15, 60 * 60_000);
      if (!orderLimit.allowed) {
        res.setHeader('Retry-After', String(orderLimit.retryAfterSec));
        sendJson(res, 429, { error: 'Too many payment order requests. Please wait before creating another order.' });
        return true;
      }

      const body = await readJsonBody(req);
      const planId = body.planId || 'pro';
      const billingInterval = body.interval === 'annual' ? 'annual' : 'monthly';
      const referralCode = body.referralCode || body.ref || undefined;

      try {
        const order = await createCryptoPaymentOrder({
          orgId: session.org.id,
          userId: session.user.id,
          userEmail: session.user.email,
          planId,
          billingInterval,
          referralCode,
        });

        sendJson(res, 201, { success: true, order });
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to create payment order' });
      }
      return true;
    }

    if (path.startsWith('/api/crypto/order/') && !path.endsWith('/cancel') && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const orderId = path.replace('/api/crypto/order/', '').trim();
      const order = db.findCryptoOrderById(orderId);
      const isOwner =
        order &&
        (order.userId === session.user.id ||
          order.userEmail?.toLowerCase() === session.user.email.toLowerCase() ||
          order.orgId === session.org.id);
      if (!order || (!isOwner && !isAdminRole(session.user.role))) {
        if (order) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'crypto_order', orderId } });
        }
        sendJson(res, 404, { error: 'Payment order not found' });
        return true;
      }

      sendJson(res, 200, order);
      return true;
    }

    if (path.startsWith('/api/crypto/order/') && path.endsWith('/cancel') && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const orderId = path.replace('/api/crypto/order/', '').replace('/cancel', '').trim();
      try {
        const result = await cancelPaymentOrder(orderId, {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role,
          orgId: session.org.id,
        });
        void logSecurityEvent({
          type: 'payment_status_change',
          outcome: 'success',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { action: 'cancel_order', orderId },
        });
        sendJson(res, 200, result);
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to cancel order' });
      }
      return true;
    }

    if (path === '/api/crypto/check-order' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const checkLimit = rateLimit(`crypto:check:${session.user.id}`, 30, 5 * 60_000);
      if (!checkLimit.allowed) {
        res.setHeader('Retry-After', String(checkLimit.retryAfterSec));
        sendJson(res, 429, { error: 'Too many verification checks. Please wait a moment.' });
        return true;
      }

      const { orderId, txId } = await readJsonBody(req);
      if (!orderId || typeof orderId !== 'string') {
        sendJson(res, 400, { error: 'Order ID is required' });
        return true;
      }

      const order = db.findCryptoOrderById(orderId);
      const isOwner =
        order &&
        (order.userId === session.user.id ||
          order.userEmail?.toLowerCase() === session.user.email.toLowerCase() ||
          order.orgId === session.org.id);
      if (!order || (!isOwner && !isAdminRole(session.user.role))) {
        if (order) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'crypto_check_order', orderId } });
        }
        sendJson(res, 404, { error: 'Payment order not found' });
        return true;
      }

      try {
        const result = await verifyPaymentOrder(orderId, typeof txId === 'string' ? txId : undefined);
        if (result.activated) {
          const freshOrg = db.findOrgById(session.org.id);
          if (freshOrg) session.org = freshOrg;
          void logSecurityEvent({
            type: 'payment_status_change',
            outcome: 'success',
            userId: session.user.id,
            req,
            details: { action: 'verified_paid', orderId },
          });
        }
        sendJson(res, 200, {
          success: true,
          order: result.order,
          activated: result.activated,
          message: result.message,
          organization: session.org,
        });
      } catch (err: any) {
        sendJson(res, 500, { error: 'Payment verification could not be completed at this time.' });
      }
      return true;
    }

    if (path === '/api/crypto/orders' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const userEmail = session.user.email.toLowerCase();
      const orders = db.getCryptoOrders().filter((o) => {
        if (session.user.role === 'super_admin') return true;
        return o.userId === session.user.id || (o.userEmail && o.userEmail.toLowerCase() === userEmail) || o.orgId === session.org.id;
      });
      sendJson(res, 200, orders);
      return true;
    }

    if (path === '/api/crypto/lbank-test' && (method === 'GET' || method === 'POST')) {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      // Restrict LBank exchange diagnostic endpoint to administrators only
      if (!isAdminRole(session.user.role)) {
        void logSecurityEvent({
          type: 'forbidden_access',
          outcome: 'blocked',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { path },
        });
        sendJson(res, 403, { error: 'Admin privilege required' });
        return true;
      }

      try {
        const testResult = await testLBankConnection();
        sendJson(res, 200, testResult);
      } catch (err: any) {
        sendJson(res, 500, {
          status: 'FAILED',
          title: 'LBank API Connection: FAILED',
          endpoint: 'https://api.lbank.info/v2/supplement/api_Restrictions.do',
          errorMessage: 'Unexpected error executing LBank API test.',
          diagnostic: 'Check server environment configuration.',
          timestamp: new Date().toISOString(),
        });
      }
      return true;
    }

    // --- 8.5 REFERRAL, COMMISSION WALLET & WITHDRAWAL SYSTEM ---
    if (path === '/api/referrals/validate' && method === 'POST') {
      const refLimit = rateLimit(`referral:validate:${ipHash}`, 30, 15 * 60_000);
      if (!refLimit.allowed) {
        res.setHeader('Retry-After', String(refLimit.retryAfterSec));
        sendJson(res, 429, { valid: false, error: 'Too many validation requests. Please wait before trying again.' });
        return true;
      }
      const session = await resolveSession(req);
      const body = await readJsonBody(req);
      const code = body?.referralCode || body?.code || '';
      const email = body?.email || session?.user?.email || '';
      await db.ensureSchema();
      const validation = await validateReferralCodeForRegistration(code, email);
      if (!validation.valid) {
        sendJson(res, 400, { valid: false, error: validation.error });
        return true;
      }
      sendJson(res, 200, {
        valid: true,
        referralCode: validation.referrer?.referralCode,
        referrerName: validation.referrer?.name,
      });
      return true;
    }

    if ((path === '/api/referrals/me' || path === '/api/profile/referrals') && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      await db.ensureSchema();
      try {
        const summary = await getUserReferralSummary(session.user.id, getPublicOrigin(req));
        sendJson(res, 200, summary);
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to load referral profile' });
      }
      return true;
    }

    if (path === '/api/referrals/apply' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const body = await readJsonBody(req);
      const code = body?.referralCode || body?.code || '';
      await db.ensureSchema();
      try {
        const result = await applyReferralCodeToUser(session.user.id, code);
        sendJson(res, 200, result);
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to apply referral code' });
      }
      return true;
    }

    if ((path === '/api/withdrawals' || path === '/api/referrals/withdrawals') && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      await db.ensureSchema();
      try {
        const requests = await getUserWithdrawalRequests(session.user.id);
        sendJson(res, 200, requests);
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to fetch withdrawal history' });
      }
      return true;
    }

    if ((path === '/api/withdrawals' || path === '/api/referrals/withdrawals') && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const body = await readJsonBody(req);
      const amount = body?.amountUsd ?? body?.amount;
      const walletAddress = body?.walletAddress || body?.address || '';
      await db.ensureSchema();
      try {
        const request = await createWithdrawalRequest({
          userId: session.user.id,
          amount,
          walletAddress,
        });
        void logSecurityEvent({
          type: 'payment_status_change',
          outcome: 'success',
          userId: session.user.id,
          req,
          details: { action: 'withdrawal_requested', withdrawalId: request.id, amount: request.amount },
        });
        sendJson(res, 201, {
          success: true,
          request,
          withdrawal: request,
          message: `Withdrawal request of ${request.amount.toFixed(2)} USDT submitted and funds reserved.`,
        });
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to submit withdrawal request' });
      }
      return true;
    }

    // 9. SUPPORT TICKETS (Customer & Admin Ticketing System)
    if (path === '/api/tickets' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated. Please log in to view support tickets.' });
        return true;
      }
      try {
        const scope = parsedUrl.searchParams.get('scope') || '';
        const statusFilter = parsedUrl.searchParams.get('status') || undefined;
        const searchFilter = parsedUrl.searchParams.get('search') || undefined;
        if (isAdminUser(session.user) && scope !== 'own') {
          const { tickets } = await listAdminSupportTickets(session.user, {
            status: statusFilter,
            search: searchFilter,
          });
          sendJson(res, 200, tickets);
        } else {
          const tickets = await listCustomerSupportTickets(session.user);
          sendJson(res, 200, tickets);
        }
      } catch (err: any) {
        const status = err instanceof TicketAccessDeniedError ? 403 : 400;
        sendJson(res, status, { error: err.message || 'Failed to load support tickets.' });
      }
      return true;
    }

    if (path === '/api/tickets' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated. Please log in to create a support ticket.' });
        return true;
      }

      const body = await readJsonBody(req);
      try {
        const result = await createSupportTicket(session.user, body, getPublicOrigin(req));
        sendJson(res, result.alreadyCreated ? 200 : 201, {
          ...result.ticket,
          ticket: result.ticket,
          alreadyCreated: result.alreadyCreated,
          emailNotification: result.ticket.emailNotification,
        });
      } catch (err: any) {
        const status =
          err instanceof TicketValidationError
            ? 400
            : err instanceof TicketAccessDeniedError
            ? 403
            : 400;
        sendJson(res, status, { error: err.message || 'Failed to create support ticket.' });
      }
      return true;
    }

    if (path === '/api/admin/tickets' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated. Please log in.' });
        return true;
      }
      if (!isAdminUser(session.user)) {
        sendJson(res, 403, { error: 'Admin access required to view the global support ticket inbox.' });
        return true;
      }

      try {
        const statusFilter = parsedUrl.searchParams.get('status') || undefined;
        const searchFilter = parsedUrl.searchParams.get('search') || undefined;
        const result = await listAdminSupportTickets(session.user, {
          status: statusFilter,
          search: searchFilter,
        });
        sendJson(res, 200, result);
      } catch (err: any) {
        const status = err instanceof TicketAccessDeniedError ? 403 : 400;
        sendJson(res, status, { error: err.message || 'Failed to load admin ticket inbox.' });
      }
      return true;
    }

    if (
      (path.startsWith('/api/tickets/') || path.startsWith('/api/admin/tickets/')) &&
      (path.endsWith('/replies') || path.endsWith('/messages') || path.endsWith('/reply')) &&
      method === 'POST'
    ) {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated. Please log in to reply to a ticket.' });
        return true;
      }

      const isAdminPath = path.startsWith('/api/admin/tickets/');
      if (isAdminPath && !isAdminUser(session.user)) {
        sendJson(res, 403, { error: 'Admin access required to reply from the administrative support inbox.' });
        return true;
      }

      const ticketId = path
        .replace('/api/admin/tickets/', '')
        .replace('/api/tickets/', '')
        .replace(/\/(replies|messages|reply)$/, '')
        .trim();

      const body = await readJsonBody(req);
      try {
        const result = await replyToSupportTicket(
          decodeURIComponent(ticketId),
          session.user,
          {
            ...body,
            replyAsAdmin: isAdminPath ? true : body?.replyAsAdmin,
          },
          getPublicOrigin(req)
        );
        sendJson(res, 200, {
          success: true,
          ticket: result.ticket,
          reply: result.reply,
          emailNotification: result.emailNotification,
        });
      } catch (err: any) {
        if (err instanceof TicketAccessDeniedError) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'ticket_reply', ticketId } });
        }
        const status =
          err instanceof TicketValidationError
            ? 400
            : err instanceof TicketAccessDeniedError
            ? 403
            : err instanceof TicketNotFoundError
            ? 404
            : 400;
        sendJson(res, status, { error: err.message || 'Failed to post ticket reply.' });
      }
      return true;
    }

    if (
      (path.startsWith('/api/tickets/') || path.startsWith('/api/admin/tickets/')) &&
      path.endsWith('/status') &&
      (method === 'PATCH' || method === 'POST')
    ) {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated. Please log in.' });
        return true;
      }
      if (!isAdminUser(session.user)) {
        void logSecurityEvent({ type: 'forbidden_access', outcome: 'blocked', userId: session.user.id, actorRole: session.user.role, req, details: { resource: 'ticket_status' } });
        sendJson(res, 403, { error: 'Admin access required to update ticket status.' });
        return true;
      }

      const ticketId = path
        .replace('/api/admin/tickets/', '')
        .replace('/api/tickets/', '')
        .replace(/\/status$/, '')
        .trim();

      const body = await readJsonBody(req);
      try {
        const updatedTicket = await updateSupportTicketStatus(
          decodeURIComponent(ticketId),
          session.user,
          body?.status
        );
        void logSecurityEvent({
          type: 'admin_action',
          outcome: 'success',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { action: 'update_ticket_status', ticketId, status: body?.status },
        });
        sendJson(res, 200, {
          success: true,
          ticket: updatedTicket,
        });
      } catch (err: any) {
        const status =
          err instanceof TicketValidationError
            ? 400
            : err instanceof TicketAccessDeniedError
            ? 403
            : err instanceof TicketNotFoundError
            ? 404
            : 400;
        sendJson(res, status, { error: err.message || 'Failed to update ticket status.' });
      }
      return true;
    }

    if (
      (path.startsWith('/api/tickets/') || path.startsWith('/api/admin/tickets/')) &&
      method === 'GET'
    ) {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated. Please log in to view ticket details.' });
        return true;
      }

      const isAdminPath = path.startsWith('/api/admin/tickets/');
      if (isAdminPath && !isAdminUser(session.user)) {
        sendJson(res, 403, { error: 'Admin access required.' });
        return true;
      }

      const ticketId = path
        .replace('/api/admin/tickets/', '')
        .replace('/api/tickets/', '')
        .trim();

      try {
        const ticket = await getSupportTicketDetail(decodeURIComponent(ticketId), session.user);
        sendJson(res, 200, ticket);
      } catch (err: any) {
        if (err instanceof TicketAccessDeniedError) {
          void logSecurityEvent({ type: 'idor_blocked', outcome: 'blocked', userId: session.user.id, req, details: { resource: 'ticket_detail', ticketId } });
        }
        const status =
          err instanceof TicketAccessDeniedError
            ? 403
            : err instanceof TicketNotFoundError
            ? 404
            : 400;
        sendJson(res, status, { error: err.message || 'Failed to load ticket.' });
      }
      return true;
    }

    // 10. ADMIN DASHBOARD METRICS & CONTROL
    if (path === '/api/admin/overview' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session || session.user.role !== 'super_admin') {
        sendJson(res, 403, { error: 'Super Admin privilege required' });
        return true;
      }

      await db.ensureSchema();
      const users = db.getUsers();
      const orgs = db.getOrganizations();
      const sites = db.getWebsites();
      const incidents = db.getIncidents();
      const invoices = db.getInvoices();
      const totalRevenue = invoices.filter((i) => i.status === 'paid').reduce((acc, curr) => acc + curr.amount, 0);
      const referralOverview = await getAdminReferralOverview();

      sendJson(res, 200, {
        totalUsers: users.length,
        totalOrganizations: orgs.length,
        totalWebsites: sites.length,
        onlineWebsites: sites.filter((s) => s.status === 'ONLINE').length,
        degradedWebsites: sites.filter((s) => s.status === 'DEGRADED').length,
        offlineWebsites: sites.filter((s) => s.status === 'OFFLINE').length,
        openIncidents: incidents.filter((i) => i.status === 'OPEN').length,
        totalRevenue,
        workerStats: monitorEngine.getStats(),
        settings: db.getSettings(),
        referralOverview,
        totalReferralCommissionsGenerated: referralOverview.totalReferralCommissionsGenerated,
        totalAvailableReferralLiabilities: referralOverview.totalAvailableReferralLiabilities,
        totalReservedForPendingWithdrawals: referralOverview.totalReservedForPendingWithdrawals,
        pendingWithdrawalRequestsCount: referralOverview.pendingWithdrawalRequestsCount,
        totalSuccessfullyPaidWithdrawals: referralOverview.totalSuccessfullyPaidWithdrawals,
        totalRejectedRequestsCount: referralOverview.totalRejectedRequestsCount,
      });
      return true;
    }

    if (path === '/api/admin/users' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session || session.user.role !== 'super_admin') {
        sendJson(res, 403, { error: 'Super Admin privilege required' });
        return true;
      }
      sendJson(res, 200, db.getUsers().map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        orgId: u.orgId,
        referralCode: u.referralCode,
        referredByUserId: u.referredByUserId,
        referredByCode: u.referredByCode,
        createdAt: u.createdAt,
      })));
      return true;
    }

    if (path === '/api/admin/security-events' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session || session.user.role !== 'super_admin') {
        sendJson(res, 403, { error: 'Super Admin privilege required' });
        return true;
      }
      const limit = Number(parsedUrl.searchParams.get('limit')) || 100;
      const page = Number(parsedUrl.searchParams.get('page')) || 1;
      const type = parsedUrl.searchParams.get('type') || undefined;
      const result = await listSecurityEvents({ page, pageSize: limit, type });
      sendJson(res, 200, result);
      return true;
    }

    if (path.startsWith('/api/admin/users/') && path.endsWith('/unlock') && method === 'POST') {
      const session = await resolveSession(req);
      if (!session || session.user.role !== 'super_admin') {
        sendJson(res, 403, { error: 'Super Admin privilege required' });
        return true;
      }
      const targetId = path.replace('/api/admin/users/', '').replace('/unlock', '').trim();
      const targetUser = db.findUserById(targetId) || db.findUserByEmail(targetId);
      if (!targetUser) {
        sendJson(res, 404, { error: 'User not found' });
        return true;
      }
      const body = await readJsonBody(req);
      // Step-up authentication: verify the super_admin's own password when provided or required
      if (typeof body?.adminPassword === 'string' && body.adminPassword.length > 0) {
        const ok = await verifyPasswordAsync(body.adminPassword, session.user.passwordHash);
        if (!ok) {
          await logSecurityEvent({ type: 'admin_action', outcome: 'failure', userId: session.user.id, actorRole: session.user.role, req, details: { action: 'unlock_user_stepup_failed', targetId: targetUser.id } });
          sendJson(res, 401, { error: 'Admin password verification failed.' });
          return true;
        }
      }
      await adminUnlockAccount(targetUser, session.user, req);
      sendJson(res, 200, { success: true, message: `Account ${targetUser.email} unlocked.` });
      return true;
    }

    if (path.startsWith('/api/admin/users/') && path.endsWith('/role') && (method === 'POST' || method === 'PATCH')) {
      const session = await resolveSession(req);
      if (!session || session.user.role !== 'super_admin') {
        sendJson(res, 403, { error: 'Super Admin privilege required' });
        return true;
      }
      const targetId = path.replace('/api/admin/users/', '').replace('/role', '').trim();
      const targetUser = db.findUserById(targetId);
      if (!targetUser) {
        sendJson(res, 404, { error: 'User not found' });
        return true;
      }
      const body = await readJsonBody(req);
      const newRole = body?.role;
      if (newRole !== 'team_member' && newRole !== 'agency_admin' && newRole !== 'admin' && newRole !== 'super_admin') {
        sendJson(res, 400, { error: 'Invalid role specified.' });
        return true;
      }
      if (targetUser.email.toLowerCase() === 'mobinalavi7491@gmail.com' && newRole !== 'super_admin') {
        sendJson(res, 400, { error: 'Primary Super Admin role cannot be downgraded.' });
        return true;
      }
      const prevRole = targetUser.role;
      db.updateUserRole(targetUser.id, newRole);
      await revokeAllUserSessions(targetUser.id, 'role_changed');
      await logSecurityEvent({
        type: 'role_changed',
        outcome: 'success',
        userId: session.user.id,
        actorRole: session.user.role,
        req,
        details: { targetUserId: targetUser.id, from: prevRole, to: newRole },
        awaitWrite: true,
      });
      sendJson(res, 200, { success: true, userId: targetUser.id, role: newRole });
      return true;
    }

    // Admin Withdrawal Management Endpoints
    if (path === '/api/admin/referrals/overview' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.user.role !== 'super_admin' && session.user.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin privilege required' });
        return true;
      }
      await db.ensureSchema();
      const overview = await getAdminReferralOverview();
      sendJson(res, 200, overview);
      return true;
    }

    if (path === '/api/admin/withdrawals' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.user.role !== 'super_admin' && session.user.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin privilege required to view withdrawal requests' });
        return true;
      }
      await db.ensureSchema();
      const [requests, overview] = await Promise.all([
        getAdminWithdrawalRequests({
          id: session.user.id,
          email: session.user.email,
          role: session.user.role,
        }),
        getAdminReferralOverview(),
      ]);
      sendJson(res, 200, { requests, overview });
      return true;
    }

    if (path.startsWith('/api/admin/withdrawals/') && path.endsWith('/approve') && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.user.role !== 'super_admin' && session.user.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin access required to approve withdrawals.' });
        return true;
      }
      const withdrawalId = path
        .replace('/api/admin/withdrawals/', '')
        .replace('/approve', '')
        .trim();

      await db.ensureSchema();
      try {
        const result = await approveWithdrawalForPayout(withdrawalId, {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role,
        });
        void logSecurityEvent({
          type: 'admin_action',
          outcome: 'success',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { action: 'approve_withdrawal', withdrawalId },
        });
        sendJson(res, 200, {
          ...result,
          request: result.withdrawal,
        });
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to approve withdrawal.' });
      }
      return true;
    }

    if (
      path.startsWith('/api/admin/withdrawals/') &&
      (path.endsWith('/mark-paid') || path.endsWith('/pay')) &&
      method === 'POST'
    ) {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.user.role !== 'super_admin' && session.user.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin access required to mark withdrawals as paid.' });
        return true;
      }
      const withdrawalId = path
        .replace('/api/admin/withdrawals/', '')
        .replace('/mark-paid', '')
        .replace('/pay', '')
        .trim();

      const body = await readJsonBody(req);
      const txHash = body?.txHash || body?.txId || '';

      await db.ensureSchema();
      try {
        const result = await markWithdrawalAsPaid(
          withdrawalId,
          {
            id: session.user.id,
            email: session.user.email,
            role: session.user.role,
          },
          txHash
        );
        void logSecurityEvent({
          type: 'admin_action',
          outcome: 'success',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { action: 'mark_withdrawal_paid', withdrawalId },
        });
        sendJson(res, 200, {
          ...result,
          request: result.withdrawal,
        });
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to mark withdrawal as paid.' });
      }
      return true;
    }

    if (path.startsWith('/api/admin/withdrawals/') && path.endsWith('/reject') && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.user.role !== 'super_admin' && session.user.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin access required to reject withdrawals.' });
        return true;
      }
      const withdrawalId = path
        .replace('/api/admin/withdrawals/', '')
        .replace('/reject', '')
        .trim();

      const body = await readJsonBody(req);
      const reason = body?.reason;

      await db.ensureSchema();
      try {
        const result = await rejectWithdrawalRequest(
          withdrawalId,
          {
            id: session.user.id,
            email: session.user.email,
            role: session.user.role,
          },
          reason
        );
        void logSecurityEvent({
          type: 'admin_action',
          outcome: 'success',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { action: 'reject_withdrawal', withdrawalId },
        });
        sendJson(res, 200, {
          ...result,
          request: result.withdrawal,
        });
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to reject withdrawal.' });
      }
      return true;
    }

    if (path.startsWith('/api/admin/withdrawals/') && path.endsWith('/cancel') && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.user.role !== 'super_admin' && session.user.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin access required to cancel withdrawals.' });
        return true;
      }
      const withdrawalId = path
        .replace('/api/admin/withdrawals/', '')
        .replace('/cancel', '')
        .trim();

      await db.ensureSchema();
      try {
        const result = await cancelWithdrawalRequest(withdrawalId, {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role,
        });
        void logSecurityEvent({
          type: 'admin_action',
          outcome: 'success',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { action: 'cancel_withdrawal', withdrawalId },
        });
        sendJson(res, 200, {
          ...result,
          request: result.withdrawal,
        });
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to cancel withdrawal.' });
      }
      return true;
    }

    // Approve Payment Order (Admin only)
    if (
      (path.startsWith('/api/admin/crypto/orders/') || path.startsWith('/api/admin/payments/')) &&
      path.endsWith('/approve') &&
      method === 'POST'
    ) {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.user.role !== 'super_admin' && session.user.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin access required to approve payments.' });
        return true;
      }
      const orderId = path
        .replace('/api/admin/crypto/orders/', '')
        .replace('/api/admin/payments/', '')
        .replace('/approve', '')
        .trim();

      try {
        const result = await approvePaymentOrder(orderId, {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role,
        });
        void logSecurityEvent({
          type: 'payment_status_change',
          outcome: 'success',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { action: 'admin_approve_payment', orderId },
        });
        sendJson(res, 200, result);
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to approve payment.' });
      }
      return true;
    }

    // Reject Payment Order (Admin only)
    if (
      (path.startsWith('/api/admin/crypto/orders/') || path.startsWith('/api/admin/payments/')) &&
      path.endsWith('/reject') &&
      method === 'POST'
    ) {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      if (session.user.role !== 'super_admin' && session.user.role !== 'admin') {
        sendJson(res, 403, { error: 'Admin access required to reject payments.' });
        return true;
      }
      const orderId = path
        .replace('/api/admin/crypto/orders/', '')
        .replace('/api/admin/payments/', '')
        .replace('/reject', '')
        .trim();

      const body = await readJsonBody(req);
      const reason = body?.reason;

      try {
        const result = await rejectPaymentOrder(
          orderId,
          {
            id: session.user.id,
            email: session.user.email,
            role: session.user.role,
          },
          reason
        );
        void logSecurityEvent({
          type: 'payment_status_change',
          outcome: 'success',
          userId: session.user.id,
          actorRole: session.user.role,
          req,
          details: { action: 'admin_reject_payment', orderId },
        });
        sendJson(res, 200, result);
      } catch (err: any) {
        sendJson(res, 400, { error: err.message || 'Failed to reject payment.' });
      }
      return true;
    }

    if ((path === '/api/admin/crypto/orders' || path === '/api/admin/payments') && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const role = session.user.role;
      const isAdmin = role === 'admin' || role === 'super_admin';
      if (!isAdmin) {
        sendJson(res, 403, { error: 'Admin access required to view global platform transactions' });
        return true;
      }

      const orders = [...db.getCryptoOrders()].sort((a, b) => {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      sendJson(res, 200, orders);
      return true;
    }

    if (path === '/api/admin/trigger-worker' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session || session.user.role !== 'super_admin') {
        sendJson(res, 403, { error: 'Super Admin privilege required' });
        return true;
      }
      await monitorEngine.tick();
      void logSecurityEvent({ type: 'admin_action', outcome: 'success', userId: session.user.id, actorRole: session.user.role, req, details: { action: 'trigger_worker' } });
      sendJson(res, 200, { message: 'Monitoring queue tick triggered successfully', stats: monitorEngine.getStats() });
      return true;
    }

    // 11. PUBLIC DEVELOPER REST API (v1)
    if (path.startsWith('/api/v1/')) {
      // Management endpoints for API keys require a full user session (never a raw API key)
      if (path === '/api/v1/api-keys' && method === 'GET') {
        const session = await resolveSession(req);
        if (!session) {
          sendJson(res, 401, { error: 'Unauthenticated' });
          return true;
        }
        // Strip hashedSecret before returning key metadata
        const safeKeys = db
          .getApiKeys()
          .filter((k) => k.orgId === session.org.id)
          .map(({ hashedSecret: _hs, ...rest }) => rest);
        sendJson(res, 200, safeKeys);
        return true;
      }

      if (path === '/api/v1/api-keys' && method === 'POST') {
        const session = await resolveSession(req);
        if (!session) {
          sendJson(res, 401, { error: 'Unauthenticated' });
          return true;
        }
        if (session.org.planId === 'free' && session.user.role !== 'super_admin') {
          const trial = getAccountTrialStatus(session.org);
          if (trial.isExpired) {
            sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
            return true;
          }
        }
        const body = await readJsonBody(req);
        const secret = `pv_live_${crypto.randomBytes(24).toString('hex')}`;
        const prefix = secret.substring(0, 11);
        const newKey: ApiKey = {
          id: `key_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          orgId: session.org.id,
          name: cleanString(body.name, 80) || 'API Client Key',
          prefix,
          hashedSecret: crypto.createHash('sha256').update(secret).digest('hex'),
          scopes: ['websites:read', 'websites:write', 'scans:create'],
          createdAt: new Date().toISOString(),
        };
        db.addApiKey(newKey);
        const { hashedSecret: _hs, ...publicKey } = newKey;
        sendJson(res, 201, { ...publicKey, secretToken: secret });
        return true;
      }

      if (path.startsWith('/api/v1/api-keys/') && method === 'DELETE') {
        const session = await resolveSession(req);
        if (!session) {
          sendJson(res, 401, { error: 'Unauthenticated' });
          return true;
        }
        const keyId = path.replace('/api/v1/api-keys/', '').trim();
        const keyRecord = db.getApiKeys().find((k) => k.id === keyId);
        if (!keyRecord || (keyRecord.orgId !== session.org.id && session.user.role !== 'super_admin')) {
          sendJson(res, 404, { error: 'API key not found' });
          return true;
        }
        db.revokeApiKey(keyId);
        sendJson(res, 200, { success: true, message: 'API key revoked.' });
        return true;
      }

      // Authenticate API v1 data requests using FULL SHA-256 secret hash comparison (constant-time) or active session
      const apiKeyHeader = req.headers['x-api-key'] || req.headers['authorization'];
      const rawKey = typeof apiKeyHeader === 'string' ? apiKeyHeader.replace(/^Bearer\s+/i, '').trim() : '';
      let matchedKey: ApiKey | undefined;
      if (rawKey && rawKey.startsWith('pv_live_') && rawKey.length >= 16 && rawKey.length <= 128) {
        const candidateHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        for (const k of db.getApiKeys()) {
          if (k.hashedSecret && constantTimeEqual(candidateHash, k.hashedSecret)) {
            matchedKey = k;
            break;
          }
        }
      }

      let targetOrgId: string | undefined = matchedKey?.orgId;
      let isSuperAdminCaller = false;
      if (!matchedKey) {
        const session = await resolveSession(req);
        if (!session) {
          void logSecurityEvent({ type: 'unauthorized_access', outcome: 'blocked', req, details: { path, reason: 'invalid_api_key' } });
          sendJson(res, 401, { error: 'Valid X-API-Key header or Bearer session token is required.' });
          return true;
        }
        targetOrgId = session.org.id;
        isSuperAdminCaller = session.user.role === 'super_admin';
      } else {
        matchedKey.lastUsedAt = new Date().toISOString();
      }

      if (path === '/api/v1/websites' && method === 'GET') {
        await cleanupOverdueExpiredWebsites().catch(() => {});
        if (targetOrgId) {
          await reconcileOrganizationWebsiteAllocations(targetOrgId).catch(() => {});
        }
        const scopedSites = isSuperAdminCaller
          ? db.getWebsites()
          : db.getWebsites().filter((w) => w.orgId === targetOrgId);
        // Filter out expired websites from API v1 data feed unless super admin
        const accessibleSites = isSuperAdminCaller
          ? scopedSites
          : scopedSites.filter((w) => !w.isSubscriptionExpired && w.accessStatus !== 'expired_grace_period');
        sendJson(res, 200, {
          data: accessibleSites.map((w) => ({
            id: w.id,
            name: w.name,
            url: w.url,
            domain: w.domain,
            status: w.status,
            healthScore: w.healthScore,
            responseTimeMs: w.lastResponseTimeMs,
            uptime24h: w.uptime24h,
            lastCheckedAt: w.lastCheckedAt,
          })),
        });
        return true;
      }
    }

    sendJson(res, 404, { error: 'Requested API endpoint was not found.' });
    return true;
  } catch (err: any) {
    if (err instanceof HttpError) {
      if (err.extraHeaders) {
        for (const [k, v] of Object.entries(err.extraHeaders)) res.setHeader(k, v);
      }
      sendJson(res, err.status, { error: err.message });
      return true;
    }
    console.error('[API Route Handler Error]:', sanitizeForLog(err?.message || 'Unexpected error', 200));
    sendJson(res, 500, { error: 'An unexpected error occurred. Please try again later.' });
    return true;
  }
}
