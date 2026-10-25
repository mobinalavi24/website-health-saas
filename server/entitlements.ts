import crypto from 'node:crypto';
import type pg from 'pg';
import { db, type Website, type User, type Organization } from './db.ts';
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
  isUnlimited?: boolean;
}

export const MONTHLY_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const ANNUAL_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 365 days
export const GRACE_PERIOD_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days (48 hours)
export const DEFAULT_PRO_WEBSITE_CAPACITY = 5;
export const SUPER_ADMIN_EMAIL = 'mobinalavi7491@gmail.com';
export const UNLIMITED_CAPACITY = 999999;

/**
 * Authoritatively checks whether the user or organization belongs to the designated
 * unlimited Super Admin account (`mobinalavi7491@gmail.com`).
 * Always verifies against the trusted server-side user record in `db` — never trusts
 * an unverified email string alone.
 */
export function isExemptSuperAdmin(
  user?: { id?: string; email?: string; role?: string } | null,
  org?: { id?: string; ownerId?: string } | null
): boolean {
  if (user && user.id) {
    const trustedUser = db.findUserById(user.id);
    if (
      trustedUser &&
      trustedUser.role === 'super_admin' &&
      trustedUser.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL
    ) {
      return true;
    }
    return false;
  }

  if (org) {
    if (org.ownerId) {
      const owner = db.findUserById(org.ownerId);
      if (
        owner &&
        owner.role === 'super_admin' &&
        owner.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL
      ) {
        return true;
      }
    }
    const orgSuperAdmin = db
      .getUsers()
      .find(
        (u) =>
          u.orgId === org.id &&
          u.role === 'super_admin' &&
          u.email.trim().toLowerCase() === SUPER_ADMIN_EMAIL
      );
    if (orgSuperAdmin) {
      return true;
    }
  }

  return false;
}

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
export async function ensureEntitlementsTable(): Promise<void> {
  await db.ensureSchema();
  if (schemaEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS subscription_entitlements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
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
    await query(
      `ALTER TABLE subscription_entitlements DROP CONSTRAINT IF EXISTS subscription_entitlements_org_id_fkey`
    ).catch(() => {});

    const websiteAlterStatements = [
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS entitlement_id TEXT',
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ',
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ',
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMPTZ',
      "ALTER TABLE websites ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'active'",
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS last_whois_result JSONB',
    ];
    for (const st of websiteAlterStatements) {
      await query(st).catch(() => {});
    }
    schemaEnsured = true;
  } catch {
    // Handled if table already exists
  }
}

/**
 * Grants an independent subscription entitlement inside an active PostgreSQL transaction
 * when a crypto payment order is verified and approved (`status = 'Paid'`).
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

  let effectiveOrgId = orderRow.org_id;
  const orgCheck = await client.query('SELECT id FROM organizations WHERE id = $1 LIMIT 1', [
    effectiveOrgId,
  ]);
  if (orgCheck.rows.length === 0 && orderRow.user_id) {
    const userCheck = await client.query('SELECT org_id FROM users WHERE id = $1 LIMIT 1', [
      orderRow.user_id,
    ]);
    if (userCheck.rows[0]?.org_id) {
      effectiveOrgId = String(userCheck.rows[0].org_id);
    }
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
      effectiveOrgId,
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

    const proOrgsRes = await client.query(`SELECT * FROM organizations WHERE plan_id = 'pro'`);
    const existingEntOrgsRes = await client.query(`SELECT DISTINCT org_id FROM subscription_entitlements`);
    const orgsWithEntitlements = new Set(existingEntOrgsRes.rows.map((r: any) => String(r.org_id)));

    for (const orgRow of proOrgsRes.rows) {
      if (orgsWithEntitlements.has(String(orgRow.id))) continue;
      const legacyOrderId = `legacy_org_${orgRow.id}`;
      const billingInterval: 'monthly' | 'annual' =
        orgRow.billing_interval === 'annual' ? 'annual' : 'monthly';
      const startsAtIso = toIsoString(orgRow.created_at, new Date().toISOString());
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

// Per-organization mutex to serialize website-to-entitlement allocation & renewal reconciliation
const orgLocks = new Map<string, Promise<any>>();
async function withOrgLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const prev = orgLocks.get(orgId) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  orgLocks.set(orgId, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (orgLocks.get(orgId) === next) {
      orgLocks.delete(orgId);
    }
  }
}

/**
 * Reconciles website-to-entitlement allocations, expiration states, 2-day deletion deadlines,
 * and renewal restorations for a given organization.
 */
export async function reconcileOrganizationWebsiteAllocations(
  orgId: string,
  nowMs: number = Date.now()
): Promise<void> {
  await ensureEntitlementsTable();
  return withOrgLock(orgId, async () => {
    const nowIso = new Date(nowMs).toISOString();

    // 1. Mark any active entitlements whose expires_at <= nowMs as 'expired'
    await query(
      `UPDATE subscription_entitlements
       SET status = 'expired'
       WHERE org_id = $1 AND status = 'active' AND expires_at <= $2`,
      [orgId, nowIso]
    );

    const org = db.findOrgById(orgId);
    const orgSites = db
      .getWebsites()
      .filter((w) => w.orgId === orgId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    if (orgSites.length === 0) return;

    // 2. Super Admin Unlimited Exemption
    if (isExemptSuperAdmin(null, org)) {
      for (const site of orgSites) {
        if (
          site.entitlementId !== 'super_admin_unlimited' ||
          site.accessStatus !== 'active' ||
          site.isSubscriptionExpired ||
          site.scheduledDeletionAt
        ) {
          db.updateWebsite(site.id, {
            entitlementId: 'super_admin_unlimited',
            subscriptionExpiresAt: null,
            expiredAt: null,
            scheduledDeletionAt: null,
            accessStatus: 'active',
            isSubscriptionExpired: false,
            deletionRemainingMs: null,
          });
        }
      }
      return;
    }

    // 3. Load all entitlements for this organization
    const entRes = await query(
      `SELECT * FROM subscription_entitlements
       WHERE org_id = $1
       ORDER BY purchased_at ASC, created_at ASC`,
      [orgId]
    );
    const allEntitlements = entRes.rows.map((r) => mapEntitlementRow(r, nowMs));
    const entById = new Map<string, SubscriptionEntitlement>(
      allEntitlements.map((e) => [e.id, e])
    );
    const activeEntitlements = allEntitlements.filter((e) => e.isActive);

    // Track how many slots are used on each entitlement
    const usedSlotsByEnt = new Map<string, number>();
    for (const ent of allEntitlements) {
      usedSlotsByEnt.set(ent.id, 0);
    }

    // First pass: count websites already explicitly bound to an entitlement
    for (const site of orgSites) {
      if (site.entitlementId && entById.has(site.entitlementId)) {
        usedSlotsByEnt.set(
          site.entitlementId,
          (usedSlotsByEnt.get(site.entitlementId) || 0) + 1
        );
      }
    }

    // Second pass: backfill any unallocated websites (!site.entitlementId) safely
    for (const site of orgSites) {
      if (site.entitlementId) continue;

      // Try to match to an entitlement that has remaining capacity (preferring active, then historical)
      const candidateEnt =
        activeEntitlements.find(
          (e) => (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
        ) ||
        allEntitlements.find(
          (e) => (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
        );

      if (candidateEnt) {
        usedSlotsByEnt.set(
          candidateEnt.id,
          (usedSlotsByEnt.get(candidateEnt.id) || 0) + 1
        );
        site.entitlementId = candidateEnt.id;
        site.subscriptionExpiresAt = candidateEnt.expiresAt;
      } else if (
        allEntitlements.length === 0 &&
        org &&
        org.planId === 'free' &&
        org.trialEndsAt &&
        orgSites.length === 1
      ) {
        site.entitlementId = 'free_trial';
        site.subscriptionExpiresAt = org.trialEndsAt;
      } else {
        // Ambiguous legacy website: flag for safe handling rather than guessing or deleting
        db.updateWebsite(site.id, {
          entitlementId: 'ambiguous_legacy',
          accessStatus: 'ambiguous_protected',
          isSubscriptionExpired: false,
          scheduledDeletionAt: null,
          deletionRemainingMs: null,
        });
        continue;
      }
    }

    // Third pass: evaluate active vs expired status and handle renewals!
    for (const site of orgSites) {
      if (
        site.entitlementId === 'ambiguous_legacy' ||
        site.entitlementId === 'super_admin_unlimited'
      ) {
        continue;
      }

      if (site.entitlementId === 'free_trial') {
        const trialEndsIso = org?.trialEndsAt || site.subscriptionExpiresAt;
        const trialEndsMs = trialEndsIso ? new Date(trialEndsIso).getTime() : 0;
        const isTrialStillActive = trialEndsMs > nowMs && org?.planId === 'free';

        if (isTrialStillActive) {
          db.updateWebsite(site.id, {
            entitlementId: 'free_trial',
            subscriptionExpiresAt: trialEndsIso,
            expiredAt: null,
            scheduledDeletionAt: null,
            accessStatus: 'active',
            isSubscriptionExpired: false,
            deletionRemainingMs: null,
          });
          continue;
        }

        // Free trial expired -> check if user purchased an active paid entitlement (upgrade/renewal)!
        const upgradeEnt = activeEntitlements.find(
          (e) => (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
        );
        if (upgradeEnt) {
          usedSlotsByEnt.set(upgradeEnt.id, (usedSlotsByEnt.get(upgradeEnt.id) || 0) + 1);
          db.updateWebsite(site.id, {
            entitlementId: upgradeEnt.id,
            subscriptionExpiresAt: upgradeEnt.expiresAt,
            expiredAt: null,
            scheduledDeletionAt: null,
            accessStatus: 'active',
            isSubscriptionExpired: false,
            deletionRemainingMs: null,
          });
          continue;
        }

        // Otherwise mark free trial website as expired with 2-day grace period
        const expIso = trialEndsIso || nowIso;
        const expMs = new Date(expIso).getTime();
        const delIso = new Date(expMs + GRACE_PERIOD_DURATION_MS).toISOString();
        const remMs = Math.max(0, new Date(delIso).getTime() - nowMs);
        db.updateWebsite(site.id, {
          entitlementId: 'free_trial',
          subscriptionExpiresAt: expIso,
          expiredAt: expIso,
          scheduledDeletionAt: delIso,
          accessStatus: 'expired_grace_period',
          isSubscriptionExpired: true,
          deletionRemainingMs: remMs,
        });
        continue;
      }

      const assignedEnt = site.entitlementId ? entById.get(site.entitlementId) : undefined;
      if (!assignedEnt) {
        // Entitlement record missing/unknown -> protect as ambiguous rather than guessing
        db.updateWebsite(site.id, {
          entitlementId: 'ambiguous_legacy',
          accessStatus: 'ambiguous_protected',
          isSubscriptionExpired: false,
          scheduledDeletionAt: null,
          deletionRemainingMs: null,
        });
        continue;
      }

      if (assignedEnt.isActive) {
        // Direct entitlement is active (including if it was renewed in-place!)
        const wasExpired = site.accessStatus === 'expired_grace_period' || site.isSubscriptionExpired;
        db.updateWebsite(site.id, {
          entitlementId: assignedEnt.id,
          subscriptionExpiresAt: assignedEnt.expiresAt,
          expiredAt: null,
          scheduledDeletionAt: null,
          accessStatus: 'active',
          isSubscriptionExpired: false,
          deletionRemainingMs: null,
        });
        if (wasExpired) {
          db.addAuditLog({
            id: `aud_renew_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            orgId,
            action: 'WEBSITE_RENEWAL_RESTORED',
            target: site.domain,
            details: `Cancelled pending deletion and restored website "${site.name}" (${site.id}) under renewed entitlement ${assignedEnt.id}.`,
            timestamp: nowIso,
          });
        }
        continue;
      }

      // Assigned entitlement has EXPIRED (assignedEnt.isActive === false).
      // Check if the customer purchased a NEW renewal entitlement AFTER the expired entitlement was created/expired!
      const assignedStartMs = new Date(assignedEnt.startsAt).getTime();
      const assignedExpMs = new Date(assignedEnt.expiresAt).getTime();
      const renewalEnt = activeEntitlements.find((candidate) => {
        const used = usedSlotsByEnt.get(candidate.id) || 0;
        if (used >= candidate.websiteCapacity) return false;
        const candStartMs = new Date(candidate.startsAt).getTime();
        const candCreatedMs = new Date(candidate.createdAt).getTime();
        // A renewal/replacement entitlement is one purchased/started at or after the expired entitlement's expiration
        return candStartMs >= assignedExpMs || candCreatedMs >= assignedExpMs;
      });

      if (renewalEnt) {
        usedSlotsByEnt.set(renewalEnt.id, (usedSlotsByEnt.get(renewalEnt.id) || 0) + 1);
        db.updateWebsite(site.id, {
          entitlementId: renewalEnt.id,
          subscriptionExpiresAt: renewalEnt.expiresAt,
          expiredAt: null,
          scheduledDeletionAt: null,
          accessStatus: 'active',
          isSubscriptionExpired: false,
          deletionRemainingMs: null,
        });
        db.addAuditLog({
          id: `aud_renew_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          orgId,
          action: 'WEBSITE_RENEWAL_RESTORED',
          target: site.domain,
          details: `Cancelled pending deletion and re-allocated website "${site.name}" (${site.id}) from expired entitlement ${assignedEnt.id} to renewed entitlement ${renewalEnt.id}.`,
          timestamp: nowIso,
        });
        continue;
      }

      // No renewal entitlement covers this website -> enforce expiration and deterministic 2-day deletion schedule
      const expIso = assignedEnt.expiresAt;
      const expMs = new Date(expIso).getTime();
      const delIso = new Date(expMs + GRACE_PERIOD_DURATION_MS).toISOString();
      const remMs = Math.max(0, new Date(delIso).getTime() - nowMs);

      db.updateWebsite(site.id, {
        entitlementId: assignedEnt.id,
        subscriptionExpiresAt: expIso,
        expiredAt: expIso,
        scheduledDeletionAt: delIso,
        accessStatus: 'expired_grace_period',
        isSubscriptionExpired: true,
        deletionRemainingMs: remMs,
      });
    }
  });
}

/**
 * Automatically deletes websites whose 2-day post-expiration grace period has elapsed.
 * - Safe to run repeatedly (idempotent).
 * - Handles missed executions and server restarts.
 * - Never deletes websites belonging to the designated Super Admin (`mobinalavi7491@gmail.com`).
 * - Never deletes ambiguous legacy websites.
 * - Preserves all user accounts, organizations, payment records, subscription entitlements, and audit logs.
 */
export async function cleanupOverdueExpiredWebsites(
  nowMs: number = Date.now()
): Promise<{ deletedWebsiteIds: string[]; deletedCount: number }> {
  await ensureEntitlementsTable();
  const orgIds = Array.from(new Set(db.getWebsites().map((w) => w.orgId)));
  for (const orgId of orgIds) {
    await reconcileOrganizationWebsiteAllocations(orgId, nowMs);
  }

  const deletedWebsiteIds: string[] = [];
  const nowIso = new Date(nowMs).toISOString();

  const candidates = db.getWebsites().filter((site) => {
    if (site.accessStatus !== 'expired_grace_period') return false;
    if (!site.scheduledDeletionAt) return false;
    if (
      site.entitlementId === 'super_admin_unlimited' ||
      site.entitlementId === 'ambiguous_legacy'
    ) {
      return false;
    }
    const org = db.findOrgById(site.orgId);
    if (isExemptSuperAdmin(null, org)) return false;
    const delMs = new Date(site.scheduledDeletionAt).getTime();
    return Number.isFinite(delMs) && delMs <= nowMs;
  });

  for (const site of candidates) {
    try {
      const removed = db.removeWebsite(site.id);
      if (removed) {
        deletedWebsiteIds.push(site.id);
        db.addAuditLog({
          id: `aud_del_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          orgId: site.orgId,
          action: 'WEBSITE_EXPIRED_AUTO_DELETED',
          target: site.domain,
          details: `Automatically deleted website "${site.name}" (${site.id}) after 2-day post-expiration grace period ended (expiredAt: ${site.expiredAt}, scheduledDeletionAt: ${site.scheduledDeletionAt}).`,
          timestamp: nowIso,
        });
        console.log(
          `[Entitlement Cleanup] Deleted overdue expired website ${site.id} (${site.domain}) for org ${site.orgId} (deadline: ${site.scheduledDeletionAt}).`
        );
      }
    } catch (err: any) {
      console.error(
        `[Entitlement Cleanup Error] Failed to delete overdue website ${site.id}:`,
        err?.message || 'Unknown error'
      );
    }
  }

  return {
    deletedWebsiteIds,
    deletedCount: deletedWebsiteIds.length,
  };
}

/**
 * Synchronizes expired entitlements in PostgreSQL and returns the authoritative
 * capacity summary for an organization.
 */
export async function getOrganizationEntitlementSummary(
  orgId: string,
  nowMs: number = Date.now()
): Promise<OrganizationEntitlementSummary> {
  await ensureEntitlementsTable();
  await reconcileOrganizationWebsiteAllocations(orgId, nowMs);

  const nowIso = new Date(nowMs).toISOString();
  const org = db.findOrgById(orgId);
  const superAdminUnlimited = isExemptSuperAdmin(null, org);

  const entRes = await query(
    `SELECT * FROM subscription_entitlements
     WHERE org_id = $1
     ORDER BY expires_at ASC, created_at DESC`,
    [orgId]
  );

  const entitlements = entRes.rows.map((r) => mapEntitlementRow(r, nowMs));
  const activeEntitlements = entitlements.filter((e) => e.isActive);
  const expiredEntitlements = entitlements.filter((e) => !e.isActive);

  if (superAdminUnlimited) {
    if (org && org.planId === 'free') {
      db.updateOrganization(org.id, { planId: 'pro' });
    }
    const usedWebsiteSlots = db.getWebsites().filter((w) => w.orgId === orgId).length;
    return {
      orgId,
      entitlements,
      activeEntitlements,
      expiredEntitlements,
      activeEntitlementCount: Math.max(1, activeEntitlements.length),
      totalActiveCapacity: UNLIMITED_CAPACITY,
      paidActiveCapacity: UNLIMITED_CAPACITY,
      freeTrialCapacity: 0,
      usedWebsiteSlots,
      remainingWebsiteSlots: UNLIMITED_CAPACITY,
      overCapacitySlots: 0,
      hasActivePaidEntitlement: true,
      allPaidEntitlementsExpired: false,
      earliestActiveExpiresAt: null,
      latestActiveExpiresAt: null,
      isUnlimited: true,
    };
  }

  const paidActiveCapacity = activeEntitlements.reduce(
    (sum, item) => sum + item.websiteCapacity,
    0
  );

  let freeTrialCapacity = 0;

  if (activeEntitlements.length > 0) {
    if (org && org.planId !== 'pro') {
      db.updateOrganization(org.id, { planId: 'pro' });
    }
  } else if (entitlements.length > 0 && activeEntitlements.length === 0) {
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
    const trialInfo = getAccountTrialStatus(org, nowMs);
    if (org.planId === 'free' && !trialInfo.isExpired) {
      freeTrialCapacity = 1;
    }
  }

  const totalActiveCapacity =
    activeEntitlements.length > 0 ? paidActiveCapacity : freeTrialCapacity;

  const orgWebsites = db.getWebsites().filter((w) => w.orgId === orgId);
  const activeAllocatedCount = orgWebsites.filter(
    (w) => w.accessStatus !== 'expired_grace_period'
  ).length;
  const remainingWebsiteSlots = Math.max(0, totalActiveCapacity - activeAllocatedCount);
  const overCapacitySlots = Math.max(0, orgWebsites.length - totalActiveCapacity);

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
    usedWebsiteSlots: activeAllocatedCount,
    remainingWebsiteSlots,
    overCapacitySlots,
    hasActivePaidEntitlement: activeEntitlements.length > 0,
    allPaidEntitlementsExpired: entitlements.length > 0 && activeEntitlements.length === 0,
    earliestActiveExpiresAt: sortedActiveByExpiry[0]?.expiresAt || null,
    latestActiveExpiresAt:
      sortedActiveByExpiry[sortedActiveByExpiry.length - 1]?.expiresAt || null,
    isUnlimited: false,
  };
}

/**
 * Selects the specific entitlement that will fund a newly added website.
 */
export async function allocateEntitlementForNewWebsite(
  orgId: string,
  user?: { id?: string; email?: string; role?: string } | null,
  nowMs: number = Date.now()
): Promise<{
  allowed: boolean;
  entitlementId?: string;
  subscriptionExpiresAt?: string | null;
  summary: OrganizationEntitlementSummary;
}> {
  const org = db.findOrgById(orgId);
  const summary = await getOrganizationEntitlementSummary(orgId, nowMs);

  if (isExemptSuperAdmin(user, org)) {
    return {
      allowed: true,
      entitlementId: 'super_admin_unlimited',
      subscriptionExpiresAt: null,
      summary,
    };
  }

  if (summary.totalActiveCapacity <= 0 || summary.remainingWebsiteSlots <= 0) {
    return {
      allowed: false,
      summary,
    };
  }

  const orgSites = db
    .getWebsites()
    .filter((w) => w.orgId === orgId && w.accessStatus !== 'expired_grace_period');

  for (const activeEnt of summary.activeEntitlements) {
    const usedOnThisEnt = orgSites.filter((w) => w.entitlementId === activeEnt.id).length;
    if (usedOnThisEnt < activeEnt.websiteCapacity) {
      return {
        allowed: true,
        entitlementId: activeEnt.id,
        subscriptionExpiresAt: activeEnt.expiresAt,
        summary,
      };
    }
  }

  if (summary.freeTrialCapacity > 0) {
    return {
      allowed: true,
      entitlementId: 'free_trial',
      subscriptionExpiresAt: org?.trialEndsAt || null,
      summary,
    };
  }

  return {
    allowed: false,
    summary,
  };
}

/**
 * Authoritative backend guard that verifies website ownership, entitlement status,
 * and expiration before returning website details or allowing any website action.
 */
export async function verifyWebsiteAccessAndEntitlement(
  site: Website | undefined | null,
  user: User,
  org: Organization,
  nowMs: number = Date.now()
): Promise<{
  allowed: boolean;
  site?: Website;
  status?: number;
  body?: Record<string, any>;
  isIdor?: boolean;
}> {
  if (!site) {
    return { allowed: false, status: 404, body: { error: 'Website not found' } };
  }

  const superAdmin = isExemptSuperAdmin(user, org);
  if (site.orgId !== org.id && !superAdmin && user.role !== 'super_admin') {
    return {
      allowed: false,
      status: 404,
      body: { error: 'Website not found' },
      isIdor: true,
    };
  }

  if (superAdmin) {
    return { allowed: true, site };
  }

  // Reconcile allocations and run overdue cleanup for this website's organization
  await reconcileOrganizationWebsiteAllocations(site.orgId, nowMs);
  await cleanupOverdueExpiredWebsites(nowMs);

  const refreshed = db.findWebsiteById(site.id);
  if (!refreshed) {
    return {
      allowed: false,
      status: 404,
      body: {
        error: 'WEBSITE_DELETED_AFTER_EXPIRATION',
        message:
          'This website was permanently deleted because its subscription expired and the 2-day renewal grace period ended.',
      },
    };
  }

  if (refreshed.accessStatus === 'expired_grace_period' || refreshed.isSubscriptionExpired) {
    return {
      allowed: false,
      site: refreshed,
      status: 403,
      body: {
        error: 'SUBSCRIPTION_EXPIRED',
        code: 'SUBSCRIPTION_EXPIRED',
        message:
          'Subscription expired — This website will be deleted in 2 days. Renew your subscription to retain access.',
        websiteId: refreshed.id,
        expiredAt: refreshed.expiredAt || refreshed.subscriptionExpiresAt,
        scheduledDeletionAt: refreshed.scheduledDeletionAt,
        deletionRemainingMs: refreshed.deletionRemainingMs,
      },
    };
  }

  return { allowed: true, site: refreshed };
}

/**
 * Redacts detailed scan/WHOIS/verification payloads from expired websites when returned
 * in the list endpoint (`GET /api/websites`), while keeping the website row and its
 * 2-day deletion notice metadata visible during the grace period.
 */
export function sanitizeWebsiteForList(
  site: Website,
  user?: User | null,
  org?: Organization | null
): Website {
  if (isExemptSuperAdmin(user, org)) {
    return {
      ...site,
      accessStatus: 'active',
      isSubscriptionExpired: false,
      scheduledDeletionAt: null,
      deletionRemainingMs: null,
    };
  }

  if (site.accessStatus === 'expired_grace_period' || site.isSubscriptionExpired) {
    const remMs = site.scheduledDeletionAt
      ? Math.max(0, new Date(site.scheduledDeletionAt).getTime() - Date.now())
      : 0;
    return {
      ...site,
      isSubscriptionExpired: true,
      deletionRemainingMs: remMs,
      lastScanResult: undefined,
      lastWhoisResult: null,
      verification: {
        verified: Boolean(site.verification?.verified),
        token: '',
        method: site.verification?.method || 'dns_txt',
      },
    };
  }

  return site;
}
