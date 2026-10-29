import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { db, hashPassword } from './server/db.ts';
import { handleApiRoute } from './server/api.ts';
import { approvePaymentOrder, rejectPaymentOrder, cancelPaymentOrder } from './server/paymentApproval.ts';
import { applyAuthCleanupMigration, runMigration } from './server/db/migrate.ts';
import { query } from './server/db/connection.ts';
import { createSession as createDbSession, findSessionByToken, deleteSessionByToken } from './server/db/sessionRepo.ts';

console.log('=== STARTING PULSEVANGUARDE AUTH & PAYMENT APPROVAL TEST SUITE ===');

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
    super(new IncomingMessage(new Socket()));
  }

  override setHeader(name: string, value: any): this {
    this.capturedHeaders[name.toLowerCase()] = value;
    return this;
  }

  override write(chunk: any): boolean {
    this.bodyChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  }

  override end(chunk?: any): this {
    if (chunk) {
      this.bodyChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    }
    return this;
  }

  getJson(): any {
    const raw = this.bodyChunks.join('');
    return raw ? JSON.parse(raw) : null;
  }
}

async function executeRoute(method: string, url: string, body?: any, headers?: Record<string, string>) {
  const req = new MockRequest(method, url, body, headers);
  const res = new MockResponse();
  const handled = await handleApiRoute(req, res);
  return { handled, statusCode: res.statusCode, data: res.getJson() };
}

async function runAuthAndPaymentTests() {
  // Ensure schema and migration is initialized
  await db.ensureSchema();
  await runMigration({ force: true });

  // -------------------------------------------------------------
  // Test 1: mobinalavi7491@gmail.com has super_admin role
  // -------------------------------------------------------------
  console.log('\n--- Test 1: mobinalavi7491@gmail.com has super_admin role ---');
  const targetUser = db.findUserByEmail('mobinalavi7491@gmail.com');
  assert(targetUser, 'mobinalavi7491@gmail.com must exist in the database');
  assert.equal(targetUser.role, 'super_admin', 'Target email must have role super_admin');
  console.log(`✓ Test 1 Passed: mobinalavi7491@gmail.com verified with role: ${targetUser.role}`);

  // -------------------------------------------------------------
  // Test 2: The two default accounts are removed and not automatically recreated
  // -------------------------------------------------------------
  console.log('\n--- Test 2: Removed default accounts do not exist and cannot be recreated ---');
  const adminAccount = db.findUserByEmail('admin@pulsevanguard.com');
  const agencyAccount = db.findUserByEmail('agency@acmedigital.com');
  assert(!adminAccount, 'admin@pulsevanguard.com must NOT exist in the database');
  assert(!agencyAccount, 'agency@acmedigital.com must NOT exist in the database');

  // Verify registration blocks default accounts
  const regAdminRes = await executeRoute('POST', '/api/auth/register', {
    email: 'admin@pulsevanguard.com',
    password: 'password123',
    name: 'Fake Admin',
  });
  assert.equal(regAdminRes.statusCode, 400, 'Registering admin@pulsevanguard.com must be blocked');

  const regAgencyRes = await executeRoute('POST', '/api/auth/register', {
    email: 'agency@acmedigital.com',
    password: 'password123',
    name: 'Fake Agency',
  });
  assert.equal(regAgencyRes.statusCode, 400, 'Registering agency@acmedigital.com must be blocked');

  // Verify db.addUser throws if attempt is made directly
  assert.throws(() => {
    db.addUser({
      id: 'usr_exploit',
      email: 'admin@pulsevanguard.com',
      name: 'Exploit',
      passwordHash: 'hash',
      role: 'super_admin',
      orgId: 'org_test',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    });
  }, /Default demo accounts cannot be created/);
  console.log('✓ Test 2 Passed: Decommissioned accounts are completely blocked from re-creation');

  // -------------------------------------------------------------
  // Test 3: The two removed accounts cannot log in or reuse existing sessions
  // -------------------------------------------------------------
  console.log('\n--- Test 3: Removed accounts cannot log in or reuse sessions ---');
  const loginAdminRes = await executeRoute('POST', '/api/auth/login', {
    email: 'admin@pulsevanguard.com',
    password: 'password123',
  });
  assert.equal(loginAdminRes.statusCode, 401, 'Login for admin@pulsevanguard.com must return 401');

  const loginAgencyRes = await executeRoute('POST', '/api/auth/login', {
    email: 'agency@acmedigital.com',
    password: 'password123',
  });
  assert.equal(loginAgencyRes.statusCode, 401, 'Login for agency@acmedigital.com must return 401');

  // Verify legacy session revocation from cache or unknown user
  const legacyToken = 'pv_sess_legacy_admin_token';
  // Try resolving with a forged/legacy token
  const meWithLegacyRes = await executeRoute('GET', '/api/auth/me', undefined, {
    authorization: `Bearer ${legacyToken}`,
  });
  assert.equal(meWithLegacyRes.statusCode, 401, 'Legacy or forged admin session must be rejected (401)');
  console.log('✓ Test 3 Passed: Removed accounts cannot log in and legacy sessions are revoked');

  // -------------------------------------------------------------
  // Test 4: Normal user cannot access administrative API endpoints
  // -------------------------------------------------------------
  console.log('\n--- Test 4: Normal user RBAC enforcement on admin endpoints ---');
  // Register a normal test user
  const normalUserEmail = `normal_${Date.now()}@example.com`;
  const regNormal = await executeRoute('POST', '/api/auth/register', {
    email: normalUserEmail,
    password: 'securePassword123',
    name: 'Normal Customer',
  });
  assert.equal(regNormal.statusCode, 201);
  const normalToken = regNormal.data.token;
  assert(normalToken, 'Normal user must receive token');

  // Attempt admin endpoints
  const adminOverviewAttempt = await executeRoute('GET', '/api/admin/overview', undefined, {
    authorization: `Bearer ${normalToken}`,
  });
  assert.equal(adminOverviewAttempt.statusCode, 403, 'Normal user must be denied /api/admin/overview (403)');

  const adminUsersAttempt = await executeRoute('GET', '/api/admin/users', undefined, {
    authorization: `Bearer ${normalToken}`,
  });
  assert.equal(adminUsersAttempt.statusCode, 403, 'Normal user must be denied /api/admin/users (403)');

  const adminOrdersAttempt = await executeRoute('GET', '/api/admin/crypto/orders', undefined, {
    authorization: `Bearer ${normalToken}`,
  });
  assert.equal(adminOrdersAttempt.statusCode, 403, 'Normal user must be denied /api/admin/crypto/orders (403)');
  console.log('✓ Test 4 Passed: Normal user is strictly forbidden from administrative API endpoints');

  // -------------------------------------------------------------
  // Test 5: The intended Super Admin can access administrative endpoints
  // -------------------------------------------------------------
  console.log('\n--- Test 5: Intended Super Admin access to administrative endpoints ---');
  // Set password hash for mobinalavi7491@gmail.com and login
  const superAdmin = db.findUserByEmail('mobinalavi7491@gmail.com')!;
  superAdmin.passwordHash = hashPassword('AdminPass2026!');
  db.persist();

  const superAdminLoginRes = await executeRoute('POST', '/api/auth/login', {
    email: 'mobinalavi7491@gmail.com',
    password: 'AdminPass2026!',
  });
  assert.equal(superAdminLoginRes.statusCode, 200, 'Super admin login must succeed');
  assert.equal(superAdminLoginRes.data.user.role, 'super_admin');
  const superAdminToken = superAdminLoginRes.data.token;

  const adminOverview = await executeRoute('GET', '/api/admin/overview', undefined, {
    authorization: `Bearer ${superAdminToken}`,
  });
  assert.equal(adminOverview.statusCode, 200, 'Super Admin must access /api/admin/overview');

  const adminUsers = await executeRoute('GET', '/api/admin/users', undefined, {
    authorization: `Bearer ${superAdminToken}`,
  });
  assert.equal(adminUsers.statusCode, 200, 'Super Admin must access /api/admin/users');

  const adminOrders = await executeRoute('GET', '/api/admin/crypto/orders', undefined, {
    authorization: `Bearer ${superAdminToken}`,
  });
  assert.equal(adminOrders.statusCode, 200, 'Super Admin must access /api/admin/crypto/orders');
  assert(Array.isArray(adminOrders.data), 'Orders list must be an array');
  console.log('✓ Test 5 Passed: Super Admin mobinalavi7491@gmail.com has full authorized access');

  // -------------------------------------------------------------
  // Test 6: Existing non-admin users and their data remain intact
  // -------------------------------------------------------------
  console.log('\n--- Test 6: Existing non-admin users and records integrity ---');
  const allUsers = db.getUsers();
  assert(allUsers.length >= 2, 'Existing users must be preserved');
  for (const u of allUsers) {
    assert(u.email !== 'admin@pulsevanguard.com');
    assert(u.email !== 'agency@acmedigital.com');
  }
  const websites = db.getWebsites();
  assert(websites.length > 0, 'Websites must remain intact');
  console.log(`✓ Test 6 Passed: ${allUsers.length} users and ${websites.length} websites intact`);

  // -------------------------------------------------------------
  // Test 7: Database initialization / restarts do not undo changes
  // -------------------------------------------------------------
  console.log('\n--- Test 7: Restart and re-migration resistance ---');
  const reMigration = await runMigration({ force: false });
  assert(reMigration.success, 'Re-running migration should succeed');
  const checkTargetAgain = db.findUserByEmail('mobinalavi7491@gmail.com');
  assert.equal(checkTargetAgain?.role, 'super_admin');
  assert(!db.findUserByEmail('admin@pulsevanguard.com'));
  assert(!db.findUserByEmail('agency@acmedigital.com'));
  console.log('✓ Test 7 Passed: Application restarts and migration runs preserve super_admin and removals');

  // -------------------------------------------------------------
  // Test 8: Payments Approval & Rejection Workflow
  // -------------------------------------------------------------
  console.log('\n--- Test 8: Payments Approval, Rejection, and Idempotency ---');
  // 8a. Customer creates a crypto payment order
  const createOrderRes = await executeRoute(
    'POST',
    '/api/crypto/create-order',
    {
      planId: 'pro',
      billingInterval: 'monthly',
      currency: 'USD',
    },
    {
      authorization: `Bearer ${normalToken}`,
    }
  );
  assert.equal(createOrderRes.statusCode, 201, 'Customer should be able to create payment order');
  const orderId = createOrderRes.data.order.id;
  assert(orderId, 'Order must have an ID');
  assert.equal(createOrderRes.data.order.status, 'Pending');

  // 8b. Super admin retrieves global payment list and sees this order
  const ordersListRes = await executeRoute('GET', '/api/admin/crypto/orders', undefined, {
    authorization: `Bearer ${superAdminToken}`,
  });
  assert.equal(ordersListRes.statusCode, 200);
  const foundOrder = ordersListRes.data.find((o: any) => o.id === orderId);
  assert(foundOrder, 'Super admin must see the newly created order in payment list');
  assert.equal(foundOrder.userEmail, normalUserEmail);
  assert.equal(foundOrder.planId, 'pro');
  assert.equal(foundOrder.status, 'Pending');
  assert(!foundOrder.secretKey && !foundOrder.privateKey, 'No payment secrets or private keys must be exposed');

  // 8c. Normal user cannot approve payment
  const unauthApprove = await executeRoute('POST', `/api/admin/crypto/orders/${orderId}/approve`, undefined, {
    authorization: `Bearer ${normalToken}`,
  });
  assert.equal(unauthApprove.statusCode, 403, 'Normal user must be forbidden from approving payment');

  // 8d. Super Admin approves payment
  const approveRes = await executeRoute('POST', `/api/admin/crypto/orders/${orderId}/approve`, undefined, {
    authorization: `Bearer ${superAdminToken}`,
  });
  if (approveRes.statusCode !== 200) {
    console.error('approveRes error data:', approveRes.data);
  }
  assert.equal(approveRes.statusCode, 200, 'Super admin approval must succeed');
  assert.equal(approveRes.data.order.status, 'Paid');
  assert.equal(approveRes.data.order.approvedBy, 'mobinalavi7491@gmail.com');

  // Verify customer organization subscription is activated to PRO
  const customerMeRes = await executeRoute('GET', '/api/auth/me', undefined, {
    authorization: `Bearer ${normalToken}`,
  });
  assert.equal(customerMeRes.statusCode, 200);
  assert.equal(customerMeRes.data.organization.planId, 'pro', 'Customer plan must be activated to pro');

  // 8e. Idempotent approval: second call returns success cleanly without duplicating duration
  const reApproveRes = await executeRoute('POST', `/api/admin/crypto/orders/${orderId}/approve`, undefined, {
    authorization: `Bearer ${superAdminToken}`,
  });
  assert.equal(reApproveRes.statusCode, 200, 'Re-approving must succeed idempotently');
  assert.equal(reApproveRes.data.alreadyApproved, true);

  // 8f. Rejection flow on a second payment order
  const order2Res = await executeRoute(
    'POST',
    '/api/crypto/create-order',
    {
      planId: 'pro',
      interval: 'annual',
      currency: 'USD',
    },
    {
      authorization: `Bearer ${normalToken}`,
    }
  );
  assert.equal(order2Res.statusCode, 201);
  const orderId2 = order2Res.data.order.id;

  // Super admin rejects payment with a reason
  const rejectRes = await executeRoute(
    'POST',
    `/api/admin/crypto/orders/${orderId2}/reject`,
    { reason: 'Transaction hash not found on TRON explorer' },
    {
      authorization: `Bearer ${superAdminToken}`,
    }
  );
  assert.equal(rejectRes.statusCode, 200, 'Super admin rejection must succeed');
  assert.equal(rejectRes.data.order.status, 'Rejected');
  assert.equal(rejectRes.data.order.rejectedBy, 'mobinalavi7491@gmail.com');
  assert.equal(rejectRes.data.order.rejectionReason, 'Transaction hash not found on TRON explorer');

  // Attempt to approve a rejected order must fail
  const approveRejectedRes = await executeRoute('POST', `/api/admin/crypto/orders/${orderId2}/approve`, undefined, {
    authorization: `Bearer ${superAdminToken}`,
  });
  assert.equal(approveRejectedRes.statusCode, 400, 'Cannot approve an order that was rejected');

  // 8g. Customer cancel order flow
  const order3Res = await executeRoute(
    'POST',
    '/api/crypto/create-order',
    {
      planId: 'pro',
      billingInterval: 'monthly',
      currency: 'USD',
    },
    {
      authorization: `Bearer ${normalToken}`,
    }
  );
  assert.equal(order3Res.statusCode, 201);
  const orderId3 = order3Res.data.order.id;

  const cancelRes = await executeRoute('POST', `/api/crypto/order/${orderId3}/cancel`, undefined, {
    authorization: `Bearer ${normalToken}`,
  });
  assert.equal(cancelRes.statusCode, 200, 'Customer can cancel active unpaid order');
  assert.equal(cancelRes.data.order.status, 'Cancelled');

  console.log('✓ Test 8 Passed: Complete payment approval, rejection, idempotency, and cancellation verified');

  console.log('\n=== ALL AUTH & PAYMENT TESTS COMPLETED SUCCESSFULLY ===');
}

runAuthAndPaymentTests().catch((err) => {
  console.error('\n❌ Auth and Payment Tests Failed:', err);
  process.exit(1);
});
