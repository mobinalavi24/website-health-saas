import type { ScanResult } from '../server/scanner.ts';
import type {
  PageSpeedMetricStatus,
  CoreWebVitalMetric,
  PageSpeedOpportunity,
  PageSpeedDeviceData,
  CombinedPageSpeedResult,
  StoredPageSpeedRecord,
} from '../server/pagespeedTypes.ts';

export type * from '../server/seoTypes.ts';

export type {
  ScanResult,
  PageSpeedMetricStatus,
  CoreWebVitalMetric,
  PageSpeedOpportunity,
  PageSpeedDeviceData,
  CombinedPageSpeedResult,
  StoredPageSpeedRecord,
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'agency_admin' | 'team_member' | 'client_viewer';
  orgId: string;
  avatarUrl?: string;
  emailVerified: boolean;
  referralCode?: string;
  referredBy?: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  planId: 'free' | 'pro' | 'agency' | 'enterprise';
  billingInterval: 'monthly' | 'annual';
  currency: string;
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

export interface TrialInfo {
  startedAt: string;
  endsAt: string;
  expired: boolean;
  remainingMs: number;
}

export interface AccountStatus {
  plan: 'free' | 'pro' | 'agency' | 'enterprise';
  trial: TrialInfo;
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
    USDT?: { monthly: number; annual: number };
    [key: string]: { monthly: number; annual: number } | undefined;
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
  createdAt: string;
}

export interface LBankConnectionTestResult {
  status: 'SUCCESS' | 'FAILED';
  title: string;
  endpoint: string;
  accountDetails?: {
    apiKeyMasked: string;
    permissions?: {
      enableReading: boolean;
      ipRestrict: boolean;
      enableSpotTrading: boolean;
      enableWithdrawals: boolean;
      enableFuturesTrading: boolean;
      enableTransfer?: boolean;
    };
    createdTime?: string;
    depositAddress?: string;
    accountCoins?: Array<{ coin: string; usable: string }>;
  };
  errorMessage?: string;
  errorCode?: number | string;
  diagnostic: string;
  timestamp: string;
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

export type TicketStatus = 'open' | 'in_progress' | 'waiting_for_customer' | 'resolved' | 'closed';

export interface TicketMessage {
  id: string;
  ticketId: string;
  senderUserId: string;
  senderName: string;
  senderEmail: string;
  senderRole: 'customer' | 'admin' | 'super_admin';
  message: string;
  createdAt: string;
  // Legacy compatibility fields
  sender?: string;
  role?: string;
  timestamp?: string;
}

export interface SupportTicket {
  id: string;
  userId?: string;
  name: string;
  email: string;
  subject: string;
  category?: 'technical' | 'billing' | 'monitoring' | 'feature' | 'general';
  message: string;
  status: TicketStatus;
  priority?: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt?: string;
  lastMessageAt?: string;
  requiresAdminResponse?: boolean;
  replies: TicketMessage[];
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

export interface ReferralCommissionRecord {
  id: string;
  orderId: string;
  referrerId: string;
  referredUserId: string;
  referredUserEmail?: string;
  referralCode: string;
  planId: string;
  planName: string;
  orderAmountCents: number;
  commissionAmountCents: number;
  commissionRate: number;
  currency: string;
  status: string;
  createdAt: string;
}

export interface WithdrawalRequestRecord {
  id: string;
  userId: string;
  userEmail?: string;
  referralCode?: string;
  amountCents: number;
  currency: string;
  trc20Address: string;
  network: string;
  status: 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled';
  balanceBeforeCents: number;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  paidBy?: string | null;
  paidAt?: string | null;
  payoutTxId?: string | null;
  createdAt: string;
  updatedAt: string;
  associatedCustomers?: Array<{
    userId: string;
    email: string;
    planName: string;
    commissionCents: number;
    orderId: string;
    createdAt: string;
  }>;
}

export interface UserReferralProfile {
  referralCode: string;
  referralUrl: string;
  totalReferrals: number;
  totalEligiblePurchases: number;
  totalCommissionsEarned: number;
  availableBalance: number;
  reservedBalance: number;
  totalWithdrawn: number;
  commissions: ReferralCommissionRecord[];
  withdrawals: WithdrawalRequestRecord[];
}

export interface AdminReferralOverview {
  totalCommissionsGenerated: number;
  totalAvailableLiabilities: number;
  totalFundsReserved: number;
  pendingWithdrawalsCount: number;
  totalPaidWithdrawals: number;
  totalRejectedCount: number;
}

export interface SubscriptionEntitlement {
  id: string;
  userId: string;
  orgId: string;
  planId: 'pro' | 'agency' | 'enterprise';
  planName: string;
  billingInterval: 'monthly' | 'annual';
  websiteSlots: number;
  orderId?: string;
  status: 'active' | 'expired' | 'cancelled';
  startedAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface UserCapacityInfo {
  totalSlots: number;
  usedSlots: number;
  remainingSlots: number;
  activeEntitlements: SubscriptionEntitlement[];
  allEntitlements: SubscriptionEntitlement[];
  isTrial: boolean;
  isExpiredTrial: boolean;
  trialEndsAt?: string;
}

