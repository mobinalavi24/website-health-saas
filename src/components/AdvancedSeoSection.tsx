import React, { useState } from 'react';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Globe,
  Share2,
  Code2,
  Bot,
  Sliders,
  ListChecks,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileCode,
  ShieldCheck,
  Smartphone,
  Eye,
  Layers,
  ArrowRight,
  Maximize2,
  Copy,
  Check,
} from 'lucide-react';
import type {
  AdvancedSeoResult,
  SeoIssue,
  SeoSeverity,
  SeoCategory,
  ScanResult,
} from '../types.ts';

interface AdvancedSeoSectionProps {
  seoData?: AdvancedSeoResult | null;
  scanResult?: ScanResult | null;
}

export const AdvancedSeoSection: React.FC<AdvancedSeoSectionProps> = ({
  seoData: propSeoData,
  scanResult,
}) => {
  // Resolve data either from propSeoData or scanResult.advancedSeo or scanResult.seo.advanced
  const seo: AdvancedSeoResult | undefined =
    propSeoData ||
    scanResult?.advancedSeo ||
    (scanResult?.seo as any)?.advanced ||
    undefined;

  const [activeSubTab, setActiveSubTab] = useState<
    'overview' | 'onpage' | 'social' | 'schema' | 'crawlability' | 'technical' | 'issues'
  >('overview');

  const [issuesFilter, setIssuesFilter] = useState<'all' | 'critical' | 'warning' | 'passed'>('all');
  const [issuesCategoryFilter, setIssuesCategoryFilter] = useState<string>('all');
  const [expandedJsonLd, setExpandedJsonLd] = useState<number | null>(null);
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<number | null>(null);

  if (!seo) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-8 text-center space-y-3">
        <Search className="h-10 w-10 text-slate-500 mx-auto" />
        <h4 className="text-base font-semibold text-white">Advanced SEO Analysis Pending</h4>
        <p className="text-xs text-slate-400 max-w-md mx-auto">
          Run a full health scan or audit to generate in-depth on-page, crawlability, Open Graph, Twitter Cards, and Schema.org structured data analysis.
        </p>
      </div>
    );
  }

  const { overview, onPage, social, structuredData, crawlability, indexability, technical, conflicts, issues } = seo;

  const getSeverityBadge = (severity: SeoSeverity | 'good', passed?: boolean) => {
    if (passed || severity === 'good' || severity === 'passed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="h-3 w-3" />
          PASSED
        </span>
      );
    }
    if (severity === 'critical') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
          <XCircle className="h-3 w-3" />
          CRITICAL
        </span>
      );
    }
    if (severity === 'warning') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
          <AlertTriangle className="h-3 w-3" />
          WARNING
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
        <Info className="h-3 w-3" />
        INFO
      </span>
    );
  };

  const getScoreColorClass = (score: number) => {
    if (score >= 90) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    if (score >= 75) return 'text-[#E6A05A] border-[#E6A05A]/40 bg-[#E6A05A]/10';
    if (score >= 50) return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
    return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCodeIndex(index);
      setTimeout(() => setCopiedCodeIndex(null), 2000);
    });
  };

  const filteredIssues = issues.filter((issue) => {
    if (issuesFilter === 'critical') {
      if (issue.severity !== 'critical' || issue.passed) return false;
    } else if (issuesFilter === 'warning') {
      if (issue.severity !== 'warning' || issue.passed) return false;
    } else if (issuesFilter === 'passed') {
      if (!issue.passed) return false;
    }
    if (issuesCategoryFilter !== 'all') {
      if (issue.category !== issuesCategoryFilter) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-slate-800 text-xs font-medium scrollbar-thin">
        <button
          onClick={() => setActiveSubTab('overview')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition-colors whitespace-nowrap ${
            activeSubTab === 'overview'
              ? 'text-[#E6A05A] border-b-2 border-[#E6A05A] bg-[#E6A05A]/5 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Search className="h-3.5 w-3.5" />
          <span>SEO Overview</span>
          <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300 font-mono">
            {overview.score}/100
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('onpage')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition-colors whitespace-nowrap ${
            activeSubTab === 'onpage'
              ? 'text-[#E6A05A] border-b-2 border-[#E6A05A] bg-[#E6A05A]/5 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileCode className="h-3.5 w-3.5" />
          <span>On-Page SEO</span>
        </button>

        <button
          onClick={() => setActiveSubTab('social')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition-colors whitespace-nowrap ${
            activeSubTab === 'social'
              ? 'text-[#E6A05A] border-b-2 border-[#E6A05A] bg-[#E6A05A]/5 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>Social (OG & Cards)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('schema')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition-colors whitespace-nowrap ${
            activeSubTab === 'schema'
              ? 'text-[#E6A05A] border-b-2 border-[#E6A05A] bg-[#E6A05A]/5 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Code2 className="h-3.5 w-3.5" />
          <span>Structured Data</span>
          {structuredData.blocksCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">
              {structuredData.blocksCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('crawlability')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition-colors whitespace-nowrap ${
            activeSubTab === 'crawlability'
              ? 'text-[#E6A05A] border-b-2 border-[#E6A05A] bg-[#E6A05A]/5 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Bot className="h-3.5 w-3.5" />
          <span>Crawl & Indexability</span>
          <span
            className={`ml-1 px-1.5 py-0.2 rounded text-[10px] uppercase font-mono ${
              indexability.status === 'indexable'
                ? 'bg-emerald-500/10 text-emerald-400'
                : indexability.status === 'blocked'
                ? 'bg-rose-500/10 text-rose-400'
                : 'bg-amber-500/10 text-amber-400'
            }`}
          >
            {indexability.status}
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('technical')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition-colors whitespace-nowrap ${
            activeSubTab === 'technical'
              ? 'text-[#E6A05A] border-b-2 border-[#E6A05A] bg-[#E6A05A]/5 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>Technical SEO</span>
        </button>

        <button
          onClick={() => setActiveSubTab('issues')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg transition-colors whitespace-nowrap ${
            activeSubTab === 'issues'
              ? 'text-[#E6A05A] border-b-2 border-[#E6A05A] bg-[#E6A05A]/5 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ListChecks className="h-3.5 w-3.5" />
          <span>All Rules & Issues</span>
          <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-800 text-[10px] text-slate-300 font-mono">
            {issues.length}
          </span>
        </button>
      </div>

      {/* 1. OVERVIEW TAB */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Top Score & Summary Banner */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Score tile */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 flex flex-col justify-between items-center text-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Advanced SEO Score
              </span>
              <div
                className={`my-3 h-24 w-24 rounded-2xl border flex flex-col items-center justify-center ${getScoreColorClass(
                  overview.score
                )}`}
              >
                <span className="text-3xl font-extrabold font-mono tabular-nums leading-none">
                  {overview.score}
                </span>
                <span className="text-[10px] uppercase font-semibold tracking-wider mt-1 text-slate-400">
                  / 100 PTS
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Calculated from 14+ technical & content checks</p>
            </div>

            {/* Indexability card */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Indexability Status
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-mono font-bold uppercase ${
                    indexability.status === 'indexable'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : indexability.status === 'blocked'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}
                >
                  {indexability.status}
                </span>
              </div>
              <div className="text-xs text-slate-300 space-y-1.5 pt-1">
                {indexability.reasons.map((r, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                    <span className="text-slate-500 mt-0.5">•</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-800/80 italic">
                Reflects observable crawling and robots directives; does not guarantee Google search placement.
              </p>
            </div>

            {/* Findings tally */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                Audit Signal Breakdown
              </span>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
                  <div className="text-xl font-bold font-mono text-rose-400">
                    {overview.criticalCount}
                  </div>
                  <div className="text-[10px] uppercase font-semibold text-slate-400 mt-0.5">Critical</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
                  <div className="text-xl font-bold font-mono text-amber-400">
                    {overview.warningCount}
                  </div>
                  <div className="text-[10px] uppercase font-semibold text-slate-400 mt-0.5">Warnings</div>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-center">
                  <div className="text-xl font-bold font-mono text-emerald-400">
                    {overview.passedCount}
                  </div>
                  <div className="text-[10px] uppercase font-semibold text-slate-400 mt-0.5">Passed</div>
                </div>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                <span>Total checks executed:</span>
                <span className="font-mono text-white font-medium">{issues.length} rules</span>
              </div>
            </div>

            {/* Category Score Weights */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                Category Scores
              </span>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-slate-400">Technical SEO:</span>
                  <span className="font-mono font-medium text-white">
                    {overview.scoreBreakdown.technical.score} / {overview.scoreBreakdown.technical.max}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-[#E6A05A] h-1.5 rounded-full"
                    style={{
                      width: `${(overview.scoreBreakdown.technical.score / overview.scoreBreakdown.technical.max) * 100}%`,
                    }}
                  />
                </div>

                <div className="flex justify-between items-center text-[11px] pt-1">
                  <span className="text-slate-400">On-Page Content:</span>
                  <span className="font-mono font-medium text-white">
                    {overview.scoreBreakdown.onPage.score} / {overview.scoreBreakdown.onPage.max}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-[#E6A05A] h-1.5 rounded-full"
                    style={{
                      width: `${(overview.scoreBreakdown.onPage.score / overview.scoreBreakdown.onPage.max) * 100}%`,
                    }}
                  />
                </div>

                <div className="flex justify-between items-center text-[11px] pt-1">
                  <span className="text-slate-400">Social (OG & Cards):</span>
                  <span className="font-mono font-medium text-white">
                    {overview.scoreBreakdown.social.score} / {overview.scoreBreakdown.social.max}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-[#E6A05A] h-1.5 rounded-full"
                    style={{
                      width: `${(overview.scoreBreakdown.social.score / overview.scoreBreakdown.social.max) * 100}%`,
                    }}
                  />
                </div>

                <div className="flex justify-between items-center text-[11px] pt-1">
                  <span className="text-slate-400">Structured Data:</span>
                  <span className="font-mono font-medium text-white">
                    {overview.scoreBreakdown.structuredData.score} / {overview.scoreBreakdown.structuredData.max}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-[#E6A05A] h-1.5 rounded-full"
                    style={{
                      width: `${(overview.scoreBreakdown.structuredData.score / overview.scoreBreakdown.structuredData.max) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Signals Summary Grid */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <h4 className="text-sm font-semibold text-white flex items-center justify-between">
              <span>Core Discovered Signals</span>
              <span className="text-xs font-normal text-slate-400">Summary across HTML & HTTP response</span>
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 block">Title Tag</span>
                <span className="font-mono font-semibold text-white block truncate">
                  {onPage.title.exists ? `${onPage.title.characterCount} chars` : 'Missing'}
                </span>
                <span className={`text-[10px] ${onPage.title.severity === 'good' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {onPage.title.severity === 'good' ? 'Optimal' : onPage.title.severity}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 block">Description</span>
                <span className="font-mono font-semibold text-white block truncate">
                  {onPage.description.exists ? `${onPage.description.characterCount} chars` : 'Missing'}
                </span>
                <span className={`text-[10px] ${onPage.description.severity === 'good' ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {onPage.description.severity === 'good' ? 'Optimal' : onPage.description.severity}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 block">Canonical URL</span>
                <span className={`font-mono font-semibold block ${onPage.canonical.exists ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {onPage.canonical.exists ? 'Declared' : 'Missing'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {onPage.canonical.isHttps ? 'HTTPS Match' : onPage.canonical.exists ? 'HTTP / Insecure' : 'No Link Tag'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 block">Open Graph</span>
                <span className={`font-mono font-semibold block ${social.openGraph.present ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {social.openGraph.present ? 'Detected' : 'Missing'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {social.openGraph.image.present ? 'Image Included' : 'No og:image'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 block">JSON-LD</span>
                <span className={`font-mono font-semibold block ${structuredData.blocksCount > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {structuredData.blocksCount > 0 ? `${structuredData.blocksCount} block(s)` : 'None'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {structuredData.schemasFound.length > 0 ? `${structuredData.schemasFound.length} types` : 'No Schema'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-500 block">Robots / Sitemap</span>
                <span className="font-mono font-semibold text-white block">
                  {crawlability.robotsTxt.exists ? 'robots.txt' : 'No robots'}
                </span>
                <span className="text-[10px] text-slate-400">
                  {crawlability.sitemap.exists ? 'Sitemap found' : 'No sitemap'}
                </span>
              </div>
            </div>
          </div>

          {/* Conflict warnings banner if any */}
          {conflicts.conflicts.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-3">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                <AlertTriangle className="h-4 w-4" />
                <span>SEO Tag Conflicts & Duplications Detected ({conflicts.conflicts.length})</span>
              </div>
              <div className="space-y-2 text-xs">
                {conflicts.conflicts.map((c, idx) => (
                  <div key={idx} className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-amber-500/20">
                    <span className="mt-0.5 text-amber-400 font-bold">•</span>
                    <div className="space-y-0.5">
                      <span className="font-semibold text-white">{c.message}</span>
                      <p className="text-[11px] text-slate-300">
                        Type: <span className="font-mono text-amber-300">{c.type}</span> ({c.severity})
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. ON-PAGE SEO TAB */}
      {activeSubTab === 'onpage' && (
        <div className="space-y-6">
          {/* Title and Meta Description Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Title */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">Page Title Tag</span>
                  {getSeverityBadge(onPage.title.severity, onPage.title.severity === 'good')}
                </div>
                <span className="font-mono text-xs text-slate-400">{onPage.title.characterCount} chars</span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <p className="text-sm font-medium text-white break-words">
                  {onPage.title.value ? onPage.title.value : <span className="text-rose-400 italic">No &lt;title&gt; element found</span>}
                </p>
              </div>

              {onPage.title.issues.length > 0 && (
                <div className="space-y-1 text-xs text-slate-300">
                  {onPage.title.issues.map((issue, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                      <span className="text-amber-400 mt-0.5">⚠</span>
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                Recommended display range: 30–60 characters. Character count guidelines provide snippet optimization guidance rather than strict ranking limits.
              </p>
            </div>

            {/* Meta Description */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white">Meta Description</span>
                  {getSeverityBadge(onPage.description.severity, onPage.description.severity === 'good')}
                </div>
                <span className="font-mono text-xs text-slate-400">{onPage.description.characterCount} chars</span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <p className="text-xs text-slate-200 leading-relaxed break-words">
                  {onPage.description.value ? onPage.description.value : <span className="text-amber-400 italic">No &lt;meta name="description"&gt; found</span>}
                </p>
              </div>

              {onPage.description.issues.length > 0 && (
                <div className="space-y-1 text-xs text-slate-300">
                  {onPage.description.issues.map((issue, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                      <span className="text-amber-400 mt-0.5">⚠</span>
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                Recommended display range: 70–160 characters. Search engines use descriptions as snippet candidates depending on searcher queries.
              </p>
            </div>
          </div>

          {/* Canonical Card */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Canonical URL Analysis</span>
              {getSeverityBadge(onPage.canonical.exists ? 'good' : 'warning', onPage.canonical.exists && !onPage.canonical.multipleTags)}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">Canonical Tag Status</span>
                <span className="font-semibold text-white">
                  {onPage.canonical.exists ? `${onPage.canonical.tagsCount} tag(s) found` : 'Not declared'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">URL Scheme & Domain</span>
                <span className="font-semibold text-white">
                  {onPage.canonical.isHttps ? 'HTTPS' : 'HTTP'} · {onPage.canonical.isSameDomain ? 'Same Domain' : 'Cross-Domain'}
                </span>
              </div>

              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">Target Path Format</span>
                <span className="font-semibold text-white">
                  {onPage.canonical.isAbsolute ? 'Absolute URL' : 'Relative URL'}
                </span>
              </div>
            </div>

            {onPage.canonical.url && (
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 font-mono text-xs text-slate-300 break-all">
                <span className="text-slate-500 select-none mr-2">canonical:</span>
                {onPage.canonical.url}
              </div>
            )}

            {onPage.canonical.issues.length > 0 && (
              <div className="space-y-1 text-xs text-slate-300">
                {onPage.canonical.issues.map((issue, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 text-[11px] text-slate-300">
                    <span className="text-amber-400 mt-0.5">⚠</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Heading Structure Card */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Heading Structure (H1, H2, H3)</span>
              <span className="font-mono text-xs text-slate-400">
                H1: {onPage.headings.h1Count} | H2: {onPage.headings.h2Count} | H3: {onPage.headings.h3Count}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="text-xs font-medium text-slate-300 block">Primary Heading (H1) Content</span>
                {onPage.headings.h1Texts.length > 0 ? (
                  <div className="space-y-1.5">
                    {onPage.headings.h1Texts.map((text, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white">
                        <span className="font-mono text-[10px] text-[#E6A05A] mr-2">H1 #{idx + 1}</span>
                        {text}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-amber-400 italic">
                    No &lt;h1&gt; tags found on the page.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-xs font-medium text-slate-300 block">Heading Hierarchy & Gaps</span>
                {onPage.headings.hierarchyGaps.length > 0 ? (
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 space-y-1">
                    {onPage.headings.hierarchyGaps.map((gap, idx) => (
                      <div key={idx}>• {gap}</div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                    No major heading hierarchy skipping gaps detected.
                  </div>
                )}

                {/* Sample hierarchy breakdown */}
                {onPage.headings.headingsHierarchy.length > 0 && (
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 max-h-48 overflow-y-auto space-y-1 font-mono text-[11px]">
                    {onPage.headings.headingsHierarchy.slice(0, 15).map((h, idx) => (
                      <div key={idx} className="text-slate-300 truncate">
                        <span
                          className={`font-bold mr-2 ${
                            h.tag === 'h1' ? 'text-[#E6A05A]' : h.tag === 'h2' ? 'text-blue-400' : 'text-slate-500'
                          }`}
                        >
                          &lt;{h.tag}&gt;
                        </span>
                        <span>{h.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Images & Alt attributes */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Image SEO & Alt Coverage</span>
              <span className="font-mono text-xs text-slate-400">
                {onPage.images.altCoveragePercent}% coverage
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">Total Images</span>
                <span className="font-mono text-base font-bold text-white">{onPage.images.totalImages}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">Descriptive Alt</span>
                <span className="font-mono text-base font-bold text-emerald-400">{onPage.images.imagesWithAlt}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">Decorative (alt="")</span>
                <span className="font-mono text-base font-bold text-slate-300">{onPage.images.decorativeImages}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">Missing Alt</span>
                <span className="font-mono text-base font-bold text-rose-400">{onPage.images.missingAlt}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">Width/Height Set</span>
                <span className="font-mono text-base font-bold text-blue-400">{onPage.images.imagesWithDimensions}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                <span className="text-slate-500 block mb-1">Lazy Loaded</span>
                <span className="font-mono text-base font-bold text-[#E6A05A]">{onPage.images.lazyLoadedImages}</span>
              </div>
            </div>

            <div className="w-full bg-slate-800 rounded-full h-2">
              <div
                className="bg-emerald-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, onPage.images.altCoveragePercent)}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              Note: Decorative images with intentional empty alt attributes (alt="") are considered valid accessible markup for screen readers.
            </p>
          </div>

          {/* Links & Internationalization */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Links */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Page Link Architecture</span>
                <span className="font-mono text-xs text-slate-400">{onPage.links.totalLinks} links total</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Internal</span>
                  <span className="font-mono text-sm font-bold text-white">{onPage.links.internalLinks}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">External</span>
                  <span className="font-mono text-sm font-bold text-white">{onPage.links.externalLinks}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-500 block text-[11px]">Empty / Fragment</span>
                  <span className="font-mono text-sm font-bold text-amber-400">
                    {onPage.links.emptyHrefCount + onPage.links.fragmentOnlyCount}
                  </span>
                </div>
              </div>

              {onPage.links.issues.length > 0 && (
                <div className="space-y-1 text-[11px] text-slate-300">
                  {onPage.links.issues.map((issue, idx) => (
                    <div key={idx} className="flex items-start gap-1">
                      <span className="text-amber-400">•</span>
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Language & Hreflang */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Internationalization & Lang</span>
                {getSeverityBadge(onPage.internationalization.htmlLang.isValidCode ? 'good' : 'warning')}
              </div>

              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                  <span className="text-slate-400">HTML lang attribute:</span>
                  <span className="font-mono font-semibold text-white">
                    {onPage.internationalization.htmlLang.value || <span className="text-amber-400">Missing</span>}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex justify-between items-center">
                  <span className="text-slate-400">hreflang Alternate Tags:</span>
                  <span className="font-mono font-semibold text-white">
                    {onPage.internationalization.hreflangCount} declared
                  </span>
                </div>

                {onPage.internationalization.languages.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]">
                    <span className="text-slate-400 block mb-1">Declared Locales:</span>
                    <span className="font-mono text-[#E6A05A]">
                      {onPage.internationalization.languages.join(', ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. SOCIAL (OPEN GRAPH & TWITTER) TAB */}
      {activeSubTab === 'social' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs text-blue-300 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <p>
              Open Graph and Twitter Cards enhance link previews when shared on Facebook, LinkedIn, Slack, WhatsApp, and X/Twitter. They do not directly alter organic Google search rankings, but drive click-through rates and brand perception.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Open Graph Column */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-[#E6A05A]" />
                  <span>Open Graph Protocol</span>
                </h4>
                {getSeverityBadge(social.openGraph.present ? 'good' : 'warning')}
              </div>

              {/* Live Preview Mockup */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <span className="text-[10px] uppercase font-mono text-slate-500">Facebook / LinkedIn Share Preview</span>
                <div className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden shadow-lg">
                  {social.openGraph.image.value && social.openGraph.image.isValidUrl ? (
                    <div className="w-full h-44 bg-slate-950 flex items-center justify-center overflow-hidden border-b border-slate-800">
                      <img
                        src={social.openGraph.image.value}
                        alt="OG Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-full h-28 bg-slate-950 flex items-center justify-center text-xs text-slate-600 border-b border-slate-800">
                      No og:image specified
                    </div>
                  )}
                  <div className="p-3 space-y-1">
                    <span className="text-[10px] uppercase text-slate-400 font-mono block">
                      {social.openGraph.siteName.value || scanResult?.domain || 'Website'}
                    </span>
                    <h5 className="text-sm font-bold text-white line-clamp-1">
                      {social.openGraph.title.value || onPage.title.value || 'No Title Available'}
                    </h5>
                    <p className="text-xs text-slate-400 line-clamp-2">
                      {social.openGraph.description.value || onPage.description.value || 'No social description available.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tag Checklist */}
              <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">og:title</span>
                  <span className={`font-semibold ${social.openGraph.title.present ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {social.openGraph.title.present ? 'Present' : 'Missing'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">og:description</span>
                  <span className={`font-semibold ${social.openGraph.description.present ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {social.openGraph.description.present ? 'Present' : 'Missing'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">og:image</span>
                  <span className={`font-semibold ${social.openGraph.image.present ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {social.openGraph.image.present ? 'Present' : 'Missing'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">og:url</span>
                  <span className={`font-semibold ${social.openGraph.url.present ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {social.openGraph.url.present ? 'Present' : 'Optional'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">og:type</span>
                  <span className="font-semibold text-slate-300">
                    {social.openGraph.type.value || 'website'}
                  </span>
                </div>
              </div>
            </div>

            {/* Twitter Cards Column */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Share2 className="h-4 w-4 text-blue-400" />
                  <span>Twitter (X) Cards</span>
                </h4>
                {getSeverityBadge(social.twitter.present ? 'good' : 'warning')}
              </div>

              {/* Twitter Card Mockup */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <span className="text-[10px] uppercase font-mono text-slate-500">X (Twitter) Card Mockup</span>
                <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-lg">
                  {social.twitter.image.value && social.twitter.image.isValidUrl ? (
                    <div className="w-full h-40 bg-slate-950 flex items-center justify-center overflow-hidden border-b border-slate-800">
                      <img
                        src={social.twitter.image.value}
                        alt="Twitter Card"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                  ) : (
                    <div className="w-full h-24 bg-slate-950 flex items-center justify-center text-xs text-slate-600 border-b border-slate-800">
                      No twitter:image specified
                    </div>
                  )}
                  <div className="p-3 space-y-1">
                    <span className="text-[10px] text-slate-400 font-mono block">
                      Card Type: {social.twitter.card.value || 'summary'}
                    </span>
                    <h5 className="text-sm font-bold text-white line-clamp-1">
                      {social.twitter.title.value || onPage.title.value || 'Twitter Title'}
                    </h5>
                    <p className="text-xs text-slate-400 line-clamp-2">
                      {social.twitter.description.value || onPage.description.value || 'No Twitter description specified.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Twitter Checklist */}
              <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">twitter:card</span>
                  <span className={`font-semibold ${social.twitter.card.present ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {social.twitter.card.value || 'Missing'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">twitter:title</span>
                  <span className={`font-semibold ${social.twitter.title.present ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {social.twitter.title.present ? 'Present' : 'Missing'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">twitter:description</span>
                  <span className={`font-semibold ${social.twitter.description.present ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {social.twitter.description.present ? 'Present' : 'Missing'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-slate-900 border border-slate-800">
                  <span className="font-mono text-slate-300">twitter:site / :creator</span>
                  <span className="font-semibold text-slate-300">
                    {social.twitter.site.value || social.twitter.creator.value || 'Not configured'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. STRUCTURED DATA (JSON-LD) TAB */}
      {activeSubTab === 'schema' && (
        <div className="space-y-6">
          {/* Prominent Disclaimer */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-white mb-0.5">Basic JSON-LD & Schema.org Structural Validation</p>
              <p>{structuredData.disclaimer}</p>
            </div>
          </div>

          {/* Structured Data Summary Banner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 text-xs space-y-1">
              <span className="text-slate-500 block">Detected Blocks</span>
              <span className="text-xl font-bold font-mono text-white">
                {structuredData.blocksCount} JSON-LD tag(s)
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 text-xs space-y-1">
              <span className="text-slate-500 block">Schema.org Types</span>
              <span className="text-xl font-bold font-mono text-[#E6A05A]">
                {structuredData.schemasFound.length > 0 ? structuredData.schemasFound.join(', ') : 'None'}
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 text-xs space-y-1">
              <span className="text-slate-500 block">Structural Status</span>
              <span
                className={`text-xl font-bold font-mono uppercase ${
                  structuredData.validationStatus === 'valid'
                    ? 'text-emerald-400'
                    : structuredData.validationStatus === 'invalid'
                    ? 'text-rose-400'
                    : 'text-slate-400'
                }`}
              >
                {structuredData.validationStatus}
              </span>
            </div>
          </div>

          {/* Blocks List */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Discovered JSON-LD Scripts ({structuredData.items.length})
            </h4>

            {structuredData.items.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-8 text-center text-xs text-slate-400">
                No &lt;script type="application/ld+json"&gt; blocks were detected on this page.
              </div>
            ) : (
              structuredData.items.map((item, idx) => {
                const isExpanded = expandedJsonLd === idx;
                return (
                  <div key={idx} className="rounded-xl border border-slate-800 bg-[#0F172A] overflow-hidden">
                    <div
                      onClick={() => setExpandedJsonLd(isExpanded ? null : idx)}
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Code2 className="h-4 w-4 text-[#E6A05A]" />
                        <div>
                          <span className="text-xs font-semibold text-white block">
                            Block #{idx + 1} — Type:{' '}
                            <span className="font-mono text-[#E6A05A]">
                              {Array.isArray(item.type) ? item.type.join(', ') : item.type || (item.isGraph ? '@graph' : 'Unknown')}
                            </span>
                          </span>
                          <span className="text-[11px] text-slate-400">
                            Context: {item.context || 'None'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                            item.validJson && (!item.validationErrors || item.validationErrors.length === 0)
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {item.validJson ? 'Valid JSON' : 'Syntax Error'}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="p-4 border-t border-slate-800 bg-slate-950 space-y-3">
                        {item.validationErrors && item.validationErrors.length > 0 && (
                          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 space-y-1">
                            <span className="font-semibold block">Validation Warnings:</span>
                            {item.validationErrors.map((err, eIdx) => (
                              <div key={eIdx}>• {err}</div>
                            ))}
                          </div>
                        )}

                        <div className="relative">
                          <button
                            onClick={() => handleCopy(item.rawPreview || '', idx)}
                            className="absolute top-2 right-2 px-2 py-1 rounded bg-slate-800 text-[10px] text-slate-300 hover:text-white flex items-center gap-1 border border-slate-700"
                          >
                            {copiedCodeIndex === idx ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-400" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>Copy JSON</span>
                              </>
                            )}
                          </button>
                          <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-60">
                            {item.rawPreview}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 5. CRAWLABILITY & INDEXABILITY TAB */}
      {activeSubTab === 'crawlability' && (
        <div className="space-y-6">
          {/* Indexability Master Decision */}
          <div
            className={`rounded-xl border p-6 space-y-3 ${
              indexability.status === 'indexable'
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : indexability.status === 'blocked'
                ? 'border-rose-500/30 bg-rose-500/5'
                : 'border-amber-500/30 bg-amber-500/5'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-white" />
                <h4 className="text-base font-bold text-white">Unified Indexability Assessment</h4>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-mono font-bold uppercase ${
                  indexability.status === 'indexable'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : indexability.status === 'blocked'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}
              >
                STATUS: {indexability.status}
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {indexability.technicalExplanation}
            </p>

            <div className="space-y-1.5 pt-2">
              <span className="text-[11px] uppercase font-mono font-semibold text-slate-400 block">
                Technical Reasoning:
              </span>
              {indexability.reasons.map((reason, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-white">
                  <span className="text-[#E6A05A] font-bold">•</span>
                  <span>{reason}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Robots Tags & Headers Analysis Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* HTML Robots Meta */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">&lt;meta name="robots"&gt;</span>
                <span className={`font-mono ${crawlability.robotsMeta.exists ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {crawlability.robotsMeta.exists ? 'FOUND' : 'DEFAULT'}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300 min-h-12">
                {crawlability.robotsMeta.directives.length > 0
                  ? crawlability.robotsMeta.directives.join(', ')
                  : 'Implicit (index, follow)'}
              </div>
            </div>

            {/* Googlebot Meta */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">&lt;meta name="googlebot"&gt;</span>
                <span className={`font-mono ${crawlability.googlebotMeta.exists ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {crawlability.googlebotMeta.exists ? 'FOUND' : 'NONE'}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300 min-h-12">
                {crawlability.googlebotMeta.directives.length > 0
                  ? crawlability.googlebotMeta.directives.join(', ')
                  : 'Follows standard robots'}
              </div>
            </div>

            {/* X-Robots-Tag HTTP Header */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">HTTP X-Robots-Tag</span>
                <span className={`font-mono ${crawlability.xRobotsTag.exists ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {crawlability.xRobotsTag.exists ? 'SENT' : 'NOT SENT'}
                </span>
              </div>
              <div className="p-2.5 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300 min-h-12">
                {crawlability.xRobotsTag.directives.length > 0
                  ? crawlability.xRobotsTag.directives.join(', ')
                  : 'No HTTP header directives'}
              </div>
            </div>
          </div>

          {/* Robots.txt and Sitemap In-Depth Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Robots.txt */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">robots.txt Directives</span>
                <span className={`font-mono text-xs ${crawlability.robotsTxt.exists ? 'text-emerald-400' : 'text-amber-400'}`}>
                  HTTP {crawlability.robotsTxt.httpStatus || 404}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">User-Agent Groups:</span>
                  <span className="font-mono text-white">{crawlability.robotsTxt.userAgentGroupsCount}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Disallow Rules:</span>
                  <span className="font-mono text-white">{crawlability.robotsTxt.disallowRulesCount}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Allow Rules:</span>
                  <span className="font-mono text-white">{crawlability.robotsTxt.allowRulesCount}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Contains "Disallow: /":</span>
                  <span className={`font-mono font-semibold ${crawlability.robotsTxt.hasDisallowAll ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {crawlability.robotsTxt.hasDisallowAll ? 'YES (All crawlers blocked)' : 'NO'}
                  </span>
                </div>
              </div>

              {crawlability.robotsTxt.sitemapsDeclared.length > 0 && (
                <div className="pt-2 text-xs">
                  <span className="text-slate-400 block mb-1">Declared Sitemaps:</span>
                  {crawlability.robotsTxt.sitemapsDeclared.map((s, idx) => (
                    <div key={idx} className="p-2 rounded bg-slate-900 border border-slate-800 font-mono text-[11px] text-[#E6A05A] break-all">
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Sitemap */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">XML Sitemap Analysis</span>
                <span className={`font-mono text-xs ${crawlability.sitemap.exists ? 'text-emerald-400' : 'text-slate-400'}`}>
                  HTTP {crawlability.sitemap.httpStatus || 404}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Sitemap URL:</span>
                  <span className="font-mono text-white truncate max-w-[200px]" title={crawlability.sitemap.url}>
                    {crawlability.sitemap.url || '/sitemap.xml'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Format & Validity:</span>
                  <span className={`font-mono ${crawlability.sitemap.validXml ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {crawlability.sitemap.validXml ? (crawlability.sitemap.isSitemapIndex ? 'Valid Sitemap Index' : 'Valid URL Set') : 'Invalid / Missing'}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800">
                  <span className="text-slate-400">Discovered URLs count:</span>
                  <span className="font-mono text-white">
                    {crawlability.sitemap.urlCount !== undefined ? crawlability.sitemap.urlCount : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">lastmod attributes:</span>
                  <span className="font-mono text-white">
                    {crawlability.sitemap.lastModifiedDatesCount !== undefined ? `${crawlability.sitemap.lastModifiedDatesCount} items` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. TECHNICAL SEO TAB */}
      {activeSubTab === 'technical' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* HTTPS Card */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-2">
              <span className="text-slate-400 font-semibold block">HTTPS & SSL/TLS</span>
              <div className="flex items-center justify-between">
                <span className="text-white">Encrypted Transport</span>
                <span className={`font-mono font-bold ${technical.https.enabled ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {technical.https.enabled ? 'ACTIVE' : 'INSECURE'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Protocol: {technical.https.protocol || 'TLS 1.3'}. Search engines prefer secure HTTPS connections for indexation and user trust.
              </p>
            </div>

            {/* Mobile Viewport */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-2">
              <span className="text-slate-400 font-semibold block">Mobile Viewport Tag</span>
              <div className="flex items-center justify-between">
                <span className="text-white">Responsive Config</span>
                <span className={`font-mono font-bold ${technical.mobileViewport.configured ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {technical.mobileViewport.configured ? 'CONFIGURED' : 'MISSING'}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-300 truncate">
                {technical.mobileViewport.value || '<meta name="viewport"> not found'}
              </p>
            </div>

            {/* Redirects */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-2">
              <span className="text-slate-400 font-semibold block">Redirect Handling</span>
              <div className="flex items-center justify-between">
                <span className="text-white">Hops & Status</span>
                <span className="font-mono font-bold text-white">
                  {technical.redirects.hasRedirect ? `HTTP ${technical.redirects.status} Redirect` : 'Direct 200'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                Final: {technical.redirects.finalUrl}
              </p>
            </div>

            {/* HTTP Compression */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-2">
              <span className="text-slate-400 font-semibold block">HTTP Compression</span>
              <div className="flex items-center justify-between">
                <span className="text-white">Content-Encoding</span>
                <span className={`font-mono font-bold ${technical.compression.enabled ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {technical.compression.encoding || 'NONE'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Brotli and Gzip compress transfer payload for rapid crawler parsing.
              </p>
            </div>

            {/* Caching Headers */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-2">
              <span className="text-slate-400 font-semibold block">HTTP Caching Headers</span>
              <div className="flex items-center justify-between">
                <span className="text-white">Cache-Control / ETag</span>
                <span className={`font-mono font-bold ${technical.caching.hasCacheHeaders ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {technical.caching.hasCacheHeaders ? 'DECLARED' : 'DEFAULT'}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 truncate">
                {technical.caching.cacheControl || 'No Cache-Control header'}
              </p>
            </div>

            {/* Content Type */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-2">
              <span className="text-slate-400 font-semibold block">Content Type & Status</span>
              <div className="flex items-center justify-between">
                <span className="text-white">HTTP Status</span>
                <span className="font-mono font-bold text-emerald-400">
                  {technical.httpStatus} {technical.httpStatusText}
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 truncate">
                {technical.contentType || 'text/html'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 7. ALL RULES & ISSUES TAB */}
      {activeSubTab === 'issues' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-xl border border-slate-800 bg-[#0F172A]">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 mr-2">Severity:</span>
              <button
                onClick={() => setIssuesFilter('all')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  issuesFilter === 'all' ? 'bg-[#E6A05A] text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300'
                }`}
              >
                All ({issues.length})
              </button>
              <button
                onClick={() => setIssuesFilter('critical')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  issuesFilter === 'critical' ? 'bg-rose-500 text-white font-semibold' : 'bg-slate-800 text-slate-300'
                }`}
              >
                Critical ({overview.criticalCount})
              </button>
              <button
                onClick={() => setIssuesFilter('warning')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  issuesFilter === 'warning' ? 'bg-amber-500 text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300'
                }`}
              >
                Warnings ({overview.warningCount})
              </button>
              <button
                onClick={() => setIssuesFilter('passed')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  issuesFilter === 'passed' ? 'bg-emerald-500 text-slate-950 font-semibold' : 'bg-slate-800 text-slate-300'
                }`}
              >
                Passed ({overview.passedCount})
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Category:</span>
              <select
                value={issuesCategoryFilter}
                onChange={(e) => setIssuesCategoryFilter(e.target.value)}
                className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs text-white"
              >
                <option value="all">All Categories</option>
                <option value="technical">Technical SEO</option>
                <option value="onPage">On-Page SEO</option>
                <option value="social">Social SEO</option>
                <option value="structuredData">Structured Data</option>
                <option value="crawlability">Crawlability</option>
                <option value="indexability">Indexability</option>
              </select>
            </div>
          </div>

          {/* Issue Cards */}
          <div className="space-y-3">
            {filteredIssues.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 rounded-xl border border-slate-800 bg-[#0F172A]">
                No SEO checks match the selected filter criteria.
              </div>
            ) : (
              filteredIssues.map((rule) => (
                <div
                  key={rule.id}
                  className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      {getSeverityBadge(rule.severity, rule.passed)}
                      <span className="font-mono text-[11px] text-slate-400 uppercase tracking-wider">
                        {rule.category}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">{rule.id}</span>
                  </div>

                  <p className="text-sm font-semibold text-white">{rule.message}</p>

                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 flex items-start gap-2">
                    <span className="text-[#E6A05A] font-semibold">Recommendation:</span>
                    <span>{rule.recommendation}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
