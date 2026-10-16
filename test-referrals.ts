import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { db, hashPassword } from './server/db.ts';
import { handleApiRoute } from './server/api.ts';
import { approvePaymentOrder, rejectPaymentOrder } from './server/paymentApproval.ts';
import { runMigration } from './server/db/migrate.ts';
import { query } from './server/db/connection.ts';
import {
  backfillReferralCodes,
  getUserReferralSummary,
} from './server/referrals.ts';

console.log('=== STARTING PULSEVANGUARD REFERRAL, COMMISSION WALLET & WITHDRAWAL TEST SUITE ===');

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
      host: 'pulsevanguard.io',
      'x-forwarded-proto': 'https',
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

async function runReferralTests() {
  const dbJsonPath = path.join(process.cwd(), 'data', 'pulsevanguard.db.json');
  const backupJson = fs.existsSync(dbJsonPath) ? fs.readFileSync(dbJsonPath, 'utf8') : null;

  try {
    await db.ensureSchema();
    await runMigration({ force: true });

    // Prepare Super Admin (mobinalavi7491@gmail.com) session
    const superAdmin = db.findUserByEmail('mobinalavi7491@gmail.com')!;
    assert(superAdmin, 'Super admin mobinalavi7491@gmail.com must exist');
    assert.equal(superAdmin.role, 'super_admin');
    superAdmin.passwordHash = hashPassword('SuperAdmin2026!');
    db.persist();

    const adminLogin = await executeRoute('POST', '/api/auth/login', {
      email: 'mobinalavi7491@gmail.com',
      password: 'SuperAdmin2026!',
    });
    assert.equal(adminLogin.statusCode, 200);
    const superAdminToken = adminLogin.data.token;

    // -------------------------------------------------------------
    // Test 1: New user registration generates a unique referral code
    // -------------------------------------------------------------
    console.log('\n--- Test 1: New user registration generates a unique referral code ---');
    const referrerEmail = `referrer_${Date.now()}@example.com`;
    const regReferrer = await executeRoute('POST', '/api/auth/register', {
      name: 'Alice Referrer',
      email: referrerEmail,
      password: 'Password123!',
      orgName: 'Alice Agency',
    });
    assert.equal(regReferrer.statusCode, 201, 'Referrer registration must succeed');
    const referrerUser = regReferrer.data.user;
    const referrerToken = regReferrer.data.token;
    assert(referrerUser.referralCode, 'Registered user must have a non-empty referralCode');
    assert(referrerUser.referralCode.startsWith('PV'), 'Referral code should start with PV prefix');

    // Verify profile summary endpoint returns referral code and dynamic domain referral URL
    const profileRes = await executeRoute('GET', '/api/referrals/me', undefined, {
      authorization: `Bearer ${referrerToken}`,
    });
    assert.equal(profileRes.statusCode, 200);
    assert.equal(profileRes.data.referralCode, referrerUser.referralCode);
    assert(
      profileRes.data.referralUrl.includes(`/register?ref=${referrerUser.referralCode}`),
      'Referral URL must include /register?ref=USER_CODE'
    );
    console.log(`✓ Test 1 Passed: Generated unique code ${referrerUser.referralCode} and URL ${profileRes.data.referralUrl}`);

    // -------------------------------------------------------------
    // Test 2: Existing users without referral codes receive unique codes safely
    // -------------------------------------------------------------
    console.log('\n--- Test 2: Existing users without referral codes receive unique codes safely ---');
    await query(`UPDATE users SET referral_code = NULL WHERE id = $1`, [referrerUser.id]);
    const memReferrer = db.findUserById(referrerUser.id)!;
    delete memReferrer.referralCode;

    await backfillReferralCodes();
    const pgCheck = await query(`SELECT referral_code FROM users WHERE id = $1`, [referrerUser.id]);
    assert(pgCheck.rows[0]?.referral_code, 'Backfill must assign a unique referral code in PostgreSQL');
    assert(memReferrer.referralCode, 'Backfill must sync referralCode in memory');
    // Restore original code for subsequent tests
    const activeReferralCode = memReferrer.referralCode!;
    console.log(`✓ Test 2 Passed: Backfill safely assigned code ${activeReferralCode}`);

    // -------------------------------------------------------------
    // Test 3: Registration with an invalid referral code fails cleanly
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Registration with an invalid referral code fails cleanly ---');
    const badReg = await executeRoute('POST', '/api/auth/register', {
      name: 'Invalid Code User',
      email: `invalid_ref_${Date.now()}@example.com`,
      password: 'Password123!',
      referralCode: 'PV-NONEXISTENT999',
    });
    assert.equal(badReg.statusCode, 400, 'Registration with invalid referral code must return 400');
    assert(
      badReg.data.error.toLowerCase().includes('invalid') ||
        badReg.data.error.toLowerCase().includes('unrecognized'),
      'Error message must clearly state referral code is invalid'
    );
    console.log(`✓ Test 3 Passed: Invalid referral code rejected with message: "${badReg.data.error}"`);

    // -------------------------------------------------------------
    // Test 4: Self-referral is rejected during registration & apply
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Self-referral is rejected ---');
    const selfApply = await executeRoute(
      'POST',
      '/api/referrals/apply',
      { referralCode: activeReferralCode },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(selfApply.statusCode, 400, 'Applying own referral code must return 400');
    assert(
      selfApply.data.error.toLowerCase().includes('cannot refer yourself') ||
        selfApply.data.error.toLowerCase().includes('own'),
      'Self-referral error message must be clear'
    );
    console.log(`✓ Test 4 Passed: Self-referral rejected: "${selfApply.data.error}"`);

    // -------------------------------------------------------------
    // Test 5: Registration with a valid referral code links the referred user to the referrer
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Registration with a valid referral code links referred user to referrer ---');
    const customer1Email = `customer1_${Date.now()}@example.com`;
    const regCustomer1 = await executeRoute('POST', '/api/auth/register', {
      name: 'Bob Referred Customer 1',
      email: customer1Email,
      password: 'Password123!',
      orgName: 'Bob Corp',
      referralCode: activeReferralCode,
    });
    assert.equal(regCustomer1.statusCode, 201, 'Registration with valid referral code must succeed');
    const customer1User = regCustomer1.data.user;
    const customer1Token = regCustomer1.data.token;
    assert.equal(customer1User.referredByUserId, referrerUser.id);
    assert.equal(customer1User.referredByCode, activeReferralCode);

    // Verify permanent storage in PostgreSQL
    const cust1Pg = await query(
      `SELECT referred_by_user_id, referred_by_code FROM users WHERE id = $1`,
      [customer1User.id]
    );
    assert.equal(cust1Pg.rows[0].referred_by_user_id, referrerUser.id);
    assert.equal(cust1Pg.rows[0].referred_by_code, activeReferralCode);
    console.log(`✓ Test 5 Passed: Customer 1 (${customer1Email}) permanently linked to referrer ${referrerUser.id}`);

    // -------------------------------------------------------------
    // Test 6: Applying a referral code at checkout works only when no referrer is already assigned
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Applying referral code at checkout & preventing referrer changes ---');
    // Customer 1 already has a referrer -> trying to apply a different referral code must fail
    const secondReferrerReg = await executeRoute('POST', '/api/auth/register', {
      name: 'Second Referrer',
      email: `referrer2_${Date.now()}@example.com`,
      password: 'Password123!',
    });
    const secondReferralCode = secondReferrerReg.data.user.referralCode;

    const changeRefAttempt = await executeRoute(
      'POST',
      '/api/referrals/apply',
      { referralCode: secondReferralCode },
      { authorization: `Bearer ${customer1Token}` }
    );
    assert.equal(changeRefAttempt.statusCode, 400, 'Changing already assigned referrer must be rejected');

    // Register Customer 2 WITHOUT a referral code, then apply activeReferralCode at checkout
    const customer2Email = `customer2_${Date.now()}@example.com`;
    const regCustomer2 = await executeRoute('POST', '/api/auth/register', {
      name: 'Charlie Checkout Customer 2',
      email: customer2Email,
      password: 'Password123!',
    });
    assert.equal(regCustomer2.statusCode, 201);
    const customer2Token = regCustomer2.data.token;
    assert(!regCustomer2.data.user.referredByUserId, 'Customer 2 starts without a referrer');

    // Create $50 annual order while passing referralCode at checkout
    const createOrderCust2 = await executeRoute(
      'POST',
      '/api/crypto/create-order',
      { planId: 'pro', interval: 'annual', referralCode: activeReferralCode },
      { authorization: `Bearer ${customer2Token}` }
    );
    assert.equal(createOrderCust2.statusCode, 201, 'Checkout with valid referral code must succeed');
    const order50 = createOrderCust2.data.order;
    assert.equal(order50.amount, 50);
    assert.equal(order50.referrerUserId, referrerUser.id);
    assert.equal(order50.referralCode, activeReferralCode);
    console.log('✓ Test 6 Passed: Checkout referral code linked Customer 2 and blocked changing existing referrer');

    // -------------------------------------------------------------
    // Test 7: Pending, rejected, or failed payments credit $0
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Pending, rejected, or failed payments credit $0 ---');
    // Create $5 monthly order for Customer 1 (remains Pending)
    const createPendingOrder = await executeRoute(
      'POST',
      '/api/crypto/create-order',
      { planId: 'pro', interval: 'monthly' },
      { authorization: `Bearer ${customer1Token}` }
    );
    assert.equal(createPendingOrder.statusCode, 201);
    const pendingOrder = createPendingOrder.data.order;

    // Check referrer wallet while both orders are Pending
    let summaryBeforeApproval = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryBeforeApproval.totalCommissionsEarned, 0, 'Pending orders must credit $0');
    assert.equal(summaryBeforeApproval.availableBalance, 0, 'Available balance must be $0 for pending orders');

    // Reject pendingOrder and verify $0 commission
    await rejectPaymentOrder(
      pendingOrder.id,
      { id: superAdmin.id, email: superAdmin.email, role: 'super_admin' },
      'Test rejection'
    );
    summaryBeforeApproval = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryBeforeApproval.totalCommissionsEarned, 0, 'Rejected order must credit $0');
    console.log('✓ Test 7 Passed: Pending and rejected orders credit $0 commission');

    // -------------------------------------------------------------
    // Test 8: Approved $5 payment for a referred user credits $2 to the referrer
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Approved $5 payment credits $2 (40%) to referrer ---');
    const createOrder5 = await executeRoute(
      'POST',
      '/api/crypto/create-order',
      { planId: 'pro', interval: 'monthly' },
      { authorization: `Bearer ${customer1Token}` }
    );
    assert.equal(createOrder5.statusCode, 201);
    const order5 = createOrder5.data.order;
    assert.equal(order5.amount, 5);

    const approve5Res = await executeRoute(
      'POST',
      `/api/admin/crypto/orders/${order5.id}/approve`,
      {},
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(approve5Res.statusCode, 200);
    assert.equal(approve5Res.data.order.status, 'Paid');

    const summaryAfter5 = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfter5.totalCommissionsEarned, 2, '$5 plan must credit $2 commission');
    assert.equal(summaryAfter5.availableBalance, 2, 'Available balance must be $2');
    assert.equal(summaryAfter5.totalEligiblePurchases, 1);
    console.log('✓ Test 8 Passed: Approved $5 order credited $2.00 USD to referrer wallet');

    // -------------------------------------------------------------
    // Test 9: Approved $50 payment for a referred user credits $20 to the referrer
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Approved $50 payment credits $20 (40%) to referrer ---');
    const approve50Res = await executeRoute(
      'POST',
      `/api/admin/crypto/orders/${order50.id}/approve`,
      {},
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(approve50Res.statusCode, 200);
    assert.equal(approve50Res.data.order.status, 'Paid');

    const summaryAfter50 = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfter50.totalCommissionsEarned, 22, 'Total commissions must be $2 + $20 = $22');
    assert.equal(summaryAfter50.availableBalance, 22, 'Available balance must be $22');
    assert.equal(summaryAfter50.totalEligiblePurchases, 2);
    console.log('✓ Test 9 Passed: Approved $50 order credited $20.00 USD (Total balance: $22.00 USD)');

    // -------------------------------------------------------------
    // Test 10: Duplicate payment approval / webhook retry does not credit commission twice
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Idempotency on duplicate payment approval / webhook retry ---');
    const retryApprove = await approvePaymentOrder(order50.id, {
      id: superAdmin.id,
      email: superAdmin.email,
      role: 'super_admin',
    });
    assert.equal(retryApprove.alreadyApproved, true);

    const apiRetryApprove = await executeRoute(
      'POST',
      `/api/admin/crypto/orders/${order50.id}/approve`,
      {},
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(apiRetryApprove.statusCode, 200);
    assert.equal(apiRetryApprove.data.alreadyApproved, true);

    const summaryAfterRetry = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfterRetry.totalCommissionsEarned, 22, 'Balance must remain $22 after duplicate retries');
    assert.equal(summaryAfterRetry.commissions.length, 2, 'Exactly 2 commission records must exist');
    console.log('✓ Test 10 Passed: Duplicate payment approval is 100% idempotent');

    // -------------------------------------------------------------
    // Test 11: User's own purchase does not generate a referral commission
    // -------------------------------------------------------------
    console.log('\n--- Test 11: User own purchase does not generate commission ---');
    const ownOrderRes = await executeRoute(
      'POST',
      '/api/crypto/create-order',
      { planId: 'pro', interval: 'monthly' },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(ownOrderRes.statusCode, 201);
    await approvePaymentOrder(ownOrderRes.data.order.id, {
      id: superAdmin.id,
      email: superAdmin.email,
      role: 'super_admin',
    });
    const summaryAfterOwnPurchase = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfterOwnPurchase.totalCommissionsEarned, 22, 'Own purchase must not generate commission');
    console.log('✓ Test 11 Passed: Self-purchase did not generate any referral commission');

    // -------------------------------------------------------------
    // Test 12: Withdrawal below $4 is rejected
    // -------------------------------------------------------------
    console.log('\n--- Test 12: Withdrawal below $4 is rejected ---');
    const validTrc20Wallet = 'TNPeeaaFB7K9cmo4uQpcU32zGK8G1NYqeL';
    const lowWithdraw = await executeRoute(
      'POST',
      '/api/withdrawals',
      { amount: 3.5, walletAddress: validTrc20Wallet },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(lowWithdraw.statusCode, 400, 'Withdrawal < $4 must return 400');
    assert(lowWithdraw.data.error.includes('$4'), 'Error must mention $4 minimum');

    const negativeWithdraw = await executeRoute(
      'POST',
      '/api/withdrawals',
      { amount: -5, walletAddress: validTrc20Wallet },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(negativeWithdraw.statusCode, 400, 'Negative withdrawal must return 400');
    console.log('✓ Test 12 Passed: Withdrawals below $4 or negative/zero are rejected');

    // -------------------------------------------------------------
    // Test 13: Withdrawal above available balance is rejected
    // -------------------------------------------------------------
    console.log('\n--- Test 13: Withdrawal above available balance is rejected ---');
    const excessiveWithdraw = await executeRoute(
      'POST',
      '/api/withdrawals',
      { amount: 25, walletAddress: validTrc20Wallet },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(excessiveWithdraw.statusCode, 400, 'Withdrawal > available balance ($22) must return 400');
    console.log('✓ Test 13 Passed: Withdrawal exceeding available balance ($25 > $22) rejected');

    // -------------------------------------------------------------
    // Test 14: Invalid TRON/TRC20 wallet address is rejected
    // -------------------------------------------------------------
    console.log('\n--- Test 14: Invalid TRON/TRC20 wallet address is rejected ---');
    const ethWalletAttempt = await executeRoute(
      'POST',
      '/api/withdrawals',
      { amount: 5, walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(ethWalletAttempt.statusCode, 400, 'Non-TRON address must be rejected');

    const contractAddrAttempt = await executeRoute(
      'POST',
      '/api/withdrawals',
      { amount: 5, walletAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(contractAddrAttempt.statusCode, 400, 'USDT smart contract address must be rejected');
    console.log('✓ Test 14 Passed: Malformed and contract TRC20 wallet addresses rejected');

    // -------------------------------------------------------------
    // Test 15: Pending withdrawal reserves balance and prevents double-withdrawal
    // -------------------------------------------------------------
    console.log('\n--- Test 15: Pending withdrawal atomically reserves funds and prevents double-spending ---');
    // Request $15 withdrawal out of $22 available
    const withdraw1Res = await executeRoute(
      'POST',
      '/api/withdrawals',
      { amount: 15, walletAddress: validTrc20Wallet },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(withdraw1Res.statusCode, 201, 'Valid $15 withdrawal request must succeed');
    const withdrawal1 = withdraw1Res.data.withdrawal;
    assert.equal(withdrawal1.status, 'pending');
    assert.equal(withdrawal1.amount, 15);
    assert.equal(withdrawal1.availableBalanceBefore, 22);
    assert.equal(withdrawal1.network, 'USDT — TRC20 (TRON)');

    const summaryAfterReserve = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfterReserve.availableBalance, 7, 'Available balance must drop from $22 to $7');
    assert.equal(summaryAfterReserve.reservedBalance, 15, 'Reserved balance must increase to $15');
    assert.equal(summaryAfterReserve.withdrawnBalance, 0, 'Withdrawn balance remains $0 while pending');

    // Try to withdraw another $10 (exceeds remaining $7 available balance)
    const doubleSpendAttempt = await executeRoute(
      'POST',
      '/api/withdrawals',
      { amount: 10, walletAddress: validTrc20Wallet },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(doubleSpendAttempt.statusCode, 400, 'Second withdrawal exceeding unreserved balance ($7) must fail');

    // Submit a second valid withdrawal of $5 (from remaining $7 available -> leaves $2 available, $20 reserved)
    const withdraw2Res = await executeRoute(
      'POST',
      '/api/withdrawals',
      { amount: 5, walletAddress: validTrc20Wallet },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(withdraw2Res.statusCode, 201);
    const withdrawal2 = withdraw2Res.data.withdrawal;
    console.log('✓ Test 15 Passed: Atomic reservation locked funds and prevented double withdrawal');

    // -------------------------------------------------------------
    // Test 16: Admin "Approve for Payout" keeps funds reserved and updates status to approved
    // -------------------------------------------------------------
    console.log('\n--- Test 16: Admin Approve for Payout keeps funds reserved and sets status to approved ---');
    const adminApproveRes = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal1.id}/approve`,
      {},
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(adminApproveRes.statusCode, 200);
    assert.equal(adminApproveRes.data.withdrawal.status, 'approved');
    assert.equal(adminApproveRes.data.withdrawal.approvedByEmail, 'mobinalavi7491@gmail.com');

    const summaryAfterAdminApprove = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfterAdminApprove.availableBalance, 2, 'Available balance remains $2');
    assert.equal(summaryAfterAdminApprove.reservedBalance, 20, 'Funds ($15 + $5 = $20) remain reserved after Approve for Payout');
    assert.equal(summaryAfterAdminApprove.withdrawnBalance, 0, 'Not marked as paid yet');
    console.log('✓ Test 16 Passed: Approve for Payout set status to approved while keeping funds reserved');

    // -------------------------------------------------------------
    // Test 17: Admin "Mark as Paid" requires transaction hash and finalizes the withdrawal
    // -------------------------------------------------------------
    console.log('\n--- Test 17: Admin Mark as Paid requires txHash and finalizes debit ---');
    // Calling mark-paid without txHash must fail
    const missingTxRes = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal1.id}/mark-paid`,
      { txHash: '' },
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(missingTxRes.statusCode, 400, 'Mark as Paid without txHash must return 400');

    const validTronTxHash = '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e';
    const markPaidRes = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal1.id}/mark-paid`,
      { txHash: validTronTxHash },
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(markPaidRes.statusCode, 200);
    assert.equal(markPaidRes.data.withdrawal.status, 'paid');
    assert.equal(markPaidRes.data.withdrawal.txHash, validTronTxHash);

    const summaryAfterPaid = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfterPaid.availableBalance, 2, 'Available balance is $2');
    assert.equal(summaryAfterPaid.reservedBalance, 5, 'Reserved balance reduced from $20 to $5');
    assert.equal(summaryAfterPaid.withdrawnBalance, 15, 'Withdrawn balance increased to $15');

    // Duplicate mark-paid call must be idempotent and not deduct twice
    const duplicateMarkPaid = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal1.id}/mark-paid`,
      { txHash: validTronTxHash },
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(duplicateMarkPaid.statusCode, 200);
    assert.equal(duplicateMarkPaid.data.alreadyPaid, true);
    const summaryAfterDupPaid = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfterDupPaid.withdrawnBalance, 15, 'No duplicate balance deduction');
    console.log('✓ Test 17 Passed: Mark as Paid verified txHash, finalized $15 payout, and prevented duplicate deduction');

    // -------------------------------------------------------------
    // Test 18: Admin "Reject Withdrawal" releases reserved balance back to available balance once
    // -------------------------------------------------------------
    console.log('\n--- Test 18: Admin Reject Withdrawal releases reserved funds back to available balance once ---');
    const rejectRes = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal2.id}/reject`,
      { reason: 'Verification test rejection' },
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(rejectRes.statusCode, 200);
    assert.equal(rejectRes.data.withdrawal.status, 'rejected');
    assert.equal(rejectRes.data.withdrawal.rejectionReason, 'Verification test rejection');

    const summaryAfterReject = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfterReject.availableBalance, 7, 'Available balance restored from $2 to $7 ($2 + $5 released)');
    assert.equal(summaryAfterReject.reservedBalance, 0, 'Reserved balance is now $0');
    assert.equal(summaryAfterReject.withdrawnBalance, 15, 'Withdrawn balance remains $15');

    // Calling reject again must be idempotent and not release funds a second time
    const duplicateReject = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal2.id}/reject`,
      { reason: 'Duplicate reject attempt' },
      { authorization: `Bearer ${superAdminToken}` }
    );
    assert.equal(duplicateReject.statusCode, 200);
    assert.equal(duplicateReject.data.alreadyRejected, true);
    const summaryAfterDupReject = await getUserReferralSummary(referrerUser.id);
    assert.equal(summaryAfterDupReject.availableBalance, 7, 'Available balance must not be credited twice');
    console.log('✓ Test 18 Passed: Reject Withdrawal returned $5.00 to available balance exactly once');

    // -------------------------------------------------------------
    // Test 19: Non-admin users receive 403 Forbidden on admin withdrawal endpoints
    // -------------------------------------------------------------
    console.log('\n--- Test 19: Non-admin users receive 403 Forbidden on admin withdrawal endpoints ---');
    const userListAttempt = await executeRoute('GET', '/api/admin/withdrawals', undefined, {
      authorization: `Bearer ${referrerToken}`,
    });
    assert.equal(userListAttempt.statusCode, 403);

    const userApproveOwnAttempt = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal2.id}/approve`,
      {},
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(userApproveOwnAttempt.statusCode, 403);

    const userMarkPaidOwnAttempt = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal2.id}/mark-paid`,
      { txHash: validTronTxHash },
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(userMarkPaidOwnAttempt.statusCode, 403);

    const userRejectOwnAttempt = await executeRoute(
      'POST',
      `/api/admin/withdrawals/${withdrawal2.id}/reject`,
      {},
      { authorization: `Bearer ${referrerToken}` }
    );
    assert.equal(userRejectOwnAttempt.statusCode, 403);

    // Also verify Admin Withdrawals list includes referred customer emails for Super Admin
    const adminWithdrawalsList = await executeRoute('GET', '/api/admin/withdrawals', undefined, {
      authorization: `Bearer ${superAdminToken}`,
    });
    assert.equal(adminWithdrawalsList.statusCode, 200);
    const foundW1 = adminWithdrawalsList.data.requests.find((r: any) => r.id === withdrawal1.id);
    assert(foundW1, 'Super Admin must see withdrawal request in list');
    assert(
      Array.isArray(foundW1.referredCustomers) && foundW1.referredCustomers.length >= 2,
      'Admin withdrawal record must include associated referred customers list'
    );
    console.log('✓ Test 19 Passed: Non-admin users receive 403 Forbidden and Super Admin sees full audit & customer details');

    console.log('\n====================================================================');
    console.log('🎉 ALL 19 REFERRAL, WALLET & WITHDRAWAL TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('====================================================================\n');
  } finally {
    // Restore original JSON snapshot so temporary test accounts do not pollute data/pulsevanguard.db.json
    if (backupJson !== null) {
      fs.writeFileSync(dbJsonPath, backupJson, 'utf8');
    }
  }
}

runReferralTests().catch((err) => {
  console.error('❌ Referral Test Suite Failed:', err);
  process.exit(1);
});
