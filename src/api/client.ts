import type {
  User,
  Organization,
  Website,
  ScanResult,
  MetricPoint,
  Incident,
  AlertNotification,
  ReportItem,
  SubscriptionPlan,
  Invoice,
  CryptoPaymentOrder,
  LBankConnectionTestResult,
  ApiKey,
  SupportTicket,
  TicketMessage,
  TicketStatus,
  AuditLog,
  CombinedPageSpeedResult,
  AccountStatus,
  UserReferralProfile,
  WithdrawalRequestRecord,
  AdminReferralOverview,
  ReferralCommissionRecord,
  UserCapacityInfo,
  SubscriptionEntitlement,
} from '../types.ts';

const TOKEN_KEY = 'pv_auth_token';

export const apiClient = {
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },

  clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  },

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(options.headers || {});
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(path, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || `HTTP error ${res.status}`);
      (err as any).status = res.status;
      (err as any).code = data.error;
      throw err;
    }
    return data as T;
  },

  // Scanner
  async scanWebsite(url: string): Promise<ScanResult> {
    return this.request<ScanResult>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  },

  async runScanner(url: string): Promise<ScanResult> {
    return this.request<ScanResult>('/api/scanner/run', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  },

  async getPageSpeedAnalysis(url: string, forceRefresh = false): Promise<CombinedPageSpeedResult> {
    return this.request<CombinedPageSpeedResult>('/api/scanner/pagespeed', {
      method: 'POST',
      body: JSON.stringify({ url, forceRefresh }),
    });
  },

  async getSharedReport(token: string): Promise<ReportItem> {
    return this.request<ReportItem>(`/api/reports/share/${token}`);
  },

  // Auth
  async login(email: string, password: string): Promise<{ token: string; user: User; organization: Organization }> {
    const res = await this.request<{ token: string; user: User; organization: Organization }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(res.token);
    return res;
  },

  async register(
    name: string,
    email: string,
    password: string,
    orgName?: string,
    referralCode?: string
  ): Promise<{ token: string; user: User; organization: Organization }> {
    const res = await this.request<{ token: string; user: User; organization: Organization }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, orgName, referralCode }),
    });
    this.setToken(res.token);
    return res;
  },

  async getMe(): Promise<{ user: User; organization: Organization; accountStatus?: AccountStatus }> {
    return this.request<{ user: User; organization: Organization; accountStatus?: AccountStatus }>('/api/auth/me');
  },

  async getAccountStatus(): Promise<AccountStatus> {
    return this.request<AccountStatus>('/api/account/status');
  },

  async resetPassword(email: string): Promise<{ message: string }> {
    return this.request<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  // Websites
  async getWebsites(): Promise<Website[]> {
    return this.request<Website[]>('/api/websites');
  },

  async getWebsite(id: string): Promise<Website> {
    return this.request<Website>(`/api/websites/${id}`);
  },

  async addWebsite(data: Partial<Website>): Promise<Website> {
    return this.request<Website>('/api/websites', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateWebsite(id: string, data: Partial<Website>): Promise<Website> {
    return this.request<Website>(`/api/websites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteWebsite(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/websites/${id}`, {
      method: 'DELETE',
    });
  },

  async checkWebsiteNow(id: string): Promise<Website> {
    return this.request<Website>(`/api/websites/${id}/check-now`, {
      method: 'POST',
    });
  },

  async runDeepAudit(id: string): Promise<ScanResult> {
    return this.request<ScanResult>(`/api/websites/${id}/audit-now`, {
      method: 'POST',
    });
  },

  async verifyDomain(id: string): Promise<{ verified: boolean; message: string }> {
    return this.request<{ verified: boolean; message: string }>(`/api/websites/${id}/verify`, {
      method: 'POST',
    });
  },

  async getMetrics(websiteId: string): Promise<MetricPoint[]> {
    return this.request<MetricPoint[]>(`/api/websites/${websiteId}/metrics`);
  },

  // Incidents & Alerts
  async getIncidents(): Promise<Incident[]> {
    return this.request<Incident[]>('/api/incidents');
  },

  async getAlerts(): Promise<AlertNotification[]> {
    return this.request<AlertNotification[]>('/api/alerts');
  },

  async markAlertRead(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/alerts/${id}/read`, {
      method: 'POST',
    });
  },

  // Reports
  async getReports(): Promise<ReportItem[]> {
    return this.request<ReportItem[]>('/api/reports');
  },

  async generateReport(websiteId: string, title?: string, type = 'health'): Promise<ReportItem> {
    return this.request<ReportItem>('/api/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ websiteId, title, type }),
    });
  },

  // Agency
  async getAgencyClients(): Promise<{ id: string; name: string; contactEmail: string; notes?: string; createdAt: string }[]> {
    return this.request('/api/agency/clients');
  },

  async createAgencyClient(name: string, contactEmail: string, notes?: string): Promise<any> {
    return this.request('/api/agency/clients', {
      method: 'POST',
      body: JSON.stringify({ name, contactEmail, notes }),
    });
  },

  async updateBranding(data: any): Promise<any> {
    return this.request('/api/agency/branding', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Billing & Plans
  async getPlans(): Promise<SubscriptionPlan[]> {
    return this.request<SubscriptionPlan[]>('/api/billing/plans');
  },

  async changePlan(planId: string, interval: 'monthly' | 'annual', currency: string = 'USDT'): Promise<{ success: boolean; organization: Organization }> {
    return this.request<{ success: boolean; organization: Organization }>('/api/billing/change-plan', {
      method: 'POST',
      body: JSON.stringify({ planId, interval, currency }),
    });
  },

  async getInvoices(): Promise<Invoice[]> {
    return this.request<Invoice[]>('/api/billing/invoices');
  },

  // Crypto Payments (USDT TRC20)
  async createCryptoOrder(
    planId: string,
    interval: 'monthly' | 'annual',
    referralCode?: string
  ): Promise<{ success: boolean; order: CryptoPaymentOrder }> {
    return this.request<{ success: boolean; order: CryptoPaymentOrder }>('/api/crypto/create-order', {
      method: 'POST',
      body: JSON.stringify({ planId, interval, referralCode }),
    });
  },

  async getCryptoOrder(orderId: string): Promise<CryptoPaymentOrder> {
    return this.request<CryptoPaymentOrder>(`/api/crypto/order/${encodeURIComponent(orderId)}`);
  },

  async checkCryptoOrder(orderId: string, txId?: string): Promise<{
    success: boolean;
    order: CryptoPaymentOrder;
    activated: boolean;
    message: string;
    organization?: Organization;
  }> {
    return this.request<{
      success: boolean;
      order: CryptoPaymentOrder;
      activated: boolean;
      message: string;
      organization?: Organization;
    }>('/api/crypto/check-order', {
      method: 'POST',
      body: JSON.stringify({ orderId, txId }),
    });
  },

  async getCryptoOrders(): Promise<CryptoPaymentOrder[]> {
    return this.request<CryptoPaymentOrder[]>('/api/crypto/orders');
  },

  async getUserSubscriptions(): Promise<{ capacity: UserCapacityInfo; organization: Organization }> {
    return this.request<{ capacity: UserCapacityInfo; organization: Organization }>('/api/user/subscriptions');
  },

  async getUserCapacity(): Promise<UserCapacityInfo> {
    return this.request<UserCapacityInfo>('/api/user/capacity');
  },

  async getAdminCryptoOrders(): Promise<CryptoPaymentOrder[]> {
    return this.request<CryptoPaymentOrder[]>('/api/admin/crypto/orders');
  },

  async approveCryptoOrder(orderId: string): Promise<{
    success: boolean;
    order: CryptoPaymentOrder;
    alreadyApproved?: boolean;
    message: string;
  }> {
    return this.request<{
      success: boolean;
      order: CryptoPaymentOrder;
      alreadyApproved?: boolean;
      message: string;
    }>(`/api/admin/crypto/orders/${encodeURIComponent(orderId)}/approve`, {
      method: 'POST',
    });
  },

  async rejectCryptoOrder(orderId: string, reason?: string): Promise<{
    success: boolean;
    order: CryptoPaymentOrder;
    alreadyRejected?: boolean;
    message: string;
  }> {
    return this.request<{
      success: boolean;
      order: CryptoPaymentOrder;
      alreadyRejected?: boolean;
      message: string;
    }>(`/api/admin/crypto/orders/${encodeURIComponent(orderId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async cancelCryptoOrder(orderId: string): Promise<{
    success: boolean;
    order: CryptoPaymentOrder;
    message: string;
  }> {
    return this.request<{
      success: boolean;
      order: CryptoPaymentOrder;
      message: string;
    }>(`/api/crypto/order/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
    });
  },

  async testLBankConnection(): Promise<LBankConnectionTestResult> {
    return this.request<LBankConnectionTestResult>('/api/crypto/lbank-test');
  },

  // Support Ticketing
  async getTickets(): Promise<SupportTicket[]> {
    return this.request<SupportTicket[]>('/api/tickets');
  },

  async getTicket(ticketId: string): Promise<SupportTicket> {
    return this.request<SupportTicket>(`/api/tickets/${encodeURIComponent(ticketId)}`);
  },

  async createTicket(ticket: { subject: string; message: string; category?: string; priority?: string }): Promise<SupportTicket> {
    return this.request<SupportTicket>('/api/tickets', {
      method: 'POST',
      body: JSON.stringify(ticket),
    });
  },

  async replyToTicket(
    ticketId: string,
    message: string,
    status?: TicketStatus
  ): Promise<{ success: boolean; reply: TicketMessage; ticket: SupportTicket }> {
    return this.request<{ success: boolean; reply: TicketMessage; ticket: SupportTicket }>(
      `/api/tickets/${encodeURIComponent(ticketId)}/replies`,
      {
        method: 'POST',
        body: JSON.stringify({ message, status }),
      }
    );
  },

  async updateTicketStatus(
    ticketId: string,
    status: TicketStatus
  ): Promise<{ success: boolean; ticket: SupportTicket }> {
    return this.request<{ success: boolean; ticket: SupportTicket }>(
      `/api/tickets/${encodeURIComponent(ticketId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }
    );
  },

  // Admin
  async getAdminOverview(): Promise<any> {
    return this.request('/api/admin/overview');
  },

  async getAdminUsers(): Promise<any[]> {
    return this.request('/api/admin/users');
  },

  async triggerWorkerTick(): Promise<any> {
    return this.request('/api/admin/trigger-worker', { method: 'POST' });
  },

  // API Keys
  async getApiKeys(): Promise<ApiKey[]> {
    return this.request<ApiKey[]>('/api/v1/api-keys');
  },

  async createApiKey(name: string): Promise<{ key: ApiKey; secretToken: string }> {
    return this.request<{ key: ApiKey; secretToken: string }>('/api/v1/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  // Referral & Commission Wallet
  async validateReferralCode(code: string): Promise<{
    valid: boolean;
    message: string;
    referrer?: { id: string; email: string; name: string };
  }> {
    return this.request<{
      valid: boolean;
      message: string;
      referrer?: { id: string; email: string; name: string };
    }>(`/api/referral/validate?code=${encodeURIComponent(code)}`);
  },

  async applyReferralCode(referralCode: string): Promise<{
    success: boolean;
    message: string;
    referrerName?: string;
  }> {
    return this.request<{
      success: boolean;
      message: string;
      referrerName?: string;
    }>('/api/referral/apply', {
      method: 'POST',
      body: JSON.stringify({ referralCode }),
    });
  },

  async getReferralProfile(): Promise<UserReferralProfile> {
    return this.request<UserReferralProfile>('/api/referral/profile');
  },

  async requestWithdrawal(amount: number, trc20Address: string): Promise<WithdrawalRequestRecord> {
    return this.request<WithdrawalRequestRecord>('/api/referral/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount, trc20Address }),
    });
  },

  async cancelWithdrawal(withdrawalId: string): Promise<WithdrawalRequestRecord> {
    return this.request<WithdrawalRequestRecord>(`/api/referral/withdrawals/${encodeURIComponent(withdrawalId)}/cancel`, {
      method: 'POST',
    });
  },

  // Admin Referral & Withdrawal Management
  async getAdminReferralOverview(): Promise<AdminReferralOverview> {
    return this.request<AdminReferralOverview>('/api/admin/referrals/overview');
  },

  async getAdminWithdrawals(): Promise<WithdrawalRequestRecord[]> {
    return this.request<WithdrawalRequestRecord[]>('/api/admin/referrals/withdrawals');
  },

  async approveAdminWithdrawal(withdrawalId: string): Promise<WithdrawalRequestRecord> {
    return this.request<WithdrawalRequestRecord>(`/api/admin/referrals/withdrawals/${encodeURIComponent(withdrawalId)}/approve`, {
      method: 'POST',
    });
  },

  async payAdminWithdrawal(withdrawalId: string, payoutTxId: string): Promise<WithdrawalRequestRecord> {
    return this.request<WithdrawalRequestRecord>(`/api/admin/referrals/withdrawals/${encodeURIComponent(withdrawalId)}/pay`, {
      method: 'POST',
      body: JSON.stringify({ payoutTxId }),
    });
  },

  async rejectAdminWithdrawal(withdrawalId: string, reason: string): Promise<WithdrawalRequestRecord> {
    return this.request<WithdrawalRequestRecord>(`/api/admin/referrals/withdrawals/${encodeURIComponent(withdrawalId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async getAdminCommissions(): Promise<ReferralCommissionRecord[]> {
    return this.request<ReferralCommissionRecord[]>('/api/admin/referrals/commissions');
  },
};
