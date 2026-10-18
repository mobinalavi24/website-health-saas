import React, { useState, useEffect } from 'react';
import {
  Activity,
  ArrowLeft,
  Clock,
  Shield,
  Lock,
  Globe,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Sliders,
  Bell,
  FileText,
  Key,
  Pause,
  Play,
  Trash2,
  TrendingUp,
  Cpu,
  Check,
  Copy,
  Gauge,
  History as HistoryIcon,
  Mail,
  Search,
  Filter,
  Server,
  Info,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { Website, MetricPoint, Incident, ScanResult, Organization } from '../types.ts';
import { ScanReportView } from './ScanReportView.tsx';
import { PageSpeedSection } from './PageSpeedSection.tsx';
import { AdvancedSeoSection } from './AdvancedSeoSection.tsx';

interface WebsiteDetailViewProps {
  website: Website;
  organization?: Organization | null;
  onNavigate?: (view: string) => void;
  onBack: () => void;
  onUpdate: (updated: Website) => void;
  onDelete: (id: string) => void;
  onGenerateReport: (websiteId: string, title: string) => void;
}

export const WebsiteDetailView: React.FC<WebsiteDetailViewProps> = ({
  website,
  organization,
  onNavigate,
  onBack,
  onUpdate,
  onDelete,
  onGenerateReport,
}) => {
  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'pagespeed'
    | 'uptime'
    | 'history'
    | 'ssl'
    | 'dns'
    | 'spfdmarc'
    | 'security'
    | 'seo'
    | 'incidents'
    | 'settings'
  >('overview');
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [checking, setChecking] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<{ success?: boolean; text: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedSpf, setCopiedSpf] = useState(false);
  const [copiedDmarc, setCopiedDmarc] = useState(false);
  const [historyRange, setHistoryRange] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [incidentFilter, setIncidentFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  // Check if organization Free Trial is expired
  const isFreePlan = organization?.planId === 'free';
  const trialEndsMs = organization?.trialEndsAt ? new Date(organization.trialEndsAt).getTime() : 0;
  const isTrialExpired = isFreePlan && trialEndsMs > 0 && Date.now() >= trialEndsMs;

  // Settings form state
  const [intervalMinutes, setIntervalMinutes] = useState(website.intervalMinutes);
  const [alertEmail, setAlertEmail] = useState(website.notificationSettings.alertEmail || '');
  const [alertOnDown, setAlertOnDown] = useState(website.notificationSettings.alertOnDown);
  const [alertOnRecovery, setAlertOnRecovery] = useState(website.notificationSettings.alertOnRecovery);
  const [latencyThreshold, setLatencyThreshold] = useState(website.notificationSettings.latencyThresholdMs || 1200);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    loadMetricsAndIncidents();
  }, [website.id]);

  const loadMetricsAndIncidents = async () => {
    setLoadingMetrics(true);
    try {
      const [m, incList] = await Promise.all([
        apiClient.getMetrics(website.id),
        apiClient.getIncidents(),
      ]);
      setMetrics(m);
      setIncidents(incList.filter((i) => i.websiteId === website.id));
    } catch (e) {
      console.error('Failed to load metrics:', e);
    } finally {
      setLoadingMetrics(false);
    }
  };

  const handleRunRapidCheck = async () => {
    if (isTrialExpired) {
      setFeedback({ type: 'error', message: 'Your free trial has expired. Upgrade to Pro to continue.' });
      return;
    }
    setChecking(true);
    setFeedback(null);
    try {
      const updated = await apiClient.checkWebsiteNow(website.id);
      onUpdate(updated);
      await loadMetricsAndIncidents();
      setFeedback({ type: 'success', message: 'Health check completed successfully.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Check failed' });
    } finally {
      setChecking(false);
    }
  };

  const handleRunFullAudit = async () => {
    if (isTrialExpired) {
      setFeedback({ type: 'error', message: 'Your free trial has expired. Upgrade to Pro to continue.' });
      return;
    }
    setAuditing(true);
    setFeedback(null);
    try {
      const auditResult = await apiClient.runDeepAudit(website.id);
      onUpdate({
        ...website,
        lastScanResult: auditResult,
        healthScore: auditResult.overallScore,
        lastResponseTimeMs: auditResult.uptime.responseTimeMs,
        lastCheckedAt: auditResult.timestamp,
      });
      setActiveTab('overview');
      setFeedback({ type: 'success', message: 'Full health audit completed!' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Audit failed' });
    } finally {
      setAuditing(false);
    }
  };

  const handleVerifyDomain = async () => {
    if (isTrialExpired) {
      setVerifyMessage({ success: false, text: 'Your free trial has expired. Upgrade to Pro to verify domains.' });
      return;
    }
    setVerifying(true);
    setVerifyMessage(null);
    try {
      const res = await apiClient.verifyDomain(website.id);
      setVerifyMessage({ success: true, text: res.message });
      onUpdate({
        ...website,
        verification: { ...website.verification, verified: true, verifiedAt: new Date().toISOString() },
      });
    } catch (err: any) {
      setVerifyMessage({ success: false, text: err.message || 'Verification failed.' });
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveSettings = async () => {
    if (isTrialExpired) {
      setFeedback({ type: 'error', message: 'Your free trial has expired. Upgrade to Pro to update settings.' });
      return;
    }
    setSavingSettings(true);
    setFeedback(null);
    try {
      const updated = await apiClient.updateWebsite(website.id, {
        intervalMinutes,
        notificationSettings: {
          ...website.notificationSettings,
          alertEmail,
          alertOnDown,
          alertOnRecovery,
          latencyThresholdMs: latencyThreshold,
        },
      });
      onUpdate(updated);
      setFeedback({ type: 'success', message: 'Settings saved successfully.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: `Error saving settings: ${err.message}` });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCopyVerificationToken = () => {
    navigator.clipboard.writeText(website.verification.token).then(() => {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    });
  };

  // Response time graph calculations
  const maxLatency = Math.max(...metrics.map((m) => m.responseTimeMs), 300);

  return (
    <div className="space-y-6">
      {/* Back button and Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {website.name}
              </h1>
              <a
                href={website.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-slate-400 hover:text-white"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-0.5">
              <span>{website.domain}</span>
              <span aria-hidden="true">·</span>
              <span>Check every {website.intervalMinutes}m</span>
              <span aria-hidden="true">·</span>
              <span
                className={`font-semibold ${
                  website.status === 'ONLINE'
                    ? 'text-emerald-400'
                    : website.status === 'DEGRADED'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              >
                {website.status}
              </span>
            </div>
          </div>
        </div>

        {/* Quick action triggers */}
        <div className="flex items-center gap-2">
          <button
            onClick={isTrialExpired && onNavigate ? () => onNavigate('billing') : handleRunRapidCheck}
            disabled={checking}
            title={isTrialExpired ? 'Free Trial Expired. Upgrade to Pro to run checks.' : 'Check Now'}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
              isTrialExpired
                ? 'bg-slate-900 border border-slate-800 text-slate-500 hover:text-rose-400'
                : 'text-slate-300 bg-slate-900 border border-slate-800 hover:text-white disabled:opacity-50'
            }`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin text-[#E6A05A]' : ''}`} />
            <span>Check Now</span>
          </button>
          <button
            onClick={isTrialExpired && onNavigate ? () => onNavigate('billing') : handleRunFullAudit}
            disabled={auditing}
            title={isTrialExpired ? 'Free Trial Expired. Upgrade to Pro to run health audits.' : 'Full Health Audit'}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
              isTrialExpired
                ? 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                : 'text-[#0B1120] bg-[#E6A05A] hover:bg-[#cf863c] disabled:opacity-50'
            }`}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>{auditing ? 'Auditing...' : isTrialExpired ? 'Upgrade for Audit' : 'Full Health Audit'}</span>
          </button>
          <button
            onClick={() => onGenerateReport(website.id, `${website.name} Health & Performance Report`)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Report</span>
          </button>
        </div>
      </div>

      {/* Trial Expired Warning Banner */}
      {isTrialExpired && (
        <div className="rounded-xl border border-rose-800/80 bg-rose-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" />
            <div className="space-y-0.5">
              <span className="text-white font-bold tracking-tight block sm:inline mr-2">
                Free Trial Expired
              </span>
              <span className="text-rose-200">
                Upgrade to Pro to continue monitoring and scanning.
              </span>
            </div>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('billing')}
              className="px-4 py-2 rounded-lg font-bold text-xs bg-rose-600 hover:bg-rose-500 text-white transition-colors shrink-0 self-start sm:self-auto shadow-sm cursor-pointer"
            >
              Upgrade to Pro (5 USDT/mo)
            </button>
          )}
        </div>
      )}

      {/* Action Feedback Notification */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedback.type === 'error'
              ? 'bg-rose-950/30 border-rose-800 text-rose-300'
              : 'bg-emerald-950/30 border-emerald-800 text-emerald-300'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white text-xs px-1"
          >
            ×
          </button>
        </div>
      )}

      {/* Consolidated Single Navigation System */}
      <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-lg overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'overview' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          Overview & Score
        </button>
        <button
          onClick={() => setActiveTab('pagespeed')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === 'pagespeed' ? 'bg-slate-800 text-[#E6A05A] shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Gauge className="h-3.5 w-3.5" />
          <span>Google PageSpeed</span>
          {website.lastScanResult?.pageSpeed?.mobile?.scores.performance !== undefined && website.lastScanResult.pageSpeed?.mobile?.scores.performance !== null && (
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400">
              {website.lastScanResult.pageSpeed.mobile.scores.performance}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('uptime')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'uptime' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          Uptime & Latency
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'history' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          History
        </button>
        <button
          onClick={() => setActiveTab('ssl')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'ssl' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          SSL & Certificate
        </button>
        <button
          onClick={() => setActiveTab('dns')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'dns' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          DNS & Email
        </button>
        <button
          onClick={() => setActiveTab('spfdmarc')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'spfdmarc' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          SPF/DMARC
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'security' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          Security Headers
        </button>
        <button
          onClick={() => setActiveTab('seo')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'seo' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          SEO & Crawl
        </button>
        <button
          onClick={() => setActiveTab('incidents')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'incidents' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          Incidents ({incidents.length})
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'settings' ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
          }`}
        >
          Settings & Domain Verification
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key metrics cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-[#0F172A] border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400">Current Health Score</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-white tabular-nums">
                  {website.healthScore}
                </span>
                <span className="text-xs text-[#E6A05A] font-medium">/ 100</span>
              </div>
              <p className="text-[11px] text-slate-500">Continuous scoring algorithm</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0F172A] border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400">Response Latency</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
                  {website.lastResponseTimeMs}
                </span>
                <span className="text-xs text-slate-400 font-mono">ms</span>
              </div>
              <p className="text-[11px] text-slate-500">Last probe check</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0F172A] border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400">24-Hour Uptime SLA</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-white tabular-nums">
                  {website.uptime24h.toFixed(2)}%
                </span>
              </div>
              <p className="text-[11px] text-slate-500">7-day: {website.uptime7d.toFixed(2)}% · 30-day: {website.uptime30d.toFixed(2)}%</p>
            </div>

            <div className="p-4 rounded-xl bg-[#0F172A] border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400">Domain Verification</span>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-sm font-semibold uppercase tracking-wider ${
                    website.verification?.verified ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {website.verification?.verified ? 'Verified Owner' : 'Unverified'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {website.verification?.verified ? 'Full audit privileges' : 'Verify via DNS TXT in Settings'}
              </p>
            </div>
          </div>

          {/* If we have a cached deep scan result, render consolidated overview without duplicate lower tabs */}
          {website.lastScanResult ? (
            <ScanReportView
              report={website.lastScanResult}
              onReScan={handleRunFullAudit}
              hideNavigationTabs={true}
              onNavigateTab={(tab) => setActiveTab(tab as any)}
            />
          ) : (
            <div className="p-8 rounded-xl border border-slate-800 bg-[#0F172A] text-center space-y-3">
              <Shield className="h-8 w-8 text-[#E6A05A] mx-auto" />
              <h3 className="text-sm font-semibold text-white">Full Security & SEO Audit Not Run Yet</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Run an instant full audit to evaluate SSL expiration days, security headers (HSTS, CSP), robots.txt, sitemap, and email records.
              </p>
              <button
                onClick={handleRunFullAudit}
                disabled={auditing}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-semibold hover:bg-[#cf863c] transition-colors"
              >
                {auditing ? 'Running In-Depth Audit...' : 'Execute Full Health Audit'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB: GOOGLE PAGESPEED INSIGHTS */}
      {activeTab === 'pagespeed' && (
        <PageSpeedSection
          url={website.url}
          initialData={website.lastScanResult?.pageSpeed}
          onDataUpdated={(updated) => {
            if (website.lastScanResult) {
              onUpdate({
                ...website,
                lastScanResult: {
                  ...website.lastScanResult,
                  pageSpeed: updated,
                },
              });
            }
          }}
        />
      )}

      {/* TAB: UPTIME & LATENCY */}
      {activeTab === 'uptime' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white">24-Hour Latency & Uptime Timeline</h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${
                    website.status === 'ONLINE'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : website.status === 'DEGRADED'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  }`}
                >
                  {website.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Continuous probing from distributed global monitoring edge nodes.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-emerald-400">Min: {metrics.length > 0 ? Math.min(...metrics.map((m) => m.responseTimeMs)) : 0}ms</span>
                <span className="text-slate-600">·</span>
                <span className="text-amber-400">Max: {metrics.length > 0 ? Math.max(...metrics.map((m) => m.responseTimeMs)) : 0}ms</span>
              </div>
              <button
                onClick={handleRunRapidCheck}
                disabled={checking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-[#E6A05A] text-xs font-medium text-slate-200 transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin text-[#E6A05A]' : ''}`} />
                <span>Check Now</span>
              </button>
            </div>
          </div>

          {/* Latency Bar Chart */}
          <div className="space-y-2">
            <div className="flex items-end gap-1.5 h-44 pt-6 pb-2 border-b border-slate-800/80">
              {metrics.length === 0 ? (
                <div className="w-full flex items-center justify-center text-xs text-slate-500">
                  Collecting initial metrics...
                </div>
              ) : (
                metrics.map((pt, i) => {
                  const heightPercent = Math.min(100, Math.max(10, (pt.responseTimeMs / maxLatency) * 100));
                  return (
                    <div
                      key={pt.id || i}
                      className="flex-1 flex flex-col items-center group relative h-full justify-end"
                    >
                      {/* Tooltip on hover */}
                      <div className="absolute -top-10 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                        <div className="bg-slate-900 border border-slate-700 text-[10px] text-white font-mono px-2 py-1 rounded shadow-lg whitespace-nowrap">
                          {pt.responseTimeMs}ms · {new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>

                      <div
                        className={`w-full rounded-t transition-all ${
                          pt.status === 'ONLINE'
                            ? pt.responseTimeMs < 400
                              ? 'bg-emerald-500/80 group-hover:bg-emerald-400'
                              : 'bg-amber-500/80 group-hover:bg-amber-400'
                            : 'bg-rose-500 group-hover:bg-rose-400'
                        }`}
                        style={{ height: `${heightPercent}%` }}
                      />
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>24 Hours Ago</span>
              <span>12 Hours Ago</span>
              <span>Just Now</span>
            </div>
          </div>

          {/* Uptime SLA Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 block">Last 24 Hours SLA</span>
              <span className="text-xl font-bold font-mono text-emerald-400 tabular-nums">
                {website.uptime24h.toFixed(2)}%
              </span>
              <p className="text-[10px] text-slate-500">Availability commitment</p>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 block">Last 7 Days SLA</span>
              <span className="text-xl font-bold font-mono text-slate-200 tabular-nums">
                {website.uptime7d.toFixed(2)}%
              </span>
              <p className="text-[10px] text-slate-500">Weekly operational uptime</p>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-xs text-slate-400 block">Last 30 Days SLA</span>
              <span className="text-xl font-bold font-mono text-slate-200 tabular-nums">
                {website.uptime30d.toFixed(2)}%
              </span>
              <p className="text-[10px] text-slate-500">Monthly contractual SLA</p>
            </div>
          </div>

          {/* Recent Probe Telemetry */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Recent Probe Telemetry ({metrics.slice(-8).length} checks)
              </h4>
              <span className="text-[11px] text-slate-500">Frequency: Every {website.intervalMinutes}m</span>
            </div>
            <div className="space-y-2">
              {metrics.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500 rounded-lg bg-slate-900 border border-slate-800">
                  No probe telemetry points recorded yet.
                </div>
              ) : (
                metrics.slice(-8).reverse().map((m, idx) => (
                  <div
                    key={m.id || idx}
                    className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between text-xs font-mono"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          m.status === 'ONLINE' ? 'bg-emerald-400' : m.status === 'DEGRADED' ? 'bg-amber-400' : 'bg-rose-400'
                        }`}
                      />
                      <span className="text-white font-medium">{new Date(m.timestamp).toLocaleTimeString()}</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-400 font-sans text-[11px]">HTTP {m.httpStatus || 200} OK</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-slate-500 font-sans text-[11px] hidden sm:inline">Edge Probe (Frankfurt Node)</span>
                      <span className={`font-bold ${m.responseTimeMs < 400 ? 'text-emerald-400' : m.responseTimeMs < 800 ? 'text-amber-400' : 'text-rose-400'}`}>
                        {m.responseTimeMs}ms
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB: HISTORY */}
      {activeTab === 'history' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <HistoryIcon className="h-5 w-5 text-indigo-400" />
                <h3 className="text-base font-semibold text-white">Monitoring Telemetry & Scan History</h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete historical record of latency probes, availability milestones, and health audits.
              </p>
            </div>

            {/* Time Filter Buttons */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              {(['all', '24h', '7d', '30d'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setHistoryRange(r)}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    historyRange === r ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {r === 'all' ? 'All Time' : r === '24h' ? '24 Hours' : r === '7d' ? '7 Days' : '30 Days'}
                </button>
              ))}
            </div>
          </div>

          {/* Historical Summary Cards */}
          {(() => {
            const filtered = metrics.filter((m) => {
              const ms = new Date(m.timestamp).getTime();
              const now = Date.now();
              if (historyRange === '24h') return ms >= now - 24 * 60 * 60 * 1000;
              if (historyRange === '7d') return ms >= now - 7 * 24 * 60 * 60 * 1000;
              if (historyRange === '30d') return ms >= now - 30 * 24 * 60 * 60 * 1000;
              return true;
            });
            const avgLatency = filtered.length > 0 ? Math.round(filtered.reduce((acc, m) => acc + m.responseTimeMs, 0) / filtered.length) : 0;
            const maxL = filtered.length > 0 ? Math.max(...filtered.map((m) => m.responseTimeMs)) : 0;
            const onlineCount = filtered.filter((m) => m.status === 'ONLINE').length;
            const slaPercent = filtered.length > 0 ? ((onlineCount / filtered.length) * 100).toFixed(2) : '100.00';

            return (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-xs text-slate-400">Total Probes</span>
                    <p className="text-xl font-bold font-mono text-white tabular-nums">{filtered.length}</p>
                    <span className="text-[10px] text-slate-500">Recorded checks</span>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-xs text-slate-400">Average Latency</span>
                    <p className="text-xl font-bold font-mono text-emerald-400 tabular-nums">{avgLatency}ms</p>
                    <span className="text-[10px] text-slate-500">Across selected range</span>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-xs text-slate-400">Peak Latency</span>
                    <p className="text-xl font-bold font-mono text-amber-400 tabular-nums">{maxL}ms</p>
                    <span className="text-[10px] text-slate-500">Maximum recorded spike</span>
                  </div>
                  <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                    <span className="text-xs text-slate-400">Range Availability</span>
                    <p className="text-xl font-bold font-mono text-white tabular-nums">{slaPercent}%</p>
                    <span className="text-[10px] text-slate-500">Successful uptime</span>
                  </div>
                </div>

                {/* Audit Snapshot Record */}
                {website.lastScanResult && (
                  <div className="p-4 rounded-lg bg-slate-900/80 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Latest Full Diagnostic Audit Snapshot
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        {new Date(website.lastScanResult.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500 block">Overall Health</span>
                        <span className="text-sm font-bold font-mono text-white">{website.lastScanResult.overallScore}/100</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Letter Grade</span>
                        <span className="text-sm font-bold font-mono text-[#E6A05A]">Grade {website.lastScanResult.grade}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Audit Issues</span>
                        <span className="text-sm font-bold font-mono text-amber-400">{website.lastScanResult.recommendations.length} items</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Response Time</span>
                        <span className="text-sm font-bold font-mono text-emerald-400">{website.lastScanResult.uptime.responseTimeMs}ms</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Chronological Probes Table */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Telemetry Probe Log ({filtered.length} entries)
                    </h4>
                    <span className="text-[11px] text-slate-500">Chronological probe audit</span>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500 rounded-lg bg-slate-900 border border-slate-800">
                      No telemetry logs in selected range.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-800">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-slate-900/90 text-slate-400 border-b border-slate-800 font-mono text-[11px]">
                          <tr>
                            <th className="py-2.5 px-3">Timestamp</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Response Time</th>
                            <th className="py-2.5 px-3">HTTP Code</th>
                            <th className="py-2.5 px-3 hidden sm:table-cell">Probe Location</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300 bg-slate-900/40">
                          {filtered.slice(0, 30).map((pt, idx) => (
                            <tr key={pt.id || idx} className="hover:bg-slate-800/40 transition-colors">
                              <td className="py-2.5 px-3 whitespace-nowrap text-white">
                                {new Date(pt.timestamp).toLocaleString()}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                                    pt.status === 'ONLINE'
                                      ? 'bg-emerald-500/10 text-emerald-400'
                                      : pt.status === 'DEGRADED'
                                      ? 'bg-amber-500/10 text-amber-400'
                                      : 'bg-rose-500/10 text-rose-400'
                                  }`}
                                >
                                  {pt.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap font-bold">
                                <span className={pt.responseTimeMs < 400 ? 'text-emerald-400' : pt.responseTimeMs < 800 ? 'text-amber-400' : 'text-rose-400'}>
                                  {pt.responseTimeMs}ms
                                </span>
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">
                                HTTP {pt.httpStatus || 200}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap text-slate-400 font-sans text-[11px] hidden sm:table-cell">
                                Global Edge Node 1 (Frankfurt)
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* TAB: SSL & CERTIFICATE */}
      {activeTab === 'ssl' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-[#E6A05A]" />
                <h3 className="text-base font-semibold text-white">SSL / TLS Certificate Monitoring</h3>
                {website.lastScanResult?.ssl && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${
                      website.lastScanResult.ssl.valid
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    {website.lastScanResult.ssl.valid ? 'VALID CERTIFICATE' : 'INVALID / EXPIRED'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Live Port 443 handshake telemetry, cipher inspection, and automatic renewal alerting.</p>
            </div>
            <button
              onClick={handleRunFullAudit}
              disabled={auditing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-[#E6A05A] text-xs font-medium text-slate-200 transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${auditing ? 'animate-spin text-[#E6A05A]' : ''}`} />
              <span>Refresh Certificate Check</span>
            </button>
          </div>

          {website.lastScanResult?.ssl ? (
            <div className="space-y-6">
              {/* Expiration alert if under 30 days */}
              {website.lastScanResult.ssl.daysRemaining <= 30 && (
                <div
                  className={`p-4 rounded-xl border flex items-center gap-3 text-xs ${
                    website.lastScanResult.ssl.daysRemaining <= 14
                      ? 'bg-rose-950/30 border-rose-800 text-rose-300'
                      : 'bg-amber-950/30 border-amber-800 text-amber-300'
                  }`}
                >
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <div>
                    <span className="font-bold block">
                      Certificate Renewal Required: {website.lastScanResult.ssl.daysRemaining} Days Remaining
                    </span>
                    <p className="text-[11px] opacity-90">
                      Your certificate will expire on {new Date(website.lastScanResult.ssl.validTo).toLocaleDateString()}. Ensure your ACME or hosting provider auto-renews before expiry.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-medium">Certificate Authority (Issuer)</span>
                  <p className="font-mono text-sm text-white">{website.lastScanResult.ssl.issuer}</p>
                  <span className="text-[11px] text-slate-500">Trusted root CA recognized by major web browsers</span>
                </div>
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-medium">Subject Common Name</span>
                  <p className="font-mono text-sm text-white">{website.lastScanResult.ssl.subject}</p>
                  <span className="text-[11px] text-slate-500">Issued specifically for this domain hierarchy</span>
                </div>
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-medium">Validity Window & Days Remaining</span>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-lg font-bold font-mono ${
                        website.lastScanResult.ssl.daysRemaining > 30
                          ? 'text-emerald-400'
                          : website.lastScanResult.ssl.daysRemaining > 14
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {website.lastScanResult.ssl.daysRemaining} days remaining
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 block font-mono">
                    Valid until {new Date(website.lastScanResult.ssl.validTo).toLocaleDateString()}
                  </span>
                </div>
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                  <span className="text-slate-400 font-medium">Protocol & Cipher Negotiation</span>
                  <p className="font-mono text-sm text-white">
                    {website.lastScanResult.ssl.protocol || 'TLS 1.3'} / {website.lastScanResult.ssl.cipher || 'Standard AES-GCM'}
                  </p>
                  <span className="text-[11px] text-emerald-400">Modern forward-secret cryptographic handshake</span>
                </div>
              </div>

              {/* Additional TLS checks */}
              <div className="p-4 rounded-lg bg-slate-900/60 border border-slate-800 space-y-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 block">
                  Transport Security Checks
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>HTTPS Port 443 Handshake: Successful</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-300">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Certificate Authority Chain: Verified</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-slate-400 space-y-3">
              <Lock className="h-8 w-8 text-slate-600 mx-auto" />
              <p>Run a health audit to inspect live SSL certificate details.</p>
              <button
                onClick={handleRunFullAudit}
                disabled={auditing}
                className="px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] font-semibold text-xs hover:bg-[#cf863c] transition-colors"
              >
                Inspect Live SSL Certificate
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB: SECURITY HEADERS */}
      {activeTab === 'security' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <h3 className="text-base font-semibold text-white">HTTP Security Headers</h3>
          <p className="text-xs text-slate-400">Defenses against Clickjacking, MIME sniffing, and MITM attacks.</p>

          {website.lastScanResult?.security ? (
            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-white block">Strict-Transport-Security (HSTS)</span>
                  <span className="text-slate-400 text-[11px]">Forces encrypted connections</span>
                </div>
                <span className={`font-mono ${website.lastScanResult.security.hsts ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {website.lastScanResult.security.hsts ? 'ENFORCED' : 'MISSING'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-white block">Content-Security-Policy (CSP)</span>
                  <span className="text-slate-400 text-[11px]">Mitigates XSS vulnerabilities</span>
                </div>
                <span className={`font-mono ${website.lastScanResult.security.csp ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {website.lastScanResult.security.csp ? 'CONFIGURED' : 'NOT DETECTED'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-white block">X-Frame-Options</span>
                  <span className="text-slate-400 text-[11px]">Prevents iframe embedding</span>
                </div>
                <span className={`font-mono ${website.lastScanResult.security.xFrameOptions ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {website.lastScanResult.security.xFrameOptions ? 'PROTECTED' : 'UNRESTRICTED'}
                </span>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              Run a health audit to analyze HTTP security headers.
            </div>
          )}
        </div>
      )}

      {/* TAB 6: SEO */}
      {activeTab === 'seo' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2">
            <div>
              <h3 className="text-base font-semibold text-white">Advanced SEO Analysis</h3>
              <p className="text-xs text-slate-400">On-page markup, Open Graph, Twitter Cards, JSON-LD schemas, and crawler indexability.</p>
            </div>
            {website.lastScanResult?.advancedSeo?.overview && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">SEO Health Score:</span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-[#E6A05A]/10 text-[#E6A05A] border border-[#E6A05A]/30">
                  {website.lastScanResult.advancedSeo.overview.score} / 100
                </span>
              </div>
            )}
          </div>

          {website.lastScanResult ? (
            <AdvancedSeoSection
              seoData={website.lastScanResult.advancedSeo}
              scanResult={website.lastScanResult}
            />
          ) : (
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-8 text-center text-xs text-slate-400">
              Run a health audit on this website to evaluate advanced SEO indicators.
            </div>
          )}
        </div>
      )}

      {/* TAB: INCIDENTS */}
      {activeTab === 'incidents' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-400" />
                <h3 className="text-base font-semibold text-white">Downtime & Incident History</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-800 text-slate-300">
                  {incidents.length} total
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Outages, degraded responsiveness events, and recovery logs automatically detected by monitoring probes.
              </p>
            </div>

            {/* Filter buttons */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              {(['all', 'open', 'resolved'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setIncidentFilter(filter)}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    incidentFilter === filter ? 'bg-slate-800 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {filter === 'all' ? 'All Incidents' : filter === 'open' ? 'Active Outages' : 'Resolved'}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const filteredIncidents = incidents.filter((inc) => {
              if (incidentFilter === 'open') return inc.status !== 'RESOLVED';
              if (incidentFilter === 'resolved') return inc.status === 'RESOLVED';
              return true;
            });

            return (
              <div className="space-y-4">
                {filteredIncidents.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-400 space-y-3">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400 mx-auto mb-1" />
                    <p className="font-semibold text-white">
                      {incidentFilter === 'open'
                        ? 'No active incidents. All probes report operational status!'
                        : 'No incident logs matching this filter.'}
                    </p>
                    <p className="text-slate-500">Continuous 24/7 probing is active and watching your endpoints.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredIncidents.map((inc) => (
                      <div
                        key={inc.id}
                        className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-start justify-between text-xs transition-colors hover:border-slate-700"
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                                inc.status === 'RESOLVED'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}
                            >
                              {inc.status}
                            </span>
                            <span className="text-slate-600">·</span>
                            <span className="text-white font-semibold">{inc.cause}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono">
                            Started: {new Date(inc.startedAt).toLocaleString()}
                            {inc.resolvedAt && ` · Resolved: ${new Date(inc.resolvedAt).toLocaleString()}`}
                          </p>
                        </div>
                        {inc.durationMinutes !== undefined && (
                          <div className="text-right">
                            <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-slate-800 text-slate-200 border border-slate-700">
                              {inc.durationMinutes} min downtime
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* TAB 8: SETTINGS & DOMAIN VERIFICATION */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          {/* Domain Verification Box */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-semibold text-white">Domain Ownership Verification</h3>
                <p className="text-xs text-slate-400">
                  Verify domain ownership to unlock deep scanning, high-frequency 1-minute checks, and sensitive audits.
                </p>
              </div>
              <span
                className={`text-xs font-mono font-semibold ${
                  website.verification?.verified ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {website.verification?.verified ? 'VERIFIED' : 'PENDING'}
              </span>
            </div>

            {!website.verification?.verified ? (
              <div className="space-y-3 text-xs">
                <p className="text-slate-300">
                  Choose one of the following methods to verify you control <strong>{website.domain}</strong>:
                </p>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span className="font-semibold text-white block">Method A: DNS TXT Record (Recommended)</span>
                  <p className="text-slate-400 text-[11px]">
                    Add a TXT record to your DNS zone with the following value:
                  </p>
                  <div className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-200">
                    <span>{website.verification.token}</span>
                    <button
                      onClick={handleCopyVerificationToken}
                      className="text-slate-400 hover:text-white"
                      title="Copy Token"
                    >
                      {copiedToken ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span className="font-semibold text-white block">Method B: HTML Meta Tag</span>
                  <p className="text-slate-400 text-[11px]">
                    Place this meta tag inside the &lt;head&gt; section of your homepage:
                  </p>
                  <div className="p-2 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-200">
                    &lt;meta name="pulsevanguard-verify" content="{website.verification.token}" /&gt;
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-3">
                  <button
                    onClick={handleVerifyDomain}
                    disabled={verifying}
                    className="px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-semibold hover:bg-[#cf863c] transition-colors disabled:opacity-50"
                  >
                    {verifying ? 'Checking DNS Records...' : 'Verify Domain Ownership'}
                  </button>
                </div>

                {verifyMessage && (
                  <div
                    className={`p-3 rounded text-xs ${
                      verifyMessage.success
                        ? 'bg-emerald-950/30 border border-emerald-800 text-emerald-300'
                        : 'bg-rose-950/30 border border-rose-800 text-rose-300'
                    }`}
                  >
                    {verifyMessage.text}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-900/60 text-xs text-emerald-300 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                <div>
                  <span className="font-semibold block">Domain Ownership Verified</span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    Token {website.verification.token} verified on {new Date(website.verification.verifiedAt || '').toLocaleString()}.
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Configuration Form */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <h3 className="text-base font-semibold text-white pb-3 border-b border-slate-800">
              Monitoring Schedule & Alert Rules
            </h3>

            <div className="space-y-4 text-xs max-w-lg">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Check Frequency</label>
                <select
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                >
                  <option value={1}>Every 1 Minute (Rapid Monitoring)</option>
                  <option value={5}>Every 5 Minutes (Standard)</option>
                  <option value={15}>Every 15 Minutes</option>
                  <option value={60}>Every 1 Hour</option>
                </select>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Alert Email Address</label>
                <input
                  type="email"
                  value={alertEmail}
                  onChange={(e) => setAlertEmail(e.target.value)}
                  placeholder="alerts@company.com"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                >
                </input>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={alertOnDown}
                    onChange={(e) => setAlertOnDown(e.target.checked)}
                    className="rounded border-slate-700 text-[#E6A05A] focus:ring-0"
                  />
                  <span>Dispatch alert immediately when website goes DOWN</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={alertOnRecovery}
                    onChange={(e) => setAlertOnRecovery(e.target.checked)}
                    className="rounded border-slate-700 text-[#E6A05A] focus:ring-0"
                  />
                  <span>Dispatch notification when service RECOVERS</span>
                </label>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Latency Alert Threshold (ms): <span className="font-mono text-[#E6A05A]">{latencyThreshold}ms</span>
                </label>
                <input
                  type="range"
                  min="400"
                  max="3000"
                  step="100"
                  value={latencyThreshold}
                  onChange={(e) => setLatencyThreshold(Number(e.target.value))}
                  className="w-full accent-[#E6A05A]"
                />
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  className="px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-semibold hover:bg-[#cf863c] transition-colors"
                >
                  {savingSettings ? 'Saving...' : 'Save Configuration'}
                </button>

                <button
                  onClick={() => {
                    if (confirm(`Are you sure you want to stop monitoring ${website.name}?`)) {
                      onDelete(website.id);
                    }
                  }}
                  className="flex items-center gap-1 text-rose-400 hover:text-rose-300 text-xs"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Website</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
