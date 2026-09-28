import { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { db, hashPassword, verifyPassword, User, Website, Organization, AlertNotification, ReportItem, SupportTicket, ApiKey } from './db.js';
import { performWebsiteScan, normalizeInputUrl, validateTargetSecurity } from './scanner.js';
import { monitorEngine } from './monitor.js';

// Simple token mechanism for authenticated sessions
const sessionStore = new Map<string, { userId: string; orgId: string; expiresAt: number }>();

function createSession(userId: string, orgId: string): string {
  const token = `pv_sess_${crypto.randomBytes(24).toString('hex')}`;
  sessionStore.set(token, {
    userId,
    orgId,
    expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
  });
  return token;
}

function resolveSession(req: IncomingMessage): { user: User; org: Organization } | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const session = sessionStore.get(token);
  if (!session || session.expiresAt < Date.now()) return null;

  const user = db.findUserById(session.userId);
  if (!user) return null;
  const org = db.findOrgById(user.orgId);
  if (!org) return null;
  return { user, org };
}

// Helper to read JSON body
async function readJsonBody(req: IncomingMessage): Promise<any> {
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
  res.end(JSON.stringify(data));
}

export async function handleApiRoute(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const reqUrl = req.url || '';
  if (!reqUrl.startsWith('/api/')) return false;

  const parsedUrl = new URL(reqUrl, 'http://localhost');
  const path = parsedUrl.pathname;
  const method = req.method?.toUpperCase() || 'GET';

  try {
    // 0. HEALTH CHECK
    if ((path === '/api/healthz' || path === '/api/health') && method === 'GET') {
      sendJson(res, 200, { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
      return true;
    }

    // 1. FREE PUBLIC SCANNER
    if (path === '/api/scan' && method === 'POST') {
      const body = await readJsonBody(req);
      const target = body.url;
      if (!target || typeof target !== 'string') {
        sendJson(res, 400, { error: 'Please provide a valid website URL.' });
        return true;
      }

      try {
        const scanResult = await performWebsiteScan(target);
        sendJson(res, 200, scanResult);
      } catch (err: any) {
        sendJson(res, 422, { error: err.message || 'Scan failed for given URL.' });
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
      const { email, password, name, orgName } = await readJsonBody(req);
      if (!email || !password || !name) {
        sendJson(res, 400, { error: 'Name, email, and password are required.' });
        return true;
      }
      if (db.findUserByEmail(email)) {
        sendJson(res, 409, { error: 'An account with this email address already exists.' });
        return true;
      }

      const orgId = `org_${Date.now()}`;
      const userId = `usr_${Date.now()}`;

      const newOrg: Organization = {
        id: orgId,
        name: orgName || `${name}'s Workspace`,
        planId: 'free',
        billingInterval: 'monthly',
        currency: 'USD',
        ownerId: userId,
        whiteLabel: { enabled: false, brandName: orgName || name },
        clients: [],
        createdAt: new Date().toISOString(),
      };
      db.addOrganization(newOrg);

      const newUser: User = {
        id: userId,
        email: email.trim().toLowerCase(),
        name: name.trim(),
        passwordHash: hashPassword(password),
        role: 'team_member',
        orgId,
        emailVerified: true,
        createdAt: new Date().toISOString(),
      };
      db.addUser(newUser);

      const token = createSession(userId, orgId);
      sendJson(res, 201, {
        token,
        user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role, orgId },
        organization: newOrg,
      });
      return true;
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const { email, password } = await readJsonBody(req);
      if (!email || !password) {
        sendJson(res, 400, { error: 'Email and password are required.' });
        return true;
      }

      const user = db.findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        sendJson(res, 401, { error: 'Invalid credentials. Please verify your email and password.' });
        return true;
      }

      const org = db.findOrgById(user.orgId);
      const token = createSession(user.id, user.orgId);
      sendJson(res, 200, {
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId, avatarUrl: user.avatarUrl },
        organization: org,
      });
      return true;
    }

    if (path === '/api/auth/me' && method === 'GET') {
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      sendJson(res, 200, {
        user: { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role, orgId: session.user.orgId, avatarUrl: session.user.avatarUrl },
        organization: session.org,
      });
      return true;
    }

    if (path === '/api/auth/reset-password' && method === 'POST') {
      const { email } = await readJsonBody(req);
      // In production an email with reset token is dispatched; simulate success safely
      sendJson(res, 200, { message: `Password reset instructions have been dispatched to ${email || 'your email'}.` });
      return true;
    }

    // 4. WEBSITES RESOURCE
    if (path === '/api/websites' && method === 'GET') {
      const session = resolveSession(req);
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
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
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
      const session = resolveSession(req);
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
      const session = resolveSession(req);
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

      const body = await readJsonBody(req);
      const updated = db.updateWebsite(siteId, body);
      sendJson(res, 200, updated);
      return true;
    }

    if (path.startsWith('/api/websites/') && method === 'DELETE') {
      const session = resolveSession(req);
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
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
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
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
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
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
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
      const session = resolveSession(req);
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
      const session = resolveSession(req);
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
      const session = resolveSession(req);
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
      const session = resolveSession(req);
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
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
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
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      sendJson(res, 200, session.org.clients || []);
      return true;
    }

    if (path === '/api/agency/clients' && method === 'POST') {
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
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
      const session = resolveSession(req);
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
      const session = resolveSession(req);
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
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const invoices = db.getInvoices().filter((inv) => inv.orgId === session.org.id);
      sendJson(res, 200, invoices);
      return true;
    }

    // 9. SUPPORT TICKETS
    if (path === '/api/tickets' && method === 'GET') {
      const session = resolveSession(req);
      if (!session) {
        sendJson(res, 401, { error: 'Unauthenticated' });
        return true;
      }
      const tickets = session.user.role === 'super_admin'
        ? db.getTickets()
        : db.getTickets().filter((t) => t.email.toLowerCase() === session.user.email.toLowerCase());
      sendJson(res, 200, tickets);
      return true;
    }

    if (path === '/api/tickets' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.subject || !body.message || !body.email) {
        sendJson(res, 400, { error: 'Email, subject, and message are required.' });
        return true;
      }

      const ticket: SupportTicket = {
        id: `tkt_${Date.now()}`,
        name: body.name || 'Valued User',
        email: body.email.trim(),
        subject: body.subject.trim(),
        category: body.category || 'technical',
        message: body.message.trim(),
        status: 'open',
        priority: body.priority || 'medium',
        createdAt: new Date().toISOString(),
        replies: [],
      };

      db.addTicket(ticket);
      sendJson(res, 201, ticket);
      return true;
    }

    // 10. ADMIN DASHBOARD METRICS & CONTROL
    if (path === '/api/admin/overview' && method === 'GET') {
      const session = resolveSession(req);
      if (!session || session.user.role !== 'super_admin') {
        sendJson(res, 403, { error: 'Super Admin privilege required' });
        return true;
      }

      const users = db.getUsers();
      const orgs = db.getOrganizations();
      const sites = db.getWebsites();
      const incidents = db.getIncidents();
      const invoices = db.getInvoices();
      const totalRevenue = invoices.filter((i) => i.status === 'paid').reduce((acc, curr) => acc + curr.amount, 0);

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
      });
      return true;
    }

    if (path === '/api/admin/users' && method === 'GET') {
      const session = resolveSession(req);
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
        createdAt: u.createdAt,
      })));
      return true;
    }

    if (path === '/api/admin/trigger-worker' && method === 'POST') {
      const session = resolveSession(req);
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
        const session = resolveSession(req);
        if (!session) {
          sendJson(res, 401, { error: 'Unauthenticated' });
          return true;
        }
        sendJson(res, 200, db.getApiKeys().filter((k) => k.orgId === session.org.id));
        return true;
      }

      if (path === '/api/v1/api-keys' && method === 'POST') {
        const session = resolveSession(req);
        if (!session) {
          sendJson(res, 401, { error: 'Unauthenticated' });
          return true;
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
        const session = resolveSession(req);
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
