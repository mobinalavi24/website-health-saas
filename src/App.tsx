import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { Footer } from './components/Footer.tsx';
import { PublicLanding } from './components/PublicLanding.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { WebsiteDetailView } from './components/WebsiteDetailView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { BillingView } from './components/BillingView.tsx';
import { ApiDocsView } from './components/ApiDocsView.tsx';
import { AdminView } from './components/AdminView.tsx';
import { AdminCryptoTransactionsView } from './components/AdminCryptoTransactionsView.tsx';
import { MyCryptoPaymentsView } from './components/MyCryptoPaymentsView.tsx';
import { ProfileReferralView } from './components/ProfileReferralView.tsx';
import { AdminWithdrawalsView } from './components/AdminWithdrawalsView.tsx';
import { AddWebsiteModal } from './components/AddWebsiteModal.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { ContactModal } from './components/ContactModal.tsx';
import { LegalModal } from './components/LegalModal.tsx';
import { apiClient } from './api/client.ts';
import type { User, Organization, Website, Incident, AlertNotification, ReportItem, SubscriptionPlan } from './types.ts';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [activeView, setActiveView] = useState<string>('home');
  const [postLoginView, setPostLoginView] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>('USDT');

  // Core Data
  const [websites, setWebsites] = useState<Website[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [alerts, setAlerts] = useState<AlertNotification[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState<string | null>(null);

  // Modals
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');
  const [initialReferralCode, setInitialReferralCode] = useState<string>('');
  const [addWebsiteModalOpen, setAddWebsiteModalOpen] = useState(false);
  const [prefilledAddUrl, setPrefilledAddUrl] = useState('');
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [legalModal, setLegalModal] = useState<{ isOpen: boolean; type: 'terms' | 'privacy' | 'security' }>({
    isOpen: false,
    type: 'terms',
  });

  // Initial authentication check & data bootstrap
  useEffect(() => {
    bootstrapSession();
  }, []);

  const bootstrapSession = async () => {
    const params = new URLSearchParams(window.location.search);
    const refParam = (params.get('ref') || params.get('referral') || '').trim().toUpperCase();
    const viewParam = (params.get('view') || '').trim().toLowerCase();
    const isRegisterPath = window.location.pathname.toLowerCase() === '/register';

    if (refParam) {
      setInitialReferralCode(refParam);
      try {
        sessionStorage.setItem('pv_referral_code', refParam);
      } catch {}
    }

    try {
      const p = await apiClient.getPlans();
      setPlans(p);

      const me = await apiClient.getMe();
      if (me && me.user) {
        setUser(me.user);
        setOrganization(me.organization);
        if (viewParam === 'reports') {
          setActiveView('reports');
        } else {
          setActiveView('dashboard');
        }
        await loadUserData();
      } else {
        if (viewParam === 'reports') {
          setActiveView('reports');
          setPostLoginView('reports');
          setAuthModalTab('login');
          setAuthModalOpen(true);
        } else if (refParam || isRegisterPath) {
          setAuthModalTab('register');
          setAuthModalOpen(true);
        }
      }
    } catch {
      if (viewParam === 'reports') {
        setActiveView('reports');
        setPostLoginView('reports');
        setAuthModalTab('login');
        setAuthModalOpen(true);
      } else if (refParam || isRegisterPath) {
        setAuthModalTab('register');
        setAuthModalOpen(true);
      }
    }
  };

  const loadUserData = async () => {
    try {
      const [w, inc, alt, rep] = await Promise.all([
        apiClient.getWebsites(),
        apiClient.getIncidents(),
        apiClient.getAlerts(),
        apiClient.getReports(),
      ]);
      setWebsites(w);
      setIncidents(inc);
      setAlerts(alt);
      setReports(rep);
    } catch (e) {
      console.error('Error loading user records', e);
    }
  };

  // Periodic background refresh for dashboard
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      loadUserData();
    }, 20000);
    return () => clearInterval(interval);
  }, [user]);

  const handleNavigate = (view: string) => {
    // Redirect any removed sections safely so there are never broken routes or blank pages
    if (view === 'scanner' || view === 'agency' || view === 'for-agencies') {
      setActiveView(user ? 'dashboard' : 'home');
      return;
    }

    if (view === 'reports' && !user) {
      setActiveView('reports');
      setPostLoginView('reports');
      setAuthModalTab('login');
      setAuthModalOpen(true);
      return;
    }

    setActiveView(view);
    if (view !== 'website-detail') {
      setSelectedWebsiteId(null);
    }
  };

  const handleLoginSuccess = async (u: User, org: Organization) => {
    setUser(u);
    setOrganization(org);
    const targetView =
      postLoginView === 'reports' || activeView === 'reports' ? 'reports' : 'dashboard';
    setPostLoginView(null);
    setActiveView(targetView);
    await loadUserData();
  };

  const handleLogout = () => {
    void apiClient.logout().catch(() => {});
    apiClient.clearToken();
    setUser(null);
    setOrganization(null);
    setPostLoginView(null);
    setActiveView('home');
    setSelectedWebsiteId(null);
  };

  const handleMonitorNow = (url: string) => {
    if (user) {
      setPrefilledAddUrl(url);
      setAddWebsiteModalOpen(true);
    } else {
      setPrefilledAddUrl(url);
      setAuthModalTab('register');
      setAuthModalOpen(true);
    }
  };

  const handleAddWebsite = async (data: Partial<Website>) => {
    const created = await apiClient.addWebsite(data);
    setWebsites((prev) => [created, ...prev]);
    setSelectedWebsiteId(created.id);
    setActiveView('website-detail');
  };

  const handleCheckWebsiteNow = async (siteId: string) => {
    const updated = await apiClient.checkWebsiteNow(siteId);
    setWebsites((prev) => prev.map((w) => (w.id === siteId ? updated : w)));
  };

  const handleTogglePause = async (siteId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'PAUSED' ? 'ONLINE' : 'PAUSED';
    const updated = await apiClient.updateWebsite(siteId, { status: newStatus as any });
    setWebsites((prev) => prev.map((w) => (w.id === siteId ? updated : w)));
  };

  const handleDeleteWebsite = async (siteId: string) => {
    await apiClient.deleteWebsite(siteId);
    setWebsites((prev) => prev.filter((w) => w.id !== siteId));
    if (selectedWebsiteId === siteId) {
      setSelectedWebsiteId(null);
      setActiveView('dashboard');
    }
  };

  const handleGenerateReport = async (siteId: string, title: string) => {
    try {
      const rep = await apiClient.generateReport(siteId, title);
      setReports((prev) => [rep, ...prev]);
      setActiveView('reports');
    } catch (err: any) {
      alert(`Report creation failed: ${err.message}`);
    }
  };

  const selectedWebsite = websites.find((w) => w.id === selectedWebsiteId);

  return (
    <div className="min-h-screen flex flex-col bg-[#0B1120] text-slate-100">
      {/* 3-Zone Navigation Header */}
      <Navbar
        user={user}
        organization={organization}
        activeView={activeView}
        onNavigate={handleNavigate}
        onOpenAuth={(tab = 'login') => {
          setAuthModalTab(tab);
          setAuthModalOpen(true);
        }}
        onLogout={handleLogout}
        currency={currency}
        onCurrencyChange={setCurrency}
      />

      {/* Main View Area */}
      <main className="flex-1 pb-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-8">
          {/* Public Views */}
          {activeView === 'home' && (
            <PublicLanding
              onOpenAuth={(tab = 'register') => {
                setAuthModalTab(tab);
                setAuthModalOpen(true);
              }}
              onOpenContact={() => setContactModalOpen(true)}
              onMonitorNow={handleMonitorNow}
              plans={plans}
              currency={currency}
              onCurrencyChange={setCurrency}
            />
          )}

          {activeView === 'features' && (
            <div className="space-y-8">
              <div className="text-center max-w-2xl mx-auto space-y-2">
                <h1 className="text-3xl font-extrabold text-white">Full Monitoring Engine Capabilities</h1>
                <p className="text-xs text-slate-400">Everything needed to ensure zero downtime and strict SSL compliance.</p>
              </div>
              <PublicLanding
                onOpenAuth={(tab = 'register') => {
                  setAuthModalTab(tab);
                  setAuthModalOpen(true);
                }}
                onOpenContact={() => setContactModalOpen(true)}
                onMonitorNow={handleMonitorNow}
                plans={plans}
                currency={currency}
                onCurrencyChange={setCurrency}
              />
            </div>
          )}

          {activeView === 'how-it-works' && (
            <div className="space-y-8">
              <div className="text-center max-w-2xl mx-auto space-y-2">
                <h1 className="text-3xl font-extrabold text-white">How External Probing Works</h1>
                <p className="text-xs text-slate-400">No passwords or hosting credentials required.</p>
              </div>
              <PublicLanding
                onOpenAuth={(tab = 'register') => {
                  setAuthModalTab(tab);
                  setAuthModalOpen(true);
                }}
                onOpenContact={() => setContactModalOpen(true)}
                onMonitorNow={handleMonitorNow}
                plans={plans}
                currency={currency}
                onCurrencyChange={setCurrency}
              />
            </div>
          )}

          {activeView === 'pricing' && (
            <div className="space-y-6">
              <BillingView
                organization={organization}
                user={user}
                currency={currency}
                onCurrencyChange={setCurrency}
                onRefreshOrg={loadUserData}
              />
            </div>
          )}

          {activeView === 'security' && (
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-8 max-w-3xl mx-auto space-y-6">
              <h1 className="text-2xl font-bold text-white">Security & Trust Architecture</h1>
              <p className="text-xs text-slate-300 leading-relaxed">
                PulseVanguard was architected from day one to operate without privileged server credentials. Our external probing cluster queries public DNS zones, negotiates TLS port 443 handshakes, and analyzes public HTTP responses.
              </p>
              <div className="space-y-3 text-xs text-slate-300">
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
                  <h3 className="font-semibold text-white mb-1">Server-Side Request Forgery (SSRF) Defenses</h3>
                  <p>All scanned targets are resolved and validated against private IPv4 (RFC 1918), link-local cloud metadata (169.254.169.254), and loopback ranges.</p>
                </div>
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
                  <h3 className="font-semibold text-white mb-1">Tenant Data Segregation</h3>
                  <p>All organizational telemetry and websites are isolated by organization UUID with strict RBAC access controls.</p>
                </div>
              </div>
            </div>
          )}

          {/* Authenticated Dashboard Views */}
          {activeView === 'dashboard' && (
            <DashboardView
              websites={websites}
              incidents={incidents}
              alerts={alerts}
              organization={organization}
              onSelectWebsite={(id) => {
                setSelectedWebsiteId(id);
                setActiveView('website-detail');
              }}
              onAddWebsite={() => {
                setPrefilledAddUrl('');
                setAddWebsiteModalOpen(true);
              }}
              onRefresh={loadUserData}
              onCheckNow={handleCheckWebsiteNow}
              onTogglePause={handleTogglePause}
              onDeleteWebsite={handleDeleteWebsite}
              onNavigate={handleNavigate}
            />
          )}

          {activeView === 'website-detail' && selectedWebsite && (
            <WebsiteDetailView
              website={selectedWebsite}
              organization={organization}
              onNavigate={handleNavigate}
              onBack={() => {
                setSelectedWebsiteId(null);
                setActiveView('dashboard');
              }}
              onUpdate={(updated) => {
                setWebsites((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
              }}
              onDelete={handleDeleteWebsite}
              onGenerateReport={handleGenerateReport}
            />
          )}

          {activeView === 'reports' && (
            <ReportsView
              user={user}
              organization={organization}
              onOpenAuth={(tab = 'login') => {
                setPostLoginView('reports');
                setAuthModalTab(tab);
                setAuthModalOpen(true);
              }}
              reports={reports}
              websites={websites}
              onRefreshReports={loadUserData}
            />
          )}

          {activeView === 'billing' && (
            <BillingView
              organization={organization}
              user={user}
              currency={currency}
              onCurrencyChange={setCurrency}
              onRefreshOrg={loadUserData}
            />
          )}

          {activeView === 'api-docs' && <ApiDocsView />}

          {activeView === 'profile-referrals' && user && (
            <ProfileReferralView
              user={user}
              organization={organization}
              onRefreshUser={bootstrapSession}
            />
          )}

          {activeView === 'my-crypto-payments' && user && (
            <MyCryptoPaymentsView onNavigateToBilling={() => handleNavigate('billing')} />
          )}

          {activeView === 'admin-crypto-transactions' && (user?.role === 'admin' || user?.role === 'super_admin') && (
            <AdminCryptoTransactionsView />
          )}

          {activeView === 'admin-withdrawals' && (user?.role === 'admin' || user?.role === 'super_admin') && (
            <AdminWithdrawalsView />
          )}

          {activeView === 'admin' && user?.role === 'super_admin' && (
            <AdminView onNavigate={handleNavigate} />
          )}
        </div>
      </main>

      {/* Footer */}
      <Footer
        onNavigate={handleNavigate}
        onOpenLegal={(type) => setLegalModal({ isOpen: true, type })}
        onOpenContact={() => setContactModalOpen(true)}
      />

      {/* Add Website Modal */}
      <AddWebsiteModal
        isOpen={addWebsiteModalOpen}
        onClose={() => setAddWebsiteModalOpen(false)}
        onAdd={handleAddWebsite}
        prefilledUrl={prefilledAddUrl}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleLoginSuccess}
        initialTab={authModalTab}
        initialReferralCode={initialReferralCode}
      />

      {/* Contact & Support Modal */}
      <ContactModal
        isOpen={contactModalOpen}
        onClose={() => setContactModalOpen(false)}
        userEmail={user?.email}
        userName={user?.name}
        onOpenAuth={(tab = 'login') => {
          setPostLoginView('reports');
          setAuthModalTab(tab);
          setAuthModalOpen(true);
        }}
        onNavigateReports={() => handleNavigate('reports')}
      />

      {/* Legal & Compliance Modal */}
      <LegalModal
        isOpen={legalModal.isOpen}
        onClose={() => setLegalModal({ isOpen: false, type: 'terms' })}
        type={legalModal.type}
      />
    </div>
  );
}
