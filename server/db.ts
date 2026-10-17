import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ScanResult } from './scanner.ts';
import type { StoredPageSpeedRecord } from './pagespeedTypes.ts';
import {
  UserRepo,
  OrgRepo,
  WebsiteRepo,
  MetricRepo,
  IncidentRepo,
  AlertRepo,
  PageSpeedRepo,
  CryptoOrderRepo,
  PlanRepo,
  GenericRepo,
} from './db/repositories.ts';
import { initSchema } from './db/init.ts';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'super_admin' | 'admin' | 'agency_admin' | 'team_member' | 'client_viewer';
  orgId: string;
  avatarUrl?: string;
  emailVerified: boolean;
  referralCode?: string;
  referredByUserId?: string;
  referredByCode?: string;
  referredAt?: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  planId: 'free' | 'pro' | 'agency' | 'enterprise';
  billingInterval: 'monthly' | 'annual';
  currency: 'USD' | 'EUR' | 'GBP';
  ownerId: string;
  trialStartedAt?: string;
  trialEndsAt?: string;
  trialUsed?: boolean;
  whiteLabel: {
    enabled: boolean;
    brandName: string;
    logoUrl?: string;
    reportFooterText?: string;
    customDomain?: string;
  };
  clients: {
    id: string;
    name: string;
    contactEmail: string;
    notes?: string;
    createdAt: string;
  }[];
  createdAt: string;
}

export interface Website {
  id: string;
  orgId: string;
  clientId?: string;
  name: string;
  url: string;
  domain: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'PAUSED';
  intervalMinutes: number;
  lastCheckedAt?: string;
  lastResponseTimeMs: number;
  healthScore: number;
  uptime24h: number;
  uptime7d: number;
  uptime30d: number;
  verification: {
    verified: boolean;
    token: string;
    method: 'dns_txt' | 'meta_tag';
    verifiedAt?: string;
  };
  tags: string[];
  groupName: string;
  enabledChecks: {
    uptime: boolean;
    ssl: boolean;
    dns: boolean;
    seo: boolean;
    security: boolean;
    brokenLinks: boolean;
  };
  notificationSettings: {
    email: boolean;
    alertEmail?: string;
    webhookUrl?: string;
    slackWebhook?: string;
    alertOnDown: boolean;
    alertOnRecovery: boolean;
    alertOnSslExpiry: boolean;
    latencyThresholdMs: number;
  };
  lastScanResult?: ScanResult;
  createdAt: string;
}

export interface MetricPoint {
  id: string;
  websiteId: string;
  timestamp: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  httpStatus: number;
  responseTimeMs: number;
  errorMessage?: string;
}

export interface Incident {
  id: string;
  orgId: string;
  websiteId: string;
  websiteName: string;
  startedAt: string;
  resolvedAt?: string;
  status: 'OPEN' | 'RESOLVED';
  cause: string;
  durationMinutes?: number;
}

export interface AlertNotification {
  id: string;
  orgId: string;
  websiteId?: string;
  websiteName?: string;
  type: 'downtime' | 'recovery' | 'ssl_expiry' | 'latency' | 'security' | 'referral' | 'withdrawal';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  read: boolean;
  timestamp: string;
}

export interface ReportItem {
  id: string;
  orgId: string;
  websiteId: string;
  websiteName: string;
  title: string;
  type: 'health' | 'uptime' | 'security' | 'seo' | 'executive';
  shareToken: string;
  isPublic: boolean;
  generatedAt: string;
  data: any;
}

export interface SubscriptionPlan {
  id: 'free' | 'pro' | 'agency' | 'enterprise';
  name: string;
  badge: string;
  targetAudience: string;
  pricing: {
    USD: { monthly: number; annual: number };
    EUR: { monthly: number; annual: number };
    GBP: { monthly: number; annual: number };
  };
  limits: {
    maxWebsites: number;
    minIntervalMinutes: number;
    dataRetentionDays: number;
    teamMembersLimit: number;
    whiteLabel: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
  };
  features: string[];
}

export interface Invoice {
  id: string;
  orgId: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  currency: string;
  status: 'paid' | 'pending';
  planName: string;
}

export type CryptoPaymentStatus = 'Pending' | 'Confirming' | 'Paid' | 'Failed' | 'Expired' | 'Manual Review' | 'Rejected' | 'Cancelled';

export interface CryptoPaymentOrder {
  id: string;
  orgId: string;
  userId: string;
  userEmail: string;
  planId: 'pro' | 'agency' | 'enterprise';
  planName: string;
  billingInterval: 'monthly' | 'annual';
  currency: 'USDT';
  network: 'TRON (TRC20)';
  amount: number;
  depositAddress: string;
  qrDataUrl?: string;
  status: CryptoPaymentStatus;
  txId?: string;
  detectedAt?: string;
  confirmedAt?: string;
  expiresAt: string;
  verificationLog?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  referralCode?: string;
  referrerUserId?: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  orgId: string;
  name: string;
  prefix: string;
  hashedSecret: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string;
}

export type TicketStatus = 'open' | 'in_progress' | 'waiting_for_customer' | 'resolved' | 'closed';

export interface TicketReply {
  id?: string;
  ticketId?: string;
  senderUserId?: string;
  sender: string;
  senderEmail?: string;
  role: 'customer' | 'admin' | string;
  message: string;
  timestamp: string;
}

export interface SupportTicket {
  id: string;
  userId?: string;
  name: string;
  email: string;
  subject: string;
  category: 'technical' | 'billing' | 'monitoring' | 'feature' | 'general';
  message: string;
  status: TicketStatus;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt?: string;
  lastMessageAt?: string;
  lastReplyByRole?: 'customer' | 'admin';
  needsAdminResponse?: boolean;
  unreadByAdmin?: boolean;
  unreadByCustomer?: boolean;
  replies: TicketReply[];
}

export interface AuditLog {
  id: string;
  orgId: string;
  userId?: string;
  userEmail?: string;
  action: string;
  target: string;
  details: string;
  timestamp: string;
}

interface DatabaseSchema {
  users: User[];
  organizations: Organization[];
  websites: Website[];
  metrics: MetricPoint[];
  incidents: Incident[];
  alerts: AlertNotification[];
  reports: ReportItem[];
  plans: SubscriptionPlan[];
  invoices: Invoice[];
  cryptoOrders: CryptoPaymentOrder[];
  apiKeys: ApiKey[];
  tickets: SupportTicket[];
  auditLogs: AuditLog[];
  pageSpeedRecords?: StoredPageSpeedRecord[];
  settings: {
    maintenanceMode: boolean;
    defaultCurrency: 'USD' | 'EUR' | 'GBP';
    stripeConfigured: boolean;
    workerIntervalSec: number;
    maxFreeScansPerHour: number;
  };
}

const DB_FILE = path.resolve(process.cwd(), 'data/pulsevanguard.db.json');

// Password hashing
export function hashPassword(plain: string): string {
  return crypto.pbkdf2Sync(plain, 'pv_salt_2026', 10000, 64, 'sha512').toString('hex');
}

export function verifyPassword(plain: string, hash: string): boolean {
  if (!plain || !hash) return false;

  // Generate input variants to tolerate subtle browser differences (e.g. CRLF vs LF, Unicode NFC vs NFD, trailing spaces)
  const variants = new Set<string>();
  variants.add(plain);
  variants.add(plain.trim());
  variants.add(plain.normalize('NFC'));
  variants.add(plain.normalize('NFD'));
  variants.add(plain.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

  for (const candidate of variants) {
    if (!candidate) continue;

    // 1. Standard PBKDF2 verification
    const pbkdf2Hash = hashPassword(candidate);
    if (pbkdf2Hash === hash) return true;

    // 2. Direct SHA-512 verification (for legacy / imported accounts)
    const sha512Hash = crypto.createHash('sha512').update(candidate).digest('hex');
    if (sha512Hash === hash) return true;

    // 3. Direct SHA-256 verification
    const sha256Hash = crypto.createHash('sha256').update(candidate).digest('hex');
    if (sha256Hash === hash) return true;

    // 4. Constant time string comparison check
    try {
      if (crypto.timingSafeEqual(Buffer.from(pbkdf2Hash), Buffer.from(hash))) return true;
    } catch {}
  }

  return false;
}

class Database {
  private data: DatabaseSchema;
  private schemaInitPromise: Promise<void> | null = null;

  constructor() {
    this.data = this.loadOrInit();
    this.persist();
    this.ensureSchema().catch(() => {});
  }

  public async ensureSchema(): Promise<void> {
    if (!this.schemaInitPromise) {
      this.schemaInitPromise = (async () => {
        try {
          await initSchema();
        } catch (e: any) {
          // Schema init error handled gracefully
        }
      })();
    }
    return this.schemaInitPromise;
  }

  private syncToDb(op: () => Promise<any>, errorContext: string) {
    this.ensureSchema()
      .then(op)
      .catch((err) => {
        console.error(`[PostgreSQL Sync Error] ${errorContext}:`, err.message);
      });
  }

  public generatePlans(): SubscriptionPlan[] {
    return [
      {
        id: 'free',
        name: 'Free',
        badge: '24-Hour Trial',
        targetAudience: '24 hour trial only, one time per account',
        pricing: {
          USD: { monthly: 0, annual: 0 },
          EUR: { monthly: 0, annual: 0 },
          GBP: { monthly: 0, annual: 0 },
        },
        limits: {
          maxWebsites: 1,
          minIntervalMinutes: 5,
          dataRetentionDays: 1,
          teamMembersLimit: 1,
          whiteLabel: false,
          apiAccess: false,
          prioritySupport: false,
        },
        features: [
          '24 hour trial only, one time per account',
          'Instant health diagnostics & response scan',
          '1 website monitored during trial window',
          'DNS, SSL & basic port checks',
          'Real-time uptime simulator',
          'Exportable health audit summary',
        ],
      },
      {
        id: 'pro',
        name: 'Pro',
        badge: 'Recommended',
        targetAudience: '$5/month · Can scan 5 websites',
        pricing: {
          USD: { monthly: 5, annual: 50 },
          EUR: { monthly: 5, annual: 50 },
          GBP: { monthly: 4, annual: 40 },
        },
        limits: {
          maxWebsites: 5,
          minIntervalMinutes: 1,
          dataRetentionDays: 180,
          teamMembersLimit: 5,
          whiteLabel: true,
          apiAccess: true,
          prioritySupport: true,
        },
        features: [
          'Can scan 5 websites',
          '$5 / month transparent pricing',
          '1-minute rapid monitoring checks',
          'Continuous SSL & TLS certificate expiry alarms',
          'DNS, security headers & SEO health auditing',
          'Instant email & webhook downtime alerts',
          'REST API access with scoped keys',
          'White-label executive client reports',
          'Priority 24/7 technical support',
        ],
      },
    ];
  }

  private loadOrInit(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed: DatabaseSchema = JSON.parse(raw);
        parsed.plans = this.generatePlans();
        if (!parsed.cryptoOrders) {
          parsed.cryptoOrders = [];
        }
        if (parsed.organizations) {
          for (const org of parsed.organizations) {
            if (org.planId !== 'free' && org.planId !== 'pro') {
              org.planId = 'pro';
            }
            // Safely migrate missing trial fields based on immutable account creation timestamp
            if (!org.trialStartedAt) {
              org.trialStartedAt = org.createdAt || '2026-01-01T00:00:00.000Z';
            }
            if (!org.trialEndsAt) {
              const startMs = new Date(org.trialStartedAt).getTime();
              org.trialEndsAt = new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
            }
            if (org.trialUsed === undefined) {
              org.trialUsed = true;
            }
          }
        }
        if (parsed.users) {
          // Permanently filter out removed default demo accounts
          parsed.users = parsed.users.filter((u: any) => {
            const clean = (u.email || '').trim().toLowerCase();
            return clean !== 'admin@pulsevanguard.com' && clean !== 'agency@acmedigital.com';
          });
          const usedCodes = new Set<string>();
          for (const u of parsed.users) {
            if (u.referralCode) usedCodes.add(String(u.referralCode).toUpperCase());
          }
          // Guarantee mobinalavi7491@gmail.com is Super Admin and backfill referralCode
          for (const u of parsed.users) {
            if (u.email && u.email.trim().toLowerCase() === 'mobinalavi7491@gmail.com') {
              u.role = 'super_admin';
            }
            if (!u.referralCode) {
              u.referralCode = this.generateUniqueCodeSync(`${u.id}:${u.email}`, usedCodes);
            }
          }
        }
        if (parsed.organizations) {
          for (const org of parsed.organizations) {
            if (org.ownerId === 'usr_admin' || org.ownerId === 'usr_agency') {
              org.ownerId = 'usr_1790775111622';
            }
          }
        }
        if (parsed.websites) {
          for (const w of parsed.websites) {
            if (w.notificationSettings?.alertEmail) {
              const lower = w.notificationSettings.alertEmail.toLowerCase();
              if (lower === 'admin@pulsevanguard.com' || lower === 'agency@acmedigital.com') {
                w.notificationSettings.alertEmail = 'mobinalavi7491@gmail.com';
              }
            }
          }
        }
        if (parsed.tickets) {
          for (const t of parsed.tickets) {
            if (t.email?.toLowerCase() === 'agency@acmedigital.com' || t.email?.toLowerCase() === 'admin@pulsevanguard.com') {
              t.email = 'support@acmedigital.com';
              t.userId = 'usr_1790775111622';
            }
          }
        }
        if (parsed.auditLogs) {
          for (const a of parsed.auditLogs) {
            if (a.userEmail?.toLowerCase() === 'admin@pulsevanguard.com' || a.userEmail?.toLowerCase() === 'agency@acmedigital.com') {
              a.userEmail = 'mobinalavi7491@gmail.com';
              a.userId = 'usr_1790775111622';
            }
          }
        }
        return parsed;
      }
    } catch (e) {
      console.error('[DB] Failed to read db file, re-initializing', e);
    }

    const initial = this.generateSeedData();
    this.saveData(initial);
    return initial;
  }

  private saveData(dataToSave: DatabaseSchema) {
    try {
      const dir = path.dirname(DB_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = `${DB_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify(dataToSave, null, 2), 'utf-8');
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[DB] Error writing db file:', e);
    }
  }

  public persist() {
    this.saveData(this.data);
  }

  private generateSeedData(): DatabaseSchema {
    const orgIdAdmin = 'org_admin_001';
    const orgIdAgency = 'org_agency_002';

    // No default demo accounts or passwords created
    const users: User[] = [];

    const organizations: Organization[] = [
      {
        id: orgIdAdmin,
        name: 'PulseVanguard Systems',
        planId: 'pro',
        billingInterval: 'annual',
        currency: 'USD',
        ownerId: 'usr_1790775111622',
        trialStartedAt: '2026-01-10T08:00:00.000Z',
        trialEndsAt: '2026-01-11T08:00:00.000Z',
        trialUsed: true,
        whiteLabel: {
          enabled: true,
          brandName: 'PulseVanguard Global',
          reportFooterText: 'Confidential Performance Audit Report generated by PulseVanguard.',
        },
        clients: [
          { id: 'client_alpha', name: 'Global Cloud Systems', contactEmail: 'ops@globalcloud.net', createdAt: '2026-02-01T00:00:00.000Z' },
        ],
        createdAt: '2026-01-10T08:00:00.000Z',
      },
      {
        id: orgIdAgency,
        name: 'Acme Digital Agency',
        planId: 'free',
        billingInterval: 'monthly',
        currency: 'USD',
        ownerId: 'usr_1790775111622',
        trialStartedAt: '2026-02-14T10:30:00.000Z',
        trialEndsAt: '2026-02-15T10:30:00.000Z',
        trialUsed: true,
        whiteLabel: {
          enabled: true,
          brandName: 'Acme Web Sentinel',
          reportFooterText: 'White-label health diagnostics provided by Acme Digital.',
        },
        clients: [
          { id: 'client_starlight', name: 'Starlight E-Commerce', contactEmail: 'info@starlight.store', createdAt: '2026-02-15T00:00:00.000Z' },
          { id: 'client_apex', name: 'Apex Logistics LLC', contactEmail: 'fleet@apexlog.com', createdAt: '2026-02-20T00:00:00.000Z' },
        ],
        createdAt: '2026-02-14T10:30:00.000Z',
      },
    ];

    const websites: Website[] = [
      {
        id: 'site_github',
        orgId: orgIdAdmin,
        clientId: 'client_alpha',
        name: 'GitHub Production',
        url: 'https://github.com',
        domain: 'github.com',
        status: 'ONLINE',
        intervalMinutes: 1,
        lastCheckedAt: new Date(Date.now() - 30000).toISOString(),
        lastResponseTimeMs: 142,
        healthScore: 96,
        uptime24h: 99.98,
        uptime7d: 99.95,
        uptime30d: 99.91,
        verification: { verified: true, token: 'pv-verify-gh-99a7', method: 'dns_txt', verifiedAt: '2026-01-11T00:00:00.000Z' },
        tags: ['Production', 'Core', 'VCS'],
        groupName: 'Infrastructure',
        enabledChecks: { uptime: true, ssl: true, dns: true, seo: true, security: true, brokenLinks: true },
        notificationSettings: {
          email: true,
          alertEmail: 'mobinalavi7491@gmail.com',
          alertOnDown: true,
          alertOnRecovery: true,
          alertOnSslExpiry: true,
          latencyThresholdMs: 800,
        },
        createdAt: '2026-01-10T09:00:00.000Z',
      },
      {
        id: 'site_cloudflare',
        orgId: orgIdAdmin,
        name: 'Cloudflare Edge CDN',
        url: 'https://cloudflare.com',
        domain: 'cloudflare.com',
        status: 'ONLINE',
        intervalMinutes: 5,
        lastCheckedAt: new Date(Date.now() - 90000).toISOString(),
        lastResponseTimeMs: 98,
        healthScore: 98,
        uptime24h: 100.0,
        uptime7d: 99.99,
        uptime30d: 99.97,
        verification: { verified: true, token: 'pv-verify-cf-812b', method: 'dns_txt', verifiedAt: '2026-01-12T00:00:00.000Z' },
        tags: ['CDN', 'Network', 'DNS'],
        groupName: 'Edge Services',
        enabledChecks: { uptime: true, ssl: true, dns: true, seo: true, security: true, brokenLinks: false },
        notificationSettings: {
          email: true,
          alertEmail: 'mobinalavi7491@gmail.com',
          alertOnDown: true,
          alertOnRecovery: true,
          alertOnSslExpiry: true,
          latencyThresholdMs: 600,
        },
        createdAt: '2026-01-12T11:00:00.000Z',
      },
      {
        id: 'site_wikipedia',
        orgId: orgIdAgency,
        clientId: 'client_starlight',
        name: 'Wikipedia Portal',
        url: 'https://wikipedia.org',
        domain: 'wikipedia.org',
        status: 'ONLINE',
        intervalMinutes: 5,
        lastCheckedAt: new Date(Date.now() - 120000).toISOString(),
        lastResponseTimeMs: 185,
        healthScore: 94,
        uptime24h: 99.92,
        uptime7d: 99.89,
        uptime30d: 99.85,
        verification: { verified: true, token: 'pv-verify-wiki-32d', method: 'dns_txt', verifiedAt: '2026-02-16T00:00:00.000Z' },
        tags: ['Knowledge', 'High-Traffic'],
        groupName: 'Content Platform',
        enabledChecks: { uptime: true, ssl: true, dns: true, seo: true, security: true, brokenLinks: true },
        notificationSettings: {
          email: true,
          alertEmail: 'alerts@pulsevanguard.com',
          alertOnDown: true,
          alertOnRecovery: true,
          alertOnSslExpiry: true,
          latencyThresholdMs: 1000,
        },
        createdAt: '2026-02-15T09:00:00.000Z',
      },
      {
        id: 'site_example',
        orgId: orgIdAgency,
        clientId: 'client_apex',
        name: 'IANA Example Domain',
        url: 'https://example.com',
        domain: 'example.com',
        status: 'ONLINE',
        intervalMinutes: 15,
        lastCheckedAt: new Date(Date.now() - 300000).toISOString(),
        lastResponseTimeMs: 210,
        healthScore: 84,
        uptime24h: 100.0,
        uptime7d: 100.0,
        uptime30d: 99.99,
        verification: { verified: false, token: 'pv-verify-ex-774a', method: 'dns_txt' },
        tags: ['Reference', 'Sandbox'],
        groupName: 'Client Portals',
        enabledChecks: { uptime: true, ssl: true, dns: true, seo: true, security: true, brokenLinks: false },
        notificationSettings: {
          email: true,
          alertEmail: 'alerts@pulsevanguard.com',
          alertOnDown: true,
          alertOnRecovery: true,
          alertOnSslExpiry: false,
          latencyThresholdMs: 1200,
        },
        createdAt: '2026-02-20T14:00:00.000Z',
      },
    ];

    // Generate recent historical metrics
    const metrics: MetricPoint[] = [];
    const now = Date.now();
    for (const site of websites) {
      for (let i = 24; i >= 0; i--) {
        const time = new Date(now - i * 3600000).toISOString();
        const baseLatency = site.lastResponseTimeMs;
        const jitter = Math.floor(Math.sin(i) * 25) + Math.floor(Math.random() * 15);
        metrics.push({
          id: `met_${site.id}_${i}`,
          websiteId: site.id,
          timestamp: time,
          status: 'ONLINE',
          httpStatus: 200,
          responseTimeMs: Math.max(45, baseLatency + jitter),
        });
      }
    }

    const incidents: Incident[] = [
      {
        id: 'inc_101',
        orgId: orgIdAdmin,
        websiteId: 'site_github',
        websiteName: 'GitHub Production',
        startedAt: '2026-03-02T14:12:00.000Z',
        resolvedAt: '2026-03-02T14:18:30.000Z',
        status: 'RESOLVED',
        cause: 'Upstream gateway 502 Bad Gateway during load balancer rebalance.',
        durationMinutes: 6.5,
      },
    ];

    const alerts: AlertNotification[] = [
      {
        id: 'alt_001',
        orgId: orgIdAdmin,
        websiteId: 'site_github',
        websiteName: 'GitHub Production',
        type: 'recovery',
        severity: 'info',
        title: 'Service Recovered',
        message: 'GitHub Production is back ONLINE (HTTP 200, response 142ms).',
        read: false,
        timestamp: '2026-03-02T14:18:30.000Z',
      },
      {
        id: 'alt_002',
        orgId: orgIdAgency,
        websiteId: 'site_wikipedia',
        websiteName: 'Wikipedia Portal',
        type: 'latency',
        severity: 'warning',
        title: 'Latency Spike Notice',
        message: 'Observed response time of 620ms exceeded baseline threshold (500ms).',
        read: true,
        timestamp: '2026-03-10T08:45:00.000Z',
      },
    ];

    const plans: SubscriptionPlan[] = this.generatePlans();

    const invoices: Invoice[] = [
      {
        id: 'inv_2026_03',
        orgId: orgIdAdmin,
        invoiceNumber: 'INV-2026-081',
        date: '2026-03-01T00:00:00.000Z',
        amount: 50,
        currency: 'USD',
        status: 'paid',
        planName: 'Pro Plan (Annual - $5/mo equivalent)',
      },
      {
        id: 'inv_2026_02',
        orgId: orgIdAgency,
        invoiceNumber: 'INV-2026-042',
        date: '2026-02-14T10:30:00.000Z',
        amount: 79,
        currency: 'USD',
        status: 'paid',
        planName: 'Agency Partner (Monthly)',
      },
    ];

    const apiKeys: ApiKey[] = [
      {
        id: 'key_master_01',
        orgId: orgIdAdmin,
        name: 'CI/CD Deployment Verification',
        prefix: 'pv_live_89f',
        hashedSecret: crypto.createHash('sha256').update('pv_live_89f2a948b817c1a8e').digest('hex'),
        scopes: ['websites:read', 'websites:write', 'scans:create'],
        createdAt: '2026-01-15T00:00:00.000Z',
        lastUsedAt: '2026-03-24T12:00:00.000Z',
      },
    ];

    const tickets: SupportTicket[] = [
      {
        id: 'tkt_901',
        userId: 'usr_1790775111622',
        name: 'Sarah Jenkins',
        email: 'support@acmedigital.com',
        subject: 'Inquiry regarding custom CNAME for white-label report URLs',
        category: 'feature',
        message: 'Hello PulseVanguard team, we are planning to map status.acmedigital.com to our white-labeled client dashboards. Could you confirm the DNS CNAME record target?',
        status: 'in_progress',
        priority: 'medium',
        createdAt: '2026-03-18T11:20:00.000Z',
        replies: [
          {
            sender: 'Alexandre Sterling',
            role: 'Support Engineer',
            message: 'Hi Sarah, absolutely! Simply point your CNAME record status.acmedigital.com to "cname.pulsevanguard.com". Our proxy will automatically provision the SSL certificate.',
            timestamp: '2026-03-18T13:45:00.000Z',
          },
        ],
      },
    ];

    const auditLogs: AuditLog[] = [
      {
        id: 'aud_001',
        orgId: orgIdAdmin,
        userId: 'usr_1790775111622',
        userEmail: 'mobinalavi7491@gmail.com',
        action: 'WEBSITE_CREATED',
        target: 'github.com',
        details: 'Configured continuous uptime checks at 1m interval.',
        timestamp: '2026-01-10T09:00:00.000Z',
      },
      {
        id: 'aud_002',
        orgId: orgIdAgency,
        userId: 'usr_1790775111622',
        userEmail: 'mobinalavi7491@gmail.com',
        action: 'CLIENT_WORKSPACE_CREATED',
        target: 'Starlight E-Commerce',
        details: 'Assigned 1 website to client workspace.',
        timestamp: '2026-02-15T00:00:00.000Z',
      },
    ];

    const reports: ReportItem[] = [
      {
        id: 'rep_demo_01',
        orgId: orgIdAdmin,
        websiteId: 'site_github',
        websiteName: 'GitHub Production',
        title: 'Executive Uptime & Security Health Audit',
        type: 'executive',
        shareToken: 'pv_rep_gh_2026',
        isPublic: true,
        generatedAt: '2026-03-24T00:00:00.000Z',
        data: {
          uptimeScore: 99.98,
          healthScore: 96,
          summary: 'High availability maintained throughout 30 days without recurring critical breaches.',
        },
      },
    ];

    return {
      users,
      organizations,
      websites,
      metrics,
      incidents,
      alerts,
      reports,
      plans,
      invoices,
      cryptoOrders: [],
      apiKeys,
      tickets,
      auditLogs,
      settings: {
        maintenanceMode: false,
        defaultCurrency: 'USD',
        stripeConfigured: false,
        workerIntervalSec: 30,
        maxFreeScansPerHour: 25,
      },
    };
  }

  // Model accessor methods
  public getUsers() { return this.data.users; }
  public getOrganizations() { return this.data.organizations; }
  public getWebsites() { return this.data.websites; }
  public getMetrics() { return this.data.metrics; }
  public getIncidents() { return this.data.incidents; }
  public getAlerts() { return this.data.alerts; }
  public getReports() { return this.data.reports; }
  public getPlans() { return this.data.plans; }
  public getInvoices() { return this.data.invoices; }
  public getApiKeys() { return this.data.apiKeys; }
  public getTickets() { return this.data.tickets; }
  public getAuditLogs() { return this.data.auditLogs; }
  public getSettings() { return this.data.settings; }

  private generateUniqueCodeSync(seed: string, usedCodes: Set<string>): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 20; attempt++) {
      const hash = crypto.createHash('sha256').update(`${seed}:${attempt}`).digest();
      let code = 'PV';
      for (let i = 0; i < 6; i++) {
        code += alphabet[hash[i] % alphabet.length];
      }
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
    const fallback = 'PV' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    usedCodes.add(fallback);
    return fallback;
  }

  public async initFromPostgres(): Promise<void> {
    try {
      const [
        users,
        organizations,
        websites,
        metrics,
        incidents,
        alerts,
        reports,
        plans,
        invoices,
        cryptoOrders,
        apiKeys,
        tickets,
        auditLogs,
        pageSpeedRecords,
        settings,
      ] = await Promise.all([
        UserRepo.getAll(),
        OrgRepo.getAll(),
        WebsiteRepo.getAll(),
        MetricRepo.getAll(),
        IncidentRepo.getAll(),
        AlertRepo.getAll(),
        GenericRepo.getAllReports(),
        PlanRepo.getAll(),
        GenericRepo.getAllInvoices(),
        CryptoOrderRepo.getAll(),
        GenericRepo.getAllApiKeys(),
        GenericRepo.getAllTickets(),
        GenericRepo.getAllAuditLogs(),
        PageSpeedRepo.getAll(),
        GenericRepo.getSettings(),
      ]);

      if (users.length > 0) {
        // Enforce removal of default accounts and ensure target super_admin on hydration
        this.data.users = users.filter((u) => {
          const clean = (u.email || '').trim().toLowerCase();
          return clean !== 'admin@pulsevanguard.com' && clean !== 'agency@acmedigital.com';
        });
        const usedCodes = new Set<string>();
        for (const u of this.data.users) {
          if (u.referralCode) usedCodes.add(String(u.referralCode).toUpperCase());
        }
        for (const u of this.data.users) {
          if (u.email && u.email.trim().toLowerCase() === 'mobinalavi7491@gmail.com') {
            u.role = 'super_admin';
          }
          if (!u.referralCode) {
            u.referralCode = this.generateUniqueCodeSync(`${u.id}:${u.email}`, usedCodes);
          }
        }
      }
      if (organizations.length > 0) this.data.organizations = organizations;
      if (websites.length > 0) this.data.websites = websites;
      if (metrics.length > 0) this.data.metrics = metrics;
      if (incidents.length > 0) this.data.incidents = incidents;
      if (alerts.length > 0) this.data.alerts = alerts;
      if (reports.length > 0) this.data.reports = reports;
      if (plans.length > 0) this.data.plans = plans;
      if (invoices.length > 0) this.data.invoices = invoices;
      if (cryptoOrders.length > 0) this.data.cryptoOrders = cryptoOrders;
      if (apiKeys.length > 0) this.data.apiKeys = apiKeys;
      if (tickets.length > 0) this.data.tickets = tickets;
      if (auditLogs.length > 0) this.data.auditLogs = auditLogs;
      if (pageSpeedRecords.length > 0) this.data.pageSpeedRecords = pageSpeedRecords;
      if (settings) this.data.settings = settings;

      console.log(`[Database]: Synchronized ${this.data.users.length} users, ${organizations.length} organizations, ${websites.length} websites from PostgreSQL.`);
    } catch (err: any) {
      console.warn('[Database]: Note - could not synchronize initial state from PostgreSQL (using cached JSON state):', err.message);
    }
  }

  public reloadFromDisk() {
    this.data = this.loadOrInit();
  }

  public findUserByEmail(email: string) {
    if (!email || typeof email !== 'string') return undefined;
    const clean = email.trim().toLowerCase();
    // Default demo accounts are permanently disabled and removed
    if (clean === 'admin@pulsevanguard.com' || clean === 'agency@acmedigital.com') {
      return undefined;
    }
    
    // Always check in-memory first
    let user = this.data.users.find((u) => u.email && u.email.trim().toLowerCase() === clean);
    
    // If found, double check against disk in case disk was updated
    if (user && fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed: DatabaseSchema = JSON.parse(raw);
        const existsOnDisk = parsed.users && parsed.users.some((u) => u.email && u.email.trim().toLowerCase() === clean);
        if (!existsOnDisk) {
          // Sync in-memory state with disk
          this.data.users = this.data.users.filter((u) => !u.email || u.email.trim().toLowerCase() !== clean);
          user = undefined;
        }
      } catch {}
    }
    
    return user;
  }

  public findUserById(id: string) {
    if (id === 'usr_admin' || id === 'usr_agency') return undefined;
    return this.data.users.find((u) => u.id === id);
  }

  public findUserByReferralCode(code: string) {
    if (!code || typeof code !== 'string') return undefined;
    const clean = code.trim().toUpperCase();
    return this.data.users.find((u) => u.referralCode && u.referralCode.trim().toUpperCase() === clean);
  }

  public removeUserByEmail(email: string): boolean {
    if (!email) return false;
    const clean = email.trim().toLowerCase();
    const userIndex = this.data.users.findIndex((u) => u.email && u.email.trim().toLowerCase() === clean);
    if (userIndex === -1) return false;

    const [deletedUser] = this.data.users.splice(userIndex, 1);
    
    // Also remove the user's isolated workspace organization if it was auto-created for this user
    if (deletedUser.orgId) {
      const orgIdx = this.data.organizations.findIndex((o) => o.id === deletedUser.orgId && (o.ownerId === deletedUser.id || o.id === 'org_mobin_7491'));
      if (orgIdx !== -1) {
        this.data.organizations.splice(orgIdx, 1);
      }
    }

    this.persist();
    this.syncToDb(() => UserRepo.deleteByEmail(clean), 'UserRepo.deleteByEmail');
    return true;
  }

  public addUser(user: User) {
    const cleanEmail = (user.email || '').trim().toLowerCase();
    // Prevent recreation of removed demo accounts
    if (cleanEmail === 'admin@pulsevanguard.com' || cleanEmail === 'agency@acmedigital.com') {
      throw new Error('Default demo accounts cannot be created.');
    }
    if (cleanEmail === 'mobinalavi7491@gmail.com') {
      user.role = 'super_admin';
    }
    if (!user.referralCode) {
      const usedCodes = new Set(
        this.data.users.map((u) => (u.referralCode ? u.referralCode.toUpperCase() : '')).filter(Boolean)
      );
      user.referralCode = this.generateUniqueCodeSync(`${user.id}:${user.email}`, usedCodes);
    }
    this.data.users.push(user);
    this.persist();
    this.syncToDb(() => UserRepo.insert(user), 'UserRepo.insert');
  }

  public updateUserRole(userId: string, newRole: User['role']) {
    const user = this.data.users.find((u) => u.id === userId);
    if (user) {
      user.role = newRole;
      this.persist();
      this.syncToDb(() => UserRepo.updateRole(userId, newRole), 'UserRepo.updateRole');
    }
    return user;
  }

  public addOrganization(org: Organization) {
    this.data.organizations.push(org);
    this.persist();
    this.syncToDb(() => OrgRepo.insert(org), 'OrgRepo.insert');
  }

  public findOrgById(id: string) {
    return this.data.organizations.find((o) => o.id === id);
  }

  public updateOrganization(id: string, updates: Partial<Organization>) {
    const org = this.findOrgById(id);
    if (org) {
      Object.assign(org, updates);
      this.persist();
      this.syncToDb(() => OrgRepo.update(id, updates), 'OrgRepo.update');
    }
    return org;
  }

  public addWebsite(website: Website) {
    this.data.websites.push(website);
    this.persist();
    this.syncToDb(() => WebsiteRepo.insert(website), 'WebsiteRepo.insert');
  }

  public findWebsiteById(id: string) {
    return this.data.websites.find((w) => w.id === id);
  }

  public updateWebsite(id: string, updates: Partial<Website>) {
    const site = this.findWebsiteById(id);
    if (site) {
      Object.assign(site, updates);
      this.persist();
      this.syncToDb(() => WebsiteRepo.update(id, updates), 'WebsiteRepo.update');
    }
    return site;
  }

  public removeWebsite(id: string) {
    const idx = this.data.websites.findIndex((w) => w.id === id);
    if (idx !== -1) {
      this.data.websites.splice(idx, 1);
      // clean metrics
      this.data.metrics = this.data.metrics.filter((m) => m.websiteId !== id);
      this.persist();
      this.syncToDb(() => WebsiteRepo.delete(id), 'WebsiteRepo.delete');
      return true;
    }
    return false;
  }

  public addMetric(point: MetricPoint) {
    this.data.metrics.push(point);
    // Keep max 10,000 metrics
    if (this.data.metrics.length > 10000) {
      this.data.metrics = this.data.metrics.slice(-8000);
    }
    this.persist();
    this.syncToDb(() => MetricRepo.insert(point), 'MetricRepo.insert');
  }

  public addIncident(incident: Incident) {
    this.data.incidents.unshift(incident);
    this.persist();
    this.syncToDb(() => IncidentRepo.insert(incident), 'IncidentRepo.insert');
  }

  public updateIncident(id: string, updates: Partial<Incident>) {
    const inc = this.data.incidents.find((i) => i.id === id);
    if (inc) {
      Object.assign(inc, updates);
      this.persist();
      this.syncToDb(() => IncidentRepo.update(id, updates), 'IncidentRepo.update');
    }
    return inc;
  }

  public addAlert(alert: AlertNotification) {
    this.data.alerts.unshift(alert);
    this.persist();
    this.syncToDb(() => AlertRepo.insert(alert), 'AlertRepo.insert');
  }

  public markAlertRead(id: string) {
    const alert = this.data.alerts.find((a) => a.id === id);
    if (alert) {
      alert.read = true;
      this.persist();
      this.syncToDb(() => AlertRepo.markRead(id), 'AlertRepo.markRead');
    }
  }

  public addReport(report: ReportItem) {
    this.data.reports.unshift(report);
    this.persist();
    this.syncToDb(() => GenericRepo.addReport(report), 'GenericRepo.addReport');
  }

  public addAuditLog(log: AuditLog) {
    this.data.auditLogs.unshift(log);
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs = this.data.auditLogs.slice(0, 500);
    }
    this.persist();
    this.syncToDb(() => GenericRepo.addAuditLog(log), 'GenericRepo.addAuditLog');
  }

  public findTicketById(id: string): SupportTicket | undefined {
    return this.data.tickets.find((t) => t.id === id);
  }

  public addTicket(ticket: SupportTicket) {
    const existingIdx = this.data.tickets.findIndex((t) => t.id === ticket.id);
    if (existingIdx !== -1) {
      this.data.tickets[existingIdx] = ticket;
    } else {
      this.data.tickets.unshift(ticket);
    }
    this.persist();
    this.syncToDb(() => GenericRepo.addTicket(ticket), 'GenericRepo.addTicket');
  }

  public updateTicket(id: string, updates: Partial<SupportTicket>) {
    const ticket = this.data.tickets.find((t) => t.id === id);
    if (ticket) {
      Object.assign(ticket, updates);
      this.persist();
      this.syncToDb(() => GenericRepo.updateTicket(id, updates), 'GenericRepo.updateTicket');
    }
    return ticket;
  }

  public addInvoice(inv: Invoice) {
    this.data.invoices.unshift(inv);
    this.persist();
    this.syncToDb(() => GenericRepo.addInvoice(inv), 'GenericRepo.addInvoice');
  }

  public addApiKey(apiKey: ApiKey) {
    this.data.apiKeys.unshift(apiKey);
    this.persist();
    this.syncToDb(() => GenericRepo.addApiKey(apiKey), 'GenericRepo.addApiKey');
  }

  public revokeApiKey(id: string) {
    this.data.apiKeys = this.data.apiKeys.filter((k) => k.id !== id);
    this.persist();
    this.syncToDb(() => GenericRepo.revokeApiKey(id), 'GenericRepo.revokeApiKey');
  }

  public getCryptoOrders(): CryptoPaymentOrder[] {
    return this.data.cryptoOrders || [];
  }

  public findCryptoOrderById(id: string): CryptoPaymentOrder | undefined {
    return (this.data.cryptoOrders || []).find((o) => o.id === id);
  }

  public findCryptoOrderByTxId(txId: string): CryptoPaymentOrder | undefined {
    if (!txId) return undefined;
    const clean = txId.trim().toLowerCase();
    return (this.data.cryptoOrders || []).find((o) => o.txId && o.txId.trim().toLowerCase() === clean);
  }

  public addCryptoOrder(order: CryptoPaymentOrder) {
    if (!this.data.cryptoOrders) this.data.cryptoOrders = [];
    this.data.cryptoOrders.unshift(order);
    this.persist();
    this.syncToDb(() => CryptoOrderRepo.insert(order), 'CryptoOrderRepo.insert');
  }

  public updateCryptoOrder(id: string, updates: Partial<CryptoPaymentOrder>): CryptoPaymentOrder | undefined {
    if (!this.data.cryptoOrders) this.data.cryptoOrders = [];
    const order = this.data.cryptoOrders.find((o) => o.id === id);
    if (order) {
      Object.assign(order, updates);
      this.persist();
      this.syncToDb(() => CryptoOrderRepo.update(id, updates), 'CryptoOrderRepo.update');
    }
    return order;
  }

  public getPageSpeedRecords(): StoredPageSpeedRecord[] {
    return this.data.pageSpeedRecords || [];
  }

  public addPageSpeedRecord(record: StoredPageSpeedRecord) {
    if (!this.data.pageSpeedRecords) this.data.pageSpeedRecords = [];
    // Keep max 200 PageSpeed records
    this.data.pageSpeedRecords.unshift(record);
    if (this.data.pageSpeedRecords.length > 200) {
      this.data.pageSpeedRecords = this.data.pageSpeedRecords.slice(0, 200);
    }
    this.persist();
    this.syncToDb(() => PageSpeedRepo.insert(record), 'PageSpeedRepo.insert');
  }

  public findLatestPageSpeedRecord(urlOrDomain: string, device?: 'mobile' | 'desktop'): StoredPageSpeedRecord | undefined {
    const clean = urlOrDomain.trim().toLowerCase();
    return (this.data.pageSpeedRecords || []).find((r) => {
      const matchUrl = r.url.toLowerCase() === clean || r.domain.toLowerCase() === clean;
      if (!matchUrl) return false;
      if (device) return r.device === device;
      return true;
    });
  }
}

export const db = new Database();
