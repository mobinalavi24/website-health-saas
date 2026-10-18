import crypto from 'node:crypto';
import type pg from 'pg';
import { query, withTransaction } from './db/connection.ts';
import { db, type CryptoPaymentOrder } from './db.ts';

// 32-character set without visually ambiguous 0/O, 1/I
const REFERRAL_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generates an 8-character unique referral code with 'PV' prefix (e.g. PV8K2M9X).
 */
export function generateReferralCode(): string {
  let result = 'PV';
  for (let i = 0; i < 6; i++) {
    result += REFERRAL_CODE_ALPHABET.charAt(Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length));
  }
  return result;
}

/**
 * Validates TRON TRC20 address format:
 * - Starts with 'T'
 * - Exactly 34 characters
 * - Valid Base58 character set
 * - Not an obviously bogus repeating sequence
 */
export function isValidTrc20Address(address: string): boolean {
  if (typeof address !== 'string') return false;
  const clean = address.trim();
  if (clean.length !== 34) return false;
  if (!clean.startsWith('T')) return false;
  const tronRegex = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
  if (!tronRegex.test(clean)) return false;
  // Reject repetitive placeholder addresses (e.g. T111111111111111111111111111111111)
  if (/^T(.)\1{32}$/.test(clean)) return false;
  return true;
}

export interface ReferralWalletRecord {
  userId: string;
  balanceCents: number;
  reservedCents: number;
  paidCents: number;
  totalEarnedCents: number;
  updatedAt: string;
}

export interface ReferralCommissionRecord {
  id: string;
  orderId: string;
  referrerId: string;
  referredUserId: string;
  referredUserEmail?: string;
  referralCode: string;
  planId: string;
  planName: string;
  orderAmountCents: number;
  commissionAmountCents: number;
  commissionRate: number;
  currency: string;
  status: string;
  createdAt: string;
}

export interface WithdrawalRequestRecord {
  id: string;
  userId: string;
  userEmail?: string;
  referralCode?: string;
  amountCents: number;
  currency: string;
  trc20Address: string;
  network: string;
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled';
  balanceBeforeCents: number;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  paidBy?: string | null;
  paidAt?: string | null;
  payoutTxId?: string | null;
  createdAt: string;
  updatedAt: string;
  associatedCustomers?: Array<{
    userId: string;
    email: string;
    planName: string;
    commissionCents: number;
    orderId: string;
    createdAt: string;
  }>;
}

export interface UserReferralProfile {
  referralCode: string;
  referralUrl: string;
  totalReferrals: number;
  totalEligiblePurchases: number;
  totalCommissionsEarned: number;
  availableBalance: number;
  reservedBalance: number;
  totalWithdrawn: number;
  commissions: ReferralCommissionRecord[];
  withdrawals: WithdrawalRequestRecord[];
}

export interface AdminReferralOverview {
  totalCommissionsGenerated: number;
  totalAvailableLiabilities: number;
  totalFundsReserved: number;
  pendingWithdrawalsCount: number;
  totalPaidWithdrawals: number;
  totalRejectedCount: number;
}

/**
 * Row mappers
 */
export function mapWalletRow(row: any): ReferralWalletRecord {
  return {
    userId: row.user_id,
    balanceCents: parseInt(row.balance_cents || '0', 10),
    reservedCents: parseInt(row.reserved_cents || '0', 10),
    paidCents: parseInt(row.paid_cents || '0', 10),
    totalEarnedCents: parseInt(row.total_earned_cents || '0', 10),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

export function mapCommissionRow(row: any): ReferralCommissionRecord {
  return {
    id: row.id,
    orderId: row.order_id,
    referrerId: row.referrer_id,
    referredUserId: row.referred_user_id,
    referredUserEmail: row.referred_user_email,
    referralCode: row.referral_code,
    planId: row.plan_id,
    planName: row.plan_name,
    orderAmountCents: parseInt(row.order_amount_cents || '0', 10),
    commissionAmountCents: parseInt(row.commission_amount_cents || '0', 10),
    commissionRate: parseFloat(row.commission_rate || '0.40'),
    currency: row.currency || 'USDT',
    status: row.status || 'earned',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

export function mapWithdrawalRow(row: any): WithdrawalRequestRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    referralCode: row.referral_code,
    amountCents: parseInt(row.amount_cents || '0', 10),
    currency: row.currency || 'USDT',
    trc20Address: row.trc20_address,
    network: row.network || 'USDT — TRC20 (TRON)',
    status: row.status,
    balanceBeforeCents: parseInt(row.balance_before_cents || '0', 10),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at).toISOString() : null,
    rejectionReason: row.rejection_reason,
    paidBy: row.paid_by,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    payoutTxId: row.payout_tx_id,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

/**
 * Ensures a user has a unique referral code and wallet record.
 */
export async function ensureUserReferralData(client: pg.PoolClient, userId: string): Promise<string> {
  const userRes = await client.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  let code = userRes.rows[0]?.referral_code;

  if (userRes.rows.length === 0) {
    // If user is not yet in PostgreSQL, sync user and org from in-memory state
    const { db } = await import('./db.ts');
    const memUser = db.findUserById(userId);
    if (memUser) {
      const memOrg = db.findOrgById(memUser.orgId);
      if (memOrg) {
        await client.query(
          `INSERT INTO organizations (id, name, plan_id, billing_interval, currency, owner_id, trial_started_at, trial_ends_at, trial_used, white_label, clients, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            memOrg.id, memOrg.name, memOrg.planId, memOrg.billingInterval, memOrg.currency, memOrg.ownerId,
            memOrg.trialStartedAt, memOrg.trialEndsAt, memOrg.trialUsed, JSON.stringify(memOrg.whiteLabel), JSON.stringify(memOrg.clients), memOrg.createdAt
          ]
        );
      }
      const initialCode = memUser.referralCode || generateReferralCode();
      await client.query(
        `INSERT INTO users (id, email, name, password_hash, role, org_id, avatar_url, email_verified, referral_code, referred_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [
          memUser.id, memUser.email, memUser.name, memUser.passwordHash, memUser.role, memUser.orgId,
          memUser.avatarUrl || null, memUser.emailVerified ?? true, initialCode, memUser.referredBy || null, memUser.createdAt || new Date().toISOString()
        ]
      );
      code = initialCode;
    } else {
      return '';
    }
  }

  if (!code) {
    // Generate unique code
    let isUnique = false;
    let attempts = 0;
    while (!isUnique && attempts < 10) {
      attempts++;
      code = generateReferralCode();
      const check = await client.query('SELECT id FROM users WHERE referral_code = $1', [code]);
      if (check.rows.length === 0) {
        isUnique = true;
      }
    }
    await client.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, userId]);
  }

  // Ensure wallet exists
  await client.query(
    `INSERT INTO referral_wallets (user_id, balance_cents, reserved_cents, paid_cents, total_earned_cents, updated_at)
     VALUES ($1, 0, 0, 0, 0, NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  return code;
}

/**
 * Validates a referral code against eligibility rules:
 * - Code must exist
 * - Cannot refer oneself
 */
export async function validateReferralCode(
  code: string,
  currentUserId?: string
): Promise<{ valid: boolean; message: string; referrer?: { id: string; email: string; name: string } }> {
  if (!code || typeof code !== 'string') {
    return { valid: false, message: 'Referral code cannot be empty.' };
  }
  const cleanCode = code.trim().toUpperCase();
  if (cleanCode.length < 4 || cleanCode.length > 20) {
    return { valid: false, message: 'Invalid referral code format.' };
  }

  const res = await query('SELECT id, email, name FROM users WHERE UPPER(referral_code) = $1 LIMIT 1', [cleanCode]);
  let referrer = res.rows[0];
  if (!referrer) {
    const memUser = db.getUsers().find((u) => (u.referralCode || '').toUpperCase() === cleanCode);
    if (memUser) {
      referrer = { id: memUser.id, email: memUser.email, name: memUser.name };
    }
  }

  if (!referrer) {
    return { valid: false, message: 'Referral code not found or expired.' };
  }

  if (currentUserId && referrer.id === currentUserId) {
    return { valid: false, message: 'You cannot refer yourself.' };
  }

  return {
    valid: true,
    message: 'Valid referral code',
    referrer: {
      id: referrer.id,
      email: referrer.email,
      name: referrer.name,
    },
  };
}

/**
 * Applies a referral code to a user if they do not already have a permanent referrer.
 */
export async function applyReferralCodeToUser(
  userId: string,
  referralCode: string
): Promise<{ success: boolean; message: string; referrerName?: string }> {
  return await withTransaction(async (client) => {
    const userRes = await client.query('SELECT id, referred_by FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (userRes.rows.length === 0) {
      throw new Error('User account not found.');
    }
    const user = userRes.rows[0];
    if (user.referred_by) {
      throw new Error('A referral code has already been permanently assigned to this account.');
    }

    const val = await validateReferralCode(referralCode, userId);
    if (!val.valid || !val.referrer) {
      throw new Error(val.message);
    }

    await client.query('UPDATE users SET referred_by = $1 WHERE id = $2', [val.referrer.id, userId]);

    // Also update runtime db if present
    const inMemUser = db.getUsers().find((u) => u.id === userId);
    if (inMemUser) {
      (inMemUser as any).referredBy = val.referrer.id;
      db.persist();
    }

    return {
      success: true,
      message: `Referral code successfully applied! Referred by ${val.referrer.name}.`,
      referrerName: val.referrer.name,
    };
  });
}

/**
 * Calculates 40% referral commission on eligible approved subscription purchase:
 * - $5 plan -> $2.00 commission (200 cents)
 * - $50 plan -> $20.00 commission (2000 cents)
 */
export function calculateCommissionCents(order: { plan_id: string; billing_interval: string; amount: any }): {
  orderAmountCents: number;
  commissionCents: number;
} {
  const planId = order.plan_id;
  const interval = order.billing_interval;

  if (planId === 'pro') {
    if (interval === 'annual') {
      return { orderAmountCents: 5000, commissionCents: 2000 };
    }
    return { orderAmountCents: 500, commissionCents: 200 };
  }

  const rawAmount = parseFloat(order.amount) || 0;
  const orderAmountCents = Math.round(rawAmount * 100);
  const commissionCents = Math.round(orderAmountCents * 0.40);
  return { orderAmountCents, commissionCents };
}

/**
 * Atomically credits a referral commission to the referrer's wallet.
 * Strictly idempotent: unique constraint on order_id ensures one commission per eligible payment.
 */
export async function creditReferralCommissionInTransaction(
  client: pg.PoolClient,
  orderRow: {
    id: string;
    user_id: string;
    plan_id: string;
    plan_name: string;
    billing_interval: string;
    amount: any;
  }
): Promise<ReferralCommissionRecord | null> {
  // 1. Idempotency check: see if commission already processed for this order
  const check = await client.query('SELECT * FROM referral_commissions WHERE order_id = $1', [orderRow.id]);
  if (check.rows.length > 0) {
    return mapCommissionRow(check.rows[0]);
  }

  // 2. Fetch customer and verify referred_by
  const custRes = await client.query('SELECT id, email, referred_by FROM users WHERE id = $1', [orderRow.user_id]);
  if (custRes.rows.length === 0) return null;
  const customer = custRes.rows[0];
  const referrerId = customer.referred_by;

  // No commission if user was not referred or self-referral
  if (!referrerId || referrerId === customer.id) {
    return null;
  }

  // 3. Fetch referrer details
  const refRes = await client.query(
    'SELECT id, email, name, org_id, referral_code FROM users WHERE id = $1 FOR UPDATE',
    [referrerId]
  );
  if (refRes.rows.length === 0) return null;
  const referrer = refRes.rows[0];

  // 4. Calculate 40% commission
  const { orderAmountCents, commissionCents } = calculateCommissionCents(orderRow);
  if (commissionCents <= 0) return null;

  const commissionId = `comm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const referralCode = referrer.referral_code || 'PV-CODE';

  // 5. Insert into referral_commissions (ON CONFLICT DO NOTHING for strict concurrency safety)
  const insertComm = await client.query(
    `INSERT INTO referral_commissions 
     (id, order_id, referrer_id, referred_user_id, referral_code, plan_id, plan_name, order_amount_cents, commission_amount_cents, commission_rate, currency, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0.40, 'USD', 'earned', NOW())
     ON CONFLICT (order_id) DO NOTHING
     RETURNING *`,
    [
      commissionId,
      orderRow.id,
      referrer.id,
      customer.id,
      referralCode,
      orderRow.plan_id,
      orderRow.plan_name,
      orderAmountCents,
      commissionCents,
    ]
  );

  if (insertComm.rows.length === 0) {
    // Another concurrent process inserted it
    return null;
  }

  // 6. Atomically update referrer's wallet
  await client.query(
    `INSERT INTO referral_wallets (user_id, balance_cents, reserved_cents, paid_cents, total_earned_cents, updated_at)
     VALUES ($1, $2, 0, 0, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       balance_cents = referral_wallets.balance_cents + EXCLUDED.balance_cents,
       total_earned_cents = referral_wallets.total_earned_cents + EXCLUDED.total_earned_cents,
       updated_at = NOW()`,
    [referrer.id, commissionCents]
  );

  // 7. Write audit ledger entry
  const ledgerId = `led_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const walletRes = await client.query('SELECT balance_cents, reserved_cents FROM referral_wallets WHERE user_id = $1', [
    referrer.id,
  ]);
  const w = walletRes.rows[0];
  await client.query(
    `INSERT INTO referral_ledger_entries
     (id, wallet_user_id, entry_type, amount_cents, reference_id, balance_after_cents, reserved_after_cents, notes, created_at)
     VALUES ($1, $2, 'COMMISSION_EARNED', $3, $4, $5, $6, $7, NOW())`,
    [
      ledgerId,
      referrer.id,
      commissionCents,
      orderRow.id,
      w.balance_cents,
      w.reserved_cents,
      `40% commission ($${(commissionCents / 100).toFixed(2)}) earned from ${customer.email} on ${orderRow.plan_name}.`,
    ]
  );

  // 8. Create in-app notification in alerts table for referrer's workspace
  if (referrer.org_id) {
    const alertId = `alt_ref_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await client.query(
      `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
       VALUES ($1, $2, 'referral_commission', 'info', 'Referral Commission Earned', $3, false, NOW())`,
      [
        alertId,
        referrer.org_id,
        `You earned a $${(commissionCents / 100).toFixed(2)} USDT commission (40%) from referred customer ${customer.email} on ${orderRow.plan_name}!`,
      ]
    );
  }

  return mapCommissionRow(insertComm.rows[0]);
}

/**
 * Top-level wrapper for crediting commission when an order is completed.
 */
export async function creditReferralCommission(order: CryptoPaymentOrder): Promise<ReferralCommissionRecord | null> {
  return await withTransaction(async (client) => {
    return await creditReferralCommissionInTransaction(client, {
      id: order.id,
      user_id: order.userId,
      plan_id: order.planId,
      plan_name: order.planName,
      billing_interval: order.billingInterval,
      amount: order.amount,
    });
  });
}

/**
 * Retrieves the complete referral profile & wallet for a user.
 */
export async function getUserReferralProfile(userId: string, hostHeader?: string): Promise<UserReferralProfile> {
  return await withTransaction(async (client) => {
    const referralCode = await ensureUserReferralData(client, userId);

    // Fetch wallet
    const wRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1', [userId]);
    const wallet = wRes.rows[0] ? mapWalletRow(wRes.rows[0]) : { balanceCents: 0, reservedCents: 0, paidCents: 0, totalEarnedCents: 0, updatedAt: new Date().toISOString(), userId };

    // Fetch commissions
    const commRes = await client.query(
      `SELECT c.*, u.email as referred_user_email
       FROM referral_commissions c
       LEFT JOIN users u ON u.id = c.referred_user_id
       WHERE c.referrer_id = $1
       ORDER BY c.created_at DESC`,
      [userId]
    );
    const commissions = commRes.rows.map((r) => ({
      ...mapCommissionRow(r),
      referredUserEmail: r.referred_user_email ? maskEmail(r.referred_user_email) : 'Customer',
    }));

    // Fetch withdrawals
    const wthRes = await client.query(
      `SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    const withdrawals = wthRes.rows.map(mapWithdrawalRow);

    // Calculate aggregated metrics
    const totalCommissionsEarned = wallet.totalEarnedCents / 100;
    const availableBalance = wallet.balanceCents / 100;
    const reservedBalance = wallet.reservedCents / 100;
    const totalWithdrawn = wallet.paidCents / 100;

    // Distinct referred users count who made eligible purchases
    const distinctReferredUsers = new Set(commissions.map((c) => c.referredUserId));
    const totalReferrals = distinctReferredUsers.size;

    // Total purchase value from referred users
    const totalEligiblePurchases = commissions.reduce((acc, c) => acc + c.orderAmountCents / 100, 0);

    // Build public referral URL using configured or host domain
    const baseHost = hostHeader || process.env.APP_URL || 'localhost:3000';
    const proto = baseHost.includes('localhost') ? 'http' : 'https';
    const referralUrl = `${proto}://${baseHost}/register?ref=${referralCode}`;

    return {
      referralCode,
      referralUrl,
      totalReferrals,
      totalEligiblePurchases,
      totalCommissionsEarned,
      availableBalance,
      reservedBalance,
      totalWithdrawn,
      commissions,
      withdrawals,
    };
  });
}

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return 'customer@***';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.substring(0, 2)}***${local[local.length - 1]}@${domain}`;
}

/**
 * Creates a withdrawal request with atomic balance reservation:
 * - Minimum $4 USD (400 cents)
 * - Maximum available balance
 * - Valid TRC20 address
 */
export async function createWithdrawalRequest(
  userId: string,
  amountDollars: number,
  trc20Address: string
): Promise<WithdrawalRequestRecord> {
  const cleanAddress = (trc20Address || '').trim();
  if (!isValidTrc20Address(cleanAddress)) {
    throw new Error('Invalid USDT TRC20 destination wallet address. Must be a valid 34-character TRON address starting with "T".');
  }

  if (typeof amountDollars !== 'number' || isNaN(amountDollars) || !isFinite(amountDollars)) {
    throw new Error('Invalid withdrawal amount specified.');
  }

  const amountCents = Math.round(amountDollars * 100);
  if (amountCents < 400) {
    throw new Error('Minimum withdrawal amount is $4.00 USD.');
  }

  return await withTransaction(async (client) => {
    // 1. Lock wallet row for update to prevent concurrent overdrawing
    const wRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    if (wRes.rows.length === 0) {
      throw new Error('Referral wallet not initialized.');
    }
    const wallet = mapWalletRow(wRes.rows[0]);

    if (amountCents > wallet.balanceCents) {
      throw new Error(
        `Insufficient referral wallet balance. Requested: $${(amountCents / 100).toFixed(2)}, Available: $${(
          wallet.balanceCents / 100
        ).toFixed(2)}.`
      );
    }

    // 2. Atomically reserve requested amount
    const newBalance = wallet.balanceCents - amountCents;
    const newReserved = wallet.reservedCents + amountCents;

    await client.query(
      `UPDATE referral_wallets
       SET balance_cents = $1,
           reserved_cents = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [newBalance, newReserved, userId]
    );

    // 3. Create withdrawal record
    const withdrawalId = `wth_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const insertRes = await client.query(
      `INSERT INTO withdrawal_requests
       (id, user_id, amount_cents, currency, trc20_address, network, status, balance_before_cents, created_at, updated_at)
       VALUES ($1, $2, $3, 'USD', $4, 'USDT — TRC20 (TRON)', 'pending', $5, NOW(), NOW())
       RETURNING *`,
      [withdrawalId, userId, amountCents, cleanAddress, wallet.balanceCents]
    );

    // 4. Ledger entry for auditability
    const ledgerId = `led_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await client.query(
      `INSERT INTO referral_ledger_entries
       (id, wallet_user_id, entry_type, amount_cents, reference_id, balance_after_cents, reserved_after_cents, notes, created_at)
       VALUES ($1, $2, 'WITHDRAWAL_RESERVED', $3, $4, $5, $6, $7, NOW())`,
      [
        ledgerId,
        userId,
        -amountCents,
        withdrawalId,
        newBalance,
        newReserved,
        `Reserved $${(amountCents / 100).toFixed(2)} for pending TRC20 withdrawal to ${cleanAddress}.`,
      ]
    );

    // 5. Create in-app admin alert for Super Admin
    const userRes = await client.query('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = userRes.rows[0]?.email || 'User';
    const alertId = `alt_wth_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
    await client.query(
      `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
       VALUES ($1, 'org_admin_001', 'withdrawal_request', 'warning', 'New Referral Withdrawal Request', $2, false, NOW())`,
      [
        alertId,
        `${userEmail} submitted a withdrawal request for $${(amountCents / 100).toFixed(2)} USDT (TRC20) to ${cleanAddress}. Awaiting review.`,
      ]
    );

    return mapWithdrawalRow(insertRes.rows[0]);
  });
}

/**
 * Super Admin approves a withdrawal request for payout.
 * Funds remain reserved until payout is executed or rejected.
 */
export async function approveWithdrawalForPayout(
  withdrawalId: string,
  adminUser: { id: string; email: string; role: string }
): Promise<WithdrawalRequestRecord> {
  if (adminUser.role !== 'super_admin' && adminUser.role !== 'admin') {
    throw new Error('Unauthorized: Super Admin authorization required.');
  }

  return await withTransaction(async (client) => {
    const res = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [withdrawalId]);
    if (res.rows.length === 0) {
      throw new Error('Withdrawal request not found.');
    }
    const row = res.rows[0];

    if (row.status === 'approved') {
      return mapWithdrawalRow(row); // Idempotent
    }
    if (row.status !== 'pending') {
      throw new Error(`Cannot approve withdrawal with status "${row.status}".`);
    }

    const updateRes = await client.query(
      `UPDATE withdrawal_requests
       SET status = 'approved',
           approved_by = $2,
           approved_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [withdrawalId, adminUser.email]
    );

    // Send in-app notification to the requesting user
    const userOrgRes = await client.query('SELECT org_id FROM users WHERE id = $1', [row.user_id]);
    if (userOrgRes.rows.length > 0) {
      const alertId = `alt_appr_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await client.query(
        `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
         VALUES ($1, $2, 'withdrawal_approved', 'info', 'Withdrawal Request Approved', $3, false, NOW())`,
        [
          alertId,
          userOrgRes.rows[0].org_id,
          `Your withdrawal request for $${(row.amount_cents / 100).toFixed(2)} USDT (TRC20) has been approved and queued for payout.`,
        ]
      );
    }

    return mapWithdrawalRow(updateRes.rows[0]);
  });
}

/**
 * Super Admin records a completed verified payout with blockchain transaction hash.
 * Atomically deducts reserved amount and marks it as paid.
 */
export async function markWithdrawalAsPaid(
  withdrawalId: string,
  payoutTxId: string,
  adminUser: { id: string; email: string; role: string }
): Promise<WithdrawalRequestRecord> {
  if (adminUser.role !== 'super_admin' && adminUser.role !== 'admin') {
    throw new Error('Unauthorized: Super Admin authorization required.');
  }

  const cleanTxId = (payoutTxId || '').trim();
  if (!cleanTxId || cleanTxId.length < 10) {
    throw new Error('Valid blockchain payout transaction hash (TXID) is required.');
  }

  return await withTransaction(async (client) => {
    // 1. Lock withdrawal request row
    const res = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [withdrawalId]);
    if (res.rows.length === 0) {
      throw new Error('Withdrawal request not found.');
    }
    const row = res.rows[0];

    if (row.status === 'paid') {
      return mapWithdrawalRow(row); // Idempotent
    }
    if (row.status !== 'approved' && row.status !== 'pending') {
      throw new Error(`Cannot complete payout for request with status "${row.status}".`);
    }

    // 2. Lock wallet and move funds from reserved to paid
    const wRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE', [row.user_id]);
    if (wRes.rows.length === 0) {
      throw new Error('Referral wallet not found.');
    }
    const wallet = mapWalletRow(wRes.rows[0]);

    const amountCents = parseInt(row.amount_cents, 10);
    const newReserved = Math.max(0, wallet.reservedCents - amountCents);
    const newPaid = wallet.paidCents + amountCents;

    await client.query(
      `UPDATE referral_wallets
       SET reserved_cents = $1,
           paid_cents = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [newReserved, newPaid, row.user_id]
    );

    // 3. Mark withdrawal as paid
    const updateRes = await client.query(
      `UPDATE withdrawal_requests
       SET status = 'paid',
           paid_by = $2,
           paid_at = NOW(),
           payout_tx_id = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [withdrawalId, adminUser.email, cleanTxId]
    );

    // 4. Ledger entry for completed payout
    const ledgerId = `led_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await client.query(
      `INSERT INTO referral_ledger_entries
       (id, wallet_user_id, entry_type, amount_cents, reference_id, balance_after_cents, reserved_after_cents, notes, created_at)
       VALUES ($1, $2, 'WITHDRAWAL_PAID', $3, $4, $5, $6, $7, NOW())`,
      [
        ledgerId,
        row.user_id,
        amountCents,
        withdrawalId,
        wallet.balanceCents,
        newReserved,
        `Payout of $${(amountCents / 100).toFixed(2)} USDT (TRC20) finalized by ${adminUser.email}. TXID: ${cleanTxId}.`,
      ]
    );

    // 5. In-app alert for user
    const userOrgRes = await client.query('SELECT org_id FROM users WHERE id = $1', [row.user_id]);
    if (userOrgRes.rows.length > 0) {
      const alertId = `alt_paid_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await client.query(
        `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
         VALUES ($1, $2, 'withdrawal_paid', 'info', 'Referral Payout Completed!', $3, false, NOW())`,
        [
          alertId,
          userOrgRes.rows[0].org_id,
          `Your withdrawal of $${(amountCents / 100).toFixed(2)} USDT (TRC20) has been paid! Transaction Hash: ${cleanTxId}.`,
        ]
      );
    }

    return mapWithdrawalRow(updateRes.rows[0]);
  });
}

/**
 * Super Admin rejects a withdrawal request.
 * Releases the reserved funds back to the user's available balance exactly once.
 */
export async function rejectWithdrawalRequest(
  withdrawalId: string,
  reason: string,
  adminUser: { id: string; email: string; role: string }
): Promise<WithdrawalRequestRecord> {
  if (adminUser.role !== 'super_admin' && adminUser.role !== 'admin') {
    throw new Error('Unauthorized: Super Admin authorization required.');
  }

  return await withTransaction(async (client) => {
    const res = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [withdrawalId]);
    if (res.rows.length === 0) {
      throw new Error('Withdrawal request not found.');
    }
    const row = res.rows[0];

    if (row.status === 'rejected') {
      return mapWithdrawalRow(row); // Idempotent
    }
    if (row.status !== 'pending' && row.status !== 'approved') {
      throw new Error(`Cannot reject withdrawal with status "${row.status}".`);
    }

    // 1. Release reserved funds back to user balance
    const wRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE', [row.user_id]);
    if (wRes.rows.length === 0) {
      throw new Error('Referral wallet not found.');
    }
    const wallet = mapWalletRow(wRes.rows[0]);

    const amountCents = parseInt(row.amount_cents, 10);
    const newReserved = Math.max(0, wallet.reservedCents - amountCents);
    const newBalance = wallet.balanceCents + amountCents;

    await client.query(
      `UPDATE referral_wallets
       SET balance_cents = $1,
           reserved_cents = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [newBalance, newReserved, row.user_id]
    );

    // 2. Mark request as rejected
    const cleanReason = (reason || '').trim() || 'Declined by Administrator';
    const updateRes = await client.query(
      `UPDATE withdrawal_requests
       SET status = 'rejected',
           rejected_by = $2,
           rejected_at = NOW(),
           rejection_reason = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [withdrawalId, adminUser.email, cleanReason]
    );

    // 3. Write release ledger entry
    const ledgerId = `led_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await client.query(
      `INSERT INTO referral_ledger_entries
       (id, wallet_user_id, entry_type, amount_cents, reference_id, balance_after_cents, reserved_after_cents, notes, created_at)
       VALUES ($1, $2, 'WITHDRAWAL_RELEASED', $3, $4, $5, $6, $7, NOW())`,
      [
        ledgerId,
        row.user_id,
        amountCents,
        withdrawalId,
        newBalance,
        newReserved,
        `Released $${(amountCents / 100).toFixed(2)} back to available balance. Reason: ${cleanReason}.`,
      ]
    );

    // 4. In-app notification for user
    const userOrgRes = await client.query('SELECT org_id FROM users WHERE id = $1', [row.user_id]);
    if (userOrgRes.rows.length > 0) {
      const alertId = `alt_rej_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`;
      await client.query(
        `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
         VALUES ($1, $2, 'withdrawal_rejected', 'warning', 'Withdrawal Request Declined', $3, false, NOW())`,
        [
          alertId,
          userOrgRes.rows[0].org_id,
          `Your withdrawal request for $${(amountCents / 100).toFixed(2)} USDT (TRC20) was declined. Reason: ${cleanReason}. Funds have been restored to your available balance.`,
        ]
      );
    }

    return mapWithdrawalRow(updateRes.rows[0]);
  });
}

/**
 * Customer cancels their own pending withdrawal.
 */
export async function cancelWithdrawalByCustomer(
  withdrawalId: string,
  userId: string
): Promise<WithdrawalRequestRecord> {
  return await withTransaction(async (client) => {
    const res = await client.query(
      'SELECT * FROM withdrawal_requests WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [withdrawalId, userId]
    );
    if (res.rows.length === 0) {
      throw new Error('Withdrawal request not found.');
    }
    const row = res.rows[0];

    if (row.status !== 'pending') {
      throw new Error(`Cannot cancel withdrawal with status "${row.status}". Only pending requests can be cancelled.`);
    }

    // Release funds back
    const wRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE', [userId]);
    const wallet = mapWalletRow(wRes.rows[0]);

    const amountCents = parseInt(row.amount_cents, 10);
    const newReserved = Math.max(0, wallet.reservedCents - amountCents);
    const newBalance = wallet.balanceCents + amountCents;

    await client.query(
      `UPDATE referral_wallets
       SET balance_cents = $1,
           reserved_cents = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [newBalance, newReserved, userId]
    );

    const updateRes = await client.query(
      `UPDATE withdrawal_requests
       SET status = 'cancelled',
           rejection_reason = 'Cancelled by user',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [withdrawalId]
    );

    return mapWithdrawalRow(updateRes.rows[0]);
  });
}

/**
 * Super Admin overview metrics across the entire platform.
 */
export async function getAdminReferralOverview(): Promise<AdminReferralOverview> {
  const commRes = await query(`SELECT COALESCE(SUM(commission_amount_cents), 0) as total_comm FROM referral_commissions`);
  const totalCommissionsGenerated = parseInt(commRes.rows[0]?.total_comm || '0', 10) / 100;

  const wallRes = await query(
    `SELECT COALESCE(SUM(balance_cents), 0) as total_balance,
            COALESCE(SUM(reserved_cents), 0) as total_reserved,
            COALESCE(SUM(paid_cents), 0) as total_paid
     FROM referral_wallets`
  );
  const totalAvailableLiabilities = parseInt(wallRes.rows[0]?.total_balance || '0', 10) / 100;
  const totalFundsReserved = parseInt(wallRes.rows[0]?.total_reserved || '0', 10) / 100;
  const totalPaidWithdrawals = parseInt(wallRes.rows[0]?.total_paid || '0', 10) / 100;

  const countRes = await query(
    `SELECT 
       COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
       COUNT(*) FILTER (WHERE status = 'rejected') as rejected_count
     FROM withdrawal_requests`
  );
  const pendingWithdrawalsCount = parseInt(countRes.rows[0]?.pending_count || '0', 10);
  const totalRejectedCount = parseInt(countRes.rows[0]?.rejected_count || '0', 10);

  return {
    totalCommissionsGenerated,
    totalAvailableLiabilities,
    totalFundsReserved,
    pendingWithdrawalsCount,
    totalPaidWithdrawals,
    totalRejectedCount,
  };
}

/**
 * Retrieves all withdrawal requests for the Super Admin console,
 * including referrer user details and associated referred customer purchase history.
 */
export async function getAdminWithdrawalRequests(): Promise<WithdrawalRequestRecord[]> {
  const res = await query(
    `SELECT w.*, u.email as user_email, u.referral_code
     FROM withdrawal_requests w
     LEFT JOIN users u ON u.id = w.user_id
     ORDER BY 
       CASE WHEN w.status = 'pending' THEN 1
            WHEN w.status = 'approved' THEN 2
            ELSE 3 END,
       w.created_at DESC`
  );

  const withdrawals = res.rows.map(mapWithdrawalRow);

  // Attach associated referred customer records for each withdrawal's referrer
  for (const w of withdrawals) {
    const custRes = await query(
      `SELECT c.referred_user_id, c.order_id, c.plan_name, c.commission_amount_cents, c.created_at, u.email as customer_email
       FROM referral_commissions c
       LEFT JOIN users u ON u.id = c.referred_user_id
       WHERE c.referrer_id = $1
       ORDER BY c.created_at DESC`,
      [w.userId]
    );

    w.associatedCustomers = custRes.rows.map((r) => ({
      userId: r.referred_user_id,
      email: r.customer_email || 'customer@pulsevanguard.com',
      planName: r.plan_name,
      commissionCents: parseInt(r.commission_amount_cents || '0', 10),
      orderId: r.order_id,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
    }));
  }

  return withdrawals;
}

/**
 * Super Admin retrieves all referral commissions across the platform.
 */
export async function getAdminCommissions(): Promise<ReferralCommissionRecord[]> {
  const res = await query(
    `SELECT c.*, u.email as referrer_email, cu.email as referred_user_email
     FROM referral_commissions c
     LEFT JOIN users u ON u.id = c.referrer_id
     LEFT JOIN users cu ON cu.id = c.referred_user_id
     ORDER BY c.created_at DESC`
  );

  return res.rows.map((r) => ({
    ...mapCommissionRow(r),
    referrerEmail: r.referrer_email,
    referredUserEmail: r.referred_user_email,
  }));
}
