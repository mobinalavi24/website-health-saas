import React, { useState } from 'react';
import { Search, Loader2, ArrowRight, ShieldAlert, Sparkles, CheckCircle2 } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { ScanResult } from '../types.ts';
import { ScanReportView } from './ScanReportView.tsx';

interface PublicScannerProps {
  onMonitorNow?: (url: string) => void;
  initialUrl?: string;
}

export const PublicScanner: React.FC<PublicScannerProps> = ({
  onMonitorNow,
  initialUrl = '',
}) => {
  const [url, setUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(false);
  const [scanStep, setScanStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  const sampleUrls = ['github.com', 'cloudflare.com', 'wikipedia.org', 'mozilla.org'];

  const handleScan = async (targetUrl?: string) => {
    const toScan = (targetUrl || url).trim();
    if (!toScan) {
      setError('Please enter a website URL.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    // Simulated progress steps during real API execution
    setScanStep('Verifying domain & SSRF safety rules...');
    const stepTimer1 = setTimeout(() => setScanStep('Resolving public DNS (A, MX, TXT)...'), 600);
    const stepTimer2 = setTimeout(() => setScanStep('Connecting to port 443 & verifying SSL/TLS...'), 1400);
    const stepTimer3 = setTimeout(() => setScanStep('Analyzing HTTP response time, headers & SEO...'), 2200);

    try {
      const scanData = await apiClient.scanWebsite(toScan);
      setResult(scanData);
      setUrl(scanData.domain);
    } catch (err: any) {
      setError(err.message || 'Scan failed. Please verify the URL.');
    } finally {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      setLoading(false);
      setScanStep('');
    }
  };

  return (
    <div className="w-full space-y-8">
      {/* Scanner Input Bar */}
      <div className="mx-auto max-w-3xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleScan();
          }}
          className="relative flex flex-col sm:flex-row items-stretch gap-2 p-2 rounded-2xl bg-slate-900/90 border border-slate-700/80 shadow-2xl focus-within:border-[#E6A05A] transition-all"
        >
          <div className="relative flex-1 flex items-center pl-3">
            <Search className="h-5 w-5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter domain or URL (e.g. yourcompany.com)"
              disabled={loading}
              className="w-full bg-transparent px-3 py-2.5 text-sm sm:text-base text-white placeholder-slate-500 focus:outline-none font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#E6A05A] text-[#0B1120] font-semibold text-sm hover:bg-[#cf863c] transition-all disabled:opacity-60 whitespace-nowrap cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Auditing...</span>
              </>
            ) : (
              <>
                <span>Check My Website — Free</span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick Sample suggestions */}
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-400 flex-wrap">
          <span className="text-slate-500">Quick tests:</span>
          {sampleUrls.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => {
                setUrl(sample);
                handleScan(sample);
              }}
              className="text-slate-400 hover:text-[#E6A05A] underline decoration-slate-700 hover:decoration-[#E6A05A] transition-colors"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {/* Progress Feedback during active scanning */}
      {loading && (
        <div className="mx-auto max-w-xl p-6 rounded-xl border border-slate-800 bg-[#0F172A] text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-[#E6A05A]" />
            <span className="text-sm font-medium text-white">{scanStep}</span>
          </div>
          <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-[#E6A05A] animate-pulse w-3/4" />
          </div>
          <p className="text-xs text-slate-400">
            Running real DNS queries, TLS socket handshakes, and response time checks. No simulated data.
          </p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="mx-auto max-w-2xl p-4 rounded-xl border border-rose-900/60 bg-rose-950/20 text-xs text-rose-300 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block mb-0.5">Audit Request Blocked or Failed</span>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Scan Results view */}
      {result && !loading && (
        <div className="pt-4">
          <ScanReportView
            report={result}
            onReScan={() => handleScan(result.url)}
            onMonitorNow={onMonitorNow}
          />
        </div>
      )}
    </div>
  );
};
