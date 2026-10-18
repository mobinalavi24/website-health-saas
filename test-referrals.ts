import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { db, hashPassword, type User } from './server/db.ts';
import { handleApiRoute } from './server/api.ts';
import { approvePaymentOrder, rejectPaymentOrder } from './server/paymentApproval.ts';
import { applyReferralSchemaMigration, runMigration } from './server/db/migrate.ts';
import { query, withTransaction } from './server/db/connection.ts';
import {
  generateReferralCode,
  isValidTrc20Address,
  validateReferralCode,
  applyReferralCodeToUser,
  getUserReferralProfile,
  createWithdrawalRequest,
  approveWithdrawalForPayout,
  markWithdrawalAsPaid,
  rejectWithdrawalRequest,
  cancelWithdrawalByCustomer,
  getAdminReferralOverview,
  getAdminWithdrawalRequests,
  getAdminCommissions,
} from './server/referrals.ts';
import { createCryptoPaymentOrder } from './server/lbank.ts';

console.log('=== STARTING PULSEVANGUARD REFERRALS, COMMISSION & WITHDRAWAL TEST SUITE ===');

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
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}

async function runTestSuite() {
  // Step 0: Ensure schema & migration
  console.log('\n--- Step 0: Initializing DB & Referral Tables ---');
  await runMigration();
  const refMigrate = await applyReferralSchemaMigration();
  console.log(`✓ Database ready. Backfilled referral codes for users: ${refMigrate.backfilledUsers}`);

  // Test 1: TRC20 Address Validator
  console.log('\n--- Test 1: Tron TRC20 Address Validation ---');
  assert.equal(isValidTrc20Address('TLsV52sRDL79HXGGm9yzwKZsDchdYGeXhm'), true, 'Valid TRC20 address should pass');
  assert.equal(isValidTrc20Address('0x71C8fb866E35550293214549Ba24Ea26'), false, 'Ethereum address should fail');
  assert.equal(isValidTrc20Address('TLsV52sRDL79'), false, 'Short address should fail');
  assert.equal(isValidTrc20Address('T111111111111111111111111111111111'), false, 'Repetitive dummy address should fail');
  console.log('✓ TRC20 format validation strictly enforces 34-char Base58 Tron addresses');

  // Test 2: Referral Code Generation & Uniqueness
  console.log('\n--- Test 2: Referral Code Generation Format & Randomness ---');
  const codeSet = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const code = generateReferralCode();
    assert.equal(code.startsWith('PV'), true, 'Code must start with PV');
    assert.equal(code.length, 8, 'Code must be 8 chars long');
    codeSet.add(code);
  }
  assert.equal(codeSet.size, 50, 'All 50 generated codes should be unique');
  console.log('✓ Referral codes format PVXXXXXX verified and distinct');

  // Test 3: Register Referrer User A via API
  console.log('\n--- Test 3: Register Referrer User A ---');
  const ts = Date.now();
  const aliceEmail = `referrer_alice_${ts}@example.com`;
  const bobEmail = `customer_bob_${ts}@example.com`;

  const reqRegA = new MockRequest('POST', '/api/auth/register', {
    email: aliceEmail,
    password: 'Password123!',
    name: 'Alice Referrer',
    orgName: "Alice's Digital Agency",
  });
  const resRegA = new MockResponse();
  await handleApiRoute(reqRegA, resRegA);
  const dataA = resRegA.getJson();
  assert.equal(resRegA.statusCode, 201);
  assert(dataA.user.referralCode, 'Referrer Alice must receive a referral code');
  const aliceToken = dataA.token;
  const aliceUserId = dataA.user.id;
  const aliceRefCode = dataA.user.referralCode;
  console.log(`✓ Alice registered with code: ${aliceRefCode}, ID: ${aliceUserId}`);

  // Test 4: Self-referral Prevention
  console.log('\n--- Test 4: Prevent Self-Referral ---');
  const valSelf = await validateReferralCode(aliceRefCode, aliceUserId);
  assert.equal(valSelf.valid, false, 'Self-referral must be blocked');
  assert.match(valSelf.message, /cannot refer yourself/i);
  console.log('✓ Self-referral strictly prevented: ' + valSelf.message);

  // Test 5: Register Referred User B with Alice's Code
  console.log('\n--- Test 5: Register Customer Bob using Alice’s Referral Code ---');
  const reqRegB = new MockRequest('POST', '/api/auth/register', {
    email: bobEmail,
    password: 'Password123!',
    name: 'Bob Referred Customer',
    orgName: "Bob's Ecommerce",
    referralCode: aliceRefCode,
  });
  const resRegB = new MockResponse();
  await handleApiRoute(reqRegB, resRegB);
  const dataB = resRegB.getJson();
  assert.equal(resRegB.statusCode, 201);
  assert.equal(dataB.user.referredBy, aliceUserId, 'Bob must have Alice recorded as referredBy');
  const bobToken = dataB.token;
  const bobUserId = dataB.user.id;
  console.log(`✓ Bob registered and permanently linked to referrer Alice (${aliceUserId})`);

  // Test 6: Verify User cannot change referrer once permanently set
  console.log('\n--- Test 6: Prevent Changing Permanent Referrer ---');
  let errorCaught = false;
  try {
    await applyReferralCodeToUser(bobUserId, 'PVXYZ999');
  } catch (err: any) {
    errorCaught = true;
    assert.match(err.message, /already been permanently assigned/i);
  }
  assert.equal(errorCaught, true, 'User cannot change their permanently assigned referrer');
  console.log('✓ Re-applying or modifying assigned referrer is rejected');

  // Test 7: Verify Unapproved / Pending order does NOT generate commission
  console.log('\n--- Test 7: Pending Order does NOT generate Commission ---');
  // Bob creates a Pro monthly order ($5 / 5 USDT)
  const reqOrder = new MockRequest(
    'POST',
    '/api/crypto/create-order',
    { planId: 'pro', interval: 'monthly' },
    { authorization: `Bearer ${bobToken}` }
  );
  const resOrder = new MockResponse();
  await handleApiRoute(reqOrder, resOrder);
  const orderData = resOrder.getJson();
  assert.equal(resOrder.statusCode, 201);
  const bobOrder = orderData.order;
  assert.equal(bobOrder.amount, 5);

  // Check Alice's profile immediately - should have 0 balance and 0 commissions
  const profileBefore = await getUserReferralProfile(aliceUserId);
  assert.equal(profileBefore.availableBalance, 0);
  assert.equal(profileBefore.commissions.length, 0);
  console.log('✓ Pending order generated 0 commissions for Alice (balance remains 0.00 USDT)');

  // Test 8: Super Admin Approves Bob's Payment -> Exactly 40% Commission (2.00 USDT) Awarded
  console.log('\n--- Test 8: Admin Approves Payment -> 40% ($2.00) Credited to Referrer ---');
  const adminUser = { id: 'usr_admin', email: 'mobinalavi7491@gmail.com', role: 'super_admin' };
  const approvedRes = await approvePaymentOrder(bobOrder.id, adminUser, 'Payment verified via manual test');
  assert.equal(approvedRes.order.status, 'Paid');

  // Verify Alice's wallet
  const profileAfter = await getUserReferralProfile(aliceUserId);
  assert.equal(profileAfter.availableBalance, 2.0, 'Alice available balance must be 2.00 USDT (40% of 5 USDT)');
  assert.equal(profileAfter.totalCommissionsEarned, 2.0);
  assert.equal(profileAfter.commissions.length, 1);
  assert.equal(profileAfter.commissions[0].commissionAmountCents, 200);
  assert.equal(profileAfter.commissions[0].orderAmountCents, 500);
  console.log(`✓ Alice received 40% commission: ${profileAfter.availableBalance.toFixed(2)} USDT credited!`);

  // Test 9: Payment Approval Idempotency (Retry does not double-credit)
  console.log('\n--- Test 9: Concurrency & Idempotency Safeguards ---');
  await approvePaymentOrder(bobOrder.id, adminUser, 'Duplicate retry attempt');
  const profileAfterRetry = await getUserReferralProfile(aliceUserId);
  assert.equal(profileAfterRetry.availableBalance, 2.0, 'Balance must remain exactly 2.00 USDT after retry');
  assert.equal(profileAfterRetry.commissions.length, 1, 'Only one commission record allowed per order');
  console.log('✓ Re-approval idempotent: no duplicate commission credited');

  // Test 10: Second purchase with Pro Annual ($50 -> 40% is $20.00 USDT)
  console.log('\n--- Test 10: 40% Commission on $50 Annual Plan ($20.00 USDT) ---');
  const reqOrderAnnual = new MockRequest(
    'POST',
    '/api/crypto/create-order',
    { planId: 'pro', interval: 'annual' },
    { authorization: `Bearer ${bobToken}` }
  );
  const resOrderAnnual = new MockResponse();
  await handleApiRoute(reqOrderAnnual, resOrderAnnual);
  const annualOrder = resOrderAnnual.getJson().order;
  assert.equal(annualOrder.amount, 50);

  // Approve annual order
  await approvePaymentOrder(annualOrder.id, adminUser, 'Annual payment verified');
  const profileAfterAnnual = await getUserReferralProfile(aliceUserId);
  assert.equal(profileAfterAnnual.availableBalance, 22.0, 'Balance must be 2.00 + 20.00 = 22.00 USDT');
  assert.equal(profileAfterAnnual.totalCommissionsEarned, 22.0);
  assert.equal(profileAfterAnnual.commissions.length, 2);
  console.log(`✓ Alice earned $20.00 USDT on annual plan! Total available balance: ${profileAfterAnnual.availableBalance.toFixed(2)} USDT`);

  // Test 11: Withdrawal Below Minimum ($4) is Rejected
  console.log('\n--- Test 11: Withdrawal Threshold & Balance Checks ---');
  let minWithdrawalFailed = false;
  try {
    await createWithdrawalRequest(aliceUserId, 3.5, 'TLsV52sRDL79HXGGm9yzwKZsDchdYGeXhm');
  } catch (err: any) {
    minWithdrawalFailed = true;
    assert.match(err.message, /minimum withdrawal/i);
  }
  assert.equal(minWithdrawalFailed, true, 'Withdrawals under 4.00 USDT must be rejected');

  // Test 12: Withdrawal Over Available Balance is Rejected
  let overdrawFailed = false;
  try {
    await createWithdrawalRequest(aliceUserId, 100.0, 'TLsV52sRDL79HXGGm9yzwKZsDchdYGeXhm');
  } catch (err: any) {
    overdrawFailed = true;
    assert.match(err.message, /insufficient/i);
  }
  assert.equal(overdrawFailed, true, 'Overdrawing available balance must be rejected');
  console.log('✓ Minimum threshold and overdraft protections enforced');

  // Test 13: Valid Withdrawal Request ($10.00 USDT) -> Atomic Balance Reservation
  console.log('\n--- Test 13: Atomic Withdrawal Creation & Balance Reservation ---');
  const trc20Wallet = 'TLsV52sRDL79HXGGm9yzwKZsDchdYGeXhm';
  const withdrawal = await createWithdrawalRequest(aliceUserId, 10.0, trc20Wallet);
  assert.equal(withdrawal.status, 'pending');
  assert.equal(withdrawal.amountCents, 1000);

  const profileAfterWth = await getUserReferralProfile(aliceUserId);
  assert.equal(profileAfterWth.availableBalance, 12.0, 'Available balance deducted to 12.00 USDT');
  assert.equal(profileAfterWth.reservedBalance, 10.0, 'Reserved balance increased to 10.00 USDT');
  console.log(`✓ 10.00 USDT reserved. Available: ${profileAfterWth.availableBalance} USDT, Reserved: ${profileAfterWth.reservedBalance} USDT`);

  // Test 14: Customer Cancels Pending Withdrawal -> Funds Restored to Available Balance
  console.log('\n--- Test 14: Customer Cancels Pending Withdrawal -> Full Refund ---');
  await cancelWithdrawalByCustomer(withdrawal.id, aliceUserId);
  const profileAfterCancel = await getUserReferralProfile(aliceUserId);
  assert.equal(profileAfterCancel.availableBalance, 22.0, 'Full 22.00 USDT balance restored after cancellation');
  assert.equal(profileAfterCancel.reservedBalance, 0.0, 'Reserved balance reset to 0');
  console.log('✓ Customer cancellation restores funds cleanly');

  // Test 15: Create New Withdrawal ($15.00 USDT) and Super Admin Rejection -> Refund
  console.log('\n--- Test 15: Super Admin Rejects Withdrawal -> Automated Refund ---');
  const wth2 = await createWithdrawalRequest(aliceUserId, 15.0, trc20Wallet);
  const pMid = await getUserReferralProfile(aliceUserId);
  assert.equal(pMid.availableBalance, 7.0);
  assert.equal(pMid.reservedBalance, 15.0);

  await rejectWithdrawalRequest(wth2.id, 'Destination address flagged for manual review', adminUser);
  const pAfterReject = await getUserReferralProfile(aliceUserId);
  assert.equal(pAfterReject.availableBalance, 22.0, 'Funds refunded to available balance on rejection');
  assert.equal(pAfterReject.reservedBalance, 0.0);
  console.log('✓ Admin rejection cleanly refunded reserved funds back to user wallet');

  // Test 16: Create Withdrawal ($12.00 USDT) and Super Admin Approves & Pays with TXID
  console.log('\n--- Test 16: Super Admin Payout Execution with Tron TXID ---');
  const wth3 = await createWithdrawalRequest(aliceUserId, 12.0, trc20Wallet);
  const sampleTxId = '84f4e240b91e98bbcfec2e07eb2305567b4588e0b6287c936082c97486e92701';

  // Mark paid
  const paidWth = await markWithdrawalAsPaid(wth3.id, sampleTxId, adminUser);
  assert.equal(paidWth.status, 'paid');
  assert.equal(paidWth.payoutTxId, sampleTxId);

  const pFinal = await getUserReferralProfile(aliceUserId);
  assert.equal(pFinal.availableBalance, 10.0, 'Available balance is 22 - 12 = 10.00 USDT');
  assert.equal(pFinal.reservedBalance, 0.0, 'Reserved balance released');
  assert.equal(pFinal.totalWithdrawn, 12.0, 'Total paid out increased to 12.00 USDT');
  console.log(`✓ Payout recorded with TXID: ${sampleTxId}. Final state: Available: ${pFinal.availableBalance} USDT, Paid Out: ${pFinal.totalWithdrawn} USDT`);

  // Test 17: Super Admin Overview & Customer Attribution Verification
  console.log('\n--- Test 17: Admin Overview & Customer Attribution Ledger ---');
  const adminOverview = await getAdminReferralOverview();
  assert(adminOverview.totalCommissionsGenerated >= 22.0, 'Admin overview must reflect total commissions');
  assert(adminOverview.totalPaidWithdrawals >= 12.0, 'Admin overview must reflect paid withdrawals');

  const adminWithdrawals = await getAdminWithdrawalRequests();
  const matched = adminWithdrawals.find((w) => w.id === wth3.id);
  assert(matched, 'Admin withdrawal list must contain the withdrawal');
  assert(matched.associatedCustomers && matched.associatedCustomers.length > 0, 'Associated customers must be mapped');
  console.log(`✓ Admin overview & associated customers verified (${matched.associatedCustomers?.length} customer purchases tracked)`);

  console.log('\n=== ALL REFERRAL, COMMISSION & WITHDRAWAL TESTS PASSED SUCCESSFULLY! ===');
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
