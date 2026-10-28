import { query, withTransaction } from './connection.ts';
import type {
  User,
  Organization,
  Website,
  MetricPoint,
  Incident,
  AlertNotification,
  ReportItem,
  SubscriptionPlan,
  Invoice,
  CryptoPaymentOrder,
  ApiKey,
  SupportTicket,
  AuditLog,
} from '../db.ts';
import type { StoredPageSpeedRecord } from '../pagespeedTypes.ts';

// 1. User Repository
export const UserRepo = {
  async getAll(): Promise<User[]> {
    const res = await query('SELECT * FROM users ORDER BY created_at ASC');
    return res.rows.map(mapUserRow);
  },

  async findById(id: string): Promise<User | null> {
    const res = await query('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] ? mapUserRow(res.rows[0]) : null;
  },

  async findByEmail(email: string): Promise<User | null> {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    const res = await query('SELECT * FROM users WHERE email = $1 LIMIT 1', [clean]);
    return res.rows[0] ? mapUserRow(res.rows[0]) : null;
  },

  async insert(user: User): Promise<void> {
    const cleanEmail = user.email.trim().toLowerCase();
    // Prevent accidental re-insertion of removed default accounts
    if (cleanEmail === 'admin@pulsevanguard.com' || cleanEmail === 'agency@acmedigital.com') {
      return;
    }
    const role = cleanEmail === 'mobinalavi7491@gmail.com' ? 'super_admin' : user.role;
    await query(
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
  },

  async updateRole(userId: string, role: string): Promise<boolean> {
    const res = await query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
    return (res.rowCount || 0) > 0;
  },

  async updatePasswordHash(userId: string, passwordHash: string): Promise<boolean> {
    const res = await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    return (res.rowCount || 0) > 0;
  },

  async deleteByEmail(email: string): Promise<boolean> {
    const res = await query('DELETE FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    return (res.rowCount || 0) > 0;
  },
};

// 2. Organization Repository
export const OrgRepo = {
  async getAll(): Promise<Organization[]> {
    const res = await query('SELECT * FROM organizations ORDER BY created_at ASC');
    return res.rows.map(mapOrgRow);
  },

  async findById(id: string): Promise<Organization | null> {
    const res = await query('SELECT * FROM organizations WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] ? mapOrgRow(res.rows[0]) : null;
  },

  async insert(org: Organization): Promise<void> {
    await query(
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
        org.currency || 'USDT',
        org.ownerId,
        org.trialStartedAt ? new Date(org.trialStartedAt).toISOString() : null,
        org.trialEndsAt ? new Date(org.trialEndsAt).toISOString() : null,
        Boolean(org.trialUsed),
        JSON.stringify(org.whiteLabel || { enabled: false, brandName: '' }),
        JSON.stringify(org.clients || []),
        org.createdAt ? new Date(org.createdAt).toISOString() : new Date().toISOString(),
      ]
    );
  },

  async update(id: string, updates: Partial<Organization>): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    await this.insert(merged);
  },
};

// 3. Website Repository
export const WebsiteRepo = {
  async getAll(): Promise<Website[]> {
    const res = await query('SELECT * FROM websites ORDER BY created_at ASC');
    return res.rows.map(mapWebsiteRow);
  },

  async findById(id: string): Promise<Website | null> {
    const res = await query('SELECT * FROM websites WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] ? mapWebsiteRow(res.rows[0]) : null;
  },

  async findByOrgId(orgId: string): Promise<Website[]> {
    const res = await query('SELECT * FROM websites WHERE org_id = $1 ORDER BY created_at ASC', [orgId]);
    return res.rows.map(mapWebsiteRow);
  },

  async insert(site: Website): Promise<void> {
    await query(
      `INSERT INTO websites (
         id, org_id, client_id, name, url, domain, status, interval_minutes,
         last_checked_at, last_response_time_ms, health_score, uptime_24h, uptime_7d, uptime_30d,
         verification, tags, group_name, enabled_checks, notification_settings, last_scan_result,
         entitlement_id, subscription_expires_at, expired_at, scheduled_deletion_at, access_status,
         last_whois_result, created_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20,
         $21, $22, $23, $24, $25,
         $26, $27
       )
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
         last_scan_result = EXCLUDED.last_scan_result,
         entitlement_id = EXCLUDED.entitlement_id,
         subscription_expires_at = EXCLUDED.subscription_expires_at,
         expired_at = EXCLUDED.expired_at,
         scheduled_deletion_at = EXCLUDED.scheduled_deletion_at,
         access_status = EXCLUDED.access_status,
         last_whois_result = EXCLUDED.last_whois_result`,
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
        site.entitlementId || null,
        site.subscriptionExpiresAt ? new Date(site.subscriptionExpiresAt).toISOString() : null,
        site.expiredAt ? new Date(site.expiredAt).toISOString() : null,
        site.scheduledDeletionAt ? new Date(site.scheduledDeletionAt).toISOString() : null,
        site.accessStatus || 'active',
        site.lastWhoisResult ? JSON.stringify(site.lastWhoisResult) : null,
        site.createdAt ? new Date(site.createdAt).toISOString() : new Date().toISOString(),
      ]
    );
  },

  async update(id: string, updates: Partial<Website>): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    await this.insert(merged);
  },

  async delete(id: string): Promise<boolean> {
    return withTransaction(async (client) => {
      await client.query('DELETE FROM metrics WHERE website_id = $1', [id]);
      const res = await client.query('DELETE FROM websites WHERE id = $1', [id]);
      return (res.rowCount || 0) > 0;
    });
  },
};

// 4. Metrics Repository
export const MetricRepo = {
  async getAll(): Promise<MetricPoint[]> {
    const res = await query('SELECT * FROM metrics ORDER BY timestamp ASC');
    return res.rows.map(mapMetricRow);
  },

  async insert(metric: MetricPoint): Promise<void> {
    await query(
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
  },
};

// 5. Incidents Repository
export const IncidentRepo = {
  async getAll(): Promise<Incident[]> {
    const res = await query('SELECT * FROM incidents ORDER BY started_at DESC');
    return res.rows.map(mapIncidentRow);
  },

  async insert(inc: Incident): Promise<void> {
    await query(
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
  },

  async update(id: string, updates: Partial<Incident>): Promise<void> {
    const res = await query('SELECT * FROM incidents WHERE id = $1', [id]);
    if (res.rows.length === 0) return;
    const merged = { ...mapIncidentRow(res.rows[0]), ...updates };
    await this.insert(merged);
  },
};

// 6. Alerts Repository
export const AlertRepo = {
  async getAll(): Promise<AlertNotification[]> {
    const res = await query('SELECT * FROM alerts ORDER BY timestamp DESC');
    return res.rows.map(mapAlertRow);
  },

  async insert(alert: AlertNotification): Promise<void> {
    await query(
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
  },

  async markRead(id: string): Promise<void> {
    await query('UPDATE alerts SET read = true WHERE id = $1', [id]);
  },
};

// 7. PageSpeed Repository
export const PageSpeedRepo = {
  async getAll(): Promise<StoredPageSpeedRecord[]> {
    const res = await query('SELECT data FROM pagespeed_records ORDER BY scanned_at DESC');
    return res.rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  },

  async insert(record: StoredPageSpeedRecord): Promise<void> {
    await query(
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
        record.id,
        record.websiteId || null,
        record.url,
        record.domain || '',
        record.device || 'mobile',
        record.performance ?? null,
        record.accessibility ?? null,
        record.bestPractices ?? null,
        record.seo ?? null,
        JSON.stringify(record),
        record.scannedAt ? new Date(record.scannedAt).toISOString() : new Date().toISOString(),
      ]
    );
  },
};

// 8. Crypto Orders Repository
export const CryptoOrderRepo = {
  async getAll(): Promise<CryptoPaymentOrder[]> {
    const res = await query('SELECT * FROM crypto_orders ORDER BY created_at DESC');
    return res.rows.map(mapCryptoOrderRow);
  },

  async findById(id: string): Promise<CryptoPaymentOrder | null> {
    const res = await query('SELECT * FROM crypto_orders WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] ? mapCryptoOrderRow(res.rows[0]) : null;
  },

  async findByTxId(txId: string): Promise<CryptoPaymentOrder | null> {
    const clean = txId.trim().toLowerCase();
    const res = await query('SELECT * FROM crypto_orders WHERE LOWER(tx_id) = $1 LIMIT 1', [clean]);
    return res.rows[0] ? mapCryptoOrderRow(res.rows[0]) : null;
  },

  async insert(ord: CryptoPaymentOrder): Promise<void> {
    await query(
      `INSERT INTO crypto_orders (
         id, org_id, user_id, user_email, plan_id, plan_name, billing_interval,
         currency, network, amount, deposit_address, qr_data_url, status, tx_id,
         detected_at, confirmed_at, expires_at, verification_log,
         approved_by, approved_at, rejected_by, rejected_at, rejection_reason,
         referral_code, referrer_user_id, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         tx_id = EXCLUDED.tx_id,
         confirmed_at = EXCLUDED.confirmed_at,
         verification_log = EXCLUDED.verification_log,
         approved_by = EXCLUDED.approved_by,
         approved_at = EXCLUDED.approved_at,
         rejected_by = EXCLUDED.rejected_by,
         rejected_at = EXCLUDED.rejected_at,
         rejection_reason = EXCLUDED.rejection_reason,
         referral_code = COALESCE(crypto_orders.referral_code, EXCLUDED.referral_code),
         referrer_user_id = COALESCE(crypto_orders.referrer_user_id, EXCLUDED.referrer_user_id)`,
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
        ord.referralCode || null,
        ord.referrerUserId || null,
        ord.createdAt ? new Date(ord.createdAt).toISOString() : new Date().toISOString(),
      ]
    );
  },

  async update(id: string, updates: Partial<CryptoPaymentOrder>): Promise<CryptoPaymentOrder | null> {
    const existing = await this.findById(id);
    if (!existing) return null;
    const merged = { ...existing, ...updates };
    await this.insert(merged);
    return merged;
  },
};

// 9. Subscription Plans Repository
export const PlanRepo = {
  async getAll(): Promise<SubscriptionPlan[]> {
    const res = await query('SELECT * FROM subscription_plans ORDER BY id ASC');
    return res.rows.map(mapPlanRow);
  },

  async insert(plan: SubscriptionPlan): Promise<void> {
    await query(
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
  },
};

// 10. Reports, Invoices, Tickets, ApiKeys, AuditLogs, Settings
export const GenericRepo = {
  async getAllReports(): Promise<ReportItem[]> {
    const res = await query('SELECT * FROM reports ORDER BY generated_at DESC');
    return res.rows.map(mapReportRow);
  },

  async addReport(rep: ReportItem): Promise<void> {
    await query(
      `INSERT INTO reports (id, org_id, website_id, website_name, title, type, share_token, is_public, generated_at, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, is_public = EXCLUDED.is_public, data = EXCLUDED.data`,
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
  },

  async getAllInvoices(): Promise<Invoice[]> {
    const res = await query('SELECT * FROM invoices ORDER BY date DESC');
    return res.rows.map(mapInvoiceRow);
  },

  async addInvoice(inv: Invoice): Promise<void> {
    await query(
      `INSERT INTO invoices (id, org_id, invoice_number, date, amount, currency, status, plan_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [inv.id, inv.orgId, inv.invoiceNumber, inv.date, inv.amount, inv.currency, inv.status, inv.planName]
    );
  },

  async getAllApiKeys(): Promise<ApiKey[]> {
    const res = await query('SELECT * FROM api_keys ORDER BY created_at DESC');
    return res.rows.map(mapApiKeyRow);
  },

  async addApiKey(key: ApiKey): Promise<void> {
    await query(
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
  },

  async revokeApiKey(id: string): Promise<void> {
    await query('DELETE FROM api_keys WHERE id = $1', [id]);
  },

  async getAllTickets(): Promise<SupportTicket[]> {
    const res = await query('SELECT * FROM support_tickets ORDER BY COALESCE(updated_at, created_at) DESC');
    return res.rows.map(mapTicketRow);
  },

  async addTicket(tkt: SupportTicket): Promise<void> {
    const createdIso = tkt.createdAt ? new Date(tkt.createdAt).toISOString() : new Date().toISOString();
    const updatedIso = tkt.updatedAt ? new Date(tkt.updatedAt).toISOString() : createdIso;
    const lastMsgIso = tkt.lastMessageAt ? new Date(tkt.lastMessageAt).toISOString() : updatedIso;
    await query(
      `INSERT INTO support_tickets (
         id, user_id, name, email, subject, category, message, status, priority,
         created_at, updated_at, last_message_at, last_reply_by_role,
         needs_admin_response, unread_by_admin, unread_by_customer, replies
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (id) DO UPDATE SET
         user_id = COALESCE(support_tickets.user_id, EXCLUDED.user_id),
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at,
         last_message_at = EXCLUDED.last_message_at,
         last_reply_by_role = EXCLUDED.last_reply_by_role,
         needs_admin_response = EXCLUDED.needs_admin_response,
         unread_by_admin = EXCLUDED.unread_by_admin,
         unread_by_customer = EXCLUDED.unread_by_customer,
         replies = EXCLUDED.replies`,
      [
        tkt.id,
        tkt.userId || null,
        tkt.name,
        tkt.email,
        tkt.subject,
        tkt.category || 'general',
        tkt.message,
        tkt.status,
        tkt.priority || 'medium',
        createdIso,
        updatedIso,
        lastMsgIso,
        tkt.lastReplyByRole || null,
        tkt.needsAdminResponse ?? true,
        tkt.unreadByAdmin ?? true,
        tkt.unreadByCustomer ?? false,
        JSON.stringify(tkt.replies || []),
      ]
    );
  },

  async updateTicket(id: string, updates: Partial<SupportTicket>): Promise<void> {
    const res = await query('SELECT * FROM support_tickets WHERE id = $1', [id]);
    if (res.rows.length === 0) return;
    const merged = { ...mapTicketRow(res.rows[0]), ...updates };
    await this.addTicket(merged);
  },

  async getAllAuditLogs(): Promise<AuditLog[]> {
    const res = await query('SELECT * FROM audit_logs ORDER BY timestamp DESC');
    return res.rows.map(mapAuditLogRow);
  },

  async addAuditLog(log: AuditLog): Promise<void> {
    await query(
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
  },

  async getSettings(): Promise<any> {
    const res = await query('SELECT * FROM app_settings WHERE id = $1', ['default']);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      maintenanceMode: Boolean(row.maintenance_mode),
      defaultCurrency: row.default_currency,
      stripeConfigured: Boolean(row.stripe_configured),
      workerIntervalSec: row.worker_interval_sec,
      maxFreeScansPerHour: row.max_free_scans_per_hour,
    };
  },

  async updateSettings(settings: any): Promise<void> {
    await query(
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
        settings.defaultCurrency || 'USDT',
        Boolean(settings.stripeConfigured),
        settings.workerIntervalSec || 60,
        settings.maxFreeScansPerHour || 10,
      ]
    );
  },
};

// Row mappers
function mapUserRow(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    role: row.role,
    orgId: row.org_id,
    avatarUrl: row.avatar_url || undefined,
    emailVerified: Boolean(row.email_verified),
    referralCode: row.referral_code || undefined,
    referredByUserId: row.referred_by_user_id || undefined,
    referredByCode: row.referred_by_code || undefined,
    referredAt: row.referred_at ? new Date(row.referred_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapOrgRow(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    planId: row.plan_id,
    billingInterval: row.billing_interval,
    currency: row.currency,
    ownerId: row.owner_id,
    trialStartedAt: row.trial_started_at ? new Date(row.trial_started_at).toISOString() : undefined,
    trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : undefined,
    trialUsed: Boolean(row.trial_used),
    whiteLabel: typeof row.white_label === 'string' ? JSON.parse(row.white_label) : row.white_label || { enabled: false, brandName: '' },
    clients: typeof row.clients === 'string' ? JSON.parse(row.clients) : row.clients || [],
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapWebsiteRow(row: any): Website {
  const accessStatus = row.access_status || 'active';
  const scheduledDelIso = row.scheduled_deletion_at ? new Date(row.scheduled_deletion_at).toISOString() : null;
  return {
    id: row.id,
    orgId: row.org_id,
    clientId: row.client_id || undefined,
    name: row.name,
    url: row.url,
    domain: row.domain,
    status: row.status,
    intervalMinutes: row.interval_minutes,
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : undefined,
    lastResponseTimeMs: row.last_response_time_ms,
    healthScore: row.health_score,
    uptime24h: parseFloat(row.uptime_24h),
    uptime7d: parseFloat(row.uptime_7d),
    uptime30d: parseFloat(row.uptime_30d),
    verification: typeof row.verification === 'string' ? JSON.parse(row.verification) : row.verification || {},
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags || [],
    groupName: row.group_name,
    enabledChecks: typeof row.enabled_checks === 'string' ? JSON.parse(row.enabled_checks) : row.enabled_checks || {},
    notificationSettings: typeof row.notification_settings === 'string' ? JSON.parse(row.notification_settings) : row.notification_settings || {},
    lastScanResult: row.last_scan_result ? (typeof row.last_scan_result === 'string' ? JSON.parse(row.last_scan_result) : row.last_scan_result) : undefined,
    lastWhoisResult: row.last_whois_result ? (typeof row.last_whois_result === 'string' ? JSON.parse(row.last_whois_result) : row.last_whois_result) : undefined,
    entitlementId: row.entitlement_id || null,
    subscriptionExpiresAt: row.subscription_expires_at ? new Date(row.subscription_expires_at).toISOString() : null,
    expiredAt: row.expired_at ? new Date(row.expired_at).toISOString() : null,
    scheduledDeletionAt: scheduledDelIso,
    accessStatus,
    isSubscriptionExpired: accessStatus === 'expired_grace_period',
    deletionRemainingMs: scheduledDelIso ? Math.max(0, new Date(scheduledDelIso).getTime() - Date.now()) : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function mapMetricRow(row: any): MetricPoint {
  return {
    id: row.id,
    websiteId: row.website_id,
    timestamp: new Date(row.timestamp).toISOString(),
    status: row.status,
    httpStatus: row.http_status,
    responseTimeMs: row.response_time_ms,
    errorMessage: row.error_message || undefined,
  };
}

function mapIncidentRow(row: any): Incident {
  return {
    id: row.id,
    orgId: row.org_id,
    websiteId: row.website_id,
    websiteName: row.website_name,
    startedAt: new Date(row.started_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : undefined,
    status: row.status,
    cause: row.cause,
    durationMinutes: row.duration_minutes ? parseFloat(row.duration_minutes) : undefined,
  };
}

function mapAlertRow(row: any): AlertNotification {
  return {
    id: row.id,
    orgId: row.org_id,
    websiteId: row.website_id || undefined,
    websiteName: row.website_name || undefined,
    type: row.type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    read: Boolean(row.read),
    timestamp: new Date(row.timestamp).toISOString(),
  };
}

export function mapCryptoOrderRow(row: any): CryptoPaymentOrder {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    userEmail: row.user_email,
    planId: row.plan_id,
    planName: row.plan_name,
    billingInterval: row.billing_interval,
    currency: row.currency,
    network: row.network,
    amount: parseFloat(row.amount),
    depositAddress: row.deposit_address,
    qrDataUrl: row.qr_data_url || undefined,
    status: row.status,
    txId: row.tx_id || undefined,
    detectedAt: row.detected_at ? new Date(row.detected_at).toISOString() : undefined,
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : undefined,
    expiresAt: new Date(row.expires_at).toISOString(),
    verificationLog: row.verification_log || undefined,
    approvedBy: row.approved_by || undefined,
    approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : undefined,
    rejectedBy: row.rejected_by || undefined,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at).toISOString() : undefined,
    rejectionReason: row.rejection_reason || undefined,
    referralCode: row.referral_code || undefined,
    referrerUserId: row.referrer_user_id || undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function mapTicketRow(row: any): SupportTicket {
  const createdIso = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();
  const updatedIso = row.updated_at ? new Date(row.updated_at).toISOString() : createdIso;
  const lastMsgIso = row.last_message_at ? new Date(row.last_message_at).toISOString() : updatedIso;
  return {
    id: row.id,
    userId: row.user_id || undefined,
    name: row.name,
    email: row.email,
    subject: row.subject,
    category: row.category || 'general',
    message: row.message,
    status: row.status,
    priority: row.priority || 'medium',
    createdAt: createdIso,
    updatedAt: updatedIso,
    lastMessageAt: lastMsgIso,
    lastReplyByRole: row.last_reply_by_role || undefined,
    needsAdminResponse: row.needs_admin_response !== undefined && row.needs_admin_response !== null ? Boolean(row.needs_admin_response) : true,
    unreadByAdmin: row.unread_by_admin !== undefined && row.unread_by_admin !== null ? Boolean(row.unread_by_admin) : true,
    unreadByCustomer: row.unread_by_customer !== undefined && row.unread_by_customer !== null ? Boolean(row.unread_by_customer) : false,
    replies: typeof row.replies === 'string' ? JSON.parse(row.replies) : row.replies || [],
  };
}

function mapPlanRow(row: any): SubscriptionPlan {
  return {
    id: row.id,
    name: row.name,
    badge: row.badge,
    targetAudience: row.target_audience,
    pricing: typeof row.pricing === 'string' ? JSON.parse(row.pricing) : row.pricing,
    limits: typeof row.limits === 'string' ? JSON.parse(row.limits) : row.limits,
    features: typeof row.features === 'string' ? JSON.parse(row.features) : row.features,
  };
}

function mapReportRow(row: any): ReportItem {
  return {
    id: row.id,
    orgId: row.org_id,
    websiteId: row.website_id,
    websiteName: row.website_name,
    title: row.title,
    type: row.type,
    shareToken: row.share_token,
    isPublic: Boolean(row.is_public),
    generatedAt: new Date(row.generated_at).toISOString(),
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data || {},
  };
}

function mapInvoiceRow(row: any): Invoice {
  return {
    id: row.id,
    orgId: row.org_id,
    invoiceNumber: row.invoice_number,
    date: new Date(row.date).toISOString(),
    amount: parseFloat(row.amount),
    currency: row.currency,
    status: row.status,
    planName: row.plan_name,
  };
}

function mapApiKeyRow(row: any): ApiKey {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    prefix: row.prefix,
    hashedSecret: row.hashed_secret,
    scopes: typeof row.scopes === 'string' ? JSON.parse(row.scopes) : row.scopes || [],
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : undefined,
  };
}

function mapAuditLogRow(row: any): AuditLog {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id || undefined,
    userEmail: row.user_email || undefined,
    action: row.action,
    target: row.target,
    details: row.details,
    timestamp: new Date(row.timestamp).toISOString(),
  };
}

