import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Clock,
  Lock,
  Server,
  Share2,
  RotateCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MailCheck,
  FileSearch,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react';
import type { ScanResult } from '../types.ts';

interface ScanReportViewProps {
  report: ScanResult;
  onReScan?: () => void;
  onMonitorNow?: (url: string) => void;
  isPublicView?: boolean;
}

export const ScanReportView: React.FC<ScanReportViewProps> = ({
  report,
  onReScan,
  onMonitorNow,
  isPublicView = false,
}) => {
  const [activeTab, setActiveTab] = useState<'recommendations' | 'ssl' | 'dns' | 'security' | 'seo' | 'tech'>('recommendations');
  const [copied, setCopied] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    if (score >= 75) return 'text-[#E6A05A] border-[#E6A05A]/40 bg-[#E6A05A]/10';
    if (score >= 55) return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
    return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
  };

  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="w-full space-y-6">
      {/* Top summary card */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-800">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-slate-300">Public Health Diagnostic</span>
              <span aria-hidden="true">·</span>
              <span>Scanned on {new Date(report.timestamp).toLocaleString()}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-400">{report.uptime.details}</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight break-all">
                {report.domain}
              </h1>
              <a
                href={report.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-slate-400 hover:text-white transition-colors"
                title="Visit website"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <p className="text-xs text-slate-400">
              Normalized Target: <span className="font-mono text-slate-300">{report.normalizedUrl}</span>
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Score Ring */}
            <div className={`flex flex-col items-center justify-center h-24 w-24 rounded-2xl border ${getScoreColor(report.overallScore)}`}>
              <span className="text-3xl font-extrabold font-mono tabular-nums leading-none">
                {report.overallScore}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider mt-1 text-slate-300">
                Grade {report.grade}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800/80 border border-slate-700 rounded-lg hover:text-white transition-colors"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? 'Copied Link' : 'Share Report'}</span>
                </button>
                {onReScan && (
                  <button
                    onClick={onReScan}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-800/80 border border-slate-700 rounded-lg hover:text-white transition-colors"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    <span>Re-Check</span>
                  </button>
                )}
              </div>
              {onMonitorNow && (
                <button
                  onClick={() => onMonitorNow(report.url)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors"
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>Continuous Monitoring</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 4 Score Pillars */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6">
          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3.5 space-y-1">
            <span className="text-xs text-slate-400">Uptime & Latency</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold font-mono text-white tabular-nums">
                {report.categoryScores.uptimeAndSpeed.score} <span className="text-xs text-slate-500 font-normal">/ 25</span>
              </span>
              <span className="text-xs font-mono text-emerald-400">{report.uptime.responseTimeMs}ms</span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-all"
                style={{ width: `${(report.categoryScores.uptimeAndSpeed.score / 25) * 100}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3.5 space-y-1">
            <span className="text-xs text-slate-400">SSL & Transport</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold font-mono text-white tabular-nums">
                {report.categoryScores.sslAndTransport.score} <span className="text-xs text-slate-500 font-normal">/ 25</span>
              </span>
              <span className="text-xs font-mono text-slate-300">
                {report.ssl.valid ? `${report.ssl.daysRemaining}d left` : 'No SSL'}
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#E6A05A] transition-all"
                style={{ width: `${(report.categoryScores.sslAndTransport.score / 25) * 100}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3.5 space-y-1">
            <span className="text-xs text-slate-400">Security & Headers</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold font-mono text-white tabular-nums">
                {report.categoryScores.securityAndHeaders.score} <span className="text-xs text-slate-500 font-normal">/ 25</span>
              </span>
              <span className="text-xs text-slate-300">
                {report.security.hsts ? 'HSTS active' : 'HSTS missing'}
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-400 transition-all"
                style={{ width: `${(report.categoryScores.securityAndHeaders.score / 25) * 100}%` }}
              />
            </div>
          </div>

          <div className="rounded-lg bg-slate-900/80 border border-slate-800 p-3.5 space-y-1">
            <span className="text-xs text-slate-400">SEO & Standards</span>
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold font-mono text-white tabular-nums">
                {report.categoryScores.seoAndStandards.score} <span className="text-xs text-slate-500 font-normal">/ 25</span>
              </span>
              <span className="text-xs text-slate-300">
                {report.seo.robotsTxtPresent ? 'robots.txt ok' : 'no robots.txt'}
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all"
                style={{ width: `${(report.categoryScores.seoAndStandards.score / 25) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Summary counts */}
        <div className="mt-4 flex items-center gap-4 text-xs pt-4 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>{report.summary.passed} Passed Checks</span>
          </div>
          <span className="text-slate-600">·</span>
          <div className="flex items-center gap-1.5 text-amber-400 font-medium">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{report.summary.warnings} Warnings</span>
          </div>
          <span className="text-slate-600">·</span>
          <div className="flex items-center gap-1.5 text-rose-400 font-medium">
            <XCircle className="h-3.5 w-3.5" />
            <span>{report.summary.critical} Critical</span>
          </div>
        </div>
      </div>

      {/* Interactive Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-lg overflow-x-auto">
        <button
          onClick={() => setActiveTab('recommendations')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'recommendations'
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Remediation & Issues ({report.recommendations.length})
        </button>
        <button
          onClick={() => setActiveTab('ssl')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'ssl' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          SSL Certificate
        </button>
        <button
          onClick={() => setActiveTab('dns')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'dns' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          DNS & Email Authentication
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
          SEO & Meta Tags
        </button>
        <button
          onClick={() => setActiveTab('tech')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            activeTab === 'tech' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-white'
          }`}
        >
          Detected Technologies ({report.technologies.length})
        </button>
      </div>

      {/* Tab 1: Recommendations */}
      {activeTab === 'recommendations' && (
        <div className="space-y-3">
          {report.recommendations.map((item, idx) => {
            const isExpanded = expandedIndex === idx;
            return (
              <div
                key={idx}
                className="rounded-lg border border-slate-800 bg-[#0F172A] p-4 transition-colors hover:border-slate-700"
              >
                <div
                  onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                  className="flex items-start justify-between gap-4 cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {item.type === 'passed' && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                      {item.type === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-400" />}
                      {item.type === 'critical' && <XCircle className="h-4 w-4 text-rose-400" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                          {item.category}
                        </span>
                        <span className="text-xs text-slate-600">·</span>
                        <span className="text-sm font-semibold text-white">{item.title}</span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">{item.description}</p>
                    </div>
                  </div>

                  <button className="text-slate-400 hover:text-white p-1">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-slate-800 text-xs space-y-1 text-slate-300 bg-slate-900/50 p-3 rounded">
                    <span className="font-semibold text-[#E6A05A] block">Actionable Recommendation:</span>
                    <p>{item.recommendation}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 2: SSL Certificate */}
      {activeTab === 'ssl' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <h3 className="text-base font-semibold text-white">TLS/SSL Certificate Details</h3>
            <span
              className={`text-xs font-mono font-medium ${
                report.ssl.valid ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {report.ssl.valid ? 'VALID CERTIFICATE' : 'INVALID / EXPIRED'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1 p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-500">Certificate Authority (Issuer)</span>
              <p className="font-mono text-white text-sm">{report.ssl.issuer}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-500">Certificate Subject (CN)</span>
              <p className="font-mono text-white text-sm">{report.ssl.subject}</p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-500">Expiration Date</span>
              <p className="font-mono text-white text-sm">
                {new Date(report.ssl.validTo).toLocaleDateString()} ({report.ssl.daysRemaining} days remaining)
              </p>
            </div>
            <div className="space-y-1 p-3 rounded-lg bg-slate-900 border border-slate-800">
              <span className="text-slate-500">Negotiated Protocol & Cipher</span>
              <p className="font-mono text-white text-sm">
                {report.ssl.protocol || 'TLS 1.3'} / {report.ssl.cipher || 'Standard AES-GCM'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: DNS & Email Security */}
      {activeTab === 'dns' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
          <div>
            <h3 className="text-base font-semibold text-white mb-2">Email Authentication Records</h3>
            <p className="text-xs text-slate-400 mb-4">
              SPF and DMARC prevent attackers from spoofing your domain name in phishing campaigns.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">SPF (Sender Policy Framework)</span>
                  <span className={report.security.spfConfigured ? 'text-emerald-400 font-mono' : 'text-amber-400 font-mono'}>
                    {report.security.spfConfigured ? 'CONFIGURED' : 'MISSING'}
                  </span>
                </div>
                {report.security.spfRecord ? (
                  <p className="font-mono text-[11px] text-slate-300 break-all p-2 rounded bg-slate-950 border border-slate-800">
                    {report.security.spfRecord}
                  </p>
                ) : (
                  <p className="text-slate-400 text-[11px]">No TXT record starting with "v=spf1" found.</p>
                )}
              </div>

              <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">DMARC Policy</span>
                  <span className={report.security.dmarcConfigured ? 'text-emerald-400 font-mono' : 'text-amber-400 font-mono'}>
                    {report.security.dmarcConfigured ? 'CONFIGURED' : 'MISSING'}
                  </span>
                </div>
                {report.security.dmarcRecord ? (
                  <p className="font-mono text-[11px] text-slate-300 break-all p-2 rounded bg-slate-950 border border-slate-800">
                    {report.security.dmarcRecord}
                  </p>
                ) : (
                  <p className="text-slate-400 text-[11px]">No TXT record found at "_dmarc.{report.domain}".</p>
                )}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-3">Live Public DNS Records</h4>
            <div className="space-y-2 text-xs font-mono">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">A Records (IPv4):</span>
                <p className="text-white">{report.dns.aRecords.length ? report.dns.aRecords.join(', ') : 'None'}</p>
              </div>
              {report.dns.aaaaRecords.length > 0 && (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block mb-1">AAAA Records (IPv6):</span>
                  <p className="text-white">{report.dns.aaaaRecords.join(', ')}</p>
                </div>
              )}
              {report.dns.mxRecords.length > 0 && (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block mb-1">MX Records (Mail Exchangers):</span>
                  <div className="space-y-1">
                    {report.dns.mxRecords.map((mx, idx) => (
                      <p key={idx} className="text-white">
                        Priority {mx.priority} → {mx.exchange}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {report.dns.nsRecords.length > 0 && (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block mb-1">Name Servers (NS):</span>
                  <p className="text-white">{report.dns.nsRecords.join(', ')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Security Headers */}
      {activeTab === 'security' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <h3 className="text-base font-semibold text-white">HTTP Security Headers</h3>
          <p className="text-xs text-slate-400">
            Security headers protect browser visitors from clickjacking, MIME confusion, and cross-site scripting.
          </p>

          <div className="space-y-2 text-xs">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-white block">Strict-Transport-Security (HSTS)</span>
                <span className="text-slate-400 text-[11px]">Enforces encrypted HTTPS connections only</span>
              </div>
              <span className={`font-mono font-medium ${report.security.hsts ? 'text-emerald-400' : 'text-amber-400'}`}>
                {report.security.hsts ? 'PRESENT' : 'MISSING'}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-white block">Content-Security-Policy (CSP)</span>
                <span className="text-slate-400 text-[11px]">Defines approved script sources to prevent XSS</span>
              </div>
              <span className={`font-mono font-medium ${report.security.csp ? 'text-emerald-400' : 'text-amber-400'}`}>
                {report.security.csp ? 'CONFIGURED' : 'NOT DETECTED'}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-white block">X-Frame-Options</span>
                <span className="text-slate-400 text-[11px]">Mitigates framing and UI redressing attacks</span>
              </div>
              <span className={`font-mono font-medium ${report.security.xFrameOptions ? 'text-emerald-400' : 'text-amber-400'}`}>
                {report.security.xFrameOptions ? 'PROTECTED' : 'UNRESTRICTED'}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="font-semibold text-white block">X-Content-Type-Options</span>
                <span className="text-slate-400 text-[11px]">Prevents MIME sniffing vulnerabilities</span>
              </div>
              <span className={`font-mono font-medium ${report.security.xContentTypeOptions ? 'text-emerald-400' : 'text-amber-400'}`}>
                {report.security.xContentTypeOptions ? 'NOSNIFF' : 'MISSING'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: SEO & Meta */}
      {activeTab === 'seo' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <h3 className="text-base font-semibold text-white">Search Engine Discovery & Meta Structure</h3>

          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Title Tag</span>
                <span className="font-mono text-slate-300">{report.seo.titleLength} chars</span>
              </div>
              <p className="text-white font-medium">{report.seo.title || 'No <title> tag detected'}</p>
            </div>

            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 font-semibold">Meta Description</span>
                <span className="font-mono text-slate-300">{report.seo.descriptionLength} chars</span>
              </div>
              <p className="text-white leading-relaxed">{report.seo.description || 'No <meta name="description"> tag detected'}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block">robots.txt</span>
                <span className={`font-mono font-medium ${report.seo.robotsTxtPresent ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {report.seo.robotsTxtPresent ? 'FOUND' : 'MISSING'}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block">sitemap.xml</span>
                <span className={`font-mono font-medium ${report.seo.sitemapPresent ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {report.seo.sitemapPresent ? 'FOUND' : 'NOT FOUND'}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block">H1 Headings</span>
                <span className="font-mono text-white font-medium">{report.seo.h1Count} tags</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block">Image Alt Coverage</span>
                <span className="font-mono text-white font-medium">
                  {report.seo.imagesWithAltCount} / {report.seo.imageCount}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Detected Technologies */}
      {activeTab === 'tech' && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <h3 className="text-base font-semibold text-white">Publicly Observable Technologies</h3>
          <p className="text-xs text-slate-400">
            Identified non-intrusively through public HTTP response headers, DOM markers, and asset paths.
          </p>

          {report.technologies.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No distinctive signature detected. Server headers may be masked or minimalist.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {report.technologies.map((t, idx) => (
                <div key={idx} className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-white block">{t.name}</span>
                    <span className="text-[11px] text-slate-400">{t.category}</span>
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#E6A05A] px-2 py-0.5 rounded bg-[#E6A05A]/10 border border-[#E6A05A]/20">
                    {t.confidence}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
