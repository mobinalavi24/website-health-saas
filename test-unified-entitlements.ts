import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { handleApiRoute } from './server/api.ts';
import { db } from './server/db.ts';
import { query } from './server/db/connection.ts';
import { getOrganizationEntitlementSummary } from './server/entitlements.ts';

async function runTests() {
  console.log('=== Starting PulseVanguarde Unified Navigation, Crypto-Only UI & Entitlements Verification ===');

  await db.ensureSchema();

  const server = http.createServer(async (req, res) => {
    const handled = await handleApiRoute(req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 3999;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function api(
    method: string,
    route: string,
    options: { token?: string; body?: any } = {}
  ) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.token) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
    const res = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  try {
    // 1. Verify UI & Frontend files for Fiat removal & Unified Navigation
    console.log('1. Verifying Frontend UI files for zero fiat symbols and standardized navigation...');
    const uiFilesToCheck = [
      'src/components/Navbar.tsx',
      'src/components/BillingView.tsx',
      'src/components/PublicLanding.tsx',
      'src/components/ProfileReferralView.tsx',
      'src/components/DashboardView.tsx',
      'src/components/WebsiteDetailView.tsx',
      'src/components/AdminView.tsx',
      'src/components/AdminWithdrawalsView.tsx',
    ];

    for (const relPath of uiFilesToCheck) {
      const content = fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
      assert.ok(!/\b(USD|EUR|GBP)\b/.test(content), `${relPath} must not contain USD, EUR, or GBP`);
      assert.ok(!/[€£]/.test(content), `${relPath} must not contain € or £`);
      assert.ok(!/\$\d/.test(content), `${relPath} must not contain $ followed by digits`);
    }

    const navbarContent = fs.readFileSync(path.join(process.cwd(), 'src/components/Navbar.tsx'), 'utf8');
    assert.ok(navbarContent.includes('Monitored Sites'), 'Navbar must include Monitored Sites');
    assert.ok(navbarContent.includes('Reports'), 'Navbar must include Reports');
    assert.ok(navbarContent.includes('Plan & Limits'), 'Navbar must include Plan & Limits');
    assert.ok(navbarContent.includes('My Profile'), 'Navbar must include My Profile');
    assert.ok(navbarContent.includes('My Crypto Payments'), 'Navbar must include My Crypto Payments');
    assert.ok(navbarContent.includes('Withdrawals'), 'Navbar must include Withdrawals in left-side navigation');
    assert.ok(navbarContent.includes('Transactions'), 'Navbar must include Transactions in right-side admin header');
    assert.ok(!navbarContent.includes('Payment Review'), 'Navbar must not have duplicate Payment Review tab');
    assert.ok(!navbarContent.includes('>Referrals<'), 'Navbar must not have separate Referrals button in header');
    console.log('   ✓ Frontend UI files verified: zero fiat symbols and standardized navigation.');

    // 2. Verify /api/billing/plans returns USDT pricing and no $5/month text
    console.log('2. Verifying /api/billing/plans...');
    const plansRes = await api('GET', '/api/billing/plans');
    assert.equal(plansRes.status, 200);
    const proPlan = plansRes.data.find((p: any) => p.id === 'pro');
    assert.ok(proPlan, 'Pro plan must exist');
    assert.equal(proPlan.pricing.USDT.monthly, 5);
    assert.equal(proPlan.pricing.USDT.annual, 50);
    assert.ok(
      !JSON.stringify(plansRes.data).includes('$'),
      'Plans response must not contain $ symbol'
    );
    console.log('   ✓ /api/billing/plans returns 5 USDT monthly and 50 USDT annual.');

    // 3. Register Super Admin, Referrer User, and Customer User (linked via referral code)
    console.log('3. Registering test accounts (Super Admin, Referrer, Referred Customer)...');
    const adminEmail = `superadmin_${Date.now()}@example.com`;
    const adminReg = await api('POST', '/api/auth/register', {
      body: {
        email: adminEmail,
        password: 'AdminPassword123!',
        name: 'Super Admin',
        orgName: 'Admin Org',
      },
    });
    assert.equal(adminReg.status, 201);
    const adminUserId = adminReg.data.user.id;
    const adminToken = adminReg.data.token;
    await query(`UPDATE users SET role = 'super_admin' WHERE id = $1`, [adminUserId]);
    const memAdmin = db.findUserById(adminUserId);
    if (memAdmin) {
      memAdmin.role = 'super_admin';
    }
    assert.ok(adminToken, 'Super Admin token must be obtained');

    const referrerEmail = `ref_${Date.now()}@example.com`;
    const referrerReg = await api('POST', '/api/auth/register', {
      body: {
        email: referrerEmail,
        password: 'Password123!',
        name: 'Partner Referrer',
        orgName: 'Referrer Org',
      },
    });
    assert.equal(referrerReg.status, 201);
    const referrerToken = referrerReg.data.token;
    const referralCode = referrerReg.data.user.referralCode;
    assert.ok(referralCode, 'Referrer must have a unique referralCode');

    const customerEmail = `cust_${Date.now()}@example.com`;
    const customerReg = await api('POST', '/api/auth/register', {
      body: {
        email: customerEmail,
        password: 'Password123!',
        name: 'Stacking Customer',
        orgName: 'Customer Org',
        referralCode,
      },
    });
    assert.equal(customerReg.status, 201);
    const customerToken = customerReg.data.token;
    const customerOrgId = customerReg.data.organization.id;

    // Initial Free Trial capacity = 1 website
    assert.equal(
      customerReg.data.organization.entitlementSummary.totalActiveCapacity,
      1,
      'New free trial account should have 1 website capacity'
    );
    console.log('   ✓ Accounts registered and initial Free Trial capacity = 1 verified.');

    // 4. Create Pending Order -> Verify Pending Order grants 0 additional capacity
    console.log('4. Creating first Pro order (Pending) and verifying Pending order does not add capacity...');
    const order1Res = await api('POST', '/api/crypto/create-order', {
      token: customerToken,
      body: { planId: 'pro', interval: 'monthly' },
    });
    assert.ok(order1Res.status === 200 || order1Res.status === 201);
    const order1Id = order1Res.data.order.id;
    assert.equal(order1Res.data.order.amount, 5);
    assert.equal(order1Res.data.order.currency, 'USDT');

    const entBeforeApproval = await api('GET', '/api/billing/entitlements', {
      token: customerToken,
    });
    assert.equal(entBeforeApproval.data.activeEntitlements.length, 0);
    assert.equal(entBeforeApproval.data.totalActiveCapacity, 1);

    // Create a Rejected order and verify it grants 0 capacity
    const rejectedOrderRes = await api('POST', '/api/crypto/create-order', {
      token: customerToken,
      body: { planId: 'pro', interval: 'monthly' },
    });
    const rejectedOrderId = rejectedOrderRes.data.order.id;
    const rejectAction = await api(
      'POST',
      `/api/admin/crypto/orders/${rejectedOrderId}/reject`,
      {
        token: adminToken,
        body: { reason: 'Test unverified hash' },
      }
    );
    assert.equal(rejectAction.status, 200);
    const entAfterReject = await api('GET', '/api/billing/entitlements', {
      token: customerToken,
    });
    assert.equal(entAfterReject.data.activeEntitlements.length, 0);
    assert.equal(entAfterReject.data.totalActiveCapacity, 1);
    console.log('   ✓ Pending and Rejected orders grant 0 paid entitlements.');

    // 5. Approve First Pro Order -> Verify Entitlement #1 (+5 websites) is created with 30-day window
    console.log('5. Approving first Pro order and verifying Entitlement #1 (+5 websites)...');
    const approve1 = await api('POST', `/api/admin/crypto/orders/${order1Id}/approve`, {
      token: adminToken,
    });
    assert.equal(approve1.status, 200);
    assert.ok(approve1.data.entitlement, 'Approval must return created entitlement');
    assert.equal(approve1.data.entitlement.websiteCapacity, 5);

    const entAfter1 = await api('GET', '/api/billing/entitlements', {
      token: customerToken,
    });
    assert.equal(entAfter1.data.activeEntitlements.length, 1);
    assert.equal(entAfter1.data.totalActiveCapacity, 5);

    // Add 5 websites (1..5 should succeed, 6th should be blocked!)
    for (let i = 1; i <= 5; i++) {
      const addSite = await api('POST', '/api/websites', {
        token: customerToken,
        body: {
          name: `Customer Site ${i}`,
          url: `https://example.com/site-${i}`,
        },
      });
      assert.equal(addSite.status, 201, `Adding site ${i} of 5 should succeed`);
    }

    const addSite6Blocked = await api('POST', '/api/websites', {
      token: customerToken,
      body: {
        name: 'Customer Site 6',
        url: 'https://example.com/site-6',
      },
    });
    assert.equal(addSite6Blocked.status, 403, '6th website must be blocked when capacity is 5');
    console.log('   ✓ First Pro entitlement granted 5 website slots; 6th website blocked.');

    // 6. Purchase & Approve Second Pro Order while First is Active -> Verify Capacity = 10
    console.log('6. Purchasing and approving second Pro order while first is active...');
    const order2Res = await api('POST', '/api/crypto/create-order', {
      token: customerToken,
      body: { planId: 'pro', interval: 'monthly' },
    });
    assert.ok(order2Res.status === 200 || order2Res.status === 201, 'Active Pro user must be able to create another Pro order');
    const order2Id = order2Res.data.order.id;

    const approve2 = await api('POST', `/api/admin/crypto/orders/${order2Id}/approve`, {
      token: adminToken,
    });
    assert.equal(approve2.status, 200);

    // Verify idempotency: re-approving order2 does not create a 3rd entitlement or duplicate commission
    const approve2Retry = await api('POST', `/api/admin/crypto/orders/${order2Id}/approve`, {
      token: adminToken,
    });
    assert.equal(approve2Retry.status, 200);

    const entAfter2 = await api('GET', '/api/billing/entitlements', {
      token: customerToken,
    });
    assert.equal(entAfter2.data.activeEntitlements.length, 2, 'Must have 2 separate active entitlements');
    assert.equal(entAfter2.data.totalActiveCapacity, 10, 'Total capacity must be 5 + 5 = 10');
    assert.equal(entAfter2.data.usedWebsiteSlots, 5);
    assert.equal(entAfter2.data.remainingWebsiteSlots, 5);

    // Add websites 6..10 (should succeed) and 11th (should be blocked)
    for (let i = 6; i <= 10; i++) {
      const addSite = await api('POST', '/api/websites', {
        token: customerToken,
        body: {
          name: `Customer Site ${i}`,
          url: `https://example.com/site-${i}`,
        },
      });
      assert.equal(addSite.status, 201, `Adding site ${i} of 10 should succeed`);
    }

    const addSite11Blocked = await api('POST', '/api/websites', {
      token: customerToken,
      body: {
        name: 'Customer Site 11',
        url: 'https://example.com/site-11',
      },
    });
    assert.equal(addSite11Blocked.status, 403, '11th website must be blocked when capacity is 10');
    console.log('   ✓ Second Pro entitlement stacked capacity to 10; sites 6..10 added; 11th blocked.');

    // 7. Verify Referral Commissions (40%) on both independent purchases (2.00 USDT + 2.00 USDT = 4.00 USDT)
    console.log('7. Verifying 40% referral commissions on repeated purchases...');
    const refSummary = await api('GET', '/api/referrals/me', {
      token: referrerToken,
    });
    assert.equal(refSummary.status, 200);
    assert.equal(refSummary.data.availableBalance, 4.0);
    assert.equal(refSummary.data.totalCommissionsEarned, 4.0);
    assert.equal(refSummary.data.totalEligiblePurchases, 2);
    assert.equal(refSummary.data.currency, 'USDT');
    assert.ok(
      !JSON.stringify(refSummary.data).includes('$'),
      'Referral summary must not contain $ symbol'
    );
    console.log('   ✓ Referrer earned 2.00 USDT + 2.00 USDT = 4.00 USDT across 2 purchases.');

    // 8. Independent Expiration Test: Expire Entitlement #1 while Entitlement #2 remains active
    console.log('8. Testing independent expiration of Entitlement #1 (10 -> 5 capacity)...');
    const ent1Id = entAfter2.data.activeEntitlements[0].id;
    const ent2Id = entAfter2.data.activeEntitlements[1].id;
    const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    await query(`UPDATE subscription_entitlements SET expires_at = $1 WHERE id = $2`, [
      pastIso,
      ent1Id,
    ]);

    const summaryAfterExp1 = await getOrganizationEntitlementSummary(customerOrgId);
    assert.equal(summaryAfterExp1.activeEntitlements.length, 1, 'Only 1 entitlement should remain active');
    assert.equal(summaryAfterExp1.expiredEntitlements.length, 1, '1 entitlement should be expired');
    assert.equal(summaryAfterExp1.totalActiveCapacity, 5, 'Total active capacity must drop from 10 to 5');
    assert.equal(summaryAfterExp1.usedWebsiteSlots, 10, 'All 10 existing websites must be preserved');
    assert.equal(summaryAfterExp1.remainingWebsiteSlots, 0);
    assert.equal(summaryAfterExp1.overCapacitySlots, 5);

    const addWhileOverCapacity = await api('POST', '/api/websites', {
      token: customerToken,
      body: {
        name: 'Blocked Site After Expiry 1',
        url: `https://blocked-exp1-${Date.now()}.example.com`,
      },
    });
    assert.equal(addWhileOverCapacity.status, 403, 'Must block adding websites when over capacity');
    console.log('   ✓ Expiring Entitlement #1 reduced capacity to 5 while preserving all 10 existing websites.');

    // 9. Expire Entitlement #2 -> Verify Capacity drops to 0 and all 10 websites remain preserved
    console.log('9. Testing expiration of Entitlement #2 (5 -> 0 capacity)...');
    await query(`UPDATE subscription_entitlements SET expires_at = $1 WHERE id = $2`, [
      pastIso,
      ent2Id,
    ]);

    const summaryAfterExp2 = await getOrganizationEntitlementSummary(customerOrgId);
    assert.equal(summaryAfterExp2.activeEntitlements.length, 0);
    assert.equal(summaryAfterExp2.expiredEntitlements.length, 2);
    assert.equal(summaryAfterExp2.totalActiveCapacity, 0, 'Total capacity must be 0 when all paid entitlements expire');
    assert.equal(summaryAfterExp2.usedWebsiteSlots, 10, 'All 10 existing websites must still be preserved');
    assert.equal(summaryAfterExp2.allPaidEntitlementsExpired, true);

    const addWhenAllExpired = await api('POST', '/api/websites', {
      token: customerToken,
      body: {
        name: 'Blocked Site After Expiry 2',
        url: `https://blocked-exp2-${Date.now()}.example.com`,
      },
    });
    assert.equal(addWhenAllExpired.status, 403, 'Must block adding websites when all entitlements expired');
    console.log('   ✓ Expiring Entitlement #2 reduced capacity to 0 and preserved all 10 websites.');

    console.log('\n=== ALL UNIFIED NAVIGATION, CRYPTO-ONLY UI & ENTITLEMENT TESTS PASSED! ===');
  } finally {
    server.close();
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
