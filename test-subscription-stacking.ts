import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { db } from './server/db.ts';
import { handleApiRoute } from './server/api.ts';
import { approvePaymentOrder, rejectPaymentOrder } from './server/paymentApproval.ts';
import { runMigration } from './server/db/migrate.ts';
import { query } from './server/db/connection.ts';
import {
  ensureEntitlementsTable,
  getUserEntitlements,
  calculateUserWebsiteCapacity,
  isWebsiteEligible,
} from './server/entitlements.ts';
import { getUserReferralProfile } from './server/referrals.ts';

console.log('=== STARTING PULSEVANGUARD SUBSCRIPTION STACKING, ENTITLEMENTS & CAPACITY TEST SUITE ===');

class MockRequest extends IncomingMessage {
  private bodyData: string;
  public headers: Record<string, string>;
  public url: string;
  public method: string;

  constructor(method: string, url: string, bodyObj?: any, headers: Record<string, string> = {}) {
    super(new Socket());
    this.method = method;
    this.url = url;
    this.bodyData = bodyObj ? JSON.stringify(bodyObj) : '';
    this.headers = {
      'content-type': 'application/json',
      ...headers,
    };
  }

  override on(event: string, handler: any): this {
    if (event === 'data' && this.bodyData) {
      handler(Buffer.from(this.bodyData));
    } else if (event === 'end') {
      process.nextTick(() => handler());
    }
    return this;
  }
}

class MockResponse extends ServerResponse {
  public statusCode: number = 200;
  public capturedHeaders: Record<string, any> = {};
  public bodyChunks: string[] = [];

  constructor() {
    super({} as any);
  }

  override setHeader(name: string, value: any): this {
    this.capturedHeaders[name.toLowerCase()] = value;
    return this;
  }

  override writeHead(statusCode: number, headers?: any): this {
    this.statusCode = statusCode;
    if (headers) Object.assign(this.capturedHeaders, headers);
    return this;
  }

  override end(chunk?: any): this {
    if (chunk) {
      this.bodyChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    }
    return this;
  }

  public getBodyText(): string {
    return this.bodyChunks.join('');
  }

  public getJson(): any {
    const txt = this.getBodyText();
    return txt ? JSON.parse(txt) : null;
  }
}

async function runTests() {
  // Step 0: Ensure database and schema
  console.log('\n--- Step 0: Running Database Migrations & Initializing Entitlements Table ---');
  await runMigration();
  await ensureEntitlementsTable();
  console.log('✓ Database and subscription_entitlements table ready');

  const ts = Date.now();
  const referrerEmail = `referrer_ann_${ts}@example.com`;
  const customerEmail = `customer_charlie_${ts}@example.com`;
  const otherUserEmail = `other_dave_${ts}@example.com`;

  // Test 1: Register Referrer Ann and Customer Charlie
  console.log('\n--- Test 1: Register Referrer Ann & Customer Charlie ---');
  const reqAnn = new MockRequest('POST', '/api/auth/register', {
    email: referrerEmail,
    password: 'Password123!',
    name: 'Ann Referrer',
    orgName: 'Ann Tech',
  });
  const resAnn = new MockResponse();
  await handleApiRoute(reqAnn, resAnn);
  assert.equal(resAnn.statusCode, 201);
  const annUser = resAnn.getJson().user;
  const annToken = resAnn.getJson().token;
  assert.ok(annUser.referralCode, 'Ann must have unique referral code');

  // Register Charlie using Ann's referral code
  const reqCharlie = new MockRequest('POST', '/api/auth/register', {
    email: customerEmail,
    password: 'Password123!',
    name: 'Charlie Customer',
    orgName: 'Charlie Web Services',
    referralCode: annUser.referralCode,
  });
  const resCharlie = new MockResponse();
  await handleApiRoute(reqCharlie, resCharlie);
  assert.equal(resCharlie.statusCode, 201);
  const charlieData = resCharlie.getJson();
  const charlieUser = charlieData.user;
  const charlieOrg = charlieData.organization;
  const charlieToken = charlieData.token;
  console.log(`✓ Charlie registered with Org ID: ${charlieOrg.id}`);

  // Test 2: Initial capacity on Free Trial is 1 website slot
  console.log('\n--- Test 2: Initial Capacity Verification ---');
  const initialCap = await calculateUserWebsiteCapacity(charlieUser.id, charlieOrg.id);
  assert.equal(initialCap.totalSlots, 1, 'Initial free trial capacity must be 1');
  assert.equal(initialCap.usedSlots, 0);
  assert.equal(initialCap.remainingSlots, 1);
  assert.equal(initialCap.activeEntitlements.length, 0);
  console.log('✓ Initial capacity on Free Trial: 1 website slot');

  // Test 3: Create 1st Payment Order (Pending order does NOT grant capacity)
  console.log('\n--- Test 3: Pending Payment Order does NOT Grant Capacity ---');
  const reqOrder1 = new MockRequest(
    'POST',
    '/api/crypto/create-order',
    { planId: 'pro', interval: 'monthly' },
    { authorization: `Bearer ${charlieToken}` }
  );
  const resOrder1 = new MockResponse();
  await handleApiRoute(reqOrder1, resOrder1);
  assert.equal(resOrder1.statusCode, 201);
  const order1 = resOrder1.getJson().order;
  assert.equal(order1.status, 'Pending');

  const capWhilePending = await calculateUserWebsiteCapacity(charlieUser.id, charlieOrg.id);
  assert.equal(capWhilePending.totalSlots, 1, 'Capacity must remain 1 while payment is pending');
  console.log('✓ Pending order correctly granted 0 additional capacity');

  // Test 4: Admin approves 1st Payment Order -> First Entitlement Created (5 website slots)
  console.log('\n--- Test 4: Admin Approves 1st Order -> 1st Independent Entitlement (5 slots) ---');
  const adminUser = { id: 'usr_admin', email: 'mobinalavi7491@gmail.com', role: 'super_admin' };
  const approveRes1 = await approvePaymentOrder(order1.id, adminUser, 'Order 1 verified');
  assert.equal(approveRes1.order.status, 'Paid');

  const capAfterOrder1 = await calculateUserWebsiteCapacity(charlieUser.id, charlieOrg.id);
  assert.equal(capAfterOrder1.totalSlots, 5, 'Total capacity must be 5 slots after 1st approval');
  assert.equal(capAfterOrder1.activeEntitlements.length, 1);
  const ent1 = capAfterOrder1.activeEntitlements[0];
  assert.equal(ent1.websiteSlots, 5);
  assert.equal(ent1.orderId, order1.id);
  const ent1ExpiresAt = new Date(ent1.expiresAt).getTime();
  const expectedMinExpiry1 = Date.now() + 29 * 24 * 3600 * 1000;
  assert.ok(ent1ExpiresAt >= expectedMinExpiry1, 'Entitlement 1 must expire in ~30 days');
  console.log(`✓ 1st subscription granted 5 website slots. Expires: ${new Date(ent1.expiresAt).toISOString()}`);

  // Test 5: Approval Idempotency - Re-approval does not duplicate entitlement or change expiry
  console.log('\n--- Test 5: Idempotency Verification ---');
  await approvePaymentOrder(order1.id, adminUser, 'Duplicate retry');
  const capAfterRetry = await calculateUserWebsiteCapacity(charlieUser.id, charlieOrg.id);
  assert.equal(capAfterRetry.totalSlots, 5, 'Capacity must remain 5 on re-approval');
  assert.equal(capAfterRetry.activeEntitlements.length, 1, 'Must still have exactly 1 entitlement');
  assert.equal(new Date(capAfterRetry.activeEntitlements[0].expiresAt).getTime(), ent1ExpiresAt, 'Expiration date must not change on retry');
  console.log('✓ Payment approval idempotency verified: no duplicate entitlements or altered dates');

  // Test 6: Stacking 2nd Subscription while 1st is Active
  console.log('\n--- Test 6: Stacking 2nd Subscription (Annual Pro: +5 slots) ---');
  const reqOrder2 = new MockRequest(
    'POST',
    '/api/crypto/create-order',
    { planId: 'pro', interval: 'annual' },
    { authorization: `Bearer ${charlieToken}` }
  );
  const resOrder2 = new MockResponse();
  await handleApiRoute(reqOrder2, resOrder2);
  assert.equal(resOrder2.statusCode, 201);
  const order2 = resOrder2.getJson().order;
  assert.equal(order2.amount, 50);

  // Approve 2nd order
  await approvePaymentOrder(order2.id, adminUser, 'Order 2 annual verified');

  const capAfterOrder2 = await calculateUserWebsiteCapacity(charlieUser.id, charlieOrg.id);
  assert.equal(capAfterOrder2.totalSlots, 10, 'Total stacked capacity must be 5 + 5 = 10 website slots!');
  assert.equal(capAfterOrder2.activeEntitlements.length, 2, 'Must have 2 independently active entitlements');

  const activeEnts = capAfterOrder2.activeEntitlements;
  const entMonthly = activeEnts.find((e) => e.orderId === order1.id);
  const entAnnual = activeEnts.find((e) => e.orderId === order2.id);
  assert.ok(entMonthly, 'Monthly entitlement must be active');
  assert.ok(entAnnual, 'Annual entitlement must be active');

  // Verify independent expiration dates:
  // entMonthly expires in ~30 days, entAnnual expires in ~365 days
  const diffDays = (new Date(entAnnual.expiresAt).getTime() - new Date(entMonthly.expiresAt).getTime()) / (1000 * 3600 * 24);
  assert.ok(diffDays > 300, 'Annual subscription must have separate expiration ~335 days after monthly subscription');
  assert.equal(
    new Date(entMonthly.expiresAt).getTime(),
    ent1ExpiresAt,
    '2nd purchase must NOT extend, reset, or change the expiration date of the 1st subscription!'
  );
  console.log(`✓ Both subscriptions active! Total capacity: ${capAfterOrder2.totalSlots} websites.`);
  console.log(`  Sub 1 (Monthly) expires: ${new Date(entMonthly.expiresAt).toISOString()}`);
  console.log(`  Sub 2 (Annual)  expires: ${new Date(entAnnual.expiresAt).toISOString()}`);

  // Test 7: Adding Websites up to Effective Capacity (10 Websites)
  console.log('\n--- Test 7: Enforce Capacity on Website Creation (Up to 10 Sites) ---');
  const createdSiteIds: string[] = [];

  for (let i = 1; i <= 10; i++) {
    const reqAdd = new MockRequest(
      'POST',
      '/api/websites',
      { url: `https://site${i}-${ts}.example.com`, name: `Site ${i}` },
      { authorization: `Bearer ${charlieToken}` }
    );
    const resAdd = new MockResponse();
    await handleApiRoute(reqAdd, resAdd);
    assert.ok(resAdd.statusCode === 200 || resAdd.statusCode === 201, `Site ${i} should be successfully added (got ${resAdd.statusCode})`);
    const site = resAdd.getJson();
    createdSiteIds.push(site.id);
  }
  console.log(`✓ Successfully added 10 websites matching stacked capacity (10/10 slots used)`);

  // Test 8: Adding 11th Website is Strictly Rejected by Backend
  console.log('\n--- Test 8: Exceeding Stacked Capacity is Denied ---');
  const reqAdd11 = new MockRequest(
    'POST',
    '/api/websites',
    { url: `https://site11-${ts}.example.com`, name: `Site 11` },
    { authorization: `Bearer ${charlieToken}` }
  );
  const resAdd11 = new MockResponse();
  await handleApiRoute(reqAdd11, resAdd11);
  assert.equal(resAdd11.statusCode, 403, '11th website must be rejected with HTTP 403');
  const errJson = resAdd11.getJson();
  assert.ok(errJson.error.includes('capacity') || errJson.error.includes('CAPACITY'), 'Must contain capacity error message');
  console.log(`✓ 11th site rejected with clear message: "${errJson.error}"`);

  // Test 9: Simulating Expiration of First Subscription (Capacity drops from 10 to 5)
  console.log('\n--- Test 9: Expiration of 1st Entitlement drops capacity only for that entitlement ---');
  // Update 1st entitlement in DB to have expired yesterday
  const yesterdayIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await query(
    `UPDATE subscription_entitlements SET expires_at = $1, status = 'expired' WHERE id = $2`,
    [yesterdayIso, entMonthly.id]
  );
  db.updateEntitlement(entMonthly.id, { expiresAt: yesterdayIso, status: 'expired' });

  const capAfterExpiry = await calculateUserWebsiteCapacity(charlieUser.id, charlieOrg.id);
  assert.equal(capAfterExpiry.totalSlots, 5, 'Active capacity must drop to 5 after sub 1 expires');
  assert.equal(capAfterExpiry.usedSlots, 10, 'All 10 websites remain preserved (not deleted)');
  assert.equal(capAfterExpiry.activeEntitlements.length, 1, 'Only sub 2 remains active');
  console.log(`✓ Sub 1 expired cleanly. Active capacity is now 5. All 10 existing websites preserved intact.`);

  // Test 10: Website Eligibility when Capacity drops:
  // First 5 sites remain eligible; Sites 6-10 exceed active capacity
  console.log('\n--- Test 10: Inactive Capacity Access Control ---');
  const eligibleCheckSite1 = await isWebsiteEligible(createdSiteIds[0], charlieOrg.id, charlieUser.id);
  assert.equal(eligibleCheckSite1.eligible, true, 'Site 1 must remain eligible (within active 5 slots)');

  const eligibleCheckSite7 = await isWebsiteEligible(createdSiteIds[6], charlieOrg.id, charlieUser.id);
  assert.equal(eligibleCheckSite7.eligible, false, 'Site 7 must be ineligible (exceeds active 5 slots)');
  assert.ok(eligibleCheckSite7.reason?.includes('capacity'), 'Must state capacity reason');
  console.log(`✓ Site 1 eligible: ${eligibleCheckSite1.eligible}. Site 7 eligible: ${eligibleCheckSite7.eligible} (Reason: ${eligibleCheckSite7.reason})`);

  // Test 11: Attempting to check site 7 returns HTTP 403 CAPACITY_INACTIVE
  const reqCheck7 = new MockRequest(
    'POST',
    `/api/websites/${createdSiteIds[6]}/check-now`,
    {},
    { authorization: `Bearer ${charlieToken}` }
  );
  const resCheck7 = new MockResponse();
  await handleApiRoute(reqCheck7, resCheck7);
  assert.equal(resCheck7.statusCode, 403);
  assert.equal(resCheck7.getJson().error, 'CAPACITY_INACTIVE');
  console.log('✓ Checking site beyond capacity returned 403 CAPACITY_INACTIVE');

  // Test 12: Rejected Payment Order never creates entitlement
  console.log('\n--- Test 12: Rejected Payment Order Never Grants Entitlement ---');
  const reqOrder3 = new MockRequest(
    'POST',
    '/api/crypto/create-order',
    { planId: 'pro', interval: 'monthly' },
    { authorization: `Bearer ${charlieToken}` }
  );
  const resOrder3 = new MockResponse();
  await handleApiRoute(reqOrder3, resOrder3);
  const order3 = resOrder3.getJson().order;

  await rejectPaymentOrder(order3.id, adminUser, 'Fraudulent transaction hash');
  const ents3 = await getUserEntitlements(charlieUser.id, charlieOrg.id);
  const entForOrder3 = ents3.find((e) => e.orderId === order3.id);
  assert.equal(entForOrder3, undefined, 'Rejected order must never create an entitlement');
  console.log('✓ Rejected payment order generated 0 entitlements');

  // Test 13: GET /api/user/subscriptions returns consolidated capacity and entitlements
  console.log('\n--- Test 13: GET /api/user/subscriptions Endpoint ---');
  const reqUserSubs = new MockRequest(
    'GET',
    '/api/user/subscriptions',
    null,
    { authorization: `Bearer ${charlieToken}` }
  );
  const resUserSubs = new MockResponse();
  await handleApiRoute(reqUserSubs, resUserSubs);
  assert.equal(resUserSubs.statusCode, 200);
  const subData = resUserSubs.getJson();
  assert.ok(subData.capacity, 'Must return capacity object');
  assert.equal(subData.capacity.totalSlots, 5);
  assert.equal(subData.capacity.usedSlots, 10);
  assert.ok(subData.capacity.allEntitlements.length >= 2);
  console.log('✓ GET /api/user/subscriptions returned complete stacked entitlements data');

  // Test 14: Data Isolation: Other user Dave cannot see Charlie’s orders or subscriptions
  console.log('\n--- Test 14: User Data Isolation Enforced ---');
  const reqDave = new MockRequest('POST', '/api/auth/register', {
    email: otherUserEmail,
    password: 'Password123!',
    name: 'Dave User',
    orgName: 'Dave Services',
  });
  const resDave = new MockResponse();
  await handleApiRoute(reqDave, resDave);
  const daveToken = resDave.getJson().token;

  const reqDaveOrders = new MockRequest('GET', '/api/crypto/orders', null, { authorization: `Bearer ${daveToken}` });
  const resDaveOrders = new MockResponse();
  await handleApiRoute(reqDaveOrders, resDaveOrders);
  const daveOrders = resDaveOrders.getJson();
  assert.equal(daveOrders.length, 0, 'Dave must see 0 orders (cannot see Charlie orders)');

  const reqCharlieOrders = new MockRequest('GET', '/api/crypto/orders', null, { authorization: `Bearer ${charlieToken}` });
  const resCharlieOrders = new MockResponse();
  await handleApiRoute(reqCharlieOrders, resCharlieOrders);
  const charlieOrders = resCharlieOrders.getJson();
  assert.ok(charlieOrders.length >= 2, 'Charlie must see their own orders');
  console.log(`✓ Data isolation strictly enforced: Dave saw ${daveOrders.length} orders; Charlie saw ${charlieOrders.length} orders`);

  // Test 15: 40% Referral Commissions earned on both purchases
  console.log('\n--- Test 15: Referral 40% Commissions on Both Stacked Purchases ---');
  const annProfile = await getUserReferralProfile(annUser.id);
  // Ann earned 40% of Order 1 ($5 -> $2) + 40% of Order 2 ($50 -> $20) = $22.00 USDT
  assert.equal(annProfile.totalCommissionsEarned, 22.0, 'Ann must have earned 2.00 + 20.00 = 22.00 USDT total');
  assert.equal(annProfile.commissions.length, 2, 'Ann must have exactly 2 commission records');
  console.log(`✓ Referrer Ann earned 40% on both purchases: ${annProfile.totalCommissionsEarned.toFixed(2)} USDT credited!`);

  console.log('\n=== ALL SUBSCRIPTION STACKING & CAPACITY TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
