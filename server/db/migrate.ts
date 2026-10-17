import fs from 'node:fs';
import path from 'node:path';
import { query, withTransaction } from './connection.ts';
import { initSchema } from './init.ts';

export interface MigrationSummary {
  success: boolean;
  source: string;
  timestamp: string;
  counts: Record<string, number>;
  details: string[];
}

export async function applyAuthCleanupMigration(): Promise<{ removedUsers: number; superAdminUpdated: boolean }> {
  let removedUsers = 0;
  let superAdminUpdated = false;

  await withTransaction(async (client) => {
    // 1. Revoke existing sessions for the removed default accounts
    await client.query(
      `DELETE FROM sessions 
       WHERE user_id IN (
         SELECT id FROM users 
         WHERE LOWER(email) IN ('admin@pulsevanguard.com', 'agency@acmedigital.com')
       )`
    );

    // 2. Remove default accounts from PostgreSQL users table
    const deleteRes = await client.query(
      `DELETE FROM users 
       WHERE LOWER(email) IN ('admin@pulsevanguard.com', 'agency@acmedigital.com')`
    );
    removedUsers = deleteRes.rowCount || 0;

    // 3. Promote mobinalavi7491@gmail.com to super_admin
    const updateRes = await client.query(
      `UPDATE users 
       SET role = 'super_admin' 
       WHERE LOWER(email) = 'mobinalavi7491@gmail.com'`
    );
    superAdminUpdated = (updateRes.rowCount || 0) > 0;

    // 4. Update owner_id of legacy orgs to target super admin if present
    const mobinUser = await client.query(
      `SELECT id FROM users WHERE LOWER(email) = 'mobinalavi7491@gmail.com' LIMIT 1`
    );
    if (mobinUser.rows.length > 0) {
      const mobinId = mobinUser.rows[0].id;
      await client.query(
        `UPDATE organizations 
         SET owner_id = $1 
         WHERE owner_id IN ('usr_admin', 'usr_agency')`,
        [mobinId]
      );
    }

    // 5. Record migration in migration_history
    await client.query(
      `INSERT INTO migration_history (id, applied_at, source, record_counts)
       VALUES ('002_auth_cleanup', NOW(), 'auth_cleanup_migration', $1)
       ON CONFLICT (id) DO UPDATE SET
         applied_at = NOW(),
         record_counts = EXCLUDED.record_counts`,
      [
        JSON.stringify({
          removedUsers,
          superAdminUpdated,
          targetEmail: 'mobinalavi7491@gmail.com',
        }),
      ]
    );
  });

  return { removedUsers, superAdminUpdated };
}

export async function applyPaymentApprovalSchemaMigration(): Promise<void> {
  const statements = [
    'ALTER TABLE crypto_orders ADD COLUMN IF NOT EXISTS approved_by TEXT',
    'ALTER TABLE crypto_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ',
    'ALTER TABLE crypto_orders ADD COLUMN IF NOT EXISTS rejected_by TEXT',
    'ALTER TABLE crypto_orders ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ',
    'ALTER TABLE crypto_orders ADD COLUMN IF NOT EXISTS rejection_reason TEXT',
  ];

  for (const st of statements) {
    try {
      await query(st);
    } catch {
      // Column may already exist or pg-mem handled
    }
  }
}

export async function applyReferralSchemaMigration(): Promise<void> {
  const statements = [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_code TEXT',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_at TIMESTAMPTZ',
    'ALTER TABLE crypto_orders ADD COLUMN IF NOT EXISTS referral_code TEXT',
    'ALTER TABLE crypto_orders ADD COLUMN IF NOT EXISTS referrer_user_id TEXT',
    `CREATE TABLE IF NOT EXISTS referral_wallets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      currency TEXT NOT NULL DEFAULT 'USDT',
      total_earned_cents INTEGER NOT NULL DEFAULT 0,
      available_balance_cents INTEGER NOT NULL DEFAULT 0,
      reserved_balance_cents INTEGER NOT NULL DEFAULT 0,
      withdrawn_balance_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS referral_commissions (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      referrer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referred_user_email TEXT NOT NULL,
      referral_code TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      purchase_amount_cents INTEGER NOT NULL,
      commission_rate_bps INTEGER NOT NULL DEFAULT 4000,
      commission_amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USDT',
      status TEXT NOT NULL DEFAULT 'credited',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS referral_wallet_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USDT',
      reference_id TEXT NOT NULL,
      idempotency_key TEXT UNIQUE NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      reserved_after_cents INTEGER NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      referral_code TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USDT',
      network TEXT NOT NULL DEFAULT 'USDT — TRC20 (TRON)',
      wallet_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      available_balance_before_cents INTEGER NOT NULL,
      approved_by_id TEXT,
      approved_by_email TEXT,
      approved_at TIMESTAMPTZ,
      paid_by_id TEXT,
      paid_by_email TEXT,
      paid_at TIMESTAMPTZ,
      tx_hash TEXT,
      rejected_by_id TEXT,
      rejected_by_email TEXT,
      rejected_at TIMESTAMPTZ,
      rejection_reason TEXT,
      cancelled_by_id TEXT,
      cancelled_by_email TEXT,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  ];

  for (const st of statements) {
    try {
      await query(st);
    } catch {
      // Table/column may already exist
    }
  }

  try {
    const { backfillReferralCodes } = await import('../referrals.ts');
    await backfillReferralCodes();
  } catch (err: any) {
    console.warn('[Migration]: Could not backfill referral codes:', err?.message);
  }
}

export async function applySupportTicketingSchemaMigration(): Promise<void> {
  const statements = [
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_reply_by_role TEXT',
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS needs_admin_response BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS unread_by_admin BOOLEAN NOT NULL DEFAULT true',
    'ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS unread_by_customer BOOLEAN NOT NULL DEFAULT false',
    `CREATE TABLE IF NOT EXISTS ticket_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      body TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS ticket_email_logs (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      message_id TEXT,
      event_type TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      diagnostic TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    'CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_support_tickets_email ON support_tickets(email)',
    'CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, updated_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at ASC)',
  ];

  for (const st of statements) {
    try {
      await query(st);
    } catch {
      // Table/column may already exist
    }
  }
}

export async function applySubscriptionEntitlementsMigration(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS subscription_entitlements (
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
    )`,
    'CREATE INDEX IF NOT EXISTS idx_sub_entitlements_user ON subscription_entitlements(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_sub_entitlements_org ON subscription_entitlements(org_id)',
    'CREATE INDEX IF NOT EXISTS idx_sub_entitlements_status_exp ON subscription_entitlements(status, expires_at)',
    // Normalize any fiat currency labels in existing tables to crypto-only USDT
    "UPDATE organizations SET currency = 'USDT' WHERE currency IN ('USD', 'EUR', 'GBP')",
    "UPDATE app_settings SET default_currency = 'USDT' WHERE default_currency IN ('USD', 'EUR', 'GBP')",
    "UPDATE invoices SET currency = 'USDT' WHERE currency IN ('USD', 'EUR', 'GBP')",
    "UPDATE referral_wallets SET currency = 'USDT' WHERE currency IN ('USD', 'EUR', 'GBP')",
    "UPDATE referral_commissions SET currency = 'USDT' WHERE currency IN ('USD', 'EUR', 'GBP')",
    "UPDATE referral_wallet_ledger SET currency = 'USDT' WHERE currency IN ('USD', 'EUR', 'GBP')",
    "UPDATE withdrawal_requests SET currency = 'USDT' WHERE currency IN ('USD', 'EUR', 'GBP')",
  ];

  for (const st of statements) {
    try {
      await query(st);
    } catch {
      // Table/column may already exist
    }
  }

  // Update subscription_plans features in PostgreSQL to remove any $ or fiat references
  try {
    await query(
      `UPDATE subscription_plans
       SET features = $1::jsonb
       WHERE id = 'pro'`,
      [
        JSON.stringify([
          '5 Monitored Websites per Entitlement',
          'Full Access after 3-Day Trial',
          '1-Minute Rapid Uptime Checks',
          'Full Google PageSpeed & Advanced SEO Audits',
          'SSL, DNS, Security Headers & Incident Alerts',
          '5 USDT/month or 50 USDT/year (Save 2 Months)',
        ]),
      ]
    );
  } catch {
    // Ignore if subscription_plans not yet initialized
  }

  try {
    const { backfillSubscriptionEntitlements } = await import('../entitlements.ts');
    await backfillSubscriptionEntitlements();
  } catch (err: any) {
    console.warn('[Migration]: Could not backfill subscription entitlements:', err?.message);
  }
}

export async function runMigration(options: { force?: boolean } = {}): Promise<MigrationSummary> {
  const jsonPath = path.resolve(process.cwd(), 'data/pulsevanguard.db.json');

  if (!fs.existsSync(jsonPath)) {
    throw new Error(`JSON database file not found at ${jsonPath}`);
  }

  const rawJson = fs.readFileSync(jsonPath, 'utf8');
  let data: any;
  try {
    data = JSON.parse(rawJson);
  } catch (err: any) {
    throw new Error(`Invalid JSON syntax in database file ${jsonPath}: ${err.message}`);
  }

  // 1. Initialize schema
  await initSchema();

  // 2. Check if migration was already applied (idempotency check)
  const existingHistory = await query('SELECT * FROM migration_history WHERE id = $1', ['init_from_json']);
  if (existingHistory.rows.length > 0 && !options.force) {
    const row = existingHistory.rows[0];
    console.log('[Migration]: JSON database was already migrated at', row.applied_at);
    // Always apply idempotent auth cleanup migration
    const cleanupResult = await applyAuthCleanupMigration();
    if (cleanupResult.removedUsers > 0 || cleanupResult.superAdminUpdated) {
      console.log(`[Migration]: Auth cleanup applied: removed ${cleanupResult.removedUsers} default users, super admin assigned: ${cleanupResult.superAdminUpdated}`);
    }
    await applyPaymentApprovalSchemaMigration();
    await applyReferralSchemaMigration();
    await applySupportTicketingSchemaMigration();
    await applySubscriptionEntitlementsMigration();
    return {
      success: true,
      source: jsonPath,
      timestamp: row.applied_at,
      counts: row.record_counts,
      details: [
        'Migration already applied. Skipped re-inserting to preserve idempotency.',
        `Auth cleanup verified (removed default accounts: ${cleanupResult.removedUsers}, super admin updated: ${cleanupResult.superAdminUpdated})`,
      ],
    };
  }

  const counts: Record<string, number> = {};
  const details: string[] = [];

  // Use a transaction for all inserts
  await withTransaction(async (client) => {
    // 1. Subscription Plans
    const plans = data.plans || [];
    for (const plan of plans) {
      await client.query(
        `INSERT INTO subscription_plans (id, name, badge, target_audience, pricing, limits, features)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           badge = EXCLUDED.badge,
           target_audience = EXCLUDED.target_audience,
           pricing = EXCLUDED.pricing,
           limits = EXCLUDED.limits,
           features = EXCLUDED.features`,
        [
          plan.id,
          plan.name,
          plan.badge,
          plan.targetAudience,
          JSON.stringify(plan.pricing),
          JSON.stringify(plan.limits),
          JSON.stringify(plan.features),
        ]
      );
    }
    counts['plans'] = plans.length;
    details.push(`Subscription Plans: ${plans.length} records imported`);

    // 2. Organizations
    const orgs = data.organizations || [];
    for (const org of orgs) {
      await client.query(
        `INSERT INTO organizations (
           id, name, plan_id, billing_interval, currency, owner_id,
           trial_started_at, trial_ends_at, trial_used, white_label, clients, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           plan_id = EXCLUDED.plan_id,
           billing_interval = EXCLUDED.billing_interval,
           currency = EXCLUDED.currency,
           owner_id = EXCLUDED.owner_id,
           trial_started_at = EXCLUDED.trial_started_at,
           trial_ends_at = EXCLUDED.trial_ends_at,
           trial_used = EXCLUDED.trial_used,
           white_label = EXCLUDED.white_label,
           clients = EXCLUDED.clients`,
        [
          org.id,
          org.name,
          org.planId,
          org.billingInterval || 'monthly',
          org.currency || 'USD',
          org.ownerId,
          org.trialStartedAt ? new Date(org.trialStartedAt).toISOString() : null,
          org.trialEndsAt ? new Date(org.trialEndsAt).toISOString() : null,
          Boolean(org.trialUsed),
          JSON.stringify(org.whiteLabel || { enabled: false, brandName: '' }),
          JSON.stringify(org.clients || []),
          org.createdAt ? new Date(org.createdAt).toISOString() : new Date().toISOString(),
        ]
      );
    }
    counts['organizations'] = orgs.length;
    details.push(`Organizations: ${orgs.length} records imported with trial state`);

    // 3. Users (filtering out removed default/demo accounts)
    const rawUsers = data.users || [];
    const users = rawUsers.filter((u: any) => {
      const clean = (u.email || '').trim().toLowerCase();
      return clean !== 'admin@pulsevanguard.com' && clean !== 'agency@acmedigital.com';
    });
    for (const user of users) {
      const cleanEmail = user.email.toLowerCase();
      const role = cleanEmail === 'mobinalavi7491@gmail.com' ? 'super_admin' : user.role;
      await client.query(
        `INSERT INTO users (
           id, email, name, password_hash, role, org_id, avatar_url, email_verified,
           referral_code, referred_by_user_id, referred_by_code, referred_at, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           org_id = EXCLUDED.org_id,
           avatar_url = EXCLUDED.avatar_url,
           email_verified = EXCLUDED.email_verified,
           referral_code = COALESCE(users.referral_code, EXCLUDED.referral_code),
           referred_by_user_id = COALESCE(users.referred_by_user_id, EXCLUDED.referred_by_user_id),
           referred_by_code = COALESCE(users.referred_by_code, EXCLUDED.referred_by_code),
           referred_at = COALESCE(users.referred_at, EXCLUDED.referred_at)`,
        [
          user.id,
          cleanEmail,
          user.name,
          user.passwordHash,
          role,
          user.orgId,
          user.avatarUrl || null,
          user.emailVerified ?? true,
          user.referralCode || null,
          user.referredByUserId || null,
          user.referredByCode || null,
          user.referredAt ? new Date(user.referredAt).toISOString() : null,
          user.createdAt ? new Date(user.createdAt).toISOString() : new Date().toISOString(),
        ]
      );
    }
    counts['users'] = users.length;
    details.push(`Users: ${users.length} records imported with password hashes`);

    // 4. Websites
    const websites = data.websites || [];
    for (const site of websites) {
      await client.query(
        `INSERT INTO websites (
           id, org_id, client_id, name, url, domain, status, interval_minutes,
           last_checked_at, last_response_time_ms, health_score, uptime_24h, uptime_7d, uptime_30d,
           verification, tags, group_name, enabled_checks, notification_settings, last_scan_result, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
         ON CONFLICT (id) DO UPDATE SET
           org_id = EXCLUDED.org_id,
           client_id = EXCLUDED.client_id,
           name = EXCLUDED.name,
           url = EXCLUDED.url,
           domain = EXCLUDED.domain,
           status = EXCLUDED.status,
           interval_minutes = EXCLUDED.interval_minutes,
           last_checked_at = EXCLUDED.last_checked_at,
           last_response_time_ms = EXCLUDED.last_response_time_ms,
           health_score = EXCLUDED.health_score,
           uptime_24h = EXCLUDED.uptime_24h,
           uptime_7d = EXCLUDED.uptime_7d,
           uptime_30d = EXCLUDED.uptime_30d,
           verification = EXCLUDED.verification,
           tags = EXCLUDED.tags,
           group_name = EXCLUDED.group_name,
           enabled_checks = EXCLUDED.enabled_checks,
           notification_settings = EXCLUDED.notification_settings,
           last_scan_result = EXCLUDED.last_scan_result`,
        [
          site.id,
          site.orgId,
          site.clientId || null,
          site.name,
          site.url,
          site.domain,
          site.status || 'ONLINE',
          site.intervalMinutes || 5,
          site.lastCheckedAt ? new Date(site.lastCheckedAt).toISOString() : null,
          site.lastResponseTimeMs || 0,
          site.healthScore ?? 100,
          site.uptime24h ?? 100.0,
          site.uptime7d ?? 100.0,
          site.uptime30d ?? 100.0,
          JSON.stringify(site.verification || {}),
          JSON.stringify(site.tags || []),
          site.groupName || 'General',
          JSON.stringify(site.enabledChecks || {}),
          JSON.stringify(site.notificationSettings || {}),
          site.lastScanResult ? JSON.stringify(site.lastScanResult) : null,
          site.createdAt ? new Date(site.createdAt).toISOString() : new Date().toISOString(),
        ]
      );
    }
    counts['websites'] = websites.length;
    details.push(`Websites: ${websites.length} records imported with scanner history`);

    // 5. Metrics
    const metrics = data.metrics || [];
    for (const metric of metrics) {
      await client.query(
        `INSERT INTO metrics (id, website_id, timestamp, status, http_status, response_time_ms, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [
          metric.id,
          metric.websiteId,
          metric.timestamp ? new Date(metric.timestamp).toISOString() : new Date().toISOString(),
          metric.status,
          metric.httpStatus,
          metric.responseTimeMs,
          metric.errorMessage || null,
        ]
      );
    }
    counts['metrics'] = metrics.length;
    details.push(`Metrics: ${metrics.length} telemetry points imported`);

    // 6. Incidents
    const incidents = data.incidents || [];
    for (const inc of incidents) {
      await client.query(
        `INSERT INTO incidents (id, org_id, website_id, website_name, started_at, resolved_at, status, cause, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           resolved_at = EXCLUDED.resolved_at,
           cause = EXCLUDED.cause,
           duration_minutes = EXCLUDED.duration_minutes`,
        [
          inc.id,
          inc.orgId,
          inc.websiteId,
          inc.websiteName,
          inc.startedAt ? new Date(inc.startedAt).toISOString() : new Date().toISOString(),
          inc.resolvedAt ? new Date(inc.resolvedAt).toISOString() : null,
          inc.status,
          inc.cause,
          inc.durationMinutes ?? null,
        ]
      );
    }
    counts['incidents'] = incidents.length;
    details.push(`Incidents: ${incidents.length} records imported`);

    // 7. Alerts
    const alerts = data.alerts || [];
    for (const alert of alerts) {
      await client.query(
        `INSERT INTO alerts (id, org_id, website_id, website_name, type, severity, title, message, read, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           read = EXCLUDED.read`,
        [
          alert.id,
          alert.orgId,
          alert.websiteId || null,
          alert.websiteName || null,
          alert.type,
          alert.severity,
          alert.title,
          alert.message,
          Boolean(alert.read),
          alert.timestamp ? new Date(alert.timestamp).toISOString() : new Date().toISOString(),
        ]
      );
    }
    counts['alerts'] = alerts.length;
    details.push(`Alerts: ${alerts.length} notifications imported`);

    // 8. Reports
    const reports = data.reports || [];
    for (const rep of reports) {
      await client.query(
        `INSERT INTO reports (id, org_id, website_id, website_name, title, type, share_token, is_public, generated_at, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           is_public = EXCLUDED.is_public,
           data = EXCLUDED.data`,
        [
          rep.id,
          rep.orgId,
          rep.websiteId,
          rep.websiteName,
          rep.title,
          rep.type,
          rep.shareToken,
          Boolean(rep.isPublic),
          rep.generatedAt ? new Date(rep.generatedAt).toISOString() : new Date().toISOString(),
          JSON.stringify(rep.data || {}),
        ]
      );
    }
    counts['reports'] = reports.length;
    details.push(`Reports: ${reports.length} audit reports imported`);

    // 9. Invoices
    const invoices = data.invoices || [];
    for (const inv of invoices) {
      await client.query(
        `INSERT INTO invoices (id, org_id, invoice_number, date, amount, currency, status, plan_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          inv.id,
          inv.orgId,
          inv.invoiceNumber,
          inv.date,
          inv.amount,
          inv.currency,
          inv.status,
          inv.planName,
        ]
      );
    }
    counts['invoices'] = invoices.length;
    details.push(`Invoices: ${invoices.length} billing records imported`);

    // 10. Crypto Orders
    const cryptoOrders = data.cryptoOrders || [];
    for (const ord of cryptoOrders) {
      await client.query(
        `INSERT INTO crypto_orders (
           id, org_id, user_id, user_email, plan_id, plan_name, billing_interval,
           currency, network, amount, deposit_address, qr_data_url, status, tx_id,
           detected_at, confirmed_at, expires_at, verification_log,
           approved_by, approved_at, rejected_by, rejected_at, rejection_reason,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           tx_id = EXCLUDED.tx_id,
           confirmed_at = EXCLUDED.confirmed_at,
           verification_log = EXCLUDED.verification_log,
           approved_by = EXCLUDED.approved_by,
           approved_at = EXCLUDED.approved_at,
           rejected_by = EXCLUDED.rejected_by,
           rejected_at = EXCLUDED.rejected_at,
           rejection_reason = EXCLUDED.rejection_reason`,
        [
          ord.id,
          ord.orgId,
          ord.userId,
          ord.userEmail,
          ord.planId,
          ord.planName,
          ord.billingInterval,
          ord.currency,
          ord.network,
          ord.amount,
          ord.depositAddress,
          ord.qrDataUrl || null,
          ord.status,
          ord.txId || null,
          ord.detectedAt ? new Date(ord.detectedAt).toISOString() : null,
          ord.confirmedAt ? new Date(ord.confirmedAt).toISOString() : null,
          new Date(ord.expiresAt).toISOString(),
          ord.verificationLog || null,
          ord.approvedBy || null,
          ord.approvedAt ? new Date(ord.approvedAt).toISOString() : null,
          ord.rejectedBy || null,
          ord.rejectedAt ? new Date(ord.rejectedAt).toISOString() : null,
          ord.rejectionReason || null,
          ord.createdAt ? new Date(ord.createdAt).toISOString() : new Date().toISOString(),
        ]
      );
    }
    counts['cryptoOrders'] = cryptoOrders.length;
    details.push(`Crypto Orders: ${cryptoOrders.length} transactions imported`);

    // 11. API Keys
    const apiKeys = data.apiKeys || [];
    for (const key of apiKeys) {
      await client.query(
        `INSERT INTO api_keys (id, org_id, name, prefix, hashed_secret, scopes, created_at, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          key.id,
          key.orgId,
          key.name,
          key.prefix,
          key.hashedSecret,
          JSON.stringify(key.scopes || []),
          key.createdAt ? new Date(key.createdAt).toISOString() : new Date().toISOString(),
          key.lastUsedAt ? new Date(key.lastUsedAt).toISOString() : null,
        ]
      );
    }
    counts['apiKeys'] = apiKeys.length;
    details.push(`API Keys: ${apiKeys.length} keys imported`);

    // 12. Support Tickets
    const tickets = data.tickets || [];
    for (const tkt of tickets) {
      await client.query(
        `INSERT INTO support_tickets (id, user_id, name, email, subject, category, message, status, priority, created_at, replies)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           replies = EXCLUDED.replies`,
        [
          tkt.id,
          tkt.userId || null,
          tkt.name,
          tkt.email,
          tkt.subject,
          tkt.category,
          tkt.message,
          tkt.status,
          tkt.priority,
          tkt.createdAt ? new Date(tkt.createdAt).toISOString() : new Date().toISOString(),
          JSON.stringify(tkt.replies || []),
        ]
      );
    }
    counts['tickets'] = tickets.length;
    details.push(`Support Tickets: ${tickets.length} tickets imported`);

    // 13. Audit Logs
    const auditLogs = data.auditLogs || [];
    for (const log of auditLogs) {
      await client.query(
        `INSERT INTO audit_logs (id, org_id, user_id, user_email, action, target, details, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [
          log.id,
          log.orgId,
          log.userId || null,
          log.userEmail || null,
          log.action,
          log.target,
          log.details,
          log.timestamp ? new Date(log.timestamp).toISOString() : new Date().toISOString(),
        ]
      );
    }
    counts['auditLogs'] = auditLogs.length;
    details.push(`Audit Logs: ${auditLogs.length} events imported`);

    // 14. PageSpeed Records
    const pageSpeedRecords = data.pageSpeedRecords || [];
    for (const ps of pageSpeedRecords) {
      await client.query(
        `INSERT INTO pagespeed_records (id, website_id, url, domain, device, performance, accessibility, best_practices, seo, data, scanned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
           performance = EXCLUDED.performance,
           accessibility = EXCLUDED.accessibility,
           best_practices = EXCLUDED.best_practices,
           seo = EXCLUDED.seo,
           data = EXCLUDED.data,
           scanned_at = EXCLUDED.scanned_at`,
        [
          ps.id,
          ps.websiteId || null,
          ps.url,
          ps.domain || '',
          ps.device || 'mobile',
          ps.performance ?? null,
          ps.accessibility ?? null,
          ps.bestPractices ?? null,
          ps.seo ?? null,
          JSON.stringify(ps),
          ps.scannedAt ? new Date(ps.scannedAt).toISOString() : new Date().toISOString(),
        ]
      );
    }
    counts['pageSpeedRecords'] = pageSpeedRecords.length;
    details.push(`PageSpeed Records: ${pageSpeedRecords.length} records imported`);

    // 15. Settings
    const settings = data.settings || {
      maintenanceMode: false,
      defaultCurrency: 'USDT',
      stripeConfigured: false,
      workerIntervalSec: 60,
      maxFreeScansPerHour: 10,
    };
    await client.query(
      `INSERT INTO app_settings (id, maintenance_mode, default_currency, stripe_configured, worker_interval_sec, max_free_scans_per_hour, updated_at)
       VALUES ('default', $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET
         maintenance_mode = EXCLUDED.maintenance_mode,
         default_currency = EXCLUDED.default_currency,
         stripe_configured = EXCLUDED.stripe_configured,
         worker_interval_sec = EXCLUDED.worker_interval_sec,
         max_free_scans_per_hour = EXCLUDED.max_free_scans_per_hour,
         updated_at = NOW()`,
      [
        Boolean(settings.maintenanceMode),
        'USDT',
        Boolean(settings.stripeConfigured),
        settings.workerIntervalSec || 60,
        settings.maxFreeScansPerHour || 10,
      ]
    );
    counts['settings'] = 1;
    details.push('Application Settings: 1 record imported');

    // 16. Record migration in history
    await client.query(
      `INSERT INTO migration_history (id, applied_at, source, record_counts)
       VALUES ($1, NOW(), $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         applied_at = NOW(),
         record_counts = EXCLUDED.record_counts`,
      ['init_from_json', jsonPath, JSON.stringify(counts)]
    );
  });

  await applyReferralSchemaMigration();
  await applySupportTicketingSchemaMigration();
  await applySubscriptionEntitlementsMigration();

  return {
    success: true,
    source: jsonPath,
    timestamp: new Date().toISOString(),
    counts,
    details,
  };
}
