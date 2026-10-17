import crypto from 'node:crypto';
import type pg from 'pg';
import { query, withTransaction } from './db/connection.ts';
import { db, type User, type CryptoPaymentOrder } from './db.ts';
import { TRON_USDT_CONTRACT } from './lbank.ts';

export type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled';

export const COMMISSION_RATE_BPS = 4000; // 40.00%
export const COMMISSION_RATE_PERCENT = 40;
export const MIN_WITHDRAWAL_CENTS = 400; // 4.00 USDT
export const MIN_WITHDRAWAL_USD = 4;
export const PAYOUT_NETWORK_LABEL = 'USDT — TRC20 (TRON)';

export interface ReferralWallet {
  userId: string;
  currency: 'USDT';
  totalEarnedCents: number;
  availableBalanceCents: number;
  reservedBalanceCents: number;
  withdrawnBalanceCents: number;
  totalEarned: number;
  availableBalance: number;
  reservedBalance: number;
  withdrawnBalance: number;
  updatedAt: string;
}

export interface ReferralCommission {
  id: string;
  orderId: string;
  referrerUserId: string;
  referredUserId: string;
  referredUserEmail: string;
  referralCode: string;
  planId: string;
  planName: string;
  purchaseAmountCents: number;
  purchaseAmount: number;
  commissionRateBps: number;
  commissionAmountCents: number;
  commissionAmount: number;
  currency: 'USDT';
  status: 'credited';
  createdAt: string;
}

export interface ReferralWalletLedgerEntry {
  id: string;
  userId: string;
  type: 'commission_credit' | 'withdrawal_reserve' | 'withdrawal_release' | 'withdrawal_paid';
  amountCents: number;
  amount: number;
  currency: 'USDT';
  referenceId: string;
  idempotencyKey: string;
  balanceAfterCents: number;
  balanceAfter: number;
  reservedAfterCents: number;
  reservedAfter: number;
  description: string;
  createdAt: string;
}

export interface ReferredCustomerSummary {
  userId: string;
  email: string;
  name: string;
  orderId?: string;
  planName?: string;
  purchaseAmount?: number;
  commissionAmount?: number;
  createdAt: string;
}

export interface WithdrawalRequestRecord {
  id: string;
  userId: string;
  userEmail: string;
  referralCode: string;
  amountCents: number;
  amount: number;
  currency: 'USDT';
  network: string;
  walletAddress: string;
  status: WithdrawalStatus;
  availableBalanceBeforeCents: number;
  availableBalanceBefore: number;
  approvedById?: string;
  approvedByEmail?: string;
  approvedAt?: string;
  paidById?: string;
  paidByEmail?: string;
  paidAt?: string;
  txHash?: string;
  rejectedById?: string;
  rejectedByEmail?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledById?: string;
  cancelledByEmail?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  referredCustomers?: ReferredCustomerSummary[];
}

export interface UserReferralSummary {
  userId: string;
  email: string;
  referralCode: string;
  referralUrl: string;
  referredByUserId?: string;
  referredByCode?: string;
  referredAt?: string;
  canApplyReferralCode: boolean;
  commissionRatePercent: number;
  minimumWithdrawalAmount: number;
  currency: 'USDT';
  payoutNetwork: string;
  totalSuccessfulReferrals: number;
  totalEligiblePurchases: number;
  totalCommissionsEarned: number;
  availableBalance: number;
  reservedBalance: number;
  withdrawnBalance: number;
  wallet: ReferralWallet;
  commissions: ReferralCommission[];
  withdrawals: WithdrawalRequestRecord[];
  ledger: ReferralWalletLedgerEntry[];
  referredUsers: Array<{
    userId: string;
    email: string;
    name: string;
    joinedAt: string;
    purchasesCount: number;
    totalCommissionGenerated: number;
  }>;
}

export interface AdminReferralOverview {
  totalReferralCommissionsGenerated: number;
  totalReferralCommissionsCount: number;
  totalAvailableReferralLiabilities: number;
  totalReservedForPendingWithdrawals: number;
  pendingWithdrawalRequestsCount: number;
  awaitingReviewCount: number;
  approvedAwaitingPayoutCount: number;
  totalSuccessfullyPaidWithdrawals: number;
  paidWithdrawalsCount: number;
  totalRejectedRequestsCount: number;
  totalRejectedAmount: number;
  totalCancelledRequestsCount: number;
  currency: 'USDT';
}

// Simple sliding-window rate limiter for referral & withdrawal endpoints
const rateLimitBuckets = new Map<string, number[]>();

export function checkReferralRateLimit(key: string, maxRequests = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key) || [];
  const valid = existing.filter((t) => now - t < windowMs);
  if (valid.length >= maxRequests) {
    rateLimitBuckets.set(key, valid);
    return false;
  }
  valid.push(now);
  rateLimitBuckets.set(key, valid);
  return true;
}

export function resetReferralRateLimits(): void {
  rateLimitBuckets.clear();
}

export function centsToUsd(cents: number): number {
  return Number((Math.round(cents) / 100).toFixed(2));
}

export function parseUsdToCents(input: unknown): { valid: boolean; cents: number; error?: string } {
  if (input === null || input === undefined || input === '' || typeof input === 'boolean') {
    return { valid: false, cents: 0, error: 'Please enter a valid withdrawal amount.' };
  }

  const str = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return {
      valid: false,
      cents: 0,
      error: 'Invalid amount format. Amount must be a positive USDT value with at most 2 decimal places.',
    };
  }

  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) {
    return { valid: false, cents: 0, error: 'Withdrawal amount must be greater than 0.00 USDT.' };
  }

  const cents = Math.round(num * 100);
  if (cents <= 0 || cents > 100_000_000) {
    return { valid: false, cents: 0, error: 'Withdrawal amount is out of range.' };
  }

  return { valid: true, cents };
}

/**
 * Validate that a destination wallet address is a plausible TRON (TRC20) address.
 * Note: Format validation verifies TRON Base58 structure (starts with T, 34 chars, Base58 alphabet),
 * and rejects known contract/burn addresses, but does not prove on-chain USDT receptivity.
 */
export function validateTronTrc20Address(address: unknown): { valid: boolean; normalized: string; error?: string } {
  if (!address || typeof address !== 'string') {
    return { valid: false, normalized: '', error: 'USDT TRC20 wallet address is required.' };
  }

  const clean = address.trim();
  if (clean.length !== 34) {
    return {
      valid: false,
      normalized: clean,
      error: 'Invalid TRON (TRC20) address length. A valid TRC20 address must be 34 characters long and start with "T".',
    };
  }

  if (!clean.startsWith('T')) {
    return {
      valid: false,
      normalized: clean,
      error: 'Invalid TRON (TRC20) address prefix. TRON mainnet addresses must start with "T".',
    };
  }

  // Base58 alphabet check (excludes 0, O, I, l)
  const base58Regex = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
  if (!base58Regex.test(clean)) {
    return {
      valid: false,
      normalized: clean,
      error: 'Invalid TRON (TRC20) address format. Contains non-Base58 characters.',
    };
  }

  // Reject trivial repeated characters (e.g. TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT)
  const bodyChars = new Set(clean.slice(1).split(''));
  if (bodyChars.size < 4) {
    return {
      valid: false,
      normalized: clean,
      error: 'Invalid TRON (TRC20) wallet address.',
    };
  }

  // Reject the USDT TRC20 smart contract address itself
  if (clean.toLowerCase() === TRON_USDT_CONTRACT.toLowerCase()) {
    return {
      valid: false,
      normalized: clean,
      error: 'Cannot use the USDT TRC20 token smart contract address as a personal receiving wallet.',
    };
  }

  return { valid: true, normalized: clean };
}

/**
 * Generate a deterministic, readable referral code candidate from a user ID and salt
 */
export function generateReferralCodeCandidate(seed: string, attempt = 0): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Unambiguous uppercase alphanumeric
  const hash = crypto
    .createHash('sha256')
    .update(`pv_ref_2026:${seed}:${attempt}`)
    .digest();

  let code = 'PV';
  for (let i = 0; i < 6; i++) {
    code += alphabet[hash[i] % alphabet.length];
  }
  return code;
}

/**
 * Normalize a referral code string
 */
export function normalizeReferralCode(code: unknown): string {
  if (!code || typeof code !== 'string') return '';
  return code.trim().toUpperCase();
}

/**
 * Resolve the application's configured public domain / origin
 */
export function resolvePublicAppOrigin(reqHost?: string, reqProto?: string): string {
  const configured =
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.VITE_PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL;

  if (configured && configured.trim().startsWith('http')) {
    return configured.trim().replace(/\/+$/, '');
  }

  if (reqHost && reqHost.trim()) {
    const cleanHost = reqHost.trim().replace(/\/+$/, '');
    if (cleanHost.startsWith('http://') || cleanHost.startsWith('https://')) {
      return cleanHost;
    }
    const proto = reqProto || (cleanHost.startsWith('localhost') || cleanHost.startsWith('127.0.0.1') ? 'http' : 'https');
    return `${proto}://${cleanHost}`;
  }

  return 'http://localhost:3000';
}

export function buildReferralUrl(referralCode: string, reqHost?: string, reqProto?: string): string {
  const origin = resolvePublicAppOrigin(reqHost, reqProto);
  return `${origin}/register?ref=${encodeURIComponent(referralCode)}`;
}

/**
 * Ensure all existing users in both PostgreSQL and in-memory db have a unique referral_code
 * and an initialized referral_wallets row.
 */
export async function backfillReferralCodes(): Promise<{ backfilledCount: number }> {
  let backfilledCount = 0;

  await withTransaction(async (client) => {
    const res = await client.query('SELECT id, email, referral_code, referred_by_user_id, referred_by_code, referred_at FROM users ORDER BY created_at ASC');
    const usedCodes = new Set<string>();

    for (const row of res.rows) {
      if (row.referral_code) {
        usedCodes.add(String(row.referral_code).toUpperCase());
      }
    }

    // Also include any codes already present in in-memory db
    for (const u of db.getUsers()) {
      if (u.referralCode) {
        usedCodes.add(u.referralCode.toUpperCase());
      }
    }

    for (const row of res.rows) {
      let code = row.referral_code ? String(row.referral_code).toUpperCase() : '';
      if (!code) {
        let attempt = 0;
        while (true) {
          const candidate = generateReferralCodeCandidate(`${row.id}:${row.email}`, attempt);
          if (!usedCodes.has(candidate)) {
            code = candidate;
            usedCodes.add(code);
            break;
          }
          attempt++;
        }

        await client.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, row.id]);
        backfilledCount++;
      }

      // Ensure referral_wallets row exists for every user
      await client.query(
        `INSERT INTO referral_wallets (user_id, currency, total_earned_cents, available_balance_cents, reserved_balance_cents, withdrawn_balance_cents, updated_at)
         VALUES ($1, 'USD', 0, 0, 0, 0, NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [row.id]
      );

      // Sync to in-memory user record
      const memUser = db.findUserById(row.id);
      if (memUser) {
        memUser.referralCode = code;
        if (row.referred_by_user_id) memUser.referredByUserId = row.referred_by_user_id;
        if (row.referred_by_code) memUser.referredByCode = row.referred_by_code;
        if (row.referred_at) memUser.referredAt = new Date(row.referred_at).toISOString();
      }
    }

    // Also backfill any in-memory users that might not yet be in PG
    for (const memUser of db.getUsers()) {
      if (!memUser.referralCode) {
        let attempt = 0;
        while (true) {
          const candidate = generateReferralCodeCandidate(`${memUser.id}:${memUser.email}`, attempt);
          if (!usedCodes.has(candidate)) {
            memUser.referralCode = candidate;
            usedCodes.add(candidate);
            backfilledCount++;
            break;
          }
          attempt++;
        }
      }
    }
  });

  if (backfilledCount > 0) {
    db.persist();
  }

  return { backfilledCount };
}

/**
 * Generate a unique referral code for a new user
 */
export async function generateUniqueReferralCodeForUser(userId: string, email: string): Promise<string> {
  const existingCodes = new Set<string>();
  for (const u of db.getUsers()) {
    if (u.referralCode) existingCodes.add(u.referralCode.toUpperCase());
  }
  try {
    const res = await query('SELECT referral_code FROM users WHERE referral_code IS NOT NULL');
    for (const r of res.rows) {
      if (r.referral_code) existingCodes.add(String(r.referral_code).toUpperCase());
    }
  } catch {
    // Ignore if table not ready
  }

  let attempt = 0;
  while (true) {
    const candidate = generateReferralCodeCandidate(`${userId}:${email}:${Date.now()}`, attempt);
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
    attempt++;
  }
}

export async function ensureUserReferralCode(userId: string): Promise<string> {
  await backfillReferralCodes();
  const memUser = db.findUserById(userId);
  if (memUser?.referralCode) return memUser.referralCode;
  const res = await query('SELECT referral_code, email FROM users WHERE id = $1 LIMIT 1', [userId]);
  if (res.rows[0]?.referral_code) {
    return String(res.rows[0].referral_code);
  }
  const code = await generateUniqueReferralCodeForUser(userId, res.rows[0]?.email || userId);
  await query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, userId]);
  if (memUser) {
    memUser.referralCode = code;
    db.persist();
  }
  return code;
}

export async function getUserWithdrawalRequests(userId: string): Promise<WithdrawalRequestRecord[]> {
  const res = await query('SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
  return res.rows.map(mapWithdrawalRow);
}

/**
 * Find referrer user by referral code
 */
export async function findUserByReferralCode(rawCode: string): Promise<User | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;

  // Check PostgreSQL first
  try {
    const res = await query('SELECT * FROM users WHERE UPPER(referral_code) = $1 LIMIT 1', [code]);
    if (res.rows.length > 0) {
      const r = res.rows[0];
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        passwordHash: r.password_hash,
        role: r.role,
        orgId: r.org_id,
        avatarUrl: r.avatar_url || undefined,
        emailVerified: Boolean(r.email_verified),
        referralCode: r.referral_code || undefined,
        referredByUserId: r.referred_by_user_id || undefined,
        referredByCode: r.referred_by_code || undefined,
        referredAt: r.referred_at ? new Date(r.referred_at).toISOString() : undefined,
        createdAt: new Date(r.created_at).toISOString(),
      };
    }
  } catch {
    // Fallback to in-memory
  }

  const mem = db.getUsers().find((u) => u.referralCode && u.referralCode.toUpperCase() === code);
  return mem || null;
}

/**
 * Validate a referral code during new user registration
 */
export async function validateReferralCodeForRegistration(
  rawCode: string,
  newAccountEmail: string
): Promise<{ valid: boolean; referrer?: User; code?: string; error?: string }> {
  const code = normalizeReferralCode(rawCode);
  if (!code) {
    return { valid: true };
  }

  if (!/^[A-Z0-9_-]{4,24}$/.test(code)) {
    return {
      valid: false,
      error: 'Invalid referral code format. Please enter a valid PulseVanguard referral code.',
    };
  }

  const referrer = await findUserByReferralCode(code);
  if (!referrer) {
    return {
      valid: false,
      error: 'Invalid or unrecognized referral code. Please check the code and try again.',
    };
  }

  if (referrer.email.trim().toLowerCase() === newAccountEmail.trim().toLowerCase()) {
    return {
      valid: false,
      error: 'You cannot use your own referral code.',
    };
  }

  return {
    valid: true,
    referrer,
    code: referrer.referralCode || code,
  };
}

/**
 * Apply a referral code to an existing authenticated user (e.g. during checkout if they did not register with one).
 * Enforces:
 * - No self-referral
 * - Cannot change referrer once permanently assigned
 * - Cannot use multiple referral codes
 * - Prevents circular referral chains
 */
export async function applyReferralCodeToUser(
  userId: string,
  rawCode: string
): Promise<{ success: boolean; referrerId: string; referralCode: string; alreadyAssigned?: boolean; message: string }> {
  const code = normalizeReferralCode(rawCode);
  if (!code) {
    throw new Error('Please provide a valid referral code.');
  }

  if (!/^[A-Z0-9_-]{4,24}$/.test(code)) {
    throw new Error('Invalid referral code format.');
  }

  return await withTransaction(async (client) => {
    const userRes = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (userRes.rows.length === 0) {
      throw new Error('User account not found.');
    }
    const userRow = userRes.rows[0];

    // Check if user already has a referrer permanently assigned
    if (userRow.referred_by_user_id) {
      const existingCode = String(userRow.referred_by_code || '').toUpperCase();
      if (existingCode === code) {
        return {
          success: true,
          referrerId: userRow.referred_by_user_id,
          referralCode: existingCode,
          alreadyAssigned: true,
          message: `Referral code ${existingCode} is already applied to your account.`,
        };
      }
      throw new Error('A referral code has already been permanently assigned to your account and cannot be changed.');
    }

    // Look up referrer by code
    const refRes = await client.query('SELECT * FROM users WHERE UPPER(referral_code) = $1 LIMIT 1', [code]);
    if (refRes.rows.length === 0) {
      throw new Error('Invalid or unrecognized referral code.');
    }
    const referrerRow = refRes.rows[0];

    // Prevent self-referral (same user ID, same email, or same organization)
    if (
      referrerRow.id === userRow.id ||
      String(referrerRow.email).toLowerCase() === String(userRow.email).toLowerCase() ||
      referrerRow.org_id === userRow.org_id
    ) {
      throw new Error('You cannot refer yourself or use a referral code from your own workspace.');
    }

    // Prevent circular referrals (if the referrer was referred by this user)
    if (referrerRow.referred_by_user_id === userRow.id) {
      throw new Error('Ineligible referral code: circular referrals between accounts are not permitted.');
    }

    const nowIso = new Date().toISOString();
    const canonicalCode = String(referrerRow.referral_code).toUpperCase();

    await client.query(
      `UPDATE users
       SET referred_by_user_id = $1,
           referred_by_code = $2,
           referred_at = $3
       WHERE id = $4`,
      [referrerRow.id, canonicalCode, nowIso, userRow.id]
    );

    // Ensure referrer wallet exists
    await client.query(
      `INSERT INTO referral_wallets (user_id, currency, total_earned_cents, available_balance_cents, reserved_balance_cents, withdrawn_balance_cents, updated_at)
       VALUES ($1, 'USD', 0, 0, 0, 0, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [referrerRow.id]
    );

    // Sync in-memory user state
    const memUser = db.findUserById(userRow.id);
    if (memUser) {
      memUser.referredByUserId = referrerRow.id;
      memUser.referredByCode = canonicalCode;
      memUser.referredAt = nowIso;
      db.persist();
    }

    return {
      success: true,
      referrerId: referrerRow.id,
      referralCode: canonicalCode,
      message: `Referral code ${canonicalCode} has been permanently applied to your account.`,
    };
  });
}

/**
 * Authoritative server-side calculation of eligible purchase amount (in USDT cents) and 40% referral commission (in USDT cents).
 * Uses server-side plan pricing data:
 * - 5 USDT plan (monthly Pro) -> 5.00 USDT (500 cents) -> 40% commission = 2.00 USDT (200 cents)
 * - 50 USDT plan (annual Pro) -> 50.00 USDT (5000 cents) -> 40% commission = 20.00 USDT (2000 cents)
 */
export function calculateEligibleCommissionCents(planId: string, billingInterval: string): {
  eligible: boolean;
  purchaseAmountCents: number;
  commissionAmountCents: number;
} {
  const plan = db.getPlans().find((p) => p.id === planId);
  if (!plan) {
    return { eligible: false, purchaseAmountCents: 0, commissionAmountCents: 0 };
  }

  const pricingTier = plan.pricing.USDT || plan.pricing.USD || { monthly: 5, annual: 50 };
  const priceUsdt = billingInterval === 'annual' ? pricingTier.annual : pricingTier.monthly;
  const purchaseAmountCents = Math.round(priceUsdt * 100);
  if (purchaseAmountCents <= 0) {
    return { eligible: false, purchaseAmountCents: 0, commissionAmountCents: 0 };
  }

  // Exact 40% calculation in integer cents: (cents * 4000) / 10000
  const commissionAmountCents = Math.round((purchaseAmountCents * COMMISSION_RATE_BPS) / 10000);
  return {
    eligible: commissionAmountCents > 0,
    purchaseAmountCents,
    commissionAmountCents,
  };
}

/**
 * Credit 40% referral commission inside an active PostgreSQL transaction when an order is approved & activated.
 * Idempotent: guaranteed by UNIQUE constraint on referral_commissions(order_id) and referral_wallet_ledger(idempotency_key).
 */
export async function creditReferralCommissionInTransaction(
  client: pg.PoolClient,
  orderRow: {
    id: string;
    org_id: string;
    user_id: string;
    user_email: string;
    plan_id: string;
    plan_name: string;
    billing_interval: string;
    status: string;
    referral_code?: string | null;
    referrer_user_id?: string | null;
  }
): Promise<ReferralCommission | null> {
  // 1. Commission is earned ONLY when order is Paid
  if (orderRow.status !== 'Paid') {
    return null;
  }

  // 2. Check if commission was already credited for this order (idempotency check)
  const existingComm = await client.query(
    'SELECT * FROM referral_commissions WHERE order_id = $1 LIMIT 1',
    [orderRow.id]
  );
  if (existingComm.rows.length > 0) {
    return mapCommissionRow(existingComm.rows[0]);
  }

  // 3. Look up customer user record to check permanent referral relationship
  const customerRes = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [orderRow.user_id]);
  if (customerRes.rows.length === 0) {
    return null;
  }
  const customerRow = customerRes.rows[0];

  const referrerUserId: string | null =
    customerRow.referred_by_user_id || orderRow.referrer_user_id || null;
  let referralCode: string | null =
    customerRow.referred_by_code || orderRow.referral_code || null;

  if (!referrerUserId) {
    return null;
  }

  // 4. Prevent self-referral
  if (referrerUserId === customerRow.id) {
    return null;
  }

  const referrerRes = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [referrerUserId]);
  if (referrerRes.rows.length === 0) {
    return null;
  }
  const referrerRow = referrerRes.rows[0];

  if (
    String(referrerRow.email).toLowerCase() === String(customerRow.email).toLowerCase() ||
    referrerRow.org_id === customerRow.org_id
  ) {
    return null;
  }

  const resolvedCode: string = referralCode || referrerRow.referral_code || 'PVREF';

  // If customer didn't have referred_by_user_id persisted on users yet (e.g., set on order), persist it permanently now
  if (!customerRow.referred_by_user_id) {
    await client.query(
      `UPDATE users
       SET referred_by_user_id = $1,
           referred_by_code = $2,
           referred_at = COALESCE(referred_at, NOW())
       WHERE id = $3`,
      [referrerUserId, resolvedCode, customerRow.id]
    );
    const memCustomer = db.findUserById(customerRow.id);
    if (memCustomer) {
      memCustomer.referredByUserId = referrerUserId;
      memCustomer.referredByCode = resolvedCode;
    }
  }

  // 5. Calculate authoritative server-side commission (40% of 5 USDT = 2 USDT, 40% of 50 USDT = 20 USDT)
  const { eligible, purchaseAmountCents, commissionAmountCents } = calculateEligibleCommissionCents(
    orderRow.plan_id,
    orderRow.billing_interval
  );
  if (!eligible || commissionAmountCents <= 0) {
    return null;
  }

  // 6. Ensure referrer wallet row exists and lock it for update
  await client.query(
    `INSERT INTO referral_wallets (user_id, currency, total_earned_cents, available_balance_cents, reserved_balance_cents, withdrawn_balance_cents, updated_at)
     VALUES ($1, 'USDT', 0, 0, 0, 0, NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [referrerUserId]
  );

  const walletRes = await client.query(
    'SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE',
    [referrerUserId]
  );
  const walletRow = walletRes.rows[0];

  const newTotalEarnedCents = Number(walletRow.total_earned_cents) + commissionAmountCents;
  const newAvailableCents = Number(walletRow.available_balance_cents) + commissionAmountCents;
  const currentReservedCents = Number(walletRow.reserved_balance_cents);

  const commId = `comm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date().toISOString();

  // 7. Insert commission record (order_id is UNIQUE)
  await client.query(
    `INSERT INTO referral_commissions (
       id, order_id, referrer_user_id, referred_user_id, referred_user_email,
       referral_code, plan_id, plan_name, purchase_amount_cents,
       commission_rate_bps, commission_amount_cents, currency, status, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'USDT', 'credited', $12)`,
    [
      commId,
      orderRow.id,
      referrerUserId,
      customerRow.id,
      customerRow.email,
      resolvedCode,
      orderRow.plan_id,
      orderRow.plan_name,
      purchaseAmountCents,
      COMMISSION_RATE_BPS,
      commissionAmountCents,
      nowIso,
    ]
  );

  // 8. Insert immutable wallet ledger record (idempotency_key is UNIQUE)
  const ledgerId = `led_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const idempotencyKey = `comm_credit_${orderRow.id}`;
  const description = `40% referral commission (${centsToUsd(commissionAmountCents).toFixed(2)} USDT) from ${customerRow.email} purchasing ${orderRow.plan_name} (${centsToUsd(purchaseAmountCents).toFixed(2)} USDT)`;

  await client.query(
    `INSERT INTO referral_wallet_ledger (
       id, user_id, type, amount_cents, currency, reference_id, idempotency_key,
       balance_after_cents, reserved_after_cents, description, created_at
     )
     VALUES ($1, $2, 'commission_credit', $3, 'USDT', $4, $5, $6, $7, $8, $9)`,
    [
      ledgerId,
      referrerUserId,
      commissionAmountCents,
      orderRow.id,
      idempotencyKey,
      newAvailableCents,
      currentReservedCents,
      description,
      nowIso,
    ]
  );

  // 9. Update referrer wallet balance
  await client.query(
    `UPDATE referral_wallets
     SET total_earned_cents = $1,
         available_balance_cents = $2,
         updated_at = NOW()
     WHERE user_id = $3`,
    [newTotalEarnedCents, newAvailableCents, referrerUserId]
  );

  // 10. Create in-app notification for referrer
  const alertId = `alt_ref_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const alertTitle = `Referral Commission Earned: +${centsToUsd(commissionAmountCents).toFixed(2)} USDT`;
  const alertMessage = `You earned a ${centsToUsd(commissionAmountCents).toFixed(2)} USDT (40%) referral commission from ${customerRow.email}'s ${orderRow.plan_name} purchase.`;

  await client.query(
    `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
     VALUES ($1, $2, 'referral', 'info', $3, $4, false, $5)`,
    [alertId, referrerRow.org_id, alertTitle, alertMessage, nowIso]
  );

  db.addAlert({
    id: alertId,
    orgId: referrerRow.org_id,
    type: 'referral' as any,
    severity: 'info',
    title: alertTitle,
    message: alertMessage,
    read: false,
    timestamp: nowIso,
  });

  // 11. Record audit log
  const logId = `log_comm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const logDetails = `Credited ${centsToUsd(commissionAmountCents).toFixed(2)} USDT (40%) referral commission to ${referrerRow.email} (code: ${resolvedCode}) for order ${orderRow.id}.`;
  await client.query(
    `INSERT INTO audit_logs (id, org_id, user_id, user_email, action, target, details, timestamp)
     VALUES ($1, $2, $3, $4, 'REFERRAL_COMMISSION_CREDITED', $5, $6, $7)`,
    [logId, referrerRow.org_id, referrerRow.id, referrerRow.email, orderRow.id, logDetails, nowIso]
  );

  return {
    id: commId,
    orderId: orderRow.id,
    referrerUserId,
    referredUserId: customerRow.id,
    referredUserEmail: customerRow.email,
    referralCode: resolvedCode,
    planId: orderRow.plan_id,
    planName: orderRow.plan_name,
    purchaseAmountCents,
    purchaseAmount: centsToUsd(purchaseAmountCents),
    commissionRateBps: COMMISSION_RATE_BPS,
    commissionAmountCents,
    commissionAmount: centsToUsd(commissionAmountCents),
    currency: 'USDT',
    status: 'credited',
    createdAt: nowIso,
  };
}

/**
 * Standalone transactional wrapper to credit referral commission when an order is activated outside an existing PG transaction (e.g. automatic blockchain verification).
 */
export async function processOrderReferralCommission(order: CryptoPaymentOrder): Promise<ReferralCommission | null> {
  if (order.status !== 'Paid') return null;

  return await withTransaction(async (client) => {
    const res = await client.query('SELECT * FROM crypto_orders WHERE id = $1 FOR UPDATE', [order.id]);
    const row = res.rows[0] || {
      id: order.id,
      org_id: order.orgId,
      user_id: order.userId,
      user_email: order.userEmail,
      plan_id: order.planId,
      plan_name: order.planName,
      billing_interval: order.billingInterval,
      status: order.status,
      referral_code: order.referralCode || null,
      referrer_user_id: order.referrerUserId || null,
    };

    return await creditReferralCommissionInTransaction(client, row);
  });
}

/**
 * Get complete referral summary, wallet balances, commission history, and withdrawal history for a user.
 */
export async function getUserReferralSummary(
  userId: string,
  reqHost?: string,
  reqProto?: string
): Promise<UserReferralSummary> {
  await backfillReferralCodes();

  const userRes = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
  if (userRes.rows.length === 0) {
    throw new Error('User not found.');
  }
  const userRow = userRes.rows[0];

  // Ensure wallet exists
  await query(
    `INSERT INTO referral_wallets (user_id, currency, total_earned_cents, available_balance_cents, reserved_balance_cents, withdrawn_balance_cents, updated_at)
     VALUES ($1, 'USDT', 0, 0, 0, 0, NOW())
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const [walletRes, commRes, withdrawalsRes, ledgerRes, referredUsersRes, userPaidOrdersRes] = await Promise.all([
    query('SELECT * FROM referral_wallets WHERE user_id = $1 LIMIT 1', [userId]),
    query('SELECT * FROM referral_commissions WHERE referrer_user_id = $1 ORDER BY created_at DESC', [userId]),
    query('SELECT * FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
    query('SELECT * FROM referral_wallet_ledger WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
    query('SELECT id, email, name, created_at FROM users WHERE referred_by_user_id = $1 ORDER BY created_at DESC', [userId]),
    query("SELECT COUNT(*) as cnt FROM crypto_orders WHERE user_id = $1 AND status = 'Paid'", [userId]),
  ]);

  const wallet = mapWalletRow(walletRes.rows[0]);
  const commissions = commRes.rows.map(mapCommissionRow);
  const withdrawals = withdrawalsRes.rows.map((r) => mapWithdrawalRow(r));
  const ledger = ledgerRes.rows.map(mapLedgerRow);

  // Build referred users breakdown
  const referredUsers = referredUsersRes.rows.map((u) => {
    const userComms = commissions.filter((c) => c.referredUserId === u.id);
    const totalCommCents = userComms.reduce((sum, c) => sum + c.commissionAmountCents, 0);
    return {
      userId: u.id,
      email: u.email,
      name: u.name,
      joinedAt: new Date(u.created_at).toISOString(),
      purchasesCount: userComms.length,
      totalCommissionGenerated: centsToUsd(totalCommCents),
    };
  });

  const referralCode = String(userRow.referral_code || '');
  const hasPaidOrders = parseInt(userPaidOrdersRes.rows[0]?.cnt || '0', 10) > 0;
  const canApplyReferralCode = !userRow.referred_by_user_id && !hasPaidOrders;

  return {
    userId: userRow.id,
    email: userRow.email,
    referralCode,
    referralUrl: buildReferralUrl(referralCode, reqHost, reqProto),
    referredByUserId: userRow.referred_by_user_id || undefined,
    referredByCode: userRow.referred_by_code || undefined,
    referredAt: userRow.referred_at ? new Date(userRow.referred_at).toISOString() : undefined,
    canApplyReferralCode,
    commissionRatePercent: COMMISSION_RATE_PERCENT,
    minimumWithdrawalAmount: MIN_WITHDRAWAL_USD,
    currency: 'USDT',
    payoutNetwork: PAYOUT_NETWORK_LABEL,
    totalSuccessfulReferrals: referredUsers.length,
    totalEligiblePurchases: commissions.length,
    totalCommissionsEarned: wallet.totalEarned,
    availableBalance: wallet.availableBalance,
    reservedBalance: wallet.reservedBalance,
    withdrawnBalance: wallet.withdrawnBalance,
    wallet,
    commissions,
    withdrawals,
    ledger,
    referredUsers,
  };
}

/**
 * Create a new withdrawal request for a user.
 * Enforces:
 * - Minimum 4.00 USDT (400 cents)
 * - Maximum <= available referral wallet balance
 * - Plausible TRON/TRC20 destination wallet address
 * - Atomically reserves requested amount (moves from available_balance_cents to reserved_balance_cents)
 */
export async function createWithdrawalRequest(params: {
  userId: string;
  amount: unknown;
  walletAddress: unknown;
}): Promise<WithdrawalRequestRecord> {
  // 1. Validate amount
  const parsedAmount = parseUsdToCents(params.amount);
  if (!parsedAmount.valid) {
    throw new Error(parsedAmount.error || 'Invalid withdrawal amount.');
  }

  const amountCents = parsedAmount.cents;
  if (amountCents < MIN_WITHDRAWAL_CENTS) {
    throw new Error(`Minimum withdrawal amount is ${MIN_WITHDRAWAL_USD}.00 USDT.`);
  }

  // 2. Validate USDT TRC20 address
  const addrValidation = validateTronTrc20Address(params.walletAddress);
  if (!addrValidation.valid) {
    throw new Error(addrValidation.error || 'Invalid USDT TRC20 wallet address.');
  }
  const cleanAddress = addrValidation.normalized;

  await backfillReferralCodes();

  return await withTransaction(async (client) => {
    const userRes = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [params.userId]);
    if (userRes.rows.length === 0) {
      throw new Error('User account not found.');
    }
    const userRow = userRes.rows[0];

    // Ensure wallet row exists and lock it FOR UPDATE to prevent race conditions / double-withdrawal
    await client.query(
      `INSERT INTO referral_wallets (user_id, currency, total_earned_cents, available_balance_cents, reserved_balance_cents, withdrawn_balance_cents, updated_at)
       VALUES ($1, 'USDT', 0, 0, 0, 0, NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [params.userId]
    );

    const walletRes = await client.query(
      'SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE',
      [params.userId]
    );
    const walletRow = walletRes.rows[0];
    const currentAvailableCents = Number(walletRow.available_balance_cents);
    const currentReservedCents = Number(walletRow.reserved_balance_cents);

    if (currentAvailableCents < MIN_WITHDRAWAL_CENTS) {
      throw new Error(
        `Insufficient available balance. You need at least ${MIN_WITHDRAWAL_USD}.00 USDT available to request a withdrawal (current available: ${centsToUsd(currentAvailableCents).toFixed(2)} USDT).`
      );
    }

    if (amountCents > currentAvailableCents) {
      throw new Error(
        `Requested amount (${centsToUsd(amountCents).toFixed(2)} USDT) exceeds your available referral balance (${centsToUsd(currentAvailableCents).toFixed(2)} USDT).`
      );
    }

    const newAvailableCents = currentAvailableCents - amountCents;
    const newReservedCents = currentReservedCents + amountCents;
    const withdrawalId = `wd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const referralCode = String(userRow.referral_code || 'PVREF');

    // 3. Atomically reserve funds on referral_wallets
    await client.query(
      `UPDATE referral_wallets
       SET available_balance_cents = $1,
           reserved_balance_cents = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [newAvailableCents, newReservedCents, params.userId]
    );

    // 4. Create withdrawal_requests record with status = 'pending'
    await client.query(
      `INSERT INTO withdrawal_requests (
         id, user_id, user_email, referral_code, amount_cents, currency, network,
         wallet_address, status, available_balance_before_cents, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'USDT', $6, $7, 'pending', $8, $9, $9)`,
      [
        withdrawalId,
        params.userId,
        userRow.email,
        referralCode,
        amountCents,
        PAYOUT_NETWORK_LABEL,
        cleanAddress,
        currentAvailableCents,
        nowIso,
      ]
    );

    // 5. Record ledger entry for reservation
    const ledgerId = `led_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const idempotencyKey = `wd_reserve_${withdrawalId}`;
    const description = `Reserved ${centsToUsd(amountCents).toFixed(2)} USDT for withdrawal request ${withdrawalId} to ${cleanAddress} (${PAYOUT_NETWORK_LABEL})`;

    await client.query(
      `INSERT INTO referral_wallet_ledger (
         id, user_id, type, amount_cents, currency, reference_id, idempotency_key,
         balance_after_cents, reserved_after_cents, description, created_at
       )
       VALUES ($1, $2, 'withdrawal_reserve', $3, 'USDT', $4, $5, $6, $7, $8, $9)`,
      [
        ledgerId,
        params.userId,
        -amountCents,
        withdrawalId,
        idempotencyKey,
        newAvailableCents,
        newReservedCents,
        description,
        nowIso,
      ]
    );

    // 6. Notify Super Admin via in-app alerts
    const superAdminRes = await client.query(
      "SELECT id, org_id FROM users WHERE role = 'super_admin' ORDER BY created_at ASC LIMIT 1"
    );
    const adminOrgId = superAdminRes.rows[0]?.org_id || 'org_admin_001';
    const adminAlertId = `alt_wd_new_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const adminAlertTitle = `New Referral Withdrawal Request (${centsToUsd(amountCents).toFixed(2)} USDT)`;
    const adminAlertMsg = `User ${userRow.email} (${referralCode}) requested a withdrawal of ${centsToUsd(amountCents).toFixed(2)} USDT to USDT TRC20 address ${cleanAddress}.`;

    await client.query(
      `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
       VALUES ($1, $2, 'withdrawal', 'warning', $3, $4, false, $5)`,
      [adminAlertId, adminOrgId, adminAlertTitle, adminAlertMsg, nowIso]
    );

    db.addAlert({
      id: adminAlertId,
      orgId: adminOrgId,
      type: 'withdrawal' as any,
      severity: 'warning',
      title: adminAlertTitle,
      message: adminAlertMsg,
      read: false,
      timestamp: nowIso,
    });

    // 7. Audit log
    const logId = `log_wd_req_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await client.query(
      `INSERT INTO audit_logs (id, org_id, user_id, user_email, action, target, details, timestamp)
       VALUES ($1, $2, $3, $4, 'WITHDRAWAL_REQUEST_CREATED', $5, $6, $7)`,
      [
        logId,
        userRow.org_id,
        userRow.id,
        userRow.email,
        withdrawalId,
        `Withdrawal request ${withdrawalId} for ${centsToUsd(amountCents).toFixed(2)} USDT (${PAYOUT_NETWORK_LABEL}) to ${cleanAddress}. Reserved from available balance.`,
        nowIso,
      ]
    );

    const createdRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1', [withdrawalId]);
    return mapWithdrawalRow(createdRes.rows[0]);
  });
}

function assertAdminRole(adminUser: { id: string; email: string; role: string }) {
  if (!adminUser || (adminUser.role !== 'super_admin' && adminUser.role !== 'admin')) {
    throw new Error('Unauthorized: Administrator privilege required.');
  }
}

/**
 * Admin Action 1: Approve Withdrawal for Payout
 * - Validates admin permissions
 * - Validates request status is 'pending' and reserved balance is intact
 * - Marks status as 'approved' (approved for payout)
 * - Keeps funds reserved until payout is actually completed or request is rejected/cancelled
 * - Does NOT mark request as paid merely because it was approved
 */
export async function approveWithdrawalForPayout(
  withdrawalId: string,
  adminUser: { id: string; email: string; role: string }
): Promise<{ success: boolean; withdrawal: WithdrawalRequestRecord; alreadyApproved?: boolean; message: string }> {
  assertAdminRole(adminUser);

  return await withTransaction(async (client) => {
    const reqRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [withdrawalId]);
    if (reqRes.rows.length === 0) {
      throw new Error('Withdrawal request not found.');
    }
    const row = reqRes.rows[0];

    if (row.status === 'approved') {
      return {
        success: true,
        withdrawal: mapWithdrawalRow(row),
        alreadyApproved: true,
        message: 'Withdrawal request is already approved for payout.',
      };
    }

    if (row.status === 'paid') {
      throw new Error('Withdrawal request has already been paid.');
    }
    if (row.status === 'rejected') {
      throw new Error('Cannot approve a withdrawal request that has already been rejected.');
    }
    if (row.status === 'cancelled') {
      throw new Error('Cannot approve a withdrawal request that has been cancelled.');
    }

    const walletRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE', [row.user_id]);
    if (walletRes.rows.length === 0 || Number(walletRes.rows[0].reserved_balance_cents) < Number(row.amount_cents)) {
      throw new Error('Reserved wallet balance is insufficient for this withdrawal request.');
    }

    const nowIso = new Date().toISOString();
    await client.query(
      `UPDATE withdrawal_requests
       SET status = 'approved',
           approved_by_id = $1,
           approved_by_email = $2,
           approved_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [adminUser.id, adminUser.email, nowIso, withdrawalId]
    );

    // Notify user
    const userRes = await client.query('SELECT org_id FROM users WHERE id = $1 LIMIT 1', [row.user_id]);
    const userOrgId = userRes.rows[0]?.org_id;
    if (userOrgId) {
      const alertId = `alt_wd_app_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const title = `Withdrawal Approved for Payout (${centsToUsd(Number(row.amount_cents)).toFixed(2)} USDT)`;
      const message = `Your withdrawal request (${withdrawalId}) for ${centsToUsd(Number(row.amount_cents)).toFixed(2)} USDT to ${row.wallet_address} has been approved and queued for USDT TRC20 transfer.`;
      await client.query(
        `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
         VALUES ($1, $2, 'withdrawal', 'info', $3, $4, false, $5)`,
        [alertId, userOrgId, title, message, nowIso]
      );
      db.addAlert({
        id: alertId,
        orgId: userOrgId,
        type: 'withdrawal' as any,
        severity: 'info',
        title,
        message,
        read: false,
        timestamp: nowIso,
      });
    }

    // Audit log
    const logId = `log_wd_app_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await client.query(
      `INSERT INTO audit_logs (id, org_id, user_id, user_email, action, target, details, timestamp)
       VALUES ($1, $2, $3, $4, 'ADMIN_WITHDRAWAL_APPROVED', $5, $6, $7)`,
      [
        logId,
        userOrgId || 'org_admin_001',
        adminUser.id,
        adminUser.email,
        withdrawalId,
        `Withdrawal ${withdrawalId} (${centsToUsd(Number(row.amount_cents)).toFixed(2)} USDT) approved for payout by ${adminUser.email}. Funds remain reserved pending USDT TRC20 transfer.`,
        nowIso,
      ]
    );

    const updatedRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1', [withdrawalId]);
    return {
      success: true,
      withdrawal: mapWithdrawalRow(updatedRes.rows[0]),
      message: `Withdrawal request ${withdrawalId} approved for payout. Funds remain reserved until marked as paid with a verified transaction hash.`,
    };
  });
}

/**
 * Admin Action 2: Mark Withdrawal as Paid
 * - Requires verified payout transaction hash (txHash)
 * - Atomically finalizes wallet debit (deducts from reserved_balance_cents, increments withdrawn_balance_cents)
 * - Records administrator ID, payout timestamp, transaction hash, network, and final amount
 * - Prevents duplicate payouts and repeated balance deductions
 */
export async function markWithdrawalAsPaid(
  withdrawalId: string,
  adminUser: { id: string; email: string; role: string },
  txHash: unknown
): Promise<{ success: boolean; withdrawal: WithdrawalRequestRecord; alreadyPaid?: boolean; message: string }> {
  assertAdminRole(adminUser);

  const cleanTxHash = typeof txHash === 'string' ? txHash.trim() : '';
  if (!cleanTxHash || cleanTxHash.length < 8 || !/^[A-Za-z0-9_-]{8,128}$/.test(cleanTxHash)) {
    throw new Error('A valid TRON transaction hash (TXID) is required to mark a withdrawal as paid.');
  }

  return await withTransaction(async (client) => {
    const reqRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [withdrawalId]);
    if (reqRes.rows.length === 0) {
      throw new Error('Withdrawal request not found.');
    }
    const row = reqRes.rows[0];

    // Idempotency: if already marked as paid, do not deduct balance again
    if (row.status === 'paid') {
      return {
        success: true,
        withdrawal: mapWithdrawalRow(row),
        alreadyPaid: true,
        message: 'Withdrawal has already been marked as paid.',
      };
    }

    if (row.status === 'rejected') {
      throw new Error('Cannot mark a rejected withdrawal request as paid.');
    }
    if (row.status === 'cancelled') {
      throw new Error('Cannot mark a cancelled withdrawal request as paid.');
    }

    const walletRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE', [row.user_id]);
    if (walletRes.rows.length === 0) {
      throw new Error('User referral wallet not found.');
    }
    const walletRow = walletRes.rows[0];
    const amountCents = Number(row.amount_cents);
    const currentReservedCents = Number(walletRow.reserved_balance_cents);
    const currentWithdrawnCents = Number(walletRow.withdrawn_balance_cents);
    const currentAvailableCents = Number(walletRow.available_balance_cents);

    if (currentReservedCents < amountCents) {
      throw new Error('Reserved balance is insufficient to finalize this payout.');
    }

    const newReservedCents = currentReservedCents - amountCents;
    const newWithdrawnCents = currentWithdrawnCents + amountCents;
    const nowIso = new Date().toISOString();

    // 1. Finalize wallet debit
    await client.query(
      `UPDATE referral_wallets
       SET reserved_balance_cents = $1,
           withdrawn_balance_cents = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [newReservedCents, newWithdrawnCents, row.user_id]
    );

    // 2. Insert ledger entry (idempotency_key prevents duplicate payout entries)
    const ledgerId = `led_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const idempotencyKey = `wd_paid_${withdrawalId}`;
    const description = `Payout completed for withdrawal ${withdrawalId}: ${centsToUsd(amountCents).toFixed(2)} USDT sent via ${PAYOUT_NETWORK_LABEL} to ${row.wallet_address} (TX: ${cleanTxHash})`;

    await client.query(
      `INSERT INTO referral_wallet_ledger (
         id, user_id, type, amount_cents, currency, reference_id, idempotency_key,
         balance_after_cents, reserved_after_cents, description, created_at
       )
       VALUES ($1, $2, 'withdrawal_paid', $3, 'USDT', $4, $5, $6, $7, $8, $9)`,
      [
        ledgerId,
        row.user_id,
        0,
        withdrawalId,
        idempotencyKey,
        currentAvailableCents,
        newReservedCents,
        description,
        nowIso,
      ]
    );

    // 3. Update withdrawal status to paid
    await client.query(
      `UPDATE withdrawal_requests
       SET status = 'paid',
           approved_by_id = COALESCE(approved_by_id, $1),
           approved_by_email = COALESCE(approved_by_email, $2),
           approved_at = COALESCE(approved_at, $3),
           paid_by_id = $1,
           paid_by_email = $2,
           paid_at = $3,
           tx_hash = $4,
           updated_at = $3
       WHERE id = $5`,
      [adminUser.id, adminUser.email, nowIso, cleanTxHash, withdrawalId]
    );

    // 4. Notify user
    const userRes = await client.query('SELECT org_id FROM users WHERE id = $1 LIMIT 1', [row.user_id]);
    const userOrgId = userRes.rows[0]?.org_id;
    if (userOrgId) {
      const alertId = `alt_wd_paid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const title = `Withdrawal Paid: ${centsToUsd(amountCents).toFixed(2)} USDT Sent`;
      const message = `Your referral withdrawal (${withdrawalId}) of ${centsToUsd(amountCents).toFixed(2)} USDT has been paid via ${PAYOUT_NETWORK_LABEL} to ${row.wallet_address}. TXID: ${cleanTxHash}`;
      await client.query(
        `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
         VALUES ($1, $2, 'withdrawal', 'info', $3, $4, false, $5)`,
        [alertId, userOrgId, title, message, nowIso]
      );
      db.addAlert({
        id: alertId,
        orgId: userOrgId,
        type: 'withdrawal' as any,
        severity: 'info',
        title,
        message,
        read: false,
        timestamp: nowIso,
      });
    }

    // 5. Audit log
    const logId = `log_wd_paid_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await client.query(
      `INSERT INTO audit_logs (id, org_id, user_id, user_email, action, target, details, timestamp)
       VALUES ($1, $2, $3, $4, 'ADMIN_WITHDRAWAL_PAID', $5, $6, $7)`,
      [
        logId,
        userOrgId || 'org_admin_001',
        adminUser.id,
        adminUser.email,
        withdrawalId,
        `Withdrawal ${withdrawalId} (${centsToUsd(amountCents).toFixed(2)} USDT) marked as PAID by ${adminUser.email}. Network: ${PAYOUT_NETWORK_LABEL}. Destination: ${row.wallet_address}. TXID: ${cleanTxHash}`,
        nowIso,
      ]
    );

    const updatedRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1', [withdrawalId]);
    return {
      success: true,
      withdrawal: mapWithdrawalRow(updatedRes.rows[0]),
      message: `Withdrawal ${withdrawalId} (${centsToUsd(amountCents).toFixed(2)} USDT) marked as paid with TXID ${cleanTxHash}.`,
    };
  });
}

/**
 * Admin Action 3: Reject Withdrawal Request
 * - Releases reserved funds back to user's available balance exactly once
 * - Records administrator ID, rejection timestamp, and reason
 * - Preserves request in audit history
 */
export async function rejectWithdrawalRequest(
  withdrawalId: string,
  adminUser: { id: string; email: string; role: string },
  reason?: string
): Promise<{ success: boolean; withdrawal: WithdrawalRequestRecord; alreadyRejected?: boolean; message: string }> {
  assertAdminRole(adminUser);

  return await withTransaction(async (client) => {
    const reqRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [withdrawalId]);
    if (reqRes.rows.length === 0) {
      throw new Error('Withdrawal request not found.');
    }
    const row = reqRes.rows[0];

    if (row.status === 'rejected') {
      return {
        success: true,
        withdrawal: mapWithdrawalRow(row),
        alreadyRejected: true,
        message: 'Withdrawal request has already been rejected.',
      };
    }

    if (row.status === 'paid') {
      throw new Error('Cannot reject a withdrawal request that has already been paid.');
    }
    if (row.status === 'cancelled') {
      throw new Error('Cannot reject a withdrawal request that has already been cancelled.');
    }

    const walletRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE', [row.user_id]);
    if (walletRes.rows.length === 0) {
      throw new Error('User referral wallet not found.');
    }
    const walletRow = walletRes.rows[0];
    const amountCents = Number(row.amount_cents);
    const currentAvailableCents = Number(walletRow.available_balance_cents);
    const currentReservedCents = Number(walletRow.reserved_balance_cents);

    if (currentReservedCents < amountCents) {
      throw new Error('Reserved balance inconsistency detected; cannot release reservation.');
    }

    const newAvailableCents = currentAvailableCents + amountCents;
    const newReservedCents = currentReservedCents - amountCents;
    const nowIso = new Date().toISOString();
    const cleanReason = (reason || '').trim() || 'Declined by Administrator';

    // 1. Release reserved funds back to available balance
    await client.query(
      `UPDATE referral_wallets
       SET available_balance_cents = $1,
           reserved_balance_cents = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [newAvailableCents, newReservedCents, row.user_id]
    );

    // 2. Insert ledger entry with unique idempotency key so release can never happen twice
    const ledgerId = `led_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const idempotencyKey = `wd_release_${withdrawalId}`;
    const description = `Released reserved ${centsToUsd(amountCents).toFixed(2)} USDT back to available balance (withdrawal ${withdrawalId} rejected: ${cleanReason})`;

    await client.query(
      `INSERT INTO referral_wallet_ledger (
         id, user_id, type, amount_cents, currency, reference_id, idempotency_key,
         balance_after_cents, reserved_after_cents, description, created_at
       )
       VALUES ($1, $2, 'withdrawal_release', $3, 'USDT', $4, $5, $6, $7, $8, $9)`,
      [
        ledgerId,
        row.user_id,
        amountCents,
        withdrawalId,
        idempotencyKey,
        newAvailableCents,
        newReservedCents,
        description,
        nowIso,
      ]
    );

    // 3. Update withdrawal status to rejected
    await client.query(
      `UPDATE withdrawal_requests
       SET status = 'rejected',
           rejected_by_id = $1,
           rejected_by_email = $2,
           rejected_at = $3,
           rejection_reason = $4,
           updated_at = $3
       WHERE id = $5`,
      [adminUser.id, adminUser.email, nowIso, cleanReason, withdrawalId]
    );

    // 4. Notify user
    const userRes = await client.query('SELECT org_id FROM users WHERE id = $1 LIMIT 1', [row.user_id]);
    const userOrgId = userRes.rows[0]?.org_id;
    if (userOrgId) {
      const alertId = `alt_wd_rej_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const title = `Withdrawal Request Declined (${centsToUsd(amountCents).toFixed(2)} USDT Returned)`;
      const message = `Your withdrawal request (${withdrawalId}) for ${centsToUsd(amountCents).toFixed(2)} USDT was declined (${cleanReason}). The reserved funds have been returned to your available referral balance.`;
      await client.query(
        `INSERT INTO alerts (id, org_id, type, severity, title, message, read, timestamp)
         VALUES ($1, $2, 'withdrawal', 'warning', $3, $4, false, $5)`,
        [alertId, userOrgId, title, message, nowIso]
      );
      db.addAlert({
        id: alertId,
        orgId: userOrgId,
        type: 'withdrawal' as any,
        severity: 'warning',
        title,
        message,
        read: false,
        timestamp: nowIso,
      });
    }

    // 5. Audit log
    const logId = `log_wd_rej_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await client.query(
      `INSERT INTO audit_logs (id, org_id, user_id, user_email, action, target, details, timestamp)
       VALUES ($1, $2, $3, $4, 'ADMIN_WITHDRAWAL_REJECTED', $5, $6, $7)`,
      [
        logId,
        userOrgId || 'org_admin_001',
        adminUser.id,
        adminUser.email,
        withdrawalId,
        `Withdrawal ${withdrawalId} (${centsToUsd(amountCents).toFixed(2)} USDT) rejected by ${adminUser.email}. Reason: ${cleanReason}. Reserved funds released back to user.`,
        nowIso,
      ]
    );

    const updatedRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1', [withdrawalId]);
    return {
      success: true,
      withdrawal: mapWithdrawalRow(updatedRes.rows[0]),
      message: `Withdrawal request ${withdrawalId} rejected and ${centsToUsd(amountCents).toFixed(2)} USDT released back to the user's available balance.`,
    };
  });
}

/**
 * Admin Action 4: Cancel Withdrawal Request
 * - Releases reserved funds back to available balance exactly once
 */
export async function cancelWithdrawalRequest(
  withdrawalId: string,
  adminUser: { id: string; email: string; role: string }
): Promise<{ success: boolean; withdrawal: WithdrawalRequestRecord; alreadyCancelled?: boolean; message: string }> {
  assertAdminRole(adminUser);

  return await withTransaction(async (client) => {
    const reqRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE', [withdrawalId]);
    if (reqRes.rows.length === 0) {
      throw new Error('Withdrawal request not found.');
    }
    const row = reqRes.rows[0];

    if (row.status === 'cancelled') {
      return {
        success: true,
        withdrawal: mapWithdrawalRow(row),
        alreadyCancelled: true,
        message: 'Withdrawal request is already cancelled.',
      };
    }

    if (row.status === 'paid') {
      throw new Error('Cannot cancel a withdrawal request that has already been paid.');
    }
    if (row.status === 'rejected') {
      throw new Error('Cannot cancel a withdrawal request that has already been rejected.');
    }

    const walletRes = await client.query('SELECT * FROM referral_wallets WHERE user_id = $1 FOR UPDATE', [row.user_id]);
    if (walletRes.rows.length === 0) {
      throw new Error('User referral wallet not found.');
    }
    const walletRow = walletRes.rows[0];
    const amountCents = Number(row.amount_cents);
    const currentAvailableCents = Number(walletRow.available_balance_cents);
    const currentReservedCents = Number(walletRow.reserved_balance_cents);

    if (currentReservedCents < amountCents) {
      throw new Error('Reserved balance inconsistency detected; cannot release reservation.');
    }

    const newAvailableCents = currentAvailableCents + amountCents;
    const newReservedCents = currentReservedCents - amountCents;
    const nowIso = new Date().toISOString();

    await client.query(
      `UPDATE referral_wallets
       SET available_balance_cents = $1,
           reserved_balance_cents = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [newAvailableCents, newReservedCents, row.user_id]
    );

    const ledgerId = `led_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const idempotencyKey = `wd_release_${withdrawalId}`;
    const description = `Released reserved ${centsToUsd(amountCents).toFixed(2)} USDT back to available balance (withdrawal ${withdrawalId} cancelled by admin)`;

    await client.query(
      `INSERT INTO referral_wallet_ledger (
         id, user_id, type, amount_cents, currency, reference_id, idempotency_key,
         balance_after_cents, reserved_after_cents, description, created_at
       )
       VALUES ($1, $2, 'withdrawal_release', $3, 'USDT', $4, $5, $6, $7, $8, $9)`,
      [
        ledgerId,
        row.user_id,
        amountCents,
        withdrawalId,
        idempotencyKey,
        newAvailableCents,
        newReservedCents,
        description,
        nowIso,
      ]
    );

    await client.query(
      `UPDATE withdrawal_requests
       SET status = 'cancelled',
           cancelled_by_id = $1,
           cancelled_by_email = $2,
           cancelled_at = $3,
           updated_at = $3
       WHERE id = $4`,
      [adminUser.id, adminUser.email, nowIso, withdrawalId]
    );

    const updatedRes = await client.query('SELECT * FROM withdrawal_requests WHERE id = $1', [withdrawalId]);
    return {
      success: true,
      withdrawal: mapWithdrawalRow(updatedRes.rows[0]),
      message: `Withdrawal request ${withdrawalId} cancelled and reserved funds returned to available balance.`,
    };
  });
}

/**
 * Retrieve all withdrawal requests for the Admin Dashboard, enriched with referred customer details.
 */
export async function getAdminWithdrawalRequests(adminUser: {
  id: string;
  email: string;
  role: string;
}): Promise<WithdrawalRequestRecord[]> {
  assertAdminRole(adminUser);

  const [wdRes, commRes, referredUsersRes] = await Promise.all([
    query('SELECT * FROM withdrawal_requests ORDER BY created_at DESC'),
    query('SELECT * FROM referral_commissions ORDER BY created_at DESC'),
    query('SELECT id, email, name, referred_by_user_id, created_at FROM users WHERE referred_by_user_id IS NOT NULL'),
  ]);

  const commissionsByReferrer = new Map<string, ReferralCommission[]>();
  for (const r of commRes.rows) {
    const c = mapCommissionRow(r);
    const list = commissionsByReferrer.get(c.referrerUserId) || [];
    list.push(c);
    commissionsByReferrer.set(c.referrerUserId, list);
  }

  const referredByReferrer = new Map<string, Array<{ id: string; email: string; name: string; createdAt: string }>>();
  for (const u of referredUsersRes.rows) {
    const refId = String(u.referred_by_user_id);
    const list = referredByReferrer.get(refId) || [];
    list.push({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: new Date(u.created_at).toISOString(),
    });
    referredByReferrer.set(refId, list);
  }

  return wdRes.rows.map((row) => {
    const wd = mapWithdrawalRow(row);
    const referrerComms = commissionsByReferrer.get(wd.userId) || [];
    const referredCustomers: ReferredCustomerSummary[] = [];
    const seenOrders = new Set<string>();

    for (const c of referrerComms) {
      seenOrders.add(c.orderId);
      referredCustomers.push({
        userId: c.referredUserId,
        email: c.referredUserEmail,
        name: c.referredUserEmail.split('@')[0],
        orderId: c.orderId,
        planName: c.planName,
        purchaseAmount: c.purchaseAmount,
        commissionAmount: c.commissionAmount,
        createdAt: c.createdAt,
      });
    }

    // Also include any referred users who haven't made a commission entry yet if list is empty
    const refUsers = referredByReferrer.get(wd.userId) || [];
    for (const ru of refUsers) {
      if (!referredCustomers.some((rc) => rc.userId === ru.id)) {
        referredCustomers.push({
          userId: ru.id,
          email: ru.email,
          name: ru.name,
          createdAt: ru.createdAt,
        });
      }
    }

    wd.referredCustomers = referredCustomers;
    return wd;
  });
}

/**
 * Compute global Referral & Withdrawal metrics for the Admin Overview Dashboard.
 */
export async function getAdminReferralOverview(): Promise<AdminReferralOverview> {
  const [walletsRes, commRes, wdRes] = await Promise.all([
    query('SELECT * FROM referral_wallets'),
    query('SELECT * FROM referral_commissions'),
    query('SELECT * FROM withdrawal_requests'),
  ]);

  let totalCommissionsCents = 0;
  for (const c of commRes.rows) {
    totalCommissionsCents += Number(c.commission_amount_cents || 0);
  }

  let totalAvailableLiabilitiesCents = 0;
  let totalReservedCents = 0;
  for (const w of walletsRes.rows) {
    totalAvailableLiabilitiesCents += Number(w.available_balance_cents || 0);
    totalReservedCents += Number(w.reserved_balance_cents || 0);
  }

  let awaitingReviewCount = 0;
  let approvedAwaitingPayoutCount = 0;
  let paidWithdrawalsCount = 0;
  let paidWithdrawalsCents = 0;
  let rejectedCount = 0;
  let rejectedCents = 0;
  let cancelledCount = 0;

  for (const wd of wdRes.rows) {
    const amt = Number(wd.amount_cents || 0);
    if (wd.status === 'pending') {
      awaitingReviewCount++;
    } else if (wd.status === 'approved') {
      approvedAwaitingPayoutCount++;
    } else if (wd.status === 'paid') {
      paidWithdrawalsCount++;
      paidWithdrawalsCents += amt;
    } else if (wd.status === 'rejected') {
      rejectedCount++;
      rejectedCents += amt;
    } else if (wd.status === 'cancelled') {
      cancelledCount++;
    }
  }

  return {
    totalReferralCommissionsGenerated: centsToUsd(totalCommissionsCents),
    totalReferralCommissionsCount: commRes.rows.length,
    totalAvailableReferralLiabilities: centsToUsd(totalAvailableLiabilitiesCents),
    totalReservedForPendingWithdrawals: centsToUsd(totalReservedCents),
    pendingWithdrawalRequestsCount: awaitingReviewCount + approvedAwaitingPayoutCount,
    awaitingReviewCount,
    approvedAwaitingPayoutCount,
    totalSuccessfullyPaidWithdrawals: centsToUsd(paidWithdrawalsCents),
    paidWithdrawalsCount,
    totalRejectedRequestsCount: rejectedCount,
    totalRejectedAmount: centsToUsd(rejectedCents),
    totalCancelledRequestsCount: cancelledCount,
    currency: 'USDT',
  };
}

// Row Mappers
function mapWalletRow(row: any): ReferralWallet {
  const totalEarnedCents = Number(row?.total_earned_cents || 0);
  const availableBalanceCents = Number(row?.available_balance_cents || 0);
  const reservedBalanceCents = Number(row?.reserved_balance_cents || 0);
  const withdrawnBalanceCents = Number(row?.withdrawn_balance_cents || 0);

  return {
    userId: row?.user_id || '',
    currency: 'USDT',
    totalEarnedCents,
    availableBalanceCents,
    reservedBalanceCents,
    withdrawnBalanceCents,
    totalEarned: centsToUsd(totalEarnedCents),
    availableBalance: centsToUsd(availableBalanceCents),
    reservedBalance: centsToUsd(reservedBalanceCents),
    withdrawnBalance: centsToUsd(withdrawnBalanceCents),
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
  };
}

function mapCommissionRow(row: any): ReferralCommission {
  const purchaseAmountCents = Number(row.purchase_amount_cents || 0);
  const commissionAmountCents = Number(row.commission_amount_cents || 0);
  return {
    id: row.id,
    orderId: row.order_id,
    referrerUserId: row.referrer_user_id,
    referredUserId: row.referred_user_id,
    referredUserEmail: row.referred_user_email,
    referralCode: row.referral_code,
    planId: row.plan_id,
    planName: row.plan_name,
    purchaseAmountCents,
    purchaseAmount: centsToUsd(purchaseAmountCents),
    commissionRateBps: Number(row.commission_rate_bps || COMMISSION_RATE_BPS),
    commissionAmountCents,
    commissionAmount: centsToUsd(commissionAmountCents),
    currency: 'USDT',
    status: 'credited',
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapLedgerRow(row: any): ReferralWalletLedgerEntry {
  const amountCents = Number(row.amount_cents || 0);
  const balanceAfterCents = Number(row.balance_after_cents || 0);
  const reservedAfterCents = Number(row.reserved_after_cents || 0);
  const cleanDescription = String(row.description || '')
    .replace(/\$(\d+(?:\.\d+)?)\s*USD/g, '$1 USDT')
    .replace(/\$(\d+(?:\.\d+)?)/g, '$1 USDT')
    .replace(/\bUSD\b/g, 'USDT');
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amountCents,
    amount: centsToUsd(amountCents),
    currency: 'USDT',
    referenceId: row.reference_id,
    idempotencyKey: row.idempotency_key,
    balanceAfterCents,
    balanceAfter: centsToUsd(balanceAfterCents),
    reservedAfterCents,
    reservedAfter: centsToUsd(reservedAfterCents),
    description: cleanDescription,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapWithdrawalRow(row: any): WithdrawalRequestRecord {
  const amountCents = Number(row.amount_cents || 0);
  const availableBeforeCents = Number(row.available_balance_before_cents || 0);
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    referralCode: row.referral_code,
    amountCents,
    amount: centsToUsd(amountCents),
    currency: 'USDT',
    network: row.network || PAYOUT_NETWORK_LABEL,
    walletAddress: row.wallet_address,
    status: row.status as WithdrawalStatus,
    availableBalanceBeforeCents: availableBeforeCents,
    availableBalanceBefore: centsToUsd(availableBeforeCents),
    approvedById: row.approved_by_id || undefined,
    approvedByEmail: row.approved_by_email || undefined,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : undefined,
    paidById: row.paid_by_id || undefined,
    paidByEmail: row.paid_by_email || undefined,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : undefined,
    txHash: row.tx_hash || undefined,
    rejectedById: row.rejected_by_id || undefined,
    rejectedByEmail: row.rejected_by_email || undefined,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at).toISOString() : undefined,
    rejectionReason: row.rejection_reason || undefined,
    cancelledById: row.cancelled_by_id || undefined,
    cancelledByEmail: row.cancelled_by_email || undefined,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date(row.created_at).toISOString(),
  };
}
