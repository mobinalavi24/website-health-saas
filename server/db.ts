import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ScanResult } from './scanner.ts';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'super_admin' | 'agency_admin' | 'team_member' | 'client_viewer';
  orgId: string;
  avatarUrl?: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  planId: 'free' | 'pro' | 'agency' | 'enterprise';
  billingInterval: 'monthly' | 'annual';
  currency: 'USD' | 'EUR' | 'GBP';
  ownerId: string;
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
  type: 'downtime' | 'recovery' | 'ssl_expiry' | 'latency' | 'security';
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

export interface SupportTicket {
  id: string;
  userId?: string;
  name: string;
  email: string;
  subject: string;
  category: 'technical' | 'billing' | 'monitoring' | 'feature';
  message: string;
  status: 'open' | 'in_progress' | 'resolved';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  replies: { sender: string; role: string; message: string; timestamp: string }[];
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
  apiKeys: ApiKey[];
  tickets: SupportTicket[];
  auditLogs: AuditLog[];
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
  return hashPassword(plain) === hash;
}

class Database {
  private data: DatabaseSchema;

  constructor() {
    this.data = this.loadOrInit();
  }

  private loadOrInit(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw);
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

    const users: User[] = [
      {
        id: 'usr_admin',
        email: 'admin@pulsevanguard.com',
        name: 'Alexandre Sterling (Super Admin)',
        passwordHash: hashPassword('admin123'),
        role: 'super_admin',
        orgId: orgIdAdmin,
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80',
        emailVerified: true,
        createdAt: '2026-01-10T08:00:00.000Z',
      },
      {
        id: 'usr_agency',
        email: 'agency@acmedigital.com',
        name: 'Sarah Jenkins (Agency Partner)',
        passwordHash: hashPassword('agency123'),
        role: 'agency_admin',
        orgId: orgIdAgency,
        avatarUrl: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=256&q=80',
        emailVerified: true,
        createdAt: '2026-02-14T10:30:00.000Z',
      },
    ];

    const organizations: Organization[] = [
      {
        id: orgIdAdmin,
        name: 'PulseVanguard Systems',
        planId: 'enterprise',
        billingInterval: 'annual',
        currency: 'USD',
        ownerId: 'usr_admin',
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
        planId: 'agency',
        billingInterval: 'monthly',
        currency: 'USD',
        ownerId: 'usr_agency',
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
          alertEmail: 'admin@pulsevanguard.com',
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
          alertEmail: 'admin@pulsevanguard.com',
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
          alertEmail: 'agency@acmedigital.com',
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
          alertEmail: 'agency@acmedigital.com',
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

    const plans: SubscriptionPlan[] = [
      {
        id: 'free',
        name: 'Starter Free',
        badge: 'Individual',
        targetAudience: 'For developers & personal sites',
        pricing: {
          USD: { monthly: 0, annual: 0 },
          EUR: { monthly: 0, annual: 0 },
          GBP: { monthly: 0, annual: 0 },
        },
        limits: {
          maxWebsites: 2,
          minIntervalMinutes: 15,
          dataRetentionDays: 30,
          teamMembersLimit: 1,
          whiteLabel: false,
          apiAccess: false,
          prioritySupport: false,
        },
        features: [
          '2 Monitored Websites',
          '15-Minute Check Frequency',
          'HTTP & SSL Certificate Checks',
          '30-Day Historical Data Retention',
          'Email Downtime Alerts',
          'Public Health Share Links',
        ],
      },
      {
        id: 'pro',
        name: 'Professional',
        badge: 'Most Popular',
        targetAudience: 'For businesses & growing web apps',
        pricing: {
          USD: { monthly: 29, annual: 290 },
          EUR: { monthly: 27, annual: 270 },
          GBP: { monthly: 24, annual: 240 },
        },
        limits: {
          maxWebsites: 15,
          minIntervalMinutes: 1,
          dataRetentionDays: 180,
          teamMembersLimit: 5,
          whiteLabel: false,
          apiAccess: true,
          prioritySupport: true,
        },
        features: [
          '15 Monitored Websites',
          '1-Minute Rapid Monitoring',
          'SSL, DNS & Security Header Audits',
          'Core Web Vitals & SEO Crawling',
          '180-Day Data Retention',
          'Webhook & Slack Integration',
          'REST API Access with Scoped Keys',
          '5 Team Member Seats',
        ],
      },
      {
        id: 'agency',
        name: 'Agency Partner',
        badge: 'Agencies & Studios',
        targetAudience: 'For web agencies & client managers',
        pricing: {
          USD: { monthly: 79, annual: 790 },
          EUR: { monthly: 74, annual: 740 },
          GBP: { monthly: 65, annual: 650 },
        },
        limits: {
          maxWebsites: 50,
          minIntervalMinutes: 1,
          dataRetentionDays: 365,
          teamMembersLimit: 20,
          whiteLabel: true,
          apiAccess: true,
          prioritySupport: true,
        },
        features: [
          '50 Monitored Websites',
          '1-Minute Monitoring Engine',
          'White-Label PDF & Web Reports',
          'Client Workspaces & Read-Only Links',
          'Custom Brand Logo & Footer',
          '365-Day Historical Analytics',
          'Automated Scheduled Client Reports',
          '20 Team Members with RBAC',
        ],
      },
      {
        id: 'enterprise',
        name: 'Enterprise Scale',
        badge: 'High Volume',
        targetAudience: 'For large mission-critical operations',
        pricing: {
          USD: { monthly: 199, annual: 1990 },
          EUR: { monthly: 185, annual: 1850 },
          GBP: { monthly: 165, annual: 1650 },
        },
        limits: {
          maxWebsites: 250,
          minIntervalMinutes: 1,
          dataRetentionDays: 730,
          teamMembersLimit: 100,
          whiteLabel: true,
          apiAccess: true,
          prioritySupport: true,
        },
        features: [
          '250+ Monitored Websites',
          'Multi-Region 30-Second Verification',
          'Dedicated IP Monitoring Nodes',
          'Custom SLAs (99.99%)',
          'Unlimited Client Portals',
          'Custom Retention Policies (2+ Years)',
          '24/7 Dedicated Incident Team',
          'Direct Engineering Slack Channel',
        ],
      },
    ];

    const invoices: Invoice[] = [
      {
        id: 'inv_2026_03',
        orgId: orgIdAdmin,
        invoiceNumber: 'INV-2026-081',
        date: '2026-03-01T00:00:00.000Z',
        amount: 1990,
        currency: 'USD',
        status: 'paid',
        planName: 'Enterprise Scale (Annual)',
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
        userId: 'usr_agency',
        name: 'Sarah Jenkins',
        email: 'agency@acmedigital.com',
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
        userId: 'usr_admin',
        userEmail: 'admin@pulsevanguard.com',
        action: 'WEBSITE_CREATED',
        target: 'github.com',
        details: 'Configured continuous uptime checks at 1m interval.',
        timestamp: '2026-01-10T09:00:00.000Z',
      },
      {
        id: 'aud_002',
        orgId: orgIdAgency,
        userId: 'usr_agency',
        userEmail: 'agency@acmedigital.com',
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

  public findUserByEmail(email: string) {
    return this.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  public findUserById(id: string) {
    return this.data.users.find((u) => u.id === id);
  }

  public addUser(user: User) {
    this.data.users.push(user);
    this.persist();
  }

  public addOrganization(org: Organization) {
    this.data.organizations.push(org);
    this.persist();
  }

  public findOrgById(id: string) {
    return this.data.organizations.find((o) => o.id === id);
  }

  public updateOrganization(id: string, updates: Partial<Organization>) {
    const org = this.findOrgById(id);
    if (org) {
      Object.assign(org, updates);
      this.persist();
    }
    return org;
  }

  public addWebsite(website: Website) {
    this.data.websites.push(website);
    this.persist();
  }

  public findWebsiteById(id: string) {
    return this.data.websites.find((w) => w.id === id);
  }

  public updateWebsite(id: string, updates: Partial<Website>) {
    const site = this.findWebsiteById(id);
    if (site) {
      Object.assign(site, updates);
      this.persist();
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
  }

  public addIncident(incident: Incident) {
    this.data.incidents.unshift(incident);
    this.persist();
  }

  public updateIncident(id: string, updates: Partial<Incident>) {
    const inc = this.data.incidents.find((i) => i.id === id);
    if (inc) {
      Object.assign(inc, updates);
      this.persist();
    }
    return inc;
  }

  public addAlert(alert: AlertNotification) {
    this.data.alerts.unshift(alert);
    this.persist();
  }

  public markAlertRead(id: string) {
    const alert = this.data.alerts.find((a) => a.id === id);
    if (alert) {
      alert.read = true;
      this.persist();
    }
  }

  public addReport(report: ReportItem) {
    this.data.reports.unshift(report);
    this.persist();
  }

  public addAuditLog(log: AuditLog) {
    this.data.auditLogs.unshift(log);
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs = this.data.auditLogs.slice(0, 500);
    }
    this.persist();
  }

  public addTicket(ticket: SupportTicket) {
    this.data.tickets.unshift(ticket);
    this.persist();
  }

  public updateTicket(id: string, updates: Partial<SupportTicket>) {
    const ticket = this.data.tickets.find((t) => t.id === id);
    if (ticket) {
      Object.assign(ticket, updates);
      this.persist();
    }
    return ticket;
  }

  public addInvoice(inv: Invoice) {
    this.data.invoices.unshift(inv);
    this.persist();
  }

  public addApiKey(apiKey: ApiKey) {
    this.data.apiKeys.unshift(apiKey);
    this.persist();
  }

  public revokeApiKey(id: string) {
    this.data.apiKeys = this.data.apiKeys.filter((k) => k.id !== id);
    this.persist();
  }
}

export const db = new Database();
