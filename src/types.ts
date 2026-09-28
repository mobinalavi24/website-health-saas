import type { ScanResult } from '../server/scanner.ts';

export type { ScanResult };

export interface User {
  id: string;
  email: string;
  name: string;
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
