import 'dotenv/config';
import { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { db, hashPassword, verifyPassword, type User, type Website, type Organization, type AlertNotification, type ReportItem, type SupportTicket, type ApiKey } from './db.ts';
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
  findSessionByToken,
  deleteSessionByToken,
} from './db/sessionRepo.ts';
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

function getPublicOrigin(req: IncomingMessage): string {
  const configured = process.env.PUBLIC_APP_URL || process.env.APP_URL || process.env.VITE_APP_URL;
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/+$/, '');
  }
  const originHeader = req.headers['origin'];
  if (typeof originHeader === 'string' && originHeader.startsWith('http')) {
    return originHeader.replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'http';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.headers['host'] || 'localhost:5173';
  return `${proto}://${host}`;
}

// Token mechanism with in-memory caching + PostgreSQL persistence
const sessionStore = new Map<string, { userId: string; orgId: string; expiresAt: number }>();

function createSession(userId: string, orgId: string): string {
  const token = `pv_sess_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
  sessionStore.set(token, {
    userId,
    orgId,
    expiresAt,
  });
  db.ensureSchema()
    .then(() => createDbSession(token, userId, orgId, expiresAt))
    .catch((err) =>
      console.warn('[Session DB Notice] Note saving session to PostgreSQL:', err.message)
    );
  return token;
}

async function resolveSession(req: IncomingMessage): Promise<{ user: User; org: Organization } | null> {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  // 1. Check in-memory session cache first for fast response
  const session = sessionStore.get(token);
  if (session && session.expiresAt > Date.now()) {
    const user = db.findUserById(session.userId);
    if (user) {
      const cleanEmail = (user.email || '').trim().toLowerCase();
      if (cleanEmail === 'admin@pulsevanguard.com' || cleanEmail === 'agency@acmedigital.com') {
        sessionStore.delete(token);
        deleteSessionByToken(token).catch(() => {});
        return null;
      }
      const org = db.findOrgById(user.orgId);
      if (org) return { user, org };
    }
  }

  // 2. Fall back to PostgreSQL persistent sessions table (e.g. surviving server restart)
  try {
    const dbSession = await findSessionByToken(token);
    if (dbSession && dbSession.expiresAt > Date.now()) {
      const cleanEmail = (dbSession.user.email || '').trim().toLowerCase();
      if (cleanEmail === 'admin@pulsevanguard.com' || cleanEmail === 'agency@acmedigital.com') {
        sessionStore.delete(token);
        await deleteSessionByToken(token).catch(() => {});
        return null;
      }
      sessionStore.set(token, {
        userId: dbSession.userId,
        orgId: dbSession.orgId,
        expiresAt: dbSession.expiresAt,
      });
      return { user: dbSession.user, org: dbSession.org };
    }
  } catch (err: any) {
    console.warn('[Session DB Warning] Failed looking up session in PostgreSQL:', err.message);
  }

  return null;
}

// Helper to read JSON body
async function readJsonBody(req: IncomingMessage): Promise<any> {
  if ((req as any).body && typeof (req as any).body === 'object') {
    return (req as any).body;
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        if (!raw.trim()) resolve({});
        else resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

// JSON responder helper
function sendJson(res: ServerResponse, status: number, data: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.end(JSON.stringify(data));
}

export async function handleApiRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const reqUrl = req.url || (req as any).originalUrl || '';
  if (!reqUrl.startsWith('/api/')) return false;

  const parsedUrl = new URL(reqUrl, 'http://localhost');
  const path = parsedUrl.pathname;
  const method = req.method?.toUpperCase() || 'GET';

  // Handle CORS preflight options request
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.end();
    return true;
  }

  try {
    // 0. HEALTH CHECK
    if ((path === '/api/healthz' || path === '/api/health') && method === 'GET') {
      sendJson(res, 200, { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
      return true;
    }

    // 1. FREE PUBLIC SCANNER & PAGESPEED INSIGHTS / AUTHENTICATED SCANNER
    if ((path === '/api/scan' || path === '/api/scanner/run') && method === 'POST') {
      const session = await resolveSession(req);
      // Protected Scanner endpoint requires authentication
      if (path === '/api/scanner/run' && !session) {
        sendJson(res, 401, { error: 'Unauthenticated. Please log in to run scans.' });
        return true;
      }

      // If request has authentication (or is /api/scanner/run), enforce Free Trial restriction
      if (session && session.org.planId === 'free' && session.user.role !== 'super_admin') {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }
      }

      const body = await readJsonBody(req);
      const target = body.url;
      if (!target || typeof target !== 'string') {
        sendJson(res, 400, { error: 'Please provide a valid website URL.' });
        return true;
      }

      try {
        // Run core health scan
        const scanResult = await performWebsiteScan(target);

        // Run PageSpeed analysis in parallel or safely attached without failing core scan
        try {
          const pageSpeedData = await performPageSpeedAnalysis(target);
          scanResult.pageSpeed = pageSpeedData;

          // Save PageSpeed records in db for persistence
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
            error: psErr.message || 'PageSpeed analysis is temporarily unavailable.',
          };
        }

        sendJson(res, 200, scanResult);
      } catch (err: any) {
        sendJson(res, 422, { error: err.message || 'Scan failed for given URL.' });
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

      let target = '';
      let forceRefresh = false;
      let requestedStrategy: 'mobile' | 'desktop' | 'both' = 'both';

      if (method === 'POST') {
        const body = await readJsonBody(req);
        target = body?.url;
        forceRefresh = Boolean(body?.forceRefresh);
        if (body?.strategy === 'mobile' || body?.strategy === 'desktop') {
          requestedStrategy = body.strategy;
        }
      } else {
        target = parsedUrl.searchParams.get('url') || '';
        forceRefresh = parsedUrl.searchParams.get('forceRefresh') === 'true';
        const strat = parsedUrl.searchParams.get('strategy');
        if (strat === 'mobile' || strat === 'desktop') {
          requestedStrategy = strat;
        }
      }

      if (!target || typeof target !== 'string') {
        sendJson(res, 400, { error: 'Please provide a valid website URL.' });
        return true;
      }

      try {
        const pageSpeedResult = await performPageSpeedAnalysis(target, {
          forceRefresh,
          strategy: requestedStrategy,
        });

        // Persist records
        if (pageSpeedResult.mobile) {
          db.addPageSpeedRecord({
            id: `ps_mob_${Date.now()}`,
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

        sendJson(res, 200, pageSpeedResult);
      } catch (err: any) {
        sendJson(res, 422, { error: err.message || 'PageSpeed analysis failed.' });
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
      const body = await readJsonBody(req);
      const { email, password, name, orgName } = body;
      const rawRefCode = body.referralCode || body.ref || parsedUrl.searchParams.get('ref') || '';
      const cleanEmail = typeof email === 'string' ? email.trim() : '';
      const cleanPassword = typeof password === 'string' ? password : '';
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (!cleanEmail || !cleanPassword || !cleanName) {
        sendJson(res, 400, { error: 'Name, email, and password are required.' });
        return true;
      }
      if (cleanEmail.toLowerCase() === 'admin@pulsevanguard.com' || cleanEmail.toLowerCase() === 'agency@acmedigital.com') {
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

      const orgId = `org_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      const userId = `usr_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      const nowIso = new Date().toISOString();
      const trialEndsIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const newOrg: Organization = {
        id: orgId,
        name: orgName ? String(orgName).trim() : `${cleanName}'s Workspace`,
        planId: 'free',
        billingInterval: 'monthly',
        currency: 'USD',
        ownerId: userId,
        trialStartedAt: nowIso,
        trialEndsAt: trialEndsIso,
        trialUsed: true,
        whiteLabel: { enabled: false, brandName: orgName ? String(orgName).trim() : cleanName },
        clients: [],
        createdAt: nowIso,
      };
      db.addOrganization(newOrg);
      try {
        await OrgRepo.insert(newOrg);
      } catch {}

      const uniqueReferralCode = await generateUniqueReferralCodeForUser(userId, cleanEmail);
      const isTargetSuperAdmin = cleanEmail.toLowerCase() === 'mobinalavi7491@gmail.com';
      const newUser: User = {
        id: userId,
        email: cleanEmail.toLowerCase(),
        name: cleanName,
        passwordHash: hashPassword(cleanPassword),
        role: isTargetSuperAdmin ? 'super_admin' : 'team_member',
        orgId,
        emailVerified: true,
        referralCode: uniqueReferralCode,
        referredByUserId,
        referredByCode,
        referredAt: referredByUserId ? nowIso : undefined,
        createdAt: nowIso,
      };
      db.addUser(newUser);
      try {
        await UserRepo.insert(newUser);
      } catch {}

      const token = createSession(userId, orgId);
      sendJson(res, 201, {
        token,
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
        organization: newOrg,
      });
      return true;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const { email, password } = await readJsonBody(req);
      const userAgent = req.headers['user-agent'] || 'unknown';
      const cleanEmail = typeof email === 'string' ? email.trim() : '';
      const cleanPassword = typeof password === 'string' ? password : '';

      // Diagnostic logging (strictly without logging password or password hash)
      console.log(`[AUTH DIAGNOSTIC] Login attempt:`, {
        emailLength: cleanEmail.length,
        passwordLength: cleanPassword.length,
        hasEmail: Boolean(cleanEmail),
        hasPassword: Boolean(cleanPassword),
        userAgentSummary: userAgent.substring(0, 80),
        timestamp: new Date().toISOString(),
      });

      if (!cleanEmail || !cleanPassword) {
        sendJson(res, 400, { error: 'Email and password are required.' });
        return true;
      }

      // Default demo accounts are permanently blocked and cannot log in
      if (cleanEmail.toLowerCase() === 'admin@pulsevanguard.com' || cleanEmail.toLowerCase() === 'agency@acmedigital.com') {
        console.log(`[AUTH DIAGNOSTIC] Login attempt rejected for decommissioned demo account.`);
        sendJson(res, 401, { error: 'Invalid credentials. Please verify your email and password.' });
        return true;
      }

      const user = db.findUserByEmail(cleanEmail);
      if (!user) {
        console.log(`[AUTH DIAGNOSTIC] User not found by email.`);
        sendJson(res, 401, { error: 'Invalid credentials. Please verify your email and password.' });
        return true;
      }

      const isValidPassword = verifyPassword(cleanPassword, user.passwordHash);
      console.log(`[AUTH DIAGNOSTIC] Password verification outcome:`, {
        userFound: true,
        userId: user.id,
        userRole: user.role,
        verified: isValidPassword,
      });

      if (!isValidPassword) {
        sendJson(res, 401, { error: 'Invalid credentials. Please verify your email and password.' });
        return true;
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

      const org = db.findOrgById(user.orgId);
      const token = createSession(user.id, user.orgId);
      sendJson(res, 200, {
        token,
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
        organization: org,
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
        organization: session.org,
        accountStatus: {
          plan: session.org.planId,
          trial: {
            startedAt: trialStatus.trialStartedAt || session.org.createdAt,
            endsAt: trialStatus.trialEndsAt || session.org.createdAt,
            expired: trialStatus.isExpired,
            remainingMs: trialStatus.remainingMs,
          },
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
      const trialStatus = getAccountTrialStatus(session.org);
      sendJson(res, 200, {
        plan: session.org.planId,
        trial: {
          startedAt: trialStatus.trialStartedAt || session.org.createdAt,
          endsAt: trialStatus.trialEndsAt || session.org.createdAt,
          expired: trialStatus.isExpired,
          remainingMs: trialStatus.remainingMs,
        },
      });
      return true;
    }

    if (path === '/api/auth/reset-password' && method === 'POST') {
      const { email } = await readJsonBody(req);
      // In production an email with reset token is dispatched; simulate success safely
      sendJson(res, 200, { message: `Password reset instructions have been dispatched to ${email || 'your email'}.` });
      return true;
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      const authHeader = req.headers['authorization'];
      if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        sessionStore.delete(token);
        try {
          await deleteSessionByToken(token);
        } catch {}
      }
      sendJson(res, 200, { success: true, message: 'Logged out successfully' });
      return true;
    }

    // 4. WEBSITES RESOURCE
    if (path === '/api/websites' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      // Super admin can see all; regular tenants only their org's
      const websites = session.user.role === 'super_admin'
        ? db.getWebsites()
        : db.getWebsites().filter((w) => w.orgId === session.org.id);
      sendJson(res, 200, websites);
      return true;
    }

    if (path === '/api/websites' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      // Enforce Free Trial restriction
      if (session.org.planId === 'free' && session.user.role !== 'super_admin') {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }
      }

      const orgSites = db.getWebsites().filter((w) => w.orgId === session.org.id);
      const plan = db.getPlans().find((p) => p.id === session.org.planId) || db.getPlans()[0];
      if (orgSites.length >= plan.limits.maxWebsites && session.user.role !== 'super_admin') {
        sendJson(res, 403, {
          error: `Your ${plan.name} plan limit is ${plan.limits.maxWebsites} websites. Please upgrade your subscription to monitor additional endpoints.`,
        });
        return true;
      }

      const body = await readJsonBody(req);
      const rawUrl = body.url;
      if (!rawUrl) {
        sendJson(res, 400, { error: 'Website URL is required' });
        return true;
      }

      const { url, domain } = normalizeInputUrl(rawUrl);
      await validateTargetSecurity(domain);

      const newSite: Website = {
        id: `site_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        orgId: session.org.id,
        clientId: body.clientId,
        name: body.name || domain,
        url,
        domain,
        status: 'ONLINE',
        intervalMinutes: body.intervalMinutes || Math.max(plan.limits.minIntervalMinutes, 5),
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
        tags: Array.isArray(body.tags) ? body.tags : ['Production'],
        groupName: body.groupName || 'Default Project',
        enabledChecks: {
          uptime: true,
          ssl: true,
          dns: true,
          seo: true,
          security: true,
          brokenLinks: false,
          ...(body.enabledChecks || {}),
        },
        notificationSettings: {
          email: true,
          alertEmail: session.user.email,
          alertOnDown: true,
          alertOnRecovery: true,
          alertOnSslExpiry: true,
          latencyThresholdMs: 1200,
          ...(body.notificationSettings || {}),
        },
        createdAt: new Date().toISOString(),
      };

      db.addWebsite(newSite);
      // Run immediate initial check
      monitorEngine.checkWebsite(newSite).catch(() => {});

      sendJson(res, 201, newSite);
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

      if (parts[4] === 'metrics') {
        const metrics = db.getMetrics().filter((m) => m.websiteId === siteId).slice(-48);
        sendJson(res, 200, metrics);
        return true;
      }

      const site = db.findWebsiteById(siteId);
      if (!site) {
        sendJson(res, 404, { error: 'Website not found' });
        return true;
      }
      sendJson(res, 200, site);
      return true;
    }

    if (path.startsWith('/api/websites/') && method === 'PATCH') {
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
      const siteId = path.split('/')[3];
      const site = db.findWebsiteById(siteId);
      if (!site || (site.orgId !== session.org.id && session.user.role !== 'super_admin')) {
        sendJson(res, 404, { error: 'Website not found' });
        return true;
      }

      const body = await readJsonBody(req);
      const updated = db.updateWebsite(siteId, body);
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
      if (session.org.planId === 'free' && session.user.role !== 'super_admin') {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }
      }
      const siteId = path.split('/')[3];
      const site = db.findWebsiteById(siteId);
      if (!site) {
        sendJson(res, 404, { error: 'Website not found' });
        return true;
      }
      const updated = await monitorEngine.checkWebsite(site);
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
      if (session.org.planId === 'free' && session.user.role !== 'super_admin') {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }
      }
      const siteId = path.split('/')[3];
      try {
        const fullResult = await monitorEngine.runFullAudit(siteId);
        sendJson(res, 200, fullResult);
      } catch (err: any) {
        sendJson(res, 500, { error: err.message });
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
      if (session.org.planId === 'free' && session.user.role !== 'super_admin') {
        const trial = getAccountTrialStatus(session.org);
        if (trial.isExpired) {
          sendJson(res, 403, TRIAL_EXPIRED_RESPONSE);
          return true;
        }
      }
      const siteId = path.split('/')[3];
      const site = db.findWebsiteById(siteId);
      if (!site) {
        sendJson(res, 404, { error: 'Website not found' });
        return true;
      }

      // Check real DNS TXT record for verification token
      let verified = false;
      let checkDetail = '';
      try {
        const txts = await dns.resolveTxt(site.domain).catch(() => []);
        const flattened = txts.map((r) => r.join(''));
        for (const t of flattened) {
          if (t.includes(site.verification.token) || t.includes('pulsevanguard-verify')) {
            verified = true;
            checkDetail = `Found matching TXT record: ${t}`;
            break;
          }
        }
      } catch (e: any) {
        checkDetail = `DNS query failed: ${e.message}`;
      }

      // Or fallback to HTML meta tag verification
      if (!verified) {
        try {
          const resp = await fetch(site.url, { signal: AbortSignal.timeout(4000) });
          const text = await resp.text();
          if (text.includes(site.verification.token)) {
            verified = true;
            checkDetail = 'Found matching HTML meta verification tag.';
          }
        } catch {
          // Meta tag not found
        }
      }

      // For testing convenience, allow manual toggle if token is supplied
      if (verified) {
        db.updateWebsite(siteId, {
          verification: {
            ...site.verification,
            verified: true,
            verifiedAt: new Date().toISOString(),
          },
        });
        sendJson(res, 200, { verified: true, message: 'Domain ownership successfully verified!' });
      } else {
        sendJson(res, 400, {
          verified: false,
          error: `Could not verify domain ownership. Please ensure your DNS TXT record contains "${site.verification.token}" or add <meta name="pulsevanguard-verify" content="${site.verification.token}"> to your site head. (${checkDetail || 'No record found'})`,
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
      const incidents = session.user.role === 'super_admin'
        ? db.getIncidents()
        : db.getIncidents().filter((i) => i.orgId === session.org.id);
      sendJson(res, 200, incidents);
      return true;
    }

    if (path === '/api/alerts' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const alerts = session.user.role === 'super_admin'
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
      const reports = session.user.role === 'super_admin'
        ? db.getReports()
        : db.getReports().filter((r) => r.orgId === session.org.id);
      sendJson(res, 200, reports);
      return true;
    }

    if (path === '/api/reports/generate' && method === 'POST') {
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
      const site = db.findWebsiteById(body.websiteId);
      if (!site) {
        sendJson(res, 404, { error: 'Website not found' });
        return true;
      }

      const report: ReportItem = {
        id: `rep_${Date.now()}`,
        orgId: session.org.id,
        websiteId: site.id,
        websiteName: site.name,
        title: body.title || `${site.name} Performance & Health Report`,
        type: body.type || 'health',
        shareToken: `pv_rep_${crypto.randomBytes(8).toString('hex')}`,
        isPublic: true,
        generatedAt: new Date().toISOString(),
        data: {
          website: { name: site.name, url: site.url, domain: site.domain },
          healthScore: site.healthScore,
          uptime24h: site.uptime24h,
          uptime7d: site.uptime7d,
          uptime30d: site.uptime30d,
          responseTimeMs: site.lastResponseTimeMs,
          scanData: site.lastScanResult || null,
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
      if (!body.name) {
        sendJson(res, 400, { error: 'Client name is required' });
        return true;
      }

      const newClient = {
        id: `client_${Date.now()}`,
        name: body.name.trim(),
        contactEmail: body.contactEmail || '',
        notes: body.notes || '',
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
      session.org.whiteLabel = {
        ...session.org.whiteLabel,
        ...body,
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

    if (path === '/api/billing/change-plan' && method === 'POST') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const { planId, interval, currency } = await readJsonBody(req);
      const plan = db.getPlans().find((p) => p.id === planId);
      if (!plan) {
        sendJson(res, 400, { error: 'Invalid plan selected' });
        return true;
      }

      // Security rule: Prevent trial reactivation or resetting trialUsed.
      // If user switches back to 'free', their trial start/end timestamps are permanently preserved.
      // They cannot get a new 24h trial.
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

      session.org.planId = planId;
      if (interval) session.org.billingInterval = interval;
      if (currency) session.org.currency = currency;
      db.persist();

      // Generate invoice record
      const selectedCurrency = session.org.currency || 'USD';
      const amount = interval === 'annual'
        ? plan.pricing[selectedCurrency].annual
        : plan.pricing[selectedCurrency].monthly;

      if (amount > 0) {
        db.addInvoice({
          id: `inv_${Date.now()}`,
          orgId: session.org.id,
          invoiceNumber: `INV-2026-${Math.floor(100 + Math.random() * 900)}`,
          date: new Date().toISOString(),
          amount,
          currency: selectedCurrency,
          status: 'paid',
          planName: `${plan.name} (${interval === 'annual' ? 'Annual' : 'Monthly'})`,
        });
      }

      sendJson(res, 200, { success: true, organization: session.org });
      return true;
    }

    if (path === '/api/billing/invoices' && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const invoices = db.getInvoices().filter((inv) => inv.orgId === session.org.id);
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

    if (path.startsWith('/api/crypto/order/') && method === 'GET') {
      const session = await resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }

      const orderId = path.replace('/api/crypto/order/', '').trim();
      const order = db.findCryptoOrderById(orderId);
      const isOwner = order && (order.userId === session.user.id || order.userEmail?.toLowerCase() === session.user.email.toLowerCase() || order.orgId === session.org.id);
      if (!order || (!isOwner && session.user.role !== 'super_admin')) {
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

      const { orderId, txId } = await readJsonBody(req);
      if (!orderId) {
        sendJson(res, 400, { error: 'Order ID is required' });
        return true;
      }

      const order = db.findCryptoOrderById(orderId);
      const isOwner = order && (order.userId === session.user.id || order.userEmail?.toLowerCase() === session.user.email.toLowerCase() || order.orgId === session.org.id);
      if (!order || (!isOwner && session.user.role !== 'super_admin')) {
        sendJson(res, 404, { error: 'Payment order not found' });
        return true;
      }

      try {
        const result = await verifyPaymentOrder(orderId, txId);
        // If activated, refresh organization in session
        if (result.activated) {
          const freshOrg = db.findOrgById(session.org.id);
          if (freshOrg) session.org = freshOrg;
        }
        sendJson(res, 200, {
          success: true,
          order: result.order,
          activated: result.activated,
          message: result.message,
          organization: session.org,
        });
      } catch (err: any) {
        sendJson(res, 500, { error: err.message || 'Verification failed' });
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
      // Ensure user views their own payment records (or their org orders)
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

      try {
        const testResult = await testLBankConnection();
        sendJson(res, 200, testResult);
      } catch (err: any) {
        sendJson(res, 500, {
          status: 'FAILED',
          title: 'LBank API Connection: FAILED',
          endpoint: 'https://api.lbank.info/v2/supplement/api_Restrictions.do',
          errorMessage: err.message || 'Unexpected test failure',
          diagnostic: 'Unexpected error executing LBank API test.',
          timestamp: new Date().toISOString(),
        });
      }
      return true;
    }

    // --- 8.5 REFERRAL, COMMISSION WALLET & WITHDRAWAL SYSTEM ---
    if (path === '/api/referrals/validate' && method === 'POST') {
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
        sendJson(res, 201, {
          success: true,
          request,
          withdrawal: request,
          message: `Withdrawal request of $${request.amount.toFixed(2)} USD submitted and funds reserved.`,
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

      // Backend role enforcement: strictly ADMIN or SUPER_ADMIN
      const role = session.user.role;
      const isAdmin = role === 'admin' || role === 'super_admin';
      if (!isAdmin) {
        sendJson(res, 403, { error: 'Admin access required to view global platform transactions' });
        return true;
      }

      // Return all crypto payment orders from the database, newest first
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
      sendJson(res, 200, { message: 'Monitoring queue tick triggered successfully', stats: monitorEngine.getStats() });
      return true;
    }

    // 11. PUBLIC DEVELOPER REST API (v1)
    if (path.startsWith('/api/v1/')) {
      // Validate API key from Authorization header
      const apiKeyHeader = req.headers['x-api-key'] || req.headers['authorization'];
      const keyString = typeof apiKeyHeader === 'string' ? apiKeyHeader.replace(/^Bearer\s+/i, '') : '';
      const matchedKey = db.getApiKeys().find((k) => k.prefix && keyString.startsWith(k.prefix));

      if (path === '/api/v1/api-keys' && method === 'GET') {
        const session = await resolveSession(req);
        if (!session) {
          sendJson(res, 401, { error: 'Unauthenticated' });
          return true;
        }
        sendJson(res, 200, db.getApiKeys().filter((k) => k.orgId === session.org.id));
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
        const secret = `pv_live_${crypto.randomBytes(16).toString('hex')}`;
        const prefix = secret.substring(0, 11);
        const newKey: ApiKey = {
          id: `key_${Date.now()}`,
          orgId: session.org.id,
          name: body.name || 'API Client Key',
          prefix,
          hashedSecret: crypto.createHash('sha256').update(secret).digest('hex'),
          scopes: ['websites:read', 'websites:write', 'scans:create'],
          createdAt: new Date().toISOString(),
        };
        db.addApiKey(newKey);
        sendJson(res, 201, { ...newKey, secretToken: secret });
        return true;
      }

      // API Key-protected endpoints
      if (!matchedKey) {
        // Also allow active session
        const session = await resolveSession(req);
        if (!session) {
          sendJson(res, 401, { error: 'Valid X-API-Key header or Bearer session token is required.' });
          return true;
        }
      }

      if (path === '/api/v1/websites') {
        sendJson(res, 200, {
          data: db.getWebsites().map((w) => ({
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

    sendJson(res, 404, { error: `Endpoint ${method} ${path} not found.` });
    return true;
  } catch (err: any) {
    console.error('[API Route Handler Error]:', err);
    sendJson(res, 500, { error: err.message || 'Internal server error' });
    return true;
  }
}
