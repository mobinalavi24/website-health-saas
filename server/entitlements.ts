import crypto from 'node:crypto';
import type pg from 'pg';
import { db } from './db.ts';
import { query, withTransaction } from './db/connection.ts';
import { getAccountTrialStatus } from './trial.ts';

export type EntitlementStatus = 'active' | 'expired' | 'revoked' | 'cancelled';

export interface SubscriptionEntitlement {
  id: string;
  userId: string;
  orgId: string;
  planId: string;
  planName: string;
  billingInterval: 'monthly' | 'annual';
  websiteCapacity: number;
  orderId: string | null;
  status: EntitlementStatus;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
  createdAt: string;
  daysRemaining: number;
  remainingMs: number;
  isActive: boolean;
}

export interface OrganizationEntitlementSummary {
  orgId: string;
  entitlements: SubscriptionEntitlement[];
  activeEntitlements: SubscriptionEntitlement[];
  expiredEntitlements: SubscriptionEntitlement[];
  activeEntitlementCount: number;
  totalActiveCapacity: number;
  paidActiveCapacity: number;
  freeTrialCapacity: number;
  usedWebsiteSlots: number;
  remainingWebsiteSlots: number;
  overCapacitySlots: number;
  hasActivePaidEntitlement: boolean;
  allPaidEntitlementsExpired: boolean;
  earliestActiveExpiresAt: string | null;
  latestActiveExpiresAt: string | null;
}

export const MONTHLY_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const ANNUAL_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 365 days
export const DEFAULT_PRO_WEBSITE_CAPACITY = 5;

function toIsoString(val: unknown, fallback?: string): string {
  if (!val) return fallback || new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  const parsed = new Date(String(val));
  return Number.isNaN(parsed.getTime()) ? fallback || new Date().toISOString() : parsed.toISOString();
}

export function mapEntitlementRow(row: any, nowMs: number = Date.now()): SubscriptionEntitlement {
  const startsAt = toIsoString(row.starts_at);
  const expiresAt = toIsoString(row.expires_at);
  const purchasedAt = toIsoString(row.purchased_at, startsAt);
  const createdAt = toIsoString(row.created_at, startsAt);
  const expiresMs = new Date(expiresAt).getTime();
  const remainingMs = Math.max(0, expiresMs - nowMs);
  const daysRemaining = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));

  let status: EntitlementStatus = (row.status || 'active') as EntitlementStatus;
  if (status === 'active' && expiresMs <= nowMs) {
    status = 'expired';
  }

  const isActive = status === 'active' && expiresMs > nowMs;

  return {
    id: String(row.id),
    userId: String(row.user_id),
    orgId: String(row.org_id),
    planId: String(row.plan_id || 'pro'),
    planName: String(row.plan_name || 'Pro Plan'),
    billingInterval: row.billing_interval === 'annual' ? 'annual' : 'monthly',
    websiteCapacity: Math.max(1, Number(row.website_capacity) || DEFAULT_PRO_WEBSITE_CAPACITY),
    orderId: row.order_id ? String(row.order_id) : null,
    status,
    purchasedAt,
    startsAt,
    expiresAt,
    revokedAt: row.revoked_at ? toIsoString(row.revoked_at) : null,
    revokedReason: row.revoked_reason ? String(row.revoked_reason) : null,
    createdAt,
    daysRemaining,
    remainingMs,
    isActive,
  };
}

let schemaEnsured = false;
async function ensureEntitlementsTable(): Promise<void> {
  await db.ensureSchema();
  if (schemaEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS subscription_entitlements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        billing_interval TEXT NOT NULL DEFAULT 'monthly',
        website_capacity INTEGER NOT NULL DEFAULT 5,
        order_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoked_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    schemaEnsured = true;
  } catch {
    // Handled if table already exists
  }
}

/**
 * Grants an independent subscription entitlement inside an active PostgreSQL transaction
 * when a crypto payment order is verified and approved (`status = 'Paid'`).
 *
 * - Idempotent per `order_id` (`ON CONFLICT (order_id) DO NOTHING`).
 * - Never grants an entitlement for pending, confirming, rejected, failed, expired, or cancelled orders.
 * - Preserves all existing entitlements and their independent expiration dates.
 */
export async function grantEntitlementForOrderInTransaction(
  client: pg.PoolClient,
  orderRow: {
    id: string;
    user_id: string;
    org_id: string;
    plan_id: string;
    plan_name: string;
    billing_interval?: string;
    amount?: number | string;
    status: string;
    created_at?: string | Date;
    confirmed_at?: string | Date | null;
    approved_at?: string | Date | null;
  },
  options?: {
    customStartsAt?: string;
    customExpiresAt?: string;
  }
): Promise<{ created: boolean; entitlement: SubscriptionEntitlement | null }> {
  const normalizedStatus = String(orderRow.status || '').trim().toLowerCase();
  if (normalizedStatus !== 'paid') {
    return { created: false, entitlement: null };
  }

  // Check if an entitlement was already granted for this order_id
  const existingRes = await client.query(
    'SELECT * FROM subscription_entitlements WHERE order_id = $1 LIMIT 1',
    [orderRow.id]
  );
  if (existingRes.rows.length > 0) {
    return {
      created: false,
      entitlement: mapEntitlementRow(existingRes.rows[0]),
    };
  }

  const billingInterval: 'monthly' | 'annual' =
    orderRow.billing_interval === 'annual' || Number(orderRow.amount || 0) >= 40
      ? 'annual'
      : 'monthly';

  const plan = db.getPlans().find((p) => p.id === (orderRow.plan_id || 'pro'));
  const websiteCapacity = Math.max(1, plan?.limits?.maxWebsites || DEFAULT_PRO_WEBSITE_CAPACITY);

  const startsAtIso =
    options?.customStartsAt ||
    toIsoString(orderRow.approved_at || orderRow.confirmed_at || new Date().toISOString());
  const purchasedAtIso = toIsoString(orderRow.created_at, startsAtIso);
  const startsMs = new Date(startsAtIso).getTime();
  const durationMs = billingInterval === 'annual' ? ANNUAL_DURATION_MS : MONTHLY_DURATION_MS;
  const expiresAtIso =
    options?.customExpiresAt || new Date(startsMs + durationMs).toISOString();

  const entitlementId = `ent_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const nowIso = new Date().toISOString();

  const insertRes = await client.query(
    `INSERT INTO subscription_entitlements (
       id, user_id, org_id, plan_id, plan_name, billing_interval,
       website_capacity, order_id, status, purchased_at, starts_at, expires_at, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12)
     ON CONFLICT (order_id) DO NOTHING
     RETURNING *`,
    [
      entitlementId,
      orderRow.user_id,
      orderRow.org_id,
      orderRow.plan_id || 'pro',
      orderRow.plan_name || (billingInterval === 'annual' ? 'Pro Plan (Annual)' : 'Pro Plan (Monthly)'),
      billingInterval,
      websiteCapacity,
      orderRow.id,
      purchasedAtIso,
      startsAtIso,
      expiresAtIso,
      nowIso,
    ]
  );

  if (insertRes.rows.length === 0) {
    const retryRes = await client.query(
      'SELECT * FROM subscription_entitlements WHERE order_id = $1 LIMIT 1',
      [orderRow.id]
    );
    return {
      created: false,
      entitlement: retryRes.rows[0] ? mapEntitlementRow(retryRes.rows[0]) : null,
    };
  }

  return {
    created: true,
    entitlement: mapEntitlementRow(insertRes.rows[0]),
  };
}

/**
 * Safely backfills subscription_entitlements from existing paid crypto_orders
 * and legacy Pro organizations so no existing active subscription loses capacity.
 */
export async function backfillSubscriptionEntitlements(): Promise<{
  backfilledOrders: number;
  backfilledOrgs: number;
}> {
  await ensureEntitlementsTable();
  let backfilledOrders = 0;
  let backfilledOrgs = 0;

  await withTransaction(async (client) => {
    // 1. Backfill from all paid crypto_orders
    const paidOrdersRes = await client.query(
      `SELECT * FROM crypto_orders WHERE LOWER(status) = 'paid' ORDER BY created_at ASC`
    );

    for (const orderRow of paidOrdersRes.rows) {
      const res = await grantEntitlementForOrderInTransaction(client, {
        ...orderRow,
        status: 'Paid',
      });
      if (res.created) {
        backfilledOrders++;
      }
    }

    // 2. Backfill any organization currently marked as 'pro' that has 0 entitlements in subscription_entitlements
    const proOrgsRes = await client.query(
      `SELECT o.*
       FROM organizations o
       WHERE o.plan_id = 'pro'
         AND NOT EXISTS (
           SELECT 1 FROM subscription_entitlements se WHERE se.org_id = o.id
         )`
    );

    for (const orgRow of proOrgsRes.rows) {
      const legacyOrderId = `legacy_org_${orgRow.id}`;
      const billingInterval: 'monthly' | 'annual' =
        orgRow.billing_interval === 'annual' ? 'annual' : 'monthly';
      const startsAtIso = toIsoString(orgRow.created_at, new Date().toISOString());
      // Ensure legacy seed/admin orgs have an active window extending at least 30 days from now if created in the past
      const baseMs = Math.max(new Date(startsAtIso).getTime(), Date.now() - 5 * 24 * 60 * 60 * 1000);
      const durationMs = billingInterval === 'annual' ? ANNUAL_DURATION_MS : MONTHLY_DURATION_MS;
      const expiresAtIso = new Date(baseMs + durationMs).toISOString();
      const entId = `ent_legacy_${orgRow.id}`;

      const ins = await client.query(
        `INSERT INTO subscription_entitlements (
           id, user_id, org_id, plan_id, plan_name, billing_interval,
           website_capacity, order_id, status, purchased_at, starts_at, expires_at, created_at
         )
         VALUES ($1, $2, $3, 'pro', $4, $5, $6, $7, 'active', $8, $9, $10, $11)
         ON CONFLICT (order_id) DO NOTHING
         RETURNING id`,
        [
          entId,
          orgRow.owner_id || 'system',
          orgRow.id,
          billingInterval === 'annual' ? 'Pro Plan (Annual)' : 'Pro Plan (Monthly)',
          billingInterval,
          DEFAULT_PRO_WEBSITE_CAPACITY,
          legacyOrderId,
          startsAtIso,
          new Date(baseMs).toISOString(),
          expiresAtIso,
          new Date().toISOString(),
        ]
      );
      if (ins.rows.length > 0) {
        backfilledOrgs++;
      }
    }
  });

  return { backfilledOrders, backfilledOrgs };
}

/**
 * Synchronizes expired entitlements in PostgreSQL and returns the authoritative
 * capacity summary for an organization.
 *
 * Rules enforced:
 * - Each active, non-expired entitlement contributes its `websiteCapacity` (5 slots for Pro).
 * - Multiple active entitlements stack additively (e.g., 2 active Pro entitlements = 10 slots).
 * - Each entitlement expires independently based on its own `expiresAt`.
 * - When an entitlement expires, its slots are no longer counted toward `totalActiveCapacity`,
 *   WITHOUT deleting existing websites, scan results, metrics, or incidents.
 * - If all paid entitlements have expired, `totalActiveCapacity` drops to 0 (or 1 if an initial
 *   Free Trial is somehow still active).
 */
export async function getOrganizationEntitlementSummary(
  orgId: string
): Promise<OrganizationEntitlementSummary> {
  await ensureEntitlementsTable();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 1. Mark any active entitlements whose expires_at <= now as 'expired'
  await query(
    `UPDATE subscription_entitlements
     SET status = 'expired'
     WHERE org_id = $1 AND status = 'active' AND expires_at <= $2`,
    [orgId, nowIso]
  );

  // 2. Fetch all entitlements for this organization
  const entRes = await query(
    `SELECT * FROM subscription_entitlements
     WHERE org_id = $1
     ORDER BY expires_at ASC, created_at DESC`,
    [orgId]
  );

  const entitlements = entRes.rows.map((r) => mapEntitlementRow(r, nowMs));
  const activeEntitlements = entitlements.filter((e) => e.isActive);
  const expiredEntitlements = entitlements.filter((e) => !e.isActive);

  const paidActiveCapacity = activeEntitlements.reduce(
    (sum, item) => sum + item.websiteCapacity,
    0
  );

  // 3. Check organization state & Free Trial
  const org = db.getOrganizations().find((o) => o.id === orgId);
  let freeTrialCapacity = 0;

  if (activeEntitlements.length > 0) {
    // Organization has at least 1 active paid entitlement -> ensure org.planId is 'pro'
    if (org && org.planId !== 'pro') {
      db.updateOrganization(org.id, { planId: 'pro' });
    }
  } else if (entitlements.length > 0 && activeEntitlements.length === 0) {
    // Organization previously had paid entitlements, and ALL of them have now expired!
    // Revert planId to 'free' with trialUsed=true so expired Pro does not grant free slots
    if (org && org.planId === 'pro') {
      const expiredTrialEndsAt =
        !org.trialEndsAt || new Date(org.trialEndsAt).getTime() > nowMs
          ? nowIso
          : org.trialEndsAt;
      db.updateOrganization(org.id, {
        planId: 'free',
        trialUsed: true,
        trialEndsAt: expiredTrialEndsAt,
      });
    }
  } else if (org) {
    // Organization has never had a paid entitlement -> check if 24-hour Free Trial is active
    const trialInfo = getAccountTrialStatus(org, nowMs);
    if (org.planId === 'free' && !trialInfo.isExpired) {
      freeTrialCapacity = 1;
    }
  }

  const totalActiveCapacity =
    activeEntitlements.length > 0 ? paidActiveCapacity : freeTrialCapacity;

  // 4. Count currently monitored websites for this organization
  const usedWebsiteSlots = db.getWebsites().filter((w) => w.orgId === orgId).length;
  const remainingWebsiteSlots = Math.max(0, totalActiveCapacity - usedWebsiteSlots);
  const overCapacitySlots = Math.max(0, usedWebsiteSlots - totalActiveCapacity);

  const sortedActiveByExpiry = [...activeEntitlements].sort(
    (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
  );

  return {
    orgId,
    entitlements,
    activeEntitlements,
    expiredEntitlements,
    activeEntitlementCount: activeEntitlements.length,
    totalActiveCapacity,
    paidActiveCapacity,
    freeTrialCapacity,
    usedWebsiteSlots,
    remainingWebsiteSlots,
    overCapacitySlots,
    hasActivePaidEntitlement: activeEntitlements.length > 0,
    allPaidEntitlementsExpired: entitlements.length > 0 && activeEntitlements.length === 0,
    earliestActiveExpiresAt: sortedActiveByExpiry[0]?.expiresAt || null,
    latestActiveExpiresAt:
      sortedActiveByExpiry[sortedActiveByExpiry.length - 1]?.expiresAt || null,
  };
}
