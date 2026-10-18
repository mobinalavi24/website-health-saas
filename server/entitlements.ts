import { query, withTransaction } from './db/connection.ts';
import { db } from './db.ts';
import { getAccountTrialStatus } from './trial.ts';
import type { SubscriptionEntitlement, UserCapacityInfo } from '../src/types.ts';

export type { SubscriptionEntitlement, UserCapacityInfo };

/**
 * Ensure subscription_entitlements table exists in PostgreSQL.
 */
export async function ensureEntitlementsTable(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS subscription_entitlements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      billing_interval TEXT NOT NULL DEFAULT 'monthly',
      website_slots INTEGER NOT NULL DEFAULT 5,
      order_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_entitlements_user_status ON subscription_entitlements(user_id, status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_entitlements_org ON subscription_entitlements(org_id);
    CREATE INDEX IF NOT EXISTS idx_entitlements_order ON subscription_entitlements(order_id);
  `;
  try {
    await query(sql);
  } catch (err: any) {
    // Already created or in-memory pg
  }
}

/**
 * Creates an independent subscription entitlement within a database transaction upon payment approval.
 * Idempotent: Row-level conflict check on unique order_id prevents duplicate entitlements.
 * Does NOT overwrite, reset, or change any existing entitlement expiration dates.
 */
export async function createSubscriptionEntitlementInTransaction(
  client: any,
  orderRow: {
    id: string;
    org_id: string;
    user_id: string;
    user_email?: string;
    plan_id: string;
    plan_name: string;
    billing_interval: string;
    amount?: number | string;
  }
): Promise<SubscriptionEntitlement> {
  await ensureEntitlementsTable();

  // 1. Check idempotency: does an entitlement already exist for this order?
  const existing = await client.query(
    'SELECT * FROM subscription_entitlements WHERE order_id = $1',
    [orderRow.id]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    return mapEntitlementRow(row);
  }

  // 2. Determine duration and slots
  // Pro: 5 websites. Monthly = 30 days, Annual = 365 days.
  const isAnnual = orderRow.billing_interval?.toLowerCase() === 'annual';
  const durationMs = isAnnual
    ? 365 * 24 * 60 * 60 * 1000
    : 30 * 24 * 60 * 60 * 1000;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMs);
  const entitlementId = `ent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const slots = orderRow.plan_id === 'agency' ? 15 : 5;

  const insertSql = `
    INSERT INTO subscription_entitlements (
      id, user_id, org_id, plan_id, plan_name, billing_interval,
      website_slots, order_id, status, started_at, expires_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $9)
    ON CONFLICT (order_id) DO NOTHING
    RETURNING *;
  `;

  const res = await client.query(insertSql, [
    entitlementId,
    orderRow.user_id,
    orderRow.org_id,
    orderRow.plan_id,
    orderRow.plan_name || (orderRow.plan_id === 'pro' ? 'Pro' : 'Subscription'),
    isAnnual ? 'annual' : 'monthly',
    slots,
    orderRow.id,
    now.toISOString(),
    expiresAt.toISOString(),
  ]);

  let entitlement: SubscriptionEntitlement;
  if (res.rows.length > 0) {
    entitlement = mapEntitlementRow(res.rows[0]);
  } else {
    // If conflict hit concurrently, fetch existing
    const retry = await client.query(
      'SELECT * FROM subscription_entitlements WHERE order_id = $1',
      [orderRow.id]
    );
    entitlement = mapEntitlementRow(retry.rows[0]);
  }

  // Sync with runtime in-memory database
  db.addEntitlement(entitlement);

  return entitlement;
}

/**
 * Retrieve all subscription entitlements for a user.
 * Automatically marks expired entitlements as 'expired' based on expiration timestamp.
 */
export async function getUserEntitlements(
  userId: string,
  orgId?: string
): Promise<SubscriptionEntitlement[]> {
  await ensureEntitlementsTable();
  const nowIso = new Date().toISOString();

  // Update expired statuses in DB
  try {
    await query(
      `UPDATE subscription_entitlements
       SET status = 'expired'
       WHERE (user_id = $1 OR org_id = $2)
         AND status = 'active'
         AND expires_at <= $3`,
      [userId, orgId || '', nowIso]
    );
  } catch {
    // ignore
  }

  let entitlements: SubscriptionEntitlement[] = [];
  try {
    const res = await query(
      `SELECT * FROM subscription_entitlements
       WHERE user_id = $1 OR (org_id = $2 AND org_id != '')
       ORDER BY created_at DESC`,
      [userId, orgId || '']
    );
    entitlements = res.rows.map(mapEntitlementRow);
  } catch (e) {
    // In-memory fallback
    entitlements = db.getEntitlements().filter(
      (e) => e.userId === userId || (orgId && e.orgId === orgId)
    );
  }

  // Sync status against current clock
  const nowMs = Date.now();
  for (const ent of entitlements) {
    if (ent.status === 'active' && new Date(ent.expiresAt).getTime() <= nowMs) {
      ent.status = 'expired';
    }
  }

  return entitlements;
}

/**
 * Calculates effective website capacity based on active, non-expired subscription entitlements.
 * Sums website slots of all active entitlements.
 * If no active entitlements, falls back to free trial rules.
 */
export async function calculateUserWebsiteCapacity(
  userId: string,
  orgId: string
): Promise<UserCapacityInfo> {
  const allEntitlements = await getUserEntitlements(userId, orgId);
  const nowMs = Date.now();

  const activeEntitlements = allEntitlements.filter(
    (e) => e.status === 'active' && new Date(e.expiresAt).getTime() > nowMs
  );

  const org = db.findOrgById(orgId);
  const orgSites = db.getWebsites().filter((w) => w.orgId === orgId);
  const usedSlots = orgSites.length;

  let totalSlots = 0;
  let isTrial = false;
  let isExpiredTrial = false;
  let trialEndsAt: string | undefined = undefined;

  if (activeEntitlements.length > 0) {
    // Sum website slots from all stacked active entitlements
    totalSlots = activeEntitlements.reduce((sum, e) => sum + (e.websiteSlots || 5), 0);
    isTrial = false;
    isExpiredTrial = false;
  } else {
    // Fallback to Organization / Free Trial rules
    if (org) {
      const trial = getAccountTrialStatus(org);
      trialEndsAt = org.trialEndsAt;
      if (org.planId === 'free') {
        isTrial = true;
        if (trial.isExpired) {
          totalSlots = 0;
          isExpiredTrial = true;
        } else {
          totalSlots = 1; // 1 website allowed during active 24h trial
          isExpiredTrial = false;
        }
      } else {
        // Legacy active Pro fallback without explicit entitlement
        totalSlots = 5;
      }
    } else {
      totalSlots = 1;
      isTrial = true;
    }
  }

  const remainingSlots = Math.max(0, totalSlots - usedSlots);

  return {
    totalSlots,
    usedSlots,
    remainingSlots,
    activeEntitlements,
    allEntitlements,
    isTrial,
    isExpiredTrial,
    trialEndsAt,
  };
}

/**
 * Determines whether a specific website is eligible for monitoring and scanning
 * under the user's active subscription capacity.
 * Websites are ranked by their creation date: the oldest sites within totalSlots are active;
 * any websites exceeding totalSlots are marked as inactive capacity (due to expired entitlement).
 */
export async function isWebsiteEligible(
  websiteId: string,
  orgId: string,
  userId: string
): Promise<{ eligible: boolean; reason?: string; siteIndex?: number; totalCapacity?: number }> {
  const capacity = await calculateUserWebsiteCapacity(userId, orgId);

  const orgSites = db.getWebsites()
    .filter((w) => w.orgId === orgId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const siteIndex = orgSites.findIndex((w) => w.id === websiteId);
  if (siteIndex === -1) {
    return { eligible: false, reason: 'Website not found.' };
  }

  if (capacity.isExpiredTrial) {
    return {
      eligible: false,
      reason: 'Your 24-hour free trial has expired. Please purchase a Pro subscription to monitor this website.',
      siteIndex,
      totalCapacity: capacity.totalSlots,
    };
  }

  if (siteIndex >= capacity.totalSlots) {
    return {
      eligible: false,
      reason: `Website #${siteIndex + 1} exceeds your active subscription capacity of ${capacity.totalSlots} websites. Please purchase an additional subscription to reactivate monitoring for this site.`,
      siteIndex,
      totalCapacity: capacity.totalSlots,
    };
  }

  return {
    eligible: true,
    siteIndex,
    totalCapacity: capacity.totalSlots,
  };
}

/**
 * Safely backfill subscription entitlements for existing paid crypto orders and active organizations.
 * Ensures existing subscriptions are never lost during upgrades or restarts.
 */
export async function backfillExistingSubEntitlements(client?: any): Promise<number> {
  await ensureEntitlementsTable();
  const runner = client ? client.query.bind(client) : query;
  let backfilled = 0;

  try {
    // 1. Backfill from paid crypto orders
    const paidOrders = await runner(
      `SELECT * FROM crypto_orders WHERE status = 'Paid'`
    );

    for (const order of paidOrders.rows) {
      const check = await runner(
        'SELECT id FROM subscription_entitlements WHERE order_id = $1',
        [order.id]
      );
      if (check.rows.length === 0) {
        // Ensure user exists in users table before inserting entitlement to satisfy foreign key
        const uCheck = await runner('SELECT id FROM users WHERE id = $1', [order.user_id]);
        if (uCheck.rows.length === 0) {
          const memU = db.findUserById(order.user_id);
          if (memU) {
            const targetOrgId = memU.orgId || order.org_id;
            const oCheck = await runner('SELECT id FROM organizations WHERE id = $1', [targetOrgId]);
            if (oCheck.rows.length === 0) {
              const memO = db.findOrgById(targetOrgId);
              if (memO) {
                await runner(
                  `INSERT INTO organizations (id, name, plan_id, billing_interval, currency, owner_id, trial_started_at, trial_ends_at, trial_used, white_label, clients, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                   ON CONFLICT (id) DO NOTHING`,
                  [
                    memO.id, memO.name, memO.planId, memO.billingInterval, memO.currency, memO.ownerId,
                    memO.trialStartedAt, memO.trialEndsAt, memO.trialUsed, JSON.stringify(memO.whiteLabel), JSON.stringify(memO.clients), memO.createdAt
                  ]
                );
              }
            }
            await runner(
              `INSERT INTO users (id, email, name, password_hash, role, org_id, avatar_url, email_verified, referral_code, referred_by, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               ON CONFLICT (id) DO NOTHING`,
              [
                memU.id, memU.email, memU.name, memU.passwordHash, memU.role, targetOrgId,
                memU.avatarUrl || null, memU.emailVerified ?? true, memU.referralCode || null, memU.referredBy || null, memU.createdAt || new Date().toISOString()
              ]
            );
          } else {
            // User does not exist anywhere, skip backfilling for orphaned order
            continue;
          }
        }

        const isAnnual = order.billing_interval?.toLowerCase() === 'annual';
        const durationDays = isAnnual ? 365 : 30;
        const startDate = order.confirmed_at || order.approved_at || order.created_at || new Date();
        const start = new Date(startDate);
        const expires = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
        const now = new Date();
        const status = expires > now ? 'active' : 'expired';
        const slots = order.plan_id === 'agency' ? 15 : 5;
        const entId = `ent_${order.id}`;

        await runner(
          `INSERT INTO subscription_entitlements (
             id, user_id, org_id, plan_id, plan_name, billing_interval,
             website_slots, order_id, status, started_at, expires_at, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            entId,
            order.user_id,
            order.org_id,
            order.plan_id,
            order.plan_name || 'Pro',
            isAnnual ? 'annual' : 'monthly',
            slots,
            order.id,
            status,
            start.toISOString(),
            expires.toISOString(),
            start.toISOString(),
          ]
        );
        backfilled++;
      }
    }

    // 2. Also ensure active Pro organizations have at least one entitlement
    const proOrgs = await runner(
      `SELECT id, owner_id, plan_id, billing_interval, created_at FROM organizations WHERE plan_id = 'pro'`
    );

    for (const org of proOrgs.rows) {
      if (!org.owner_id) continue;
      const uCheck = await runner('SELECT id FROM users WHERE id = $1', [org.owner_id]);
      if (uCheck.rows.length === 0) continue;
      const check = await runner(
        `SELECT id FROM subscription_entitlements WHERE user_id = $1 AND status = 'active'`,
        [org.owner_id]
      );
      if (check.rows.length === 0) {
        const isAnnual = org.billing_interval?.toLowerCase() === 'annual';
        const start = new Date(org.created_at || Date.now());
        const expires = new Date(Date.now() + (isAnnual ? 365 : 30) * 24 * 60 * 60 * 1000);
        const entId = `ent_org_${org.id}`;

        await runner(
          `INSERT INTO subscription_entitlements (
             id, user_id, org_id, plan_id, plan_name, billing_interval,
             website_slots, order_id, status, started_at, expires_at, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            entId,
            org.owner_id,
            org.id,
            'pro',
            'Pro (Active Org)',
            isAnnual ? 'annual' : 'monthly',
            5,
            null,
            start.toISOString(),
            expires.toISOString(),
          ]
        );
        backfilled++;
      }
    }
  } catch (err: any) {
    console.warn('[Entitlements Backfill Notice]:', err.message);
  }

  return backfilled;
}

function mapEntitlementRow(row: any): SubscriptionEntitlement {
  return {
    id: row.id,
    userId: row.user_id,
    orgId: row.org_id,
    planId: row.plan_id,
    planName: row.plan_name,
    billingInterval: row.billing_interval,
    websiteSlots: parseInt(row.website_slots, 10) || 5,
    orderId: row.order_id || undefined,
    status: row.status,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : new Date().toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : new Date().toISOString(),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}
