import React, { useState, useRef } from 'react';
import {
  Gauge,
  Smartphone,
  Monitor,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileCode,
} from 'lucide-react';
import type {
  CombinedPageSpeedResult,
  PageSpeedDeviceData,
  CoreWebVitalMetric,
  PageSpeedMetricStatus,
} from '../types.ts';
import { apiClient } from '../api/client.ts';

interface PageSpeedSectionProps {
  websiteId?: string;
  url: string;
  initialData?: CombinedPageSpeedResult | null;
  onDataUpdated?: (newData: CombinedPageSpeedResult) => void;
}

export const PageSpeedSection: React.FC<PageSpeedSectionProps> = ({
  websiteId,
  url,
  initialData,
  onDataUpdated,
}) => {
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const hasInitialDeviceData = Boolean(initialData && (initialData.mobile || initialData.desktop));
  const [data, setData] = useState<CombinedPageSpeedResult | null>(hasInitialDeviceData ? initialData! : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    initialData && !initialData.mobile && !initialData.desktop && initialData.error
      ? initialData.error
      : null
  );
  const [expandedOpportunity, setExpandedOpportunity] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Sync state if parent props change with valid device data
  React.useEffect(() => {
    if (initialData && (initialData.mobile || initialData.desktop)) {
      setData((prev) => ({
        ...initialData,
        mobile: initialData.mobile ?? prev?.mobile ?? null,
        desktop: initialData.desktop ?? prev?.desktop ?? null,
      }));
      if (!initialData.error) {
        setError(null);
      }
    }
  }, [initialData]);

  // If no valid initial data (or previous scan stored in DB had mobile:null & desktop:null), auto-trigger live analysis smoothly
  React.useEffect(() => {
    const valid = Boolean(initialData && (initialData.mobile || initialData.desktop));
    if (!valid && url && !inFlightRef.current) {
      handleRunAnalysis(false, 'both');
    }
  }, [url]);

  const currentDeviceData: PageSpeedDeviceData | null =
    device === 'mobile' ? data?.mobile || null : data?.desktop || null;

  const handleRunAnalysis = async (
    forceRefresh = false,
    strategy: 'mobile' | 'desktop' | 'both' = 'both'
  ) => {
    if (!url || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const result = await apiClient.getPageSpeedAnalysis(url, forceRefresh, {
        websiteId,
        strategy,
      });

      const merged: CombinedPageSpeedResult = {
        ...result,
        mobile: result.mobile ?? data?.mobile ?? null,
        desktop: result.desktop ?? data?.desktop ?? null,
      };

      setData(merged);

      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
      }

      if (onDataUpdated) {
        onDataUpdated(merged);
      }
    } catch (err: any) {
      setError(err.message || 'PageSpeed analysis is temporarily unavailable.');
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  const getScoreColor = (score: number | null) => {
    if (score === null) return 'text-slate-400 border-slate-700 bg-slate-800/40';
    if (score >= 90) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    if (score >= 50) return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
    return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
  };

  const getScoreRating = (score: number | null) => {
    if (score === null) return 'N/A';
    if (score >= 90) return 'Good (90-100)';
    if (score >= 50) return 'Needs Improvement (50-89)';
    return 'Poor (0-49)';
  };

  const getStatusBadge = (status: PageSpeedMetricStatus) => {
    switch (status) {
      case 'good':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3" /> Good
          </span>
        );
      case 'needs-improvement':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
            <AlertTriangle className="h-3 w-3" /> Needs Improvement
          </span>
        );
      case 'poor':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
            <XCircle className="h-3 w-3" /> Poor
          </span>
        );
      default:
        return null;
    }
  };

  const renderMetricCard = (
    label: string,
    fullName: string,
    metric: CoreWebVitalMetric | null,
    targetInfo: string
  ) => {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-white tracking-wide uppercase font-mono">
              {label}
            </span>
            <div className="text-[11px] text-slate-400 truncate max-w-[140px]" title={fullName}>
              {fullName}
            </div>
          </div>
          {metric ? getStatusBadge(metric.status) : (
            <span className="text-[10px] text-slate-500 italic">Not available</span>
          )}
        </div>

        <div className="pt-1 flex items-baseline gap-1.5">
          {metric ? (
            <>
              <span className="text-2xl font-black font-mono text-white tabular-nums">
                {metric.value}
              </span>
              {metric.unit && (
                <span className="text-xs font-semibold text-slate-400">
                  {metric.unit}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm font-mono text-slate-500">Unavailable</span>
          )}
        </div>

        <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-500">
          Target: {targetInfo}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
            <Gauge className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-tight">
                Google PageSpeed Insights
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Lighthouse V5 API
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-world Core Web Vitals & automated browser performance auditing directly from Google.
            </p>
          </div>
        </div>

        {/* Device Switcher & Refresh */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-slate-900 border border-slate-800 p-0.5">
            <button
              onClick={() => setDevice('mobile')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                device === 'mobile'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span>Mobile</span>
            </button>
            <button
              onClick={() => setDevice('desktop')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                device === 'desktop'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              <span>Desktop</span>
            </button>
          </div>

          <button
            onClick={() => handleRunAnalysis(true, 'both')}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors disabled:opacity-50"
            title="Force re-run analysis from Google"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-[#E6A05A]' : ''}`} />
            <span>{loading ? 'Analyzing...' : 'Re-Analyze'}</span>
          </button>
        </div>
      </div>

      {/* Loading state banner */}
      {loading && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-between text-xs text-blue-300">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-4 w-4 animate-spin text-[#E6A05A] shrink-0" />
            <div>
              <span className="font-semibold text-white">Analyzing website with Google PageSpeed...</span>
              <p className="text-[11px] text-blue-300/80">Executing mobile and desktop Lighthouse profiling via Google Cloud nodes.</p>
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">Takes ~10-30 seconds</span>
        </div>
      )}

      {/* Error state (shown both when no data exists and when Re-Analyze fails while preserving previous data) */}
      {error && !loading && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-4 text-xs text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <span>{error}</span>
              {currentDeviceData && (
                <p className="text-[11px] text-rose-300/75 mt-0.5">
                  Showing your most recent successful PageSpeed report below.
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => handleRunAnalysis(true, device)}
            className="underline font-semibold hover:text-white shrink-0"
          >
            Retry Analysis
          </button>
        </div>
      )}

      {/* Device-specific unavailable state when partial data loaded */}
      {!loading && !currentDeviceData && !error && data && (
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/50 text-center space-y-3">
          <AlertTriangle className="h-6 w-6 text-amber-400 mx-auto" />
          <h3 className="text-sm font-semibold text-white">
            {device === 'desktop' ? 'Desktop' : 'Mobile'} Analysis Unavailable
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {data.error || `Lighthouse was unable to complete the ${device} audit for this website.`}
          </p>
          <button
            onClick={() => handleRunAnalysis(true, device)}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-white border border-slate-700 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry {device === 'desktop' ? 'Desktop' : 'Mobile'} Analysis
          </button>
        </div>
      )}

      {/* Empty / Unanalyzed state */}
      {!loading && !currentDeviceData && !error && !data && (
        <div className="p-8 rounded-xl border border-dashed border-slate-800 text-center space-y-3">
          <Gauge className="h-8 w-8 text-slate-600 mx-auto" />
          <h3 className="text-sm font-semibold text-white">Google PageSpeed Data Available On-Demand</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Benchmark Core Web Vitals (LCP, INP, CLS, FCP, TTFB) and Lighthouse performance scores for this domain.
          </p>
          <button
            onClick={() => handleRunAnalysis(false, 'both')}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-semibold hover:bg-[#cf863c] transition-colors"
          >
            <Zap className="h-3.5 w-3.5" />
            Analyze with Google PageSpeed
          </button>
        </div>
      )}

      {/* Analyzed Device Content */}
      {currentDeviceData && (
        <div className="space-y-6">
          {data?.error && !error && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 text-xs text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>Notice: {data.error}</span>
            </div>
          )}
          {/* Lighthouse Category Scores */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                {device === 'mobile' ? <Smartphone className="h-3.5 w-3.5 text-[#E6A05A]" /> : <Monitor className="h-3.5 w-3.5 text-[#E6A05A]" />}
                Lighthouse Scores ({device.toUpperCase()})
              </span>
              <span className="text-[11px] text-slate-500">
                Scanned {new Date(currentDeviceData.scannedAt).toLocaleTimeString()}
              </span>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Performance (Prominent) */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between ${getScoreColor(currentDeviceData.scores.performance)}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider">Performance</span>
                  <Zap className="h-4 w-4" />
                </div>
                <div className="my-3">
                  <span className="text-3xl sm:text-4xl font-black font-mono tabular-nums leading-none">
                    {currentDeviceData.scores.performance !== null ? currentDeviceData.scores.performance : '—'}
                  </span>
                  <span className="text-xs opacity-70 ml-1">/ 100</span>
                </div>
                <span className="text-[11px] font-medium opacity-90">
                  {getScoreRating(currentDeviceData.scores.performance)}
                </span>
              </div>

              {/* Accessibility */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between ${getScoreColor(currentDeviceData.scores.accessibility)}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider">Accessibility</span>
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="my-3">
                  <span className="text-3xl sm:text-4xl font-black font-mono tabular-nums leading-none">
                    {currentDeviceData.scores.accessibility !== null ? currentDeviceData.scores.accessibility : '—'}
                  </span>
                  <span className="text-xs opacity-70 ml-1">/ 100</span>
                </div>
                <span className="text-[11px] font-medium opacity-90">
                  {getScoreRating(currentDeviceData.scores.accessibility)}
                </span>
              </div>

              {/* Best Practices */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between ${getScoreColor(currentDeviceData.scores.bestPractices)}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider">Best Practices</span>
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="my-3">
                  <span className="text-3xl sm:text-4xl font-black font-mono tabular-nums leading-none">
                    {currentDeviceData.scores.bestPractices !== null ? currentDeviceData.scores.bestPractices : '—'}
                  </span>
                  <span className="text-xs opacity-70 ml-1">/ 100</span>
                </div>
                <span className="text-[11px] font-medium opacity-90">
                  {getScoreRating(currentDeviceData.scores.bestPractices)}
                </span>
              </div>

              {/* SEO */}
              <div className={`p-4 rounded-xl border flex flex-col justify-between ${getScoreColor(currentDeviceData.scores.seo)}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider">SEO</span>
                  <FileCode className="h-4 w-4" />
                </div>
                <div className="my-3">
                  <span className="text-3xl sm:text-4xl font-black font-mono tabular-nums leading-none">
                    {currentDeviceData.scores.seo !== null ? currentDeviceData.scores.seo : '—'}
                  </span>
                  <span className="text-xs opacity-70 ml-1">/ 100</span>
                </div>
                <span className="text-[11px] font-medium opacity-90">
                  {getScoreRating(currentDeviceData.scores.seo)}
                </span>
              </div>
            </div>
          </div>

          {/* Core Web Vitals */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Core Web Vitals & Speed Metrics
              </span>
              <span className="text-[11px] text-slate-500">
                Real Chrome UX & Lighthouse lab measurements
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {renderMetricCard('LCP', 'Largest Contentful Paint', currentDeviceData.metrics.lcp, '≤ 2.5s')}
              {renderMetricCard('INP', 'Interaction to Next Paint', currentDeviceData.metrics.inp, '≤ 200ms')}
              {renderMetricCard('CLS', 'Cumulative Layout Shift', currentDeviceData.metrics.cls, '≤ 0.1')}
              {renderMetricCard('FCP', 'First Contentful Paint', currentDeviceData.metrics.fcp, '≤ 1.8s')}
              {renderMetricCard('TTFB', 'Time to First Byte', currentDeviceData.metrics.ttfb, '≤ 0.8s')}
            </div>
          </div>

          {/* Opportunities & Diagnostics */}
          {currentDeviceData.opportunities && currentDeviceData.opportunities.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Opportunities & Diagnostics ({currentDeviceData.opportunities.length})
                </span>
                <span className="text-[11px] text-slate-500">
                  Calculated by Lighthouse audit engine
                </span>
              </div>

              <div className="space-y-2">
                {currentDeviceData.opportunities.map((opp) => {
                  const isExpanded = expandedOpportunity === opp.id;

                  return (
                    <div
                      key={opp.id}
                      className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 transition-colors hover:border-slate-700"
                    >
                      <div
                        onClick={() => setExpandedOpportunity(isExpanded ? null : opp.id)}
                        className="flex items-start justify-between gap-3 cursor-pointer"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-white">
                              {opp.title}
                            </span>
                            {opp.score !== null && opp.score !== undefined && (
                              <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-medium ${
                                opp.score >= 90 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                              }`}>
                                Score {opp.score}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 line-clamp-1">
                            {opp.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {opp.estimatedSavingsMs && (
                            <span className="text-[11px] font-mono text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded">
                              Save ~{(opp.estimatedSavingsMs / 1000).toFixed(2)}s
                            </span>
                          )}
                          {opp.displayValue && !opp.estimatedSavingsMs && (
                            <span className="text-[11px] font-mono text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded">
                              {opp.displayValue}
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-300 space-y-2">
                          <p>{opp.description}</p>
                          {opp.estimatedSavingsBytes && (
                            <div className="text-[11px] text-slate-400 font-mono">
                              Estimated payload reduction: ~{Math.round(opp.estimatedSavingsBytes / 1024)} KB
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
