import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { db } from './server/db.ts';
import { handleApiRoute } from './server/api.ts';
import { monitorEngine } from './server/monitor.ts';
import {
  isExemptSuperAdmin,
  getOrganizationEntitlementSummary,
  reconcileOrganizationWebsiteAllocations,
  cleanupOverdueExpiredWebsites,
  allocateEntitlementForNewWebsite,
  verifyWebsiteAccessAndEntitlement,
  GRACE_PERIOD_DURATION_MS,
} from './server/entitlements.ts';
import { validateAndNormalizeWhoisDomain, performWhoisLookup } from './server/whois.ts';
import { createSession, generateSessionToken } from './server/db/sessionRepo.ts';
import { OrgRepo, UserRepo } from './server/db/repositories.ts';
import { query } from './server/db/connection.ts';

async function runTests() {
  console.log('=== Starting PulseVanguarde Acceptance Suite: Subscription Expiration, Super Admin & WHOIS ===');
  await db.ensureSchema();

  // Start ephemeral HTTP server to test real API routes & HTTP status codes
  const server = http.createServer(async (req, res) => {
    const handled = await handleApiRoute(req, res);
    if (!handled && !res.writableEnded) {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function apiReq(
    method: string,
    path: string,
    opts: { token?: string; csrf?: string; body?: any } = {}
  ): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:' + port,
    };
    if (opts.token) {
      headers['Authorization'] = `Bearer ${opts.token}`;
    }
    if (opts.csrf) {
      headers['X-CSRF-Token'] = opts.csrf;
      headers['Cookie'] = `pv_csrf=${opts.csrf}`;
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }

  try {
    // ---------------------------------------------------------------------------
    // 1. Designated Super Admin (mobinalavi7491@gmail.com) — Unlimited & Exempt
    // ---------------------------------------------------------------------------
    console.log('\n[1/7] Verifying Unlimited Super Admin Account (mobinalavi7491@gmail.com)...');
    const superAdmin = db.findUserByEmail('mobinalavi7491@gmail.com');
    assert.ok(superAdmin, 'Designated Super Admin mobinalavi7491@gmail.com must exist');
    assert.equal(superAdmin.role, 'super_admin', 'Super Admin must have super_admin role');
    assert.equal(isExemptSuperAdmin(superAdmin), true, 'isExemptSuperAdmin must return true for mobinalavi7491@gmail.com');

    // Verify other users or fake admins do NOT get exemption
    assert.equal(
      isExemptSuperAdmin({ email: 'other@example.com', role: 'super_admin' }),
      false,
      'Non-designated email must NOT get Super Admin exemption even if role=super_admin'
    );
    assert.equal(
      isExemptSuperAdmin({ email: 'mobinalavi7491@gmail.com', role: 'user' }),
      false,
      'Non-super_admin role must NOT get Super Admin exemption'
    );

    const saSummary = await getOrganizationEntitlementSummary(superAdmin.orgId);
    assert.equal(saSummary.isUnlimited, true, 'Super Admin summary must report isUnlimited: true');
    assert.ok(saSummary.totalActiveCapacity >= 999999, 'Super Admin capacity must be unlimited');

    // Issue session for Super Admin and add > 6 websites without any paid subscription
    const saOrg = db.findOrgById(superAdmin.orgId)!;
    await OrgRepo.insert(saOrg);
    await UserRepo.insert(superAdmin);
    const saToken = generateSessionToken();
    const saSessMeta = await createSession(saToken, superAdmin.id, superAdmin.orgId, Date.now() + 3600_000, {
      ipHash: 'test',
      userAgent: 'test-suite',
    });
    const saSession = { token: saToken, csrfToken: saSessMeta.csrfToken };

    const createdSaSiteIds: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const alloc = await allocateEntitlementForNewWebsite(superAdmin.orgId, superAdmin);
      assert.equal(alloc.allowed, true, `Super Admin website #${i} allocation must succeed without limits`);
      assert.equal(alloc.entitlementId, 'super_admin_unlimited', 'Super Admin website has unlimited entitlement ID');
      assert.equal(alloc.subscriptionExpiresAt, null, 'Super Admin website has no expiration timestamp');
      const siteId = `w_test_sa_${Date.now()}_${i}`;
      db.addWebsite({
        id: siteId,
        orgId: superAdmin.orgId,
        name: `SuperAdmin Site ${i}`,
        url: `https://example.com`,
        domain: `example.com`,
        intervalMinutes: 5,
        status: 'ONLINE',
        uptime24h: 100,
        uptime7d: 100,
        uptime30d: 100,
        lastResponseTimeMs: 120,
        avgResponseTimeMs: 120,
        healthScore: 98,
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        entitlementId: null,
        subscriptionExpiresAt: null,
        expiredAt: null,
        scheduledDeletionAt: null,
        accessStatus: 'active',
        isSubscriptionExpired: false,
        ssl: { valid: true, issuer: 'Test', validFrom: '', validTo: '', daysRemaining: 90, protocol: 'TLSv1.3' },
        dns: { aRecords: ['93.184.215.14'], aaaaRecords: [], mxRecords: [], nsRecords: [], spfRecord: null, dmarcRecord: null, resolvedIp: '93.184.215.14' },
        verification: { isVerified: true, token: 'pv-test', verifiedAt: new Date().toISOString(), method: 'DNS_TXT' },
        notificationSettings: { alertOnDown: true, alertOnRecovery: true, alertOnSslExpiry: true, alertOnSlowResponse: true, latencyThresholdMs: 1200 },
      });
      createdSaSiteIds.push(siteId);
    }

    // Verify cleanup job NEVER deletes or locks Super Admin websites
    await cleanupOverdueExpiredWebsites();
    await reconcileOrganizationWebsiteAllocations(superAdmin.orgId);
    for (const id of createdSaSiteIds) {
      const w = db.findWebsiteById(id);
      assert.ok(w, `Super Admin website ${id} must never be deleted by cleanup job`);
      assert.equal(w.accessStatus, 'active', 'Super Admin website must remain active');
      assert.equal(w.isSubscriptionExpired, false);
    }
    console.log('  ✓ Super Admin unlimited capacity (>5 sites without subscription) & cleanup immunity verified.');

    // ---------------------------------------------------------------------------
    // 2. Customer Organization with Two Subscriptions (E1 and E2)
    // ---------------------------------------------------------------------------
    console.log('\n[2/7] Setting up Customer Organization with 2 Independent Subscriptions (E1 & E2)...');
    const testOrgId = `org_test_exp_${Date.now()}`;
    const testUserId = `u_test_exp_${Date.now()}`;
    const nowMs = Date.now();

    db.addOrganization({
      id: testOrgId,
      name: 'Expiration Test Org',
      ownerId: testUserId,
      planId: 'pro',
      billingInterval: 'monthly',
      currency: 'USDT',
      maxWebsites: 10,
      createdAt: new Date(nowMs - 40 * 86400_000).toISOString(),
      trialStartedAt: new Date(nowMs - 40 * 86400_000).toISOString(),
      trialEndsAt: new Date(nowMs - 39 * 86400_000).toISOString(),
      trialUsed: true,
    });

    db.addUser({
      id: testUserId,
      email: `customer.${Date.now()}@example.com`,
      name: 'Test Customer',
      role: 'user',
      orgId: testOrgId,
      passwordHash: 'scrypt$test',
      createdAt: new Date(nowMs - 40 * 86400_000).toISOString(),
    });

    const custUser = db.findUserById(testUserId)!;
    assert.equal(isExemptSuperAdmin(custUser), false, 'Regular customer must not be exempt');

    await OrgRepo.insert(db.findOrgById(testOrgId)!);
    await UserRepo.insert(custUser);
    const custToken = generateSessionToken();
    const custSessMeta = await createSession(custToken, custUser.id, testOrgId, Date.now() + 3600_000, {
      ipHash: 'test',
      userAgent: 'test-suite',
    });
    const custSession = { token: custToken, csrfToken: custSessMeta.csrfToken };

    // Create two paid crypto orders & entitlements: E1 (initially active) and E2 (active for 25 more days)
    const order1Id = `ord_test_e1_${Date.now()}`;
    const order2Id = `ord_test_e2_${Date.now()}`;
    const ent1Id = `ent_test_e1_${Date.now()}`;
    const ent2Id = `ent_test_e2_${Date.now()}`;

    db.addCryptoOrder({
      id: order1Id,
      orgId: testOrgId,
      userId: testUserId,
      userEmail: custUser.email,
      planId: 'pro',
      planName: 'Pro Plan',
      billingInterval: 'monthly',
      baseAmount: 5,
      amount: 5.01,
      currency: 'USDT',
      network: 'TRC20',
      depositAddress: 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36AmyWP',
      status: 'Paid',
      createdAt: new Date(nowMs - 29 * 86400_000).toISOString(),
      expiresAt: new Date(nowMs - 28 * 86400_000).toISOString(),
      confirmedAt: new Date(nowMs - 29 * 86400_000).toISOString(),
    });

    db.addCryptoOrder({
      id: order2Id,
      orgId: testOrgId,
      userId: testUserId,
      userEmail: custUser.email,
      planId: 'pro',
      planName: 'Pro Plan',
      billingInterval: 'monthly',
      baseAmount: 5,
      amount: 5.02,
      currency: 'USDT',
      network: 'TRC20',
      depositAddress: 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36AmyWP',
      status: 'Paid',
      createdAt: new Date(nowMs - 5 * 86400_000).toISOString(),
      expiresAt: new Date(nowMs - 4 * 86400_000).toISOString(),
      confirmedAt: new Date(nowMs - 5 * 86400_000).toISOString(),
    });

    const e1ExpiresFuture = new Date(nowMs + 2 * 86400_000).toISOString();
    const e2ExpiresFuture = new Date(nowMs + 25 * 86400_000).toISOString();

    await query(
      `INSERT INTO subscription_entitlements (
         id, user_id, org_id, plan_id, plan_name, billing_interval,
         website_capacity, order_id, status, purchased_at, starts_at, expires_at, created_at
       ) VALUES ($1, $2, $3, 'pro', 'Pro Plan', 'monthly', 5, $4, 'active', $5, $5, $6, $5)`,
      [ent1Id, testUserId, testOrgId, order1Id, new Date(nowMs - 28 * 86400_000).toISOString(), e1ExpiresFuture]
    );

    await query(
      `INSERT INTO subscription_entitlements (
         id, user_id, org_id, plan_id, plan_name, billing_interval,
         website_capacity, order_id, status, purchased_at, starts_at, expires_at, created_at
       ) VALUES ($1, $2, $3, 'pro', 'Pro Plan', 'monthly', 5, $4, 'active', $5, $5, $6, $5)`,
      [ent2Id, testUserId, testOrgId, order2Id, new Date(nowMs - 5 * 86400_000).toISOString(), e2ExpiresFuture]
    );

    // Allocate 5 websites to E1 and 2 websites to E2
    const e1SiteIds: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const alloc = await allocateEntitlementForNewWebsite(testOrgId, custUser);
      assert.equal(alloc.allowed, true);
      assert.equal(alloc.entitlementId, ent1Id, `Site ${i} should be allocated to E1`);
      const sid = `w_test_e1_${Date.now()}_${i}`;
      db.addWebsite({
        id: sid,
        orgId: testOrgId,
        name: `E1 Site ${i}`,
        url: 'https://example.com',
        domain: 'example.com',
        intervalMinutes: 5,
        status: 'ONLINE',
        uptime24h: 100,
        uptime7d: 100,
        uptime30d: 100,
        lastResponseTimeMs: 150,
        avgResponseTimeMs: 150,
        healthScore: 95,
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date(nowMs - 20 * 86400_000 + i * 1000).toISOString(),
        entitlementId: alloc.entitlementId,
        subscriptionExpiresAt: alloc.subscriptionExpiresAt,
        expiredAt: null,
        scheduledDeletionAt: null,
        accessStatus: 'active',
        isSubscriptionExpired: false,
        ssl: { valid: true, issuer: 'Test', validFrom: '', validTo: '', daysRemaining: 90, protocol: 'TLSv1.3' },
        dns: { aRecords: ['93.184.215.14'], aaaaRecords: [], mxRecords: [], nsRecords: [], spfRecord: null, dmarcRecord: null, resolvedIp: '93.184.215.14' },
        verification: { isVerified: true, token: 'pv-test', verifiedAt: new Date().toISOString(), method: 'DNS_TXT' },
        notificationSettings: { alertOnDown: true, alertOnRecovery: true, alertOnSslExpiry: true, alertOnSlowResponse: true, latencyThresholdMs: 1200 },
      });
      e1SiteIds.push(sid);
    }

    const e2SiteIds: string[] = [];
    for (let i = 1; i <= 2; i++) {
      const alloc = await allocateEntitlementForNewWebsite(testOrgId, custUser);
      assert.equal(alloc.allowed, true);
      assert.equal(alloc.entitlementId, ent2Id, `Site 5+${i} should be allocated to E2`);
      const sid = `w_test_e2_${Date.now()}_${i}`;
      db.addWebsite({
        id: sid,
        orgId: testOrgId,
        name: `E2 Site ${i}`,
        url: 'https://example.org',
        domain: 'example.org',
        intervalMinutes: 5,
        status: 'ONLINE',
        uptime24h: 100,
        uptime7d: 100,
        uptime30d: 100,
        lastResponseTimeMs: 140,
        avgResponseTimeMs: 140,
        healthScore: 96,
        lastCheckedAt: new Date().toISOString(),
        createdAt: new Date(nowMs - 4 * 86400_000 + i * 1000).toISOString(),
        entitlementId: alloc.entitlementId,
        subscriptionExpiresAt: alloc.subscriptionExpiresAt,
        expiredAt: null,
        scheduledDeletionAt: null,
        accessStatus: 'active',
        isSubscriptionExpired: false,
        ssl: { valid: true, issuer: 'Test', validFrom: '', validTo: '', daysRemaining: 90, protocol: 'TLSv1.3' },
        dns: { aRecords: ['93.184.215.14'], aaaaRecords: [], mxRecords: [], nsRecords: [], spfRecord: null, dmarcRecord: null, resolvedIp: '93.184.215.14' },
        verification: { isVerified: true, token: 'pv-test', verifiedAt: new Date().toISOString(), method: 'DNS_TXT' },
        notificationSettings: { alertOnDown: true, alertOnRecovery: true, alertOnSslExpiry: true, alertOnSlowResponse: true, latencyThresholdMs: 1200 },
      });
      e2SiteIds.push(sid);
    }

    // Verify active website access works before expiration
    const activeDetailRes = await apiReq('GET', `/api/websites/${e1SiteIds[0]}`, { token: custSession.token });
    assert.equal(activeDetailRes.status, 200, 'Active website detail must return 200 OK');
    console.log('  ✓ Active subscriptions E1 (5 sites) and E2 (2 sites) verified.');

    // ---------------------------------------------------------------------------
    // 3. Expire E1 (12 hours ago) -> Verify Strict Blocking (403 SUBSCRIPTION_EXPIRED),
    //    2-Day Grace Period Notice, and E2 Unchanged
    // ---------------------------------------------------------------------------
    console.log('\n[3/7] Expiring Subscription E1 (12h ago) while E2 remains active...');
    const e1ExpiredAtIso = new Date(nowMs - 12 * 3600_000).toISOString();
    const expectedDeletionIso = new Date(new Date(e1ExpiredAtIso).getTime() + GRACE_PERIOD_DURATION_MS).toISOString();
    await query(
      `UPDATE subscription_entitlements SET expires_at = $2, status = 'expired' WHERE id = $1`,
      [ent1Id, e1ExpiredAtIso]
    );

    await reconcileOrganizationWebsiteAllocations(testOrgId);

    // Check list endpoint: E1 websites must still be visible in list during 2-day grace period with exact expiration/deletion dates,
    // while E2 websites remain active!
    const listRes = await apiReq('GET', '/api/websites', { token: custSession.token });
    assert.equal(listRes.status, 200);
    const listedSites: any[] = listRes.data;
    const listedE1 = listedSites.filter((w) => e1SiteIds.includes(w.id));
    const listedE2 = listedSites.filter((w) => e2SiteIds.includes(w.id));
    assert.equal(listedE1.length, 5, 'All 5 expired E1 websites must remain visible in list during 2-day grace period');
    assert.equal(listedE2.length, 2, 'All 2 active E2 websites must remain visible');

    for (const w of listedE1) {
      assert.equal(w.isSubscriptionExpired, true, 'E1 website must be marked isSubscriptionExpired=true');
      assert.equal(w.accessStatus, 'expired_grace_period', 'E1 website must have accessStatus=expired_grace_period');
      assert.equal(w.expiredAt, e1ExpiredAtIso, 'E1 website must report exact subscription expiration timestamp');
      assert.equal(w.scheduledDeletionAt, expectedDeletionIso, 'E1 website must report exact 2-day deletion deadline');
      assert.equal(w.lastScanResult, undefined, 'Expired website list item must redact lastScanResult');
    }
    for (const w of listedE2) {
      assert.equal(w.isSubscriptionExpired, false, 'E2 website must NOT be affected by E1 expiration');
      assert.equal(w.accessStatus, 'active', 'E2 website must remain active');
    }

    // Verify every single website-related endpoint returns 403 SUBSCRIPTION_EXPIRED for E1's websites
    const targetE1Site = e1SiteIds[0];
    const blockedEndpoints: Array<{ method: string; path: string; body?: any }> = [
      { method: 'GET', path: `/api/websites/${targetE1Site}` },
      { method: 'GET', path: `/api/websites/${targetE1Site}/metrics` },
      { method: 'GET', path: `/api/websites/${targetE1Site}/whois` },
      { method: 'POST', path: `/api/websites/${targetE1Site}/whois`, body: {} },
      { method: 'PATCH', path: `/api/websites/${targetE1Site}`, body: { name: 'Rename' } },
      { method: 'POST', path: `/api/websites/${targetE1Site}/check-now`, body: {} },
      { method: 'POST', path: `/api/websites/${targetE1Site}/audit-now`, body: {} },
      { method: 'POST', path: `/api/websites/${targetE1Site}/verify`, body: {} },
      { method: 'POST', path: `/api/reports/generate`, body: { websiteId: targetE1Site } },
      { method: 'POST', path: `/api/scanner/pagespeed`, body: { websiteId: targetE1Site, strategy: 'mobile' } },
    ];

    for (const ep of blockedEndpoints) {
      const r = await apiReq(ep.method, ep.path, {
        token: custSession.token,
        csrf: custSession.csrfToken,
        body: ep.body,
      });
      assert.equal(r.status, 403, `Endpoint ${ep.method} ${ep.path} must return 403 Forbidden for expired website`);
      assert.equal(r.data.error, 'SUBSCRIPTION_EXPIRED', `Endpoint ${ep.method} ${ep.path} must return error=SUBSCRIPTION_EXPIRED`);
      assert.ok(
        String(r.data.message).includes('Subscription expired — This website will be deleted in 2 days. Renew your subscription to retain access.'),
        `Endpoint ${ep.method} ${ep.path} must include exact 2-day deletion notice`
      );
      assert.equal(r.data.expiredAt, e1ExpiredAtIso);
      assert.equal(r.data.scheduledDeletionAt, expectedDeletionIso);
    }

    // Meanwhile, E2's websites must still return 200 OK!
    const e2DetailRes = await apiReq('GET', `/api/websites/${e2SiteIds[0]}`, { token: custSession.token });
    assert.equal(e2DetailRes.status, 200, 'E2 active website detail must still return 200 OK when E1 is expired');
    const e2MetricsRes = await apiReq('GET', `/api/websites/${e2SiteIds[0]}/metrics`, { token: custSession.token });
    assert.equal(e2MetricsRes.status, 200, 'E2 active website metrics must still return 200 OK when E1 is expired');
    console.log('  ✓ All 10 website endpoints strictly return 403 SUBSCRIPTION_EXPIRED for E1 while E2 remains accessible.');

    // ---------------------------------------------------------------------------
    // 4. Renewal Before 2-Day Deletion Deadline -> Cancels Deletion & Restores Access
    // ---------------------------------------------------------------------------
    console.log('\n[4/7] Testing Subscription Renewal Before 2-Day Deletion Deadline...');
    const order3Id = `ord_test_e3_${Date.now()}`;
    const ent3Id = `ent_test_e3_${Date.now()}`;
    db.addCryptoOrder({
      id: order3Id,
      orgId: testOrgId,
      userId: testUserId,
      userEmail: custUser.email,
      planId: 'pro',
      planName: 'Pro Plan Renewal',
      billingInterval: 'monthly',
      baseAmount: 5,
      amount: 5.03,
      currency: 'USDT',
      network: 'TRC20',
      depositAddress: 'TYDzsYUEpvnYmQk4zGP9sWWcTEd36AmyWP',
      status: 'Paid',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(nowMs + 3600_000).toISOString(),
      confirmedAt: new Date().toISOString(),
    });
    const nowRenewalIso = new Date().toISOString();
    await query(
      `INSERT INTO subscription_entitlements (
         id, user_id, org_id, plan_id, plan_name, billing_interval,
         website_capacity, order_id, status, purchased_at, starts_at, expires_at, created_at
       ) VALUES ($1, $2, $3, 'pro', 'Pro Plan Renewal', 'monthly', 5, $4, 'active', $5, $5, $6, $5)`,
      [ent3Id, testUserId, testOrgId, order3Id, nowRenewalIso, new Date(nowMs + 30 * 86400_000).toISOString()]
    );

    await reconcileOrganizationWebsiteAllocations(testOrgId);

    for (const sid of e1SiteIds) {
      const w = db.findWebsiteById(sid)!;
      assert.equal(w.isSubscriptionExpired, false, 'Renewed website must no longer be marked expired');
      assert.equal(w.accessStatus, 'active', 'Renewed website accessStatus must be restored to active');
      assert.equal(w.scheduledDeletionAt, null, 'Renewed website scheduledDeletionAt must be cleared');
      assert.equal(w.entitlementId, ent3Id, 'Renewed website must be bound to the new active entitlement E3');
    }

    const restoredRes = await apiReq('GET', `/api/websites/${e1SiteIds[0]}`, { token: custSession.token });
    assert.equal(restoredRes.status, 200, 'Renewed website must immediately return 200 OK again');
    console.log('  ✓ Renewal before 2-day deadline cancelled pending deletion and restored full access.');

    // ---------------------------------------------------------------------------
    // 5. Automatic Deletion After 2 Days (Without User Login) & Preservation of Financial History
    // ---------------------------------------------------------------------------
    console.log('\n[5/7] Testing Automatic Background Deletion After 2 Days (Overdue Grace Period)...');
    // Expire E3 3 days ago (so its 2-day grace period ended 1 day ago)
    const overdueExpiredAt = new Date(nowMs - 3 * 86400_000).toISOString();
    await query(
      `UPDATE subscription_entitlements SET expires_at = $2, status = 'expired' WHERE id = $1`,
      [ent3Id, overdueExpiredAt]
    );

    // Run background cleanup directly (simulating background worker tick / server restart with NO user login)
    const cleanupRes = await cleanupOverdueExpiredWebsites();
    assert.equal(cleanupRes.deletedCount, 5, 'Cleanup job must automatically delete all 5 overdue websites from E3');

    for (const sid of e1SiteIds) {
      assert.equal(db.findWebsiteById(sid), undefined, `Overdue website ${sid} must be permanently deleted`);
    }
    // Verify E2's active websites were NOT deleted!
    for (const sid of e2SiteIds) {
      const w = db.findWebsiteById(sid);
      assert.ok(w, `Active E2 website ${sid} must NOT be deleted when E3 overdue websites are cleaned up`);
      assert.equal(w.accessStatus, 'active');
    }

    // Verify idempotency: running cleanup again does not error or delete anything else
    const secondCleanup = await cleanupOverdueExpiredWebsites();
    assert.equal(secondCleanup.deletedCount, 0, 'Repeated cleanup run must be idempotent (0 deletions)');

    // Verify user account, organization, crypto_orders, and subscription_entitlements are preserved!
    assert.ok(db.findUserById(testUserId), 'User account must be preserved after website deletion');
    assert.ok(db.findOrgById(testOrgId), 'Organization must be preserved after website deletion');
    assert.ok(db.findCryptoOrderById(order1Id), 'Payment order 1 must be preserved after website deletion');
    assert.ok(db.findCryptoOrderById(order2Id), 'Payment order 2 must be preserved after website deletion');
    assert.ok(db.findCryptoOrderById(order3Id), 'Payment order 3 must be preserved after website deletion');
    const entHistoryRes = await query(`SELECT * FROM subscription_entitlements WHERE org_id = $1`, [testOrgId]);
    assert.equal(
      entHistoryRes.rows.length,
      3,
      'All 3 subscription entitlement history records must be preserved after website deletion'
    );
    console.log('  ✓ Automatic deletion after 2 days + idempotency + financial/user record preservation verified.');

    // ---------------------------------------------------------------------------
    // 6. WHOIS Domain Validation & Real Registry Lookup Verification
    // ---------------------------------------------------------------------------
    console.log('\n[6/7] Verifying WHOIS Domain Validation & Real Authoritative RDAP Lookup...');
    assert.equal(validateAndNormalizeWhoisDomain('Example.COM'), 'example.com');
    assert.throws(() => validateAndNormalizeWhoisDomain('https://example.com/path'), /URL|protocol|domain/i, 'Must reject full URLs');
    assert.throws(() => validateAndNormalizeWhoisDomain('example.com/test'), /path|domain/i, 'Must reject paths');
    assert.throws(() => validateAndNormalizeWhoisDomain('1.2.3.4'), /IP|domain/i, 'Must reject IPv4 addresses');
    assert.throws(() => validateAndNormalizeWhoisDomain('example.com:8080'), /port|domain/i, 'Must reject ports');
    assert.throws(() => validateAndNormalizeWhoisDomain('-bad.com'), /domain|label/i, 'Must reject leading hyphen');

    // Test WHOIS endpoint with unauthenticated request -> 401
    const unauthWhois = await apiReq('GET', `/api/websites/${e2SiteIds[0]}/whois`);
    assert.equal(unauthWhois.status, 401, 'Unauthenticated WHOIS request must return 401');

    // Test WHOIS endpoint with malformed domain -> 400
    const badWhois = await apiReq('POST', `/api/whois`, {
      token: custSession.token,
      csrf: custSession.csrfToken,
      body: { domain: 'https://example.com/malformed' },
    });
    assert.equal(badWhois.status, 400, 'Malformed domain input to /api/whois must return 400');

    // Test real WHOIS lookup on active E2 website (example.org / example.com)
    const realWhoisRes = await apiReq('POST', `/api/websites/${e2SiteIds[0]}/whois`, {
      token: custSession.token,
      csrf: custSession.csrfToken,
      body: { forceRefresh: true },
    });
    assert.equal(realWhoisRes.status, 200, 'WHOIS lookup for active website must return 200 OK');
    assert.equal(realWhoisRes.data.domainName, 'example.org');
    assert.ok(realWhoisRes.data.registrationDate, 'Real WHOIS lookup must include registrationDate');
    assert.ok(realWhoisRes.data.expirationDate, 'Real WHOIS lookup must include expirationDate');
    assert.ok(Array.isArray(realWhoisRes.data.nameServers) && realWhoisRes.data.nameServers.length > 0, 'Real WHOIS lookup must include nameServers');
    assert.ok(Array.isArray(realWhoisRes.data.statusCodes) && realWhoisRes.data.statusCodes.length > 0, 'Real WHOIS lookup must include EPP status codes');
    assert.ok(!JSON.stringify(realWhoisRes.data).includes(process.env.WHOIS_API_KEY || 'NEVER_LEAK'), 'WHOIS response must never expose secrets');
    console.log(
      `  ✓ Real WHOIS lookup succeeded for ${realWhoisRes.data.domainName}: Registrar="${realWhoisRes.data.registrar}", Created="${realWhoisRes.data.registrationDate}", Expires="${realWhoisRes.data.expirationDate}", NS=[${realWhoisRes.data.nameServers.join(', ')}]`
    );

    // ---------------------------------------------------------------------------
    // 7. Clean up temporary test records
    // ---------------------------------------------------------------------------
    console.log('\n[7/7] Cleaning up temporary test records...');
    for (const id of [...createdSaSiteIds, ...e2SiteIds]) {
      db.removeWebsite(id);
    }
    console.log('=== ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY! ===');
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error('TEST SUITE FAILED:', err);
  process.exit(1);
});
