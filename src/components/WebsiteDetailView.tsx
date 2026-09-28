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
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { Website, MetricPoint, Incident, ScanResult } from '../types.ts';
import { ScanReportView } from './ScanReportView.tsx';

interface WebsiteDetailViewProps {
  website: Website;
  onBack: () => void;
  onUpdate: (updated: Website) => void;
  onDelete: (id: string) => void;
  onGenerateReport: (websiteId: string, title: string) => void;
}

export const WebsiteDetailView: React.FC<WebsiteDetailViewProps> = ({
  website,
  onBack,
  onUpdate,
  onDelete,
  onGenerateReport,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'uptime' | 'ssl' | 'dns' | 'security' | 'seo' | 'incidents' | 'settings'>('overview');
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [checking, setChecking] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<{ success?: boolean; text: string } | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

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
    setChecking(true);
    try {
      const updated = await apiClient.checkWebsiteNow(website.id);
      onUpdate(updated);
      await loadMetricsAndIncidents();
    } finally {
      setChecking(false);
    }
  };

  const handleRunFullAudit = async () => {
    setAuditing(true);
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
    } finally {
      setAuditing(false);
    }
  };

  const handleVerifyDomain = async () => {
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
    setSavingSettings(true);
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
      alert('Settings saved successfully.');
    } catch (err: any) {
      alert(`Error saving settings: ${err.message}`);
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
            onClick={handleRunRapidCheck}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin text-[#E6A05A]' : ''}`} />
            <span>Check Now</span>
          </button>
          <button
            onClick={handleRunFullAudit}
            disabled={auditing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors disabled:opacity-50"
          >
            <Shield className="h-3.5 w-3.5" />
            <span>{auditing ? 'Auditing...' : 'Full Health Audit'}</span>
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

      {/* Tabs navigation */}
      <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-lg overflow-x-auto">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'overview' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          Overview & Score
        </button>
        <button
          onClick={() => setActiveTab('uptime')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'uptime' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          Uptime & Latency History
        </button>
        <button
          onClick={() => setActiveTab('ssl')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'ssl' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          SSL & Certificate
        </button>
        <button
          onClick={() => setActiveTab('dns')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'dns' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          DNS & Email SPF/DMARC
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'security' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          Security Headers
        </button>
        <button
          onClick={() => setActiveTab('seo')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'seo' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          SEO & Crawl
        </button>
        <button
          onClick={() => setActiveTab('incidents')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'incidents' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          Incidents ({incidents.length})
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'settings' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
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

          {/* If we have a cached deep scan result, render it */}
          {website.lastScanResult ? (
            <ScanReportView
              report={website.lastScanResult}
              onReScan={handleRunFullAudit}
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

      {/* TAB 2: UPTIME & LATENCY */}
      {activeTab === 'uptime' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-white">24-Hour Latency & Uptime Timeline</h3>
              <p className="text-xs text-slate-400 mt-0.5">Response times logged from public monitoring probing nodes.</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-emerald-400">Min: {Math.min(...metrics.map((m) => m.responseTimeMs), 0)}ms</span>
              <span className="text-slate-600">·</span>
              <span className="text-amber-400">Max: {Math.max(...metrics.map((m) => m.responseTimeMs), 0)}ms</span>
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
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">Last 24 Hours</span>
              <span className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
                {website.uptime24h.toFixed(2)}%
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">Last 7 Days</span>
              <span className="text-lg font-bold font-mono text-slate-200 tabular-nums">
                {website.uptime7d.toFixed(2)}%
              </span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-xs text-slate-400 block mb-1">Last 30 Days</span>
              <span className="text-lg font-bold font-mono text-slate-200 tabular-nums">
                {website.uptime30d.toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: SSL */}
      {activeTab === 'ssl' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <h3 className="text-base font-semibold text-white">SSL / TLS Certificate Monitoring</h3>
              <p className="text-xs text-slate-400">Port 443 handshake telemetry & renewal warning system.</p>
            </div>
            <button
              onClick={handleRunFullAudit}
              disabled={auditing}
              className="text-xs font-medium text-[#E6A05A] hover:underline"
            >
              Refresh Certificate Check
            </button>
          </div>

          {website.lastScanResult?.ssl ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-400">Issuer CA</span>
                <p className="font-mono text-sm text-white">{website.lastScanResult.ssl.issuer}</p>
              </div>
              <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-400">Subject Name</span>
                <p className="font-mono text-sm text-white">{website.lastScanResult.ssl.subject}</p>
              </div>
              <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-400">Days Remaining</span>
                <p className="font-mono text-sm text-emerald-400 font-bold">
                  {website.lastScanResult.ssl.daysRemaining} days left
                </p>
                <span className="text-[11px] text-slate-500">
                  Expires {new Date(website.lastScanResult.ssl.validTo).toLocaleDateString()}
                </span>
              </div>
              <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-400">Protocol & Cipher</span>
                <p className="font-mono text-sm text-white">
                  {website.lastScanResult.ssl.protocol || 'TLS 1.3'} / {website.lastScanResult.ssl.cipher || 'AES-GCM'}
                </p>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              Run a health audit to inspect the live SSL certificate.
            </div>
          )}
        </div>
      )}

      {/* TAB 4: DNS & EMAIL */}
      {activeTab === 'dns' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
          <div>
            <h3 className="text-base font-semibold text-white mb-1">DNS Records & Email Spoofing Defense</h3>
            <p className="text-xs text-slate-400">Public authoritative nameserver records & SPF / DMARC verification.</p>
          </div>

          {website.lastScanResult?.dns ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span className="font-semibold text-white block">SPF Record</span>
                  <p className="font-mono text-[11px] text-slate-300 break-all">
                    {website.lastScanResult.security.spfRecord || 'No SPF record detected'}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span className="font-semibold text-white block">DMARC Record</span>
                  <p className="font-mono text-[11px] text-slate-300 break-all">
                    {website.lastScanResult.security.dmarcRecord || 'No DMARC record detected'}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono space-y-2">
                <span className="text-slate-400 block font-sans font-semibold">A Records (IPv4):</span>
                <p className="text-white">{website.lastScanResult.dns.aRecords.join(', ') || 'None'}</p>

                {website.lastScanResult.dns.mxRecords.length > 0 && (
                  <>
                    <span className="text-slate-400 block font-sans font-semibold pt-2">MX Mail Servers:</span>
                    {website.lastScanResult.dns.mxRecords.map((m, idx) => (
                      <p key={idx} className="text-white">
                        Priority {m.priority} → {m.exchange}
                      </p>
                    ))}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              Run a health audit to pull authoritative DNS records.
            </div>
          )}
        </div>
      )}

      {/* TAB 5: SECURITY HEADERS */}
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
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <h3 className="text-base font-semibold text-white">SEO & Crawler Health</h3>
          <p className="text-xs text-slate-400">Meta tags, robots.txt, sitemap, and heading tags validation.</p>

          {website.lastScanResult?.seo ? (
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Title ({website.lastScanResult.seo.titleLength} characters):</span>
                <p className="text-white font-medium">{website.lastScanResult.seo.title || 'Missing title'}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-400 block mb-1">Meta Description ({website.lastScanResult.seo.descriptionLength} characters):</span>
                <p className="text-white font-medium">{website.lastScanResult.seo.description || 'Missing meta description'}</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block">robots.txt</span>
                  <span className={`font-mono ${website.lastScanResult.seo.robotsTxtPresent ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {website.lastScanResult.seo.robotsTxtPresent ? 'FOUND' : 'MISSING'}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block">sitemap.xml</span>
                  <span className={`font-mono ${website.lastScanResult.seo.sitemapPresent ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {website.lastScanResult.seo.sitemapPresent ? 'FOUND' : 'NOT FOUND'}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block">H1 Headings</span>
                  <span className="font-mono text-white">{website.lastScanResult.seo.h1Count} tags</span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block">Images with Alt</span>
                  <span className="font-mono text-white">
                    {website.lastScanResult.seo.imagesWithAltCount} / {website.lastScanResult.seo.imageCount}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              Run a health audit to evaluate SEO indicators.
            </div>
          )}
        </div>
      )}

      {/* TAB 7: INCIDENTS */}
      {activeTab === 'incidents' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <h3 className="text-base font-semibold text-white">Downtime & Incident History</h3>

          {incidents.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              <CheckCircle2 className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
              <span>No recorded downtime incidents for this website. Perfect availability!</span>
            </div>
          ) : (
            <div className="space-y-3">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="p-4 rounded-lg bg-slate-900 border border-slate-800 flex items-start justify-between text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-semibold font-mono ${
                          inc.status === 'RESOLVED' ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {inc.status}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-white font-medium">{inc.cause}</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Started: {new Date(inc.startedAt).toLocaleString()}
                      {inc.resolvedAt && ` · Resolved: ${new Date(inc.resolvedAt).toLocaleString()}`}
                    </p>
                  </div>
                  {inc.durationMinutes && (
                    <span className="text-xs font-mono text-slate-300">
                      {inc.durationMinutes} min downtime
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
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
