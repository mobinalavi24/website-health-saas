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
  AuditLog,
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
      throw new Error(data.error || `HTTP error ${res.status}`);
    }
    return data as T;
  },

  // Public Free Scanner
  async scanWebsite(url: string): Promise<ScanResult> {
    return this.request<ScanResult>('/api/scan', {
      method: 'POST',
      body: JSON.stringify({ url }),
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

  async register(name: string, email: string, password: string, orgName?: string): Promise<{ token: string; user: User; organization: Organization }> {
    const res = await this.request<{ token: string; user: User; organization: Organization }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, orgName }),
    });
    this.setToken(res.token);
    return res;
  },

  async getMe(): Promise<{ user: User; organization: Organization }> {
    return this.request<{ user: User; organization: Organization }>('/api/auth/me');
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

  async changePlan(planId: string, interval: 'monthly' | 'annual', currency: 'USD' | 'EUR' | 'GBP'): Promise<{ success: boolean; organization: Organization }> {
    return this.request<{ success: boolean; organization: Organization }>('/api/billing/change-plan', {
      method: 'POST',
      body: JSON.stringify({ planId, interval, currency }),
    });
  },

  async getInvoices(): Promise<Invoice[]> {
    return this.request<Invoice[]>('/api/billing/invoices');
  },

  // Crypto Payments (USDT TRC20)
  async createCryptoOrder(planId: string, interval: 'monthly' | 'annual'): Promise<{ success: boolean; order: CryptoPaymentOrder }> {
    return this.request<{ success: boolean; order: CryptoPaymentOrder }>('/api/crypto/create-order', {
      method: 'POST',
      body: JSON.stringify({ planId, interval }),
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

  async testLBankConnection(): Promise<LBankConnectionTestResult> {
    return this.request<LBankConnectionTestResult>('/api/crypto/lbank-test');
  },

  // Tickets
  async getTickets(): Promise<SupportTicket[]> {
    return this.request<SupportTicket[]>('/api/tickets');
  },

  async createTicket(ticket: { name: string; email: string; subject: string; message: string; category?: string }): Promise<SupportTicket> {
    return this.request<SupportTicket>('/api/tickets', {
      method: 'POST',
      body: JSON.stringify(ticket),
    });
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

  async createApiKey(name: string): Promise<ApiKey & { secretToken: string }> {
    return this.request<ApiKey & { secretToken: string }>('/api/v1/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },
};
