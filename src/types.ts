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
import type { WhoisContactInfo, WhoisLookupResult } from '../server/whois.ts';
export type { WhoisContactInfo, WhoisLookupResult };

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
  referredByUserId?: string;
  referredByCode?: string;
  referredAt?: string;
  createdAt: string;
}

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

export interface Organization {
  id: string;
  name: string;
  planId: 'free' | 'pro' | 'agency' | 'enterprise';
  billingInterval: 'monthly' | 'annual';
  currency: 'USDT' | string;
  ownerId: string;
  trialStartedAt?: string;
  trialEndsAt?: string;
  trialUsed?: boolean;
  maxWebsites?: number;
  entitlementSummary?: OrganizationEntitlementSummary;
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
  entitlements?: OrganizationEntitlementSummary;
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
  lastWhoisResult?: WhoisLookupResult | null;
  entitlementId?: string | null;
  subscriptionExpiresAt?: string | null;
  expiredAt?: string | null;
  scheduledDeletionAt?: string | null;
  accessStatus?: 'active' | 'expired_grace_period' | 'ambiguous_protected';
  isSubscriptionExpired?: boolean;
  deletionRemainingMs?: number | null;
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
    USDT: { monthly: number; annual: number };
    [key: string]: { monthly: number; annual: number };
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

export type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'cancelled';

export interface ReferralWallet {
  userId: string;
  currency: 'USDT';
  totalEarnedCents: number;
  availableBalanceCents: number;
  reservedBalanceCents: number;
  withdrawnBalanceCents: number;
  totalEarned: number;
  availableBalance: number;
  reservedBalance: number;
  withdrawnBalance: number;
  updatedAt: string;
}

export interface ReferralCommission {
  id: string;
  orderId: string;
  referrerUserId: string;
  referredUserId: string;
  referredUserEmail: string;
  referralCode: string;
  planId: string;
  planName: string;
  purchaseAmountCents: number;
  purchaseAmount: number;
  commissionRateBps: number;
  commissionAmountCents: number;
  commissionAmount: number;
  currency: 'USDT';
  status: 'credited';
  createdAt: string;
}

export interface ReferralWalletLedgerEntry {
  id: string;
  userId: string;
  type: 'commission_credit' | 'withdrawal_reserve' | 'withdrawal_release' | 'withdrawal_paid';
  amountCents: number;
  amount: number;
  currency: 'USDT';
  referenceId: string;
  idempotencyKey: string;
  balanceAfterCents: number;
  balanceAfter: number;
  reservedAfterCents: number;
  reservedAfter: number;
  description: string;
  createdAt: string;
}

export interface ReferredCustomerSummary {
  userId: string;
  email: string;
  name: string;
  orderId?: string;
  planName?: string;
  purchaseAmount?: number;
  commissionAmount?: number;
  createdAt: string;
}

export interface WithdrawalRequestRecord {
  id: string;
  userId: string;
  userEmail: string;
  referralCode: string;
  amountCents: number;
  amount: number;
  currency: 'USDT';
  network: string;
  walletAddress: string;
  status: WithdrawalStatus;
  availableBalanceBeforeCents: number;
  availableBalanceBefore: number;
  approvedById?: string;
  approvedByEmail?: string;
  approvedAt?: string;
  paidById?: string;
  paidByEmail?: string;
  paidAt?: string;
  txHash?: string;
  rejectedById?: string;
  rejectedByEmail?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledById?: string;
  cancelledByEmail?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
  referredCustomers?: ReferredCustomerSummary[];
}

export interface UserReferralSummary {
  userId: string;
  email: string;
  referralCode: string;
  referralUrl: string;
  referredByUserId?: string;
  referredByCode?: string;
  referredAt?: string;
  canApplyReferralCode: boolean;
  commissionRatePercent: number;
  minimumWithdrawalAmount: number;
  currency: 'USDT';
  payoutNetwork: string;
  totalSuccessfulReferrals: number;
  totalEligiblePurchases: number;
  totalCommissionsEarned: number;
  availableBalance: number;
  reservedBalance: number;
  withdrawnBalance: number;
  wallet: ReferralWallet;
  commissions: ReferralCommission[];
  withdrawals: WithdrawalRequestRecord[];
  ledger: ReferralWalletLedgerEntry[];
  referredUsers: Array<{
    userId: string;
    email: string;
    name: string;
    joinedAt: string;
    purchasesCount: number;
    totalCommissionGenerated: number;
  }>;
}

export interface AdminReferralOverview {
  totalReferralCommissionsGenerated: number;
  totalReferralCommissionsCount: number;
  totalAvailableReferralLiabilities: number;
  totalReservedForPendingWithdrawals: number;
  pendingWithdrawalRequestsCount: number;
  awaitingReviewCount: number;
  approvedAwaitingPayoutCount: number;
  totalSuccessfullyPaidWithdrawals: number;
  paidWithdrawalsCount: number;
  totalRejectedRequestsCount: number;
  totalRejectedAmount: number;
  totalCancelledRequestsCount: number;
  currency: 'USDT';
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
  customerName?: string;
  customerEmail?: string;
  subject: string;
  category: 'technical' | 'billing' | 'monitoring' | 'feature' | 'general';
  message: string;
  description?: string;
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
  messages?: TicketReply[];
  latestMessagePreview?: string;
  replyCount?: number;
  emailNotification?: {
    id: string;
    ticketId: string;
    messageId?: string;
    eventType: 'ticket_created_admin_notify' | 'admin_reply_customer_notify';
    recipientEmail: string;
    subject: string;
    sent: boolean;
    status: 'sent' | 'skipped_unconfigured' | 'failed';
    provider: string;
    diagnostic: string;
    createdAt: string;
  };
}

export interface AdminTicketInboxStats {
  total: number;
  open: number;
  in_progress: number;
  waiting_for_customer: number;
  resolved: number;
  closed: number;
  needsAdminResponseCount: number;
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
