import crypto from 'node:crypto';
import type pg from 'pg';
import { db, type Website, type User, type Organization } from './db.ts';
import { query, withTransaction } from './db/connection.ts';
import { getAccountTrialStatus, type TrialStatus } from './trial.ts';

export type EntitlementStatus = 'scheduled' | 'active' | 'expired' | 'revoked' | 'cancelled';
export type EntitlementSource = 'paid_purchase' | 'trial' | 'admin_grant';

export interface AllocatedWebsiteInfo {
  id: string;
  name: string;
  domain: string;
  url: string;
  status: string;
  accessStatus: string;
  createdAt: string;
  subscriptionExpiresAt?: string | null;
  scheduledDeletionAt?: string | null;
}

export interface SubscriptionEntitlement {
  id: string;
  userId: string;
  orgId: string;
  planId: string;
  planName: string;
  billingInterval: 'monthly' | 'annual';
  websiteCapacity: number;
  orderId: string | null;
  source: EntitlementSource;
  grantedByAdminId?: string | null;
  grantedByAdminEmail?: string | null;
  grantReason?: string | null;
  status: EntitlementStatus;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  revokedReason?: string | null;
  createdAt: string;
  updatedAt: string;
  daysRemaining: number;
  remainingMs: number;
  remainingTimeFormatted: string;
  isActive: boolean;
  allocatedWebsitesCount: number;
  availableCapacity: number;
  allocatedWebsites: AllocatedWebsiteInfo[];
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

export const DAY_DURATION_MS = 24 * 60 * 60 * 1000;
export const MONTHLY_DURATION_MS = 30 * DAY_DURATION_MS; // 30 days
export const ANNUAL_DURATION_MS = 365 * DAY_DURATION_MS; // 365 days
export const GRACE_PERIOD_DURATION_MS = 2 * DAY_DURATION_MS; // 2 days (48 hours)
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

export function formatRemainingTime(remainingMs: number, status: EntitlementStatus): string {
  if (status === 'revoked' || status === 'cancelled') return 'Revoked';
  if (status === 'expired' || remainingMs <= 0) return 'Expired';
  if (remainingMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.ceil(remainingMs / (60 * 1000)));
    return `${mins}m remaining`;
  }
  if (remainingMs < DAY_DURATION_MS) {
    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const mins = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
    return mins > 0 ? `${hours}h ${mins}m remaining` : `${hours}h remaining`;
  }
  const days = Math.ceil(remainingMs / DAY_DURATION_MS);
  return `${days} ${days === 1 ? 'day' : 'days'} remaining`;
}

export function mapEntitlementRow(row: any, nowMs: number = Date.now()): SubscriptionEntitlement {
  const startsAt = toIsoString(row.starts_at);
  const expiresAt = toIsoString(row.expires_at);
  const purchasedAt = toIsoString(row.purchased_at, startsAt);
  const createdAt = toIsoString(row.created_at, startsAt);
  const updatedAt = toIsoString(row.updated_at, createdAt);
  const startsMs = new Date(startsAt).getTime();
  const expiresMs = new Date(expiresAt).getTime();
  const remainingMs = Math.max(0, expiresMs - nowMs);
  const daysRemaining = remainingMs > 0 ? Math.max(0, Math.ceil(remainingMs / DAY_DURATION_MS)) : 0;

  let status: EntitlementStatus = (row.status || 'active') as EntitlementStatus;
  if ((status === 'active' || status === 'scheduled') && expiresMs <= nowMs) {
    status = 'expired';
  } else if (status === 'active' && startsMs > nowMs + 60_000) {
    status = 'scheduled';
  }

  const isActive = (status === 'active' || status === 'scheduled') && expiresMs > nowMs;

  let source: EntitlementSource = 'paid_purchase';
  if (row.source === 'trial' || row.source === 'admin_grant' || row.source === 'paid_purchase') {
    source = row.source;
  } else if (String(row.plan_id || '').toLowerCase() === 'free') {
    source = 'trial';
  }

  const defaultCap = source === 'trial' ? 1 : DEFAULT_PRO_WEBSITE_CAPACITY;
  const websiteCapacity = Math.max(1, Number(row.website_capacity) || defaultCap);

  return {
    id: String(row.id),
    userId: String(row.user_id),
    orgId: String(row.org_id),
    planId: String(row.plan_id || 'pro'),
    planName: String(row.plan_name || 'Pro Plan'),
    billingInterval: row.billing_interval === 'annual' ? 'annual' : 'monthly',
    websiteCapacity,
    orderId: row.order_id ? String(row.order_id) : null,
    source,
    grantedByAdminId: row.granted_by_admin_id ? String(row.granted_by_admin_id) : null,
    grantedByAdminEmail: row.granted_by_admin_email ? String(row.granted_by_admin_email) : null,
    grantReason: row.grant_reason ? String(row.grant_reason) : null,
    status,
    purchasedAt,
    startsAt,
    expiresAt,
    revokedAt: row.revoked_at ? toIsoString(row.revoked_at) : null,
    revokedReason: row.revoked_reason ? String(row.revoked_reason) : null,
    createdAt,
    updatedAt,
    daysRemaining,
    remainingMs,
    remainingTimeFormatted: formatRemainingTime(isActive ? remainingMs : 0, status),
    isActive,
    allocatedWebsitesCount: 0,
    availableCapacity: isActive ? websiteCapacity : 0,
    allocatedWebsites: [],
  };
}

export function enrichEntitlementsWithWebsites(
  entitlements: SubscriptionEntitlement[],
  orgWebsites: Website[]
): SubscriptionEntitlement[] {
  const trialEnts = entitlements.filter((e) => e.source === 'trial');
  const primaryTrialEntId = trialEnts[0]?.id;

  return entitlements.map((ent) => {
    const matchingSites = orgWebsites.filter((w) => {
      if (w.entitlementId === ent.id) return true;
      if (w.entitlementId === 'free_trial' && ent.id === primaryTrialEntId) return true;
      return false;
    });

    const allocatedWebsites: AllocatedWebsiteInfo[] = matchingSites.map((w) => ({
      id: w.id,
      name: w.name,
      domain: w.domain,
      url: w.url,
      status: w.status,
      accessStatus: w.accessStatus || (w.isSubscriptionExpired ? 'expired_grace_period' : 'active'),
      createdAt: w.createdAt,
      subscriptionExpiresAt: w.subscriptionExpiresAt || null,
      scheduledDeletionAt: w.scheduledDeletionAt || null,
    }));

    const allocatedWebsitesCount = allocatedWebsites.length;
    const availableCapacity = ent.isActive
      ? Math.max(0, ent.websiteCapacity - allocatedWebsitesCount)
      : 0;

    return {
      ...ent,
      allocatedWebsitesCount,
      availableCapacity,
      allocatedWebsites,
    };
  });
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
        source TEXT NOT NULL DEFAULT 'paid_purchase',
        granted_by_admin_id TEXT,
        granted_by_admin_email TEXT,
        grant_reason TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        revoked_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(
      `ALTER TABLE subscription_entitlements DROP CONSTRAINT IF EXISTS subscription_entitlements_org_id_fkey`
    ).catch(() => {});

    const alterStatements = [
      "ALTER TABLE subscription_entitlements ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'paid_purchase'",
      'ALTER TABLE subscription_entitlements ADD COLUMN IF NOT EXISTS granted_by_admin_id TEXT',
      'ALTER TABLE subscription_entitlements ADD COLUMN IF NOT EXISTS granted_by_admin_email TEXT',
      'ALTER TABLE subscription_entitlements ADD COLUMN IF NOT EXISTS grant_reason TEXT',
      'ALTER TABLE subscription_entitlements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS entitlement_id TEXT',
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ',
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ',
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMPTZ',
      "ALTER TABLE websites ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'active'",
      'ALTER TABLE websites ADD COLUMN IF NOT EXISTS last_whois_result JSONB',
    ];
    for (const st of alterStatements) {
      await query(st).catch(() => {});
    }
    schemaEnsured = true;
  } catch {
    // Handled if table already exists
  }
}

/**
 * Ensures an organization's initial free trial is materialized in `subscription_entitlements`
 * and kept synchronized with `org.trialEndsAt`.
 */
async function syncInitialTrialEntitlementRow(
  org: Organization,
  nowMs: number = Date.now()
): Promise<void> {
  if (isExemptSuperAdmin(null, org)) return;
  if (!org.trialEndsAt && !org.trialStartedAt && org.planId !== 'free') return;

  const existingTrialsRes = await query(
    `SELECT id, order_id, expires_at FROM subscription_entitlements WHERE org_id = $1 AND source = 'trial'`,
    [org.id]
  ).catch(() => ({ rows: [] as any[] }));

  // If an admin-granted trial already exists for this organization, do not re-activate the initial signup trial
  if (existingTrialsRes.rows.some((r: any) => r.order_id !== `initial_trial_${org.id}`)) {
    return;
  }

  const initialOrderId = `initial_trial_${org.id}`;
  const initialEntId = `ent_trial_${org.id}`;
  const startsAtIso = toIsoString(org.trialStartedAt || org.createdAt);
  const defaultEndsIso = new Date(new Date(startsAtIso).getTime() + DAY_DURATION_MS).toISOString();
  const expiresAtIso = toIsoString(org.trialEndsAt, defaultEndsIso);
  const expiresMs = new Date(expiresAtIso).getTime();
  const isTrialActive = org.planId === 'free' && expiresMs > nowMs;
  const targetStatus: EntitlementStatus = isTrialActive ? 'active' : 'expired';
  const ownerId =
    org.ownerId ||
    db.getUsers().find((u) => u.orgId === org.id)?.id ||
    'system';

  await query(
    `INSERT INTO subscription_entitlements (
       id, user_id, org_id, plan_id, plan_name, billing_interval,
       website_capacity, order_id, source, status, purchased_at, starts_at, expires_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, 'free', 'Free Trial (24 Hours)', 'monthly', 1, $4, 'trial', $5, $6, $7, $8, $9, $10)
     ON CONFLICT (order_id) DO UPDATE SET
       expires_at = EXCLUDED.expires_at,
       status = CASE
         WHEN subscription_entitlements.status IN ('revoked', 'cancelled') THEN subscription_entitlements.status
         ELSE EXCLUDED.status
       END`,
    [
      initialEntId,
      ownerId,
      org.id,
      initialOrderId,
      targetStatus,
      startsAtIso,
      startsAtIso,
      expiresAtIso,
      startsAtIso,
      new Date(nowMs).toISOString(),
    ]
  ).catch(() => {});
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
       website_capacity, order_id, source, status, purchased_at, starts_at, expires_at, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'paid_purchase', 'active', $9, $10, $11, $12, $12)
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
    const existingEntOrgsRes = await client.query(
      `SELECT DISTINCT org_id FROM subscription_entitlements WHERE source != 'trial'`
    );
    const orgsWithEntitlements = new Set(existingEntOrgsRes.rows.map((r: any) => String(r.org_id)));

    for (const orgRow of proOrgsRes.rows) {
      if (orgsWithEntitlements.has(String(orgRow.id))) continue;
      const legacyOrderId = `legacy_org_${orgRow.id}`;
      const billingInterval: 'monthly' | 'annual' =
        orgRow.billing_interval === 'annual' ? 'annual' : 'monthly';
      const startsAtIso = toIsoString(orgRow.created_at, new Date().toISOString());
      const baseMs = Math.max(new Date(startsAtIso).getTime(), Date.now() - 5 * DAY_DURATION_MS);
      const durationMs = billingInterval === 'annual' ? ANNUAL_DURATION_MS : MONTHLY_DURATION_MS;
      const expiresAtIso = new Date(baseMs + durationMs).toISOString();
      const entId = `ent_legacy_${orgRow.id}`;
      const nowIso = new Date().toISOString();

      const ins = await client.query(
        `INSERT INTO subscription_entitlements (
           id, user_id, org_id, plan_id, plan_name, billing_interval,
           website_capacity, order_id, source, status, purchased_at, starts_at, expires_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'pro', $4, $5, $6, $7, 'paid_purchase', 'active', $8, $9, $10, $11, $11)
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
          nowIso,
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
    const org = db.findOrgById(orgId);

    if (org) {
      await syncInitialTrialEntitlementRow(org, nowMs);
    }

    // 1. Mark any active entitlements whose expires_at <= nowMs as 'expired'
    await query(
      `UPDATE subscription_entitlements
       SET status = 'expired'
       WHERE org_id = $1 AND status = 'active' AND expires_at <= $2`,
      [orgId, nowIso]
    );

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
       ORDER BY expires_at ASC, purchased_at ASC, created_at ASC`,
      [orgId]
    );
    const allEntitlements = entRes.rows.map((r) => mapEntitlementRow(r, nowMs));
    const paidOrGrantEntitlements = allEntitlements.filter((e) => e.source !== 'trial');
    const activePaidOrGrantEntitlements = paidOrGrantEntitlements.filter((e) => e.isActive);
    const trialEntitlements = allEntitlements.filter((e) => e.source === 'trial');
    const activeTrialEntitlements = trialEntitlements.filter((e) => e.isActive);

    const entById = new Map<string, SubscriptionEntitlement>(
      allEntitlements.map((e) => [e.id, e])
    );
    const activeEntitlements = allEntitlements.filter((e) => e.isActive);

    // Track how many slots are used on each entitlement
    const usedSlotsByEnt = new Map<string, number>();
    for (const ent of allEntitlements) {
      usedSlotsByEnt.set(ent.id, 0);
    }

    // Normalize legacy 'free_trial' entitlementId to the organization's trial entitlement row if present
    const primaryTrialEnt =
      activeTrialEntitlements[0] ||
      trialEntitlements[trialEntitlements.length - 1];

    // First pass: count websites already explicitly bound to an entitlement
    for (const site of orgSites) {
      if (site.entitlementId === 'free_trial' && primaryTrialEnt) {
        // Keep 'free_trial' or map to primaryTrialEnt if no active paid upgrade superseded it
        usedSlotsByEnt.set(
          primaryTrialEnt.id,
          (usedSlotsByEnt.get(primaryTrialEnt.id) || 0) + 1
        );
      } else if (site.entitlementId && entById.has(site.entitlementId)) {
        usedSlotsByEnt.set(
          site.entitlementId,
          (usedSlotsByEnt.get(site.entitlementId) || 0) + 1
        );
      }
    }

    // Second pass: backfill any unallocated websites (!site.entitlementId) safely
    for (const site of orgSites) {
      if (site.entitlementId) continue;

      const candidateEnt =
        activePaidOrGrantEntitlements.find(
          (e) => (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
        ) ||
        activeTrialEntitlements.find(
          (e) => (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
        ) ||
        paidOrGrantEntitlements.find(
          (e) => (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
        ) ||
        trialEntitlements.find(
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
        paidOrGrantEntitlements.length === 0 &&
        org &&
        org.planId === 'free' &&
        org.trialEndsAt &&
        orgSites.length === 1
      ) {
        site.entitlementId = primaryTrialEnt ? primaryTrialEnt.id : 'free_trial';
        site.subscriptionExpiresAt = org.trialEndsAt;
      } else {
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

      const assignedEnt =
        site.entitlementId === 'free_trial'
          ? primaryTrialEnt
          : site.entitlementId
          ? entById.get(site.entitlementId)
          : undefined;

      // Handle Trial website ('free_trial' or source === 'trial')
      if (site.entitlementId === 'free_trial' || assignedEnt?.source === 'trial') {
        // Check if user upgraded to an active paid/admin_grant entitlement (when on initial signup trial)
        const isInitialSignupTrial =
          !assignedEnt ||
          assignedEnt.orderId === `initial_trial_${orgId}` ||
          site.entitlementId === 'free_trial';

        if (isInitialSignupTrial && activePaidOrGrantEntitlements.length > 0) {
          const upgradeEnt = activePaidOrGrantEntitlements.find(
            (e) => (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
          );
          if (upgradeEnt) {
            if (assignedEnt) {
              usedSlotsByEnt.set(
                assignedEnt.id,
                Math.max(0, (usedSlotsByEnt.get(assignedEnt.id) || 1) - 1)
              );
            }
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
        }

        // Check if the assigned trial entitlement or a newly granted active trial entitlement is active
        const activeTrial =
          assignedEnt && assignedEnt.isActive
            ? assignedEnt
            : activeTrialEntitlements.find(
                (e) =>
                  e.id === assignedEnt?.id ||
                  (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
              );

        if (activeTrial) {
          if (assignedEnt && assignedEnt.id !== activeTrial.id) {
            usedSlotsByEnt.set(
              assignedEnt.id,
              Math.max(0, (usedSlotsByEnt.get(assignedEnt.id) || 1) - 1)
            );
            usedSlotsByEnt.set(activeTrial.id, (usedSlotsByEnt.get(activeTrial.id) || 0) + 1);
          }
          db.updateWebsite(site.id, {
            entitlementId: activeTrial.id,
            subscriptionExpiresAt: activeTrial.expiresAt,
            expiredAt: null,
            scheduledDeletionAt: null,
            accessStatus: 'active',
            isSubscriptionExpired: false,
            deletionRemainingMs: null,
          });
          continue;
        }

        // Check if trial expired and user bought an active paid/admin_grant entitlement to upgrade
        const paidUpgrade = activePaidOrGrantEntitlements.find(
          (e) => (usedSlotsByEnt.get(e.id) || 0) < e.websiteCapacity
        );
        if (paidUpgrade) {
          usedSlotsByEnt.set(paidUpgrade.id, (usedSlotsByEnt.get(paidUpgrade.id) || 0) + 1);
          db.updateWebsite(site.id, {
            entitlementId: paidUpgrade.id,
            subscriptionExpiresAt: paidUpgrade.expiresAt,
            expiredAt: null,
            scheduledDeletionAt: null,
            accessStatus: 'active',
            isSubscriptionExpired: false,
            deletionRemainingMs: null,
          });
          continue;
        }

        // Otherwise mark trial website as expired with 2-day grace period
        const expIso = assignedEnt?.expiresAt || org?.trialEndsAt || site.subscriptionExpiresAt || nowIso;
        const expMs = new Date(expIso).getTime();
        const delIso = new Date(expMs + GRACE_PERIOD_DURATION_MS).toISOString();
        const remMs = Math.max(0, new Date(delIso).getTime() - nowMs);
        db.updateWebsite(site.id, {
          entitlementId: assignedEnt ? assignedEnt.id : 'free_trial',
          subscriptionExpiresAt: expIso,
          expiredAt: expIso,
          scheduledDeletionAt: delIso,
          accessStatus: 'expired_grace_period',
          isSubscriptionExpired: true,
          deletionRemainingMs: remMs,
        });
        continue;
      }

      if (!assignedEnt) {
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
        // Direct entitlement is active (including if it was renewed or had remaining days extended in-place!)
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
      // Independent entitlement rule:
      // Another entitlement NEVER steals websites from an expired entitlement if that other entitlement
      // was started before this entitlement expired. Only a brand-new paid renewal purchased strictly AFTER
      // this entitlement expired (candStartMs >= assignedExpMs && candStartMs > assignedUpdatedMs)
      // when no other prior entitlements were covering it can rescue a grace-period website.
      const assignedExpMs = new Date(assignedEnt.expiresAt).getTime();
      const assignedUpdatedMs = new Date(assignedEnt.updatedAt || assignedEnt.startsAt).getTime();
      const renewalEnt = activePaidOrGrantEntitlements.find((candidate) => {
        if (candidate.id === assignedEnt.id) return false;
        const used = usedSlotsByEnt.get(candidate.id) || 0;
        if (used >= candidate.websiteCapacity) return false;
        const candStartMs = new Date(candidate.startsAt).getTime();
        // Candidate must have started strictly at/after the expired entitlement's expiration
        // AND after the last manual update on the expired entitlement, and only for paid renewal purchases
        return (
          candidate.source === 'paid_purchase' &&
          candStartMs >= assignedExpMs &&
          candStartMs >= assignedUpdatedMs
        );
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
 * capacity summary for an organization, including allocated websites per entitlement.
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

  const orgWebsites = db.getWebsites().filter((w) => w.orgId === orgId);
  const rawEntitlements = entRes.rows.map((r) => mapEntitlementRow(r, nowMs));
  const entitlements = enrichEntitlementsWithWebsites(rawEntitlements, orgWebsites);

  const paidOrGrantEntitlements = entitlements.filter((e) => e.source !== 'trial');
  const activePaidOrGrantEntitlements = paidOrGrantEntitlements.filter((e) => e.isActive);
  const trialEntitlements = entitlements.filter((e) => e.source === 'trial');
  const activeTrialEntitlements = trialEntitlements.filter((e) => e.isActive);

  // If user has active paid/admin_grant entitlements, the initial signup trial is superseded
  const effectiveActiveEntitlements = entitlements.filter((e) => {
    if (!e.isActive) return false;
    if (
      e.source === 'trial' &&
      e.orderId === `initial_trial_${orgId}` &&
      activePaidOrGrantEntitlements.length > 0
    ) {
      return false;
    }
    return true;
  });

  const expiredEntitlements = entitlements.filter(
    (e) => !effectiveActiveEntitlements.some((a) => a.id === e.id)
  );

  if (superAdminUnlimited) {
    if (org && org.planId === 'free') {
      db.updateOrganization(org.id, { planId: 'pro' });
    }
    const usedWebsiteSlots = orgWebsites.length;
    return {
      orgId,
      entitlements,
      activeEntitlements: effectiveActiveEntitlements,
      expiredEntitlements,
      activeEntitlementCount: Math.max(1, effectiveActiveEntitlements.length),
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

  const paidActiveCapacity = activePaidOrGrantEntitlements.reduce(
    (sum, item) => sum + item.websiteCapacity,
    0
  );

  let freeTrialCapacity = 0;
  for (const trialEnt of activeTrialEntitlements) {
    const isInitialTrial = trialEnt.orderId === `initial_trial_${orgId}`;
    if (isInitialTrial && activePaidOrGrantEntitlements.length > 0) {
      continue;
    }
    freeTrialCapacity += trialEnt.websiteCapacity;
  }

  if (activePaidOrGrantEntitlements.length > 0) {
    const targetPlanId = activePaidOrGrantEntitlements[0].planId || 'pro';
    if (org && org.planId === 'free') {
      db.updateOrganization(org.id, { planId: targetPlanId });
    }
  } else if (activeTrialEntitlements.length > 0) {
    const latestTrialEnd = activeTrialEntitlements
      .map((e) => e.expiresAt)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    if (org && (org.planId !== 'free' || org.trialEndsAt !== latestTrialEnd)) {
      db.updateOrganization(org.id, {
        planId: 'free',
        trialUsed: true,
        trialEndsAt: latestTrialEnd,
      });
    }
  } else if (paidOrGrantEntitlements.length > 0 && activePaidOrGrantEntitlements.length === 0) {
    if (org && org.planId !== 'free') {
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
    if (org.planId === 'free' && !trialInfo.isExpired && freeTrialCapacity === 0) {
      freeTrialCapacity = 1;
    }
  }

  const totalActiveCapacity = paidActiveCapacity + freeTrialCapacity;

  const activeAllocatedCount = orgWebsites.filter(
    (w) => w.accessStatus !== 'expired_grace_period' && !w.isSubscriptionExpired
  ).length;
  const remainingWebsiteSlots = Math.max(0, totalActiveCapacity - activeAllocatedCount);
  const overCapacitySlots = Math.max(0, orgWebsites.length - totalActiveCapacity);

  const sortedActiveByExpiry = [...effectiveActiveEntitlements].sort(
    (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
  );

  return {
    orgId,
    entitlements,
    activeEntitlements: effectiveActiveEntitlements,
    expiredEntitlements,
    activeEntitlementCount: effectiveActiveEntitlements.length,
    totalActiveCapacity,
    paidActiveCapacity,
    freeTrialCapacity,
    usedWebsiteSlots: activeAllocatedCount,
    remainingWebsiteSlots,
    overCapacitySlots,
    hasActivePaidEntitlement: activePaidOrGrantEntitlements.length > 0,
    allPaidEntitlementsExpired:
      paidOrGrantEntitlements.length > 0 &&
      activePaidOrGrantEntitlements.length === 0 &&
      activeTrialEntitlements.length === 0,
    earliestActiveExpiresAt: sortedActiveByExpiry[0]?.expiresAt || null,
    latestActiveExpiresAt:
      sortedActiveByExpiry[sortedActiveByExpiry.length - 1]?.expiresAt || null,
    isUnlimited: false,
  };
}

/**
 * Selects the specific entitlement that will fund a newly added website.
 * Always allocates to the earliest-expiring active entitlement that has free capacity.
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
    .filter((w) => w.orgId === orgId && w.accessStatus !== 'expired_grace_period' && !w.isSubscriptionExpired);

  // Sort active entitlements by earliest expiration first
  const sortedActive = [...summary.activeEntitlements].sort(
    (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()
  );

  for (const activeEnt of sortedActive) {
    const usedOnThisEnt = orgSites.filter(
      (w) =>
        w.entitlementId === activeEnt.id ||
        (activeEnt.source === 'trial' && w.entitlementId === 'free_trial')
    ).length;
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
    const trialEnt = sortedActive.find((e) => e.source === 'trial');
    return {
      allowed: true,
      entitlementId: trialEnt ? trialEnt.id : `ent_trial_${orgId}`,
      subscriptionExpiresAt: trialEnt ? trialEnt.expiresAt : org?.trialEndsAt || null,
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
        entitlementId: refreshed.entitlementId,
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

/**
 * Administrative Action: Grant or re-enable Trial Access for a user inside a DB transaction.
 */
export async function adminGrantTrialEntitlement(
  targetUserId: string,
  adminUser: { id: string; email: string; role: string },
  options?: {
    durationHours?: number;
    durationDays?: number;
    websiteCapacity?: number;
    reason?: string;
    allowDuplicate?: boolean;
    nowMs?: number;
  }
): Promise<{
  entitlement: SubscriptionEntitlement;
  summary: OrganizationEntitlementSummary;
  trialStatus: TrialStatus;
}> {
  await ensureEntitlementsTable();
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const targetUser = db.findUserById(targetUserId);
  if (!targetUser) {
    const err: any = new Error('Target user not found.');
    err.statusCode = 404;
    throw err;
  }

  const org = db.findOrgById(targetUser.orgId);
  if (!org) {
    const err: any = new Error('Target user organization not found.');
    err.statusCode = 404;
    throw err;
  }

  await syncInitialTrialEntitlementRow(org, nowMs);

  // Check if user currently has an active trial
  const existingTrialsRes = await query(
    `SELECT * FROM subscription_entitlements
     WHERE org_id = $1 AND source = 'trial'
     ORDER BY expires_at DESC`,
    [org.id]
  );
  const existingTrials = existingTrialsRes.rows.map((r) => mapEntitlementRow(r, nowMs));
  const activeTrial = existingTrials.find((t) => t.isActive);
  const currentOrgTrial = getAccountTrialStatus(org, nowMs);

  if ((activeTrial || (org.planId === 'free' && !currentOrgTrial.isExpired)) && !options?.allowDuplicate) {
    const activeExp = activeTrial?.expiresAt || currentOrgTrial.trialEndsAt || nowIso;
    const err: any = new Error(
      `User ${targetUser.email} already has an active trial expiring at ${new Date(activeExp).toUTCString()}. Confirm duplicate trial override to grant another trial.`
    );
    err.statusCode = 409;
    err.code = 'DUPLICATE_ACTIVE_TRIAL';
    err.activeTrialExpiresAt = activeExp;
    throw err;
  }

  let durationMs = DAY_DURATION_MS; // Default 24 hours (1 day)
  let durationLabel = '24 Hours';
  if (options?.durationDays !== undefined && Number(options.durationDays) > 0) {
    const days = Math.min(365, Math.max(1, Math.round(Number(options.durationDays))));
    durationMs = days * DAY_DURATION_MS;
    durationLabel = `${days} ${days === 1 ? 'Day' : 'Days'}`;
  } else if (options?.durationHours !== undefined && Number(options.durationHours) > 0) {
    const hours = Math.min(365 * 24, Math.max(1, Math.round(Number(options.durationHours))));
    durationMs = hours * 60 * 60 * 1000;
    durationLabel = hours % 24 === 0 ? `${hours / 24} ${hours / 24 === 1 ? 'Day' : 'Days'}` : `${hours} Hours`;
  }

  const websiteCapacity = Math.min(100, Math.max(1, Math.round(Number(options?.websiteCapacity) || 1)));
  const expiresAtIso = new Date(nowMs + durationMs).toISOString();
  const reason = (options?.reason || 'Admin granted trial access').trim().slice(0, 500);
  const newEntId = `ent_trial_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO subscription_entitlements (
         id, user_id, org_id, plan_id, plan_name, billing_interval,
         website_capacity, order_id, source, granted_by_admin_id, granted_by_admin_email, grant_reason,
         status, purchased_at, starts_at, expires_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, 'free', $4, 'monthly', $5, NULL, 'trial', $6, $7, $8, 'active', $9, $9, $10, $9, $9)`,
      [
        newEntId,
        targetUser.id,
        org.id,
        `Free Trial (${durationLabel} — Admin Grant)`,
        websiteCapacity,
        adminUser.id,
        adminUser.email,
        reason,
        nowIso,
        expiresAtIso,
      ]
    );

    await client.query(
      `UPDATE organizations
       SET trial_started_at = $1,
           trial_ends_at = $2,
           trial_used = true
       WHERE id = $3`,
      [nowIso, expiresAtIso, org.id]
    );
  });

  db.updateOrganization(org.id, {
    trialStartedAt: nowIso,
    trialEndsAt: expiresAtIso,
    trialUsed: true,
  });

  // Re-bind any expired trial websites of this org up to websiteCapacity so they immediately restore
  const orgTrialSites = db
    .getWebsites()
    .filter(
      (w) =>
        w.orgId === org.id &&
        (w.entitlementId === 'free_trial' ||
          existingTrials.some((t) => t.id === w.entitlementId))
    );
  let restoredCount = 0;
  for (const site of orgTrialSites) {
    if (restoredCount >= websiteCapacity) break;
    db.updateWebsite(site.id, {
      entitlementId: newEntId,
      subscriptionExpiresAt: expiresAtIso,
      expiredAt: null,
      scheduledDeletionAt: null,
      accessStatus: 'active',
      isSubscriptionExpired: false,
      deletionRemainingMs: null,
    });
    restoredCount++;
  }

  db.addAuditLog({
    id: `aud_trial_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    orgId: org.id,
    userId: adminUser.id,
    userEmail: adminUser.email,
    action: 'ADMIN_GRANT_TRIAL',
    target: targetUser.email,
    details: `Admin ${adminUser.email} (${adminUser.id}) granted ${durationLabel} trial access (${websiteCapacity} website slot${websiteCapacity === 1 ? '' : 's'}) to ${targetUser.email} (${targetUser.id}). Starts: ${nowIso}, Expires: ${expiresAtIso}. Reason: ${reason}`,
    timestamp: nowIso,
  });

  const summary = await getOrganizationEntitlementSummary(org.id, nowMs);
  const grantedEntitlement =
    summary.entitlements.find((e) => e.id === newEntId) ||
    summary.activeEntitlements[0];
  const refreshedOrg = db.findOrgById(org.id) || org;
  const trialStatus = getAccountTrialStatus(refreshedOrg, nowMs);

  return {
    entitlement: grantedEntitlement,
    summary,
    trialStatus,
  };
}

/**
 * Administrative Action: Grant a 1-month or 1-year independent subscription entitlement
 * without creating a fake customer payment or overwriting existing subscriptions.
 */
export async function adminGrantSubscriptionEntitlement(
  targetUserId: string,
  adminUser: { id: string; email: string; role: string },
  options: {
    duration: '1_month' | '1_year' | 'monthly' | 'annual';
    planId?: 'pro' | 'agency' | 'enterprise';
    websiteCapacity?: number;
    reason?: string;
    startsAt?: string;
    nowMs?: number;
  }
): Promise<{
  entitlement: SubscriptionEntitlement;
  summary: OrganizationEntitlementSummary;
}> {
  await ensureEntitlementsTable();
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const targetUser = db.findUserById(targetUserId);
  if (!targetUser) {
    const err: any = new Error('Target user not found.');
    err.statusCode = 404;
    throw err;
  }

  const org = db.findOrgById(targetUser.orgId);
  if (!org) {
    const err: any = new Error('Target user organization not found.');
    err.statusCode = 404;
    throw err;
  }

  const rawDuration = String(options.duration || '').trim().toLowerCase();
  if (
    rawDuration !== '1_month' &&
    rawDuration !== '1_year' &&
    rawDuration !== 'monthly' &&
    rawDuration !== 'annual'
  ) {
    const err: any = new Error('Invalid subscription duration. Must be "1_month" or "1_year".');
    err.statusCode = 400;
    throw err;
  }

  const billingInterval: 'monthly' | 'annual' =
    rawDuration === '1_year' || rawDuration === 'annual' ? 'annual' : 'monthly';
  const durationMs = billingInterval === 'annual' ? ANNUAL_DURATION_MS : MONTHLY_DURATION_MS;
  const durationLabel = billingInterval === 'annual' ? '1 Year' : '1 Month';

  const planId =
    options.planId === 'agency' || options.planId === 'enterprise' || options.planId === 'pro'
      ? options.planId
      : 'pro';
  const planObj = db.getPlans().find((p) => p.id === planId);
  const defaultCap = planObj?.limits?.maxWebsites || DEFAULT_PRO_WEBSITE_CAPACITY;
  const websiteCapacity =
    options.websiteCapacity !== undefined
      ? Math.min(1000, Math.max(1, Math.round(Number(options.websiteCapacity))))
      : defaultCap;

  if (!Number.isFinite(websiteCapacity) || websiteCapacity < 1) {
    const err: any = new Error('Website capacity must be a positive integer.');
    err.statusCode = 400;
    throw err;
  }

  const startsAtIso = options.startsAt ? toIsoString(options.startsAt, nowIso) : nowIso;
  const startsMs = new Date(startsAtIso).getTime();
  const expiresAtIso = new Date(startsMs + durationMs).toISOString();
  const basePlanName = planObj?.name ? `${planObj.name} Plan` : 'Pro Plan';
  const planName = `${basePlanName} (${durationLabel} — Admin Grant)`;
  const reason = (options.reason || `Admin granted ${durationLabel} subscription`).trim().slice(0, 500);
  const newEntId = `ent_adm_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO subscription_entitlements (
         id, user_id, org_id, plan_id, plan_name, billing_interval,
         website_capacity, order_id, source, granted_by_admin_id, granted_by_admin_email, grant_reason,
         status, purchased_at, starts_at, expires_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'admin_grant', $8, $9, $10, 'active', $11, $12, $13, $11, $11)`,
      [
        newEntId,
        targetUser.id,
        org.id,
        planId,
        planName,
        billingInterval,
        websiteCapacity,
        adminUser.id,
        adminUser.email,
        reason,
        nowIso,
        startsAtIso,
        expiresAtIso,
      ]
    );

    if (org.planId === 'free') {
      await client.query(
        `UPDATE organizations SET plan_id = $1, billing_interval = $2 WHERE id = $3`,
        [planId, billingInterval, org.id]
      );
    }
  });

  if (org.planId === 'free') {
    db.updateOrganization(org.id, { planId, billingInterval });
  }

  db.addAuditLog({
    id: `aud_sub_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    orgId: org.id,
    userId: adminUser.id,
    userEmail: adminUser.email,
    action: 'ADMIN_GRANT_SUBSCRIPTION',
    target: targetUser.email,
    details: `Admin ${adminUser.email} (${adminUser.id}) granted ${durationLabel} ${basePlanName} subscription (${websiteCapacity} websites, entitlement ${newEntId}) to ${targetUser.email} (${targetUser.id}). Starts: ${startsAtIso}, Expires: ${expiresAtIso}. Reason: ${reason}`,
    timestamp: nowIso,
  });

  const summary = await getOrganizationEntitlementSummary(org.id, nowMs);
  const entitlement = summary.entitlements.find((e) => e.id === newEntId)!;

  return {
    entitlement,
    summary,
  };
}

/**
 * Administrative Action: Set custom remaining subscription days on a specific entitlement.
 * Recalculates `expires_at` on the server from `nowMs` without resetting `starts_at`,
 * updates status (`active` vs `expired`), and immediately reconciles allocated websites.
 */
export async function adminSetEntitlementRemainingDays(
  entitlementId: string,
  adminUser: { id: string; email: string; role: string },
  options: {
    remainingDays: number;
    reason?: string;
    targetUserId?: string;
    nowMs?: number;
  }
): Promise<{
  entitlement: SubscriptionEntitlement;
  previousExpiresAt: string;
  previousDaysRemaining: number;
  newExpiresAt: string;
  newDaysRemaining: number;
  summary: OrganizationEntitlementSummary;
}> {
  await ensureEntitlementsTable();
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const remainingDays = Number(options.remainingDays);
  if (!Number.isFinite(remainingDays) || remainingDays < 0 || remainingDays > 3650) {
    const err: any = new Error(
      'Remaining days must be a valid non-negative number between 0 and 3650.'
    );
    err.statusCode = 400;
    throw err;
  }

  if (options.targetUserId) {
    const targetUser = db.findUserById(options.targetUserId);
    if (targetUser) {
      const targetOrg = db.findOrgById(targetUser.orgId);
      if (targetOrg) {
        await syncInitialTrialEntitlementRow(targetOrg, nowMs);
      }
    }
  }

  const existingRes = await query(
    `SELECT * FROM subscription_entitlements WHERE id = $1 LIMIT 1`,
    [entitlementId]
  );
  if (existingRes.rows.length === 0) {
    const err: any = new Error(`Subscription entitlement "${entitlementId}" not found.`);
    err.statusCode = 404;
    throw err;
  }

  const row = existingRes.rows[0];
  const currentEnt = mapEntitlementRow(row, nowMs);

  if (options.targetUserId) {
    const targetUser = db.findUserById(options.targetUserId);
    if (
      targetUser &&
      currentEnt.userId !== targetUser.id &&
      currentEnt.orgId !== targetUser.orgId
    ) {
      const err: any = new Error(
        'Selected entitlement does not belong to the specified user account.'
      );
      err.statusCode = 403;
      throw err;
    }
  }

  const previousExpiresAt = currentEnt.expiresAt;
  const previousDaysRemaining = currentEnt.daysRemaining;
  const newExpiresMs = nowMs + Math.round(remainingDays * DAY_DURATION_MS);
  const newExpiresAt = new Date(newExpiresMs).toISOString();
  const newStatus: EntitlementStatus = remainingDays > 0 ? 'active' : 'expired';
  const newDaysRemaining = remainingDays > 0 ? Math.ceil((newExpiresMs - nowMs) / DAY_DURATION_MS) : 0;
  const reason = (options.reason || `Admin updated remaining days to ${remainingDays}`).trim().slice(0, 500);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE subscription_entitlements
       SET expires_at = $1,
           status = $2,
           updated_at = $3
       WHERE id = $4`,
      [newExpiresAt, newStatus, nowIso, entitlementId]
    );

    if (currentEnt.source === 'trial') {
      await client.query(
        `UPDATE organizations
         SET trial_ends_at = $1,
             trial_used = true
         WHERE id = $2`,
        [newExpiresAt, currentEnt.orgId]
      );
    }
  });

  if (currentEnt.source === 'trial') {
    db.updateOrganization(currentEnt.orgId, {
      trialEndsAt: newExpiresAt,
      trialUsed: true,
    });
  }

  const ownerUser =
    db.findUserById(currentEnt.userId) ||
    db.getUsers().find((u) => u.orgId === currentEnt.orgId);

  db.addAuditLog({
    id: `aud_days_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    orgId: currentEnt.orgId,
    userId: adminUser.id,
    userEmail: adminUser.email,
    action: 'ADMIN_SET_ENTITLEMENT_REMAINING_DAYS',
    target: ownerUser?.email || currentEnt.userId,
    details: `Admin ${adminUser.email} (${adminUser.id}) updated remaining subscription days for entitlement ${entitlementId} (${currentEnt.planName}, user: ${ownerUser?.email || currentEnt.userId}). Previous: ${previousDaysRemaining}d (${previousExpiresAt}) -> New: ${newDaysRemaining}d (${newExpiresAt}). Reason: ${reason}`,
    timestamp: nowIso,
  });

  const summary = await getOrganizationEntitlementSummary(currentEnt.orgId, nowMs);
  const updatedEntitlement =
    summary.entitlements.find((e) => e.id === entitlementId) ||
    mapEntitlementRow(
      {
        ...row,
        expires_at: newExpiresAt,
        status: newStatus,
        updated_at: nowIso,
      },
      nowMs
    );

  return {
    entitlement: updatedEntitlement,
    previousExpiresAt,
    previousDaysRemaining,
    newExpiresAt,
    newDaysRemaining,
    summary,
  };
}
