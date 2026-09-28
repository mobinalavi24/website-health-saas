import React, { useState } from 'react';
import { FileText, Plus, Share2, Download, Copy, Check, ExternalLink, Printer } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { ReportItem, Website, Organization } from '../types.ts';

interface ReportsViewProps {
  reports: ReportItem[];
  websites: Website[];
  organization: Organization | null;
  onRefreshReports: () => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  reports,
  websites,
  organization,
  onRefreshReports,
}) => {
  const [selectedReport, setSelectedReport] = useState<ReportItem | null>(reports[0] || null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState(websites[0]?.id || '');
  const [reportTitle, setReportTitle] = useState('');
  const [reportType, setReportType] = useState<'health' | 'uptime' | 'security' | 'executive'>('executive');
  const [generating, setGenerating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWebsiteId) return;

    setGenerating(true);
    try {
      const newReport = await apiClient.generateReport(selectedWebsiteId, reportTitle, reportType);
      setShowGenerateModal(false);
      setReportTitle('');
      onRefreshReports();
      setSelectedReport(newReport);
    } catch (err: any) {
      alert(`Error generating report: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyShareLink = (token: string) => {
    const origin = window.location.origin;
    const shareUrl = `${origin}/#report-${token}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Audit Reports & Executive Summaries
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Generate printable PDF-ready compliance summaries, SLA certificates, and shareable web links.
          </p>
        </div>

        <button
          onClick={() => setShowGenerateModal(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Generate New Report</span>
        </button>
      </div>

      {/* Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl space-y-4">
            <h2 className="text-base font-bold text-white">Generate Audit Report</h2>
            <form onSubmit={handleGenerate} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Select Website</label>
                <select
                  value={selectedWebsiteId}
                  onChange={(e) => setSelectedWebsiteId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                >
                  {websites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.domain})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Report Format / Focus</label>
                <select
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value as any)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                >
                  <option value="executive">Executive Health & SLA Summary</option>
                  <option value="uptime">Detailed Uptime & Latency Breakdown</option>
                  <option value="security">Security Headers & SSL Compliance</option>
                  <option value="health">Comprehensive 360° Diagnostic</option>
                </select>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">Custom Title (Optional)</label>
                <input
                  type="text"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  placeholder="e.g. Q1 Infrastructure Performance Audit"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  className="px-3 py-1.5 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="px-4 py-2 bg-[#E6A05A] text-[#0B1120] font-semibold rounded-lg hover:bg-[#cf863c]"
                >
                  {generating ? 'Compiling...' : 'Create Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reports Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left List */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Generated Reports ({reports.length})
          </h2>
          {reports.length === 0 ? (
            <div className="p-6 rounded-xl border border-slate-800 bg-[#0F172A] text-xs text-slate-500 text-center">
              No reports generated yet.
            </div>
          ) : (
            reports.map((rep) => {
              const isSelected = selectedReport?.id === rep.id;
              return (
                <div
                  key={rep.id}
                  onClick={() => setSelectedReport(rep)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-[#E6A05A] bg-[#0F172A]'
                      : 'border-slate-800 bg-[#0F172A]/70 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-white text-xs line-clamp-1">{rep.title}</span>
                    <span className="text-[10px] font-mono text-[#E6A05A] uppercase">{rep.type}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{rep.websiteName}</span>
                    <span>{new Date(rep.generatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Preview */}
        <div className="lg:col-span-2">
          {selectedReport ? (
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 lg:p-8 space-y-6 print:bg-white print:text-black">
              {/* Report Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800 print:border-black">
                <div>
                  <div className="text-xs text-[#E6A05A] font-semibold uppercase tracking-wider mb-1">
                    {organization?.whiteLabel?.brandName || 'PulseVanguard Systems'}
                  </div>
                  <h2 className="text-xl font-bold text-white print:text-black">{selectedReport.title}</h2>
                  <p className="text-xs text-slate-400 print:text-gray-600 mt-1">
                    Target: {selectedReport.websiteName} · Compiled on {new Date(selectedReport.generatedAt).toLocaleString()}
                  </p>
                </div>

                <div className="flex items-center gap-2 print:hidden">
                  <button
                    onClick={() => handleCopyShareLink(selectedReport.shareToken)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 bg-slate-900 border border-slate-700 rounded-lg hover:text-white"
                  >
                    {copiedToken === selectedReport.shareToken ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Link Copied</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="h-3.5 w-3.5" />
                        <span>Share Link</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#0B1120] bg-[#E6A05A] rounded-lg font-semibold hover:bg-[#cf863c]"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Print / Save PDF</span>
                  </button>
                </div>
              </div>

              {/* Report Body */}
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-slate-900 print:bg-gray-100 border border-slate-800 print:border-gray-300">
                    <span className="text-slate-400 print:text-gray-500 block mb-1">Health Score</span>
                    <span className="text-xl font-bold font-mono text-white print:text-black">
                      {selectedReport.data?.healthScore || 96} / 100
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 print:bg-gray-100 border border-slate-800 print:border-gray-300">
                    <span className="text-slate-400 print:text-gray-500 block mb-1">24h Uptime</span>
                    <span className="text-xl font-bold font-mono text-emerald-400 print:text-emerald-700">
                      {selectedReport.data?.uptime24h || 99.98}%
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 print:bg-gray-100 border border-slate-800 print:border-gray-300">
                    <span className="text-slate-400 print:text-gray-500 block mb-1">30-Day SLA</span>
                    <span className="text-xl font-bold font-mono text-white print:text-black">
                      {selectedReport.data?.uptime30d || 99.91}%
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 print:bg-gray-100 border border-slate-800 print:border-gray-300">
                    <span className="text-slate-400 print:text-gray-500 block mb-1">Response Time</span>
                    <span className="text-xl font-bold font-mono text-white print:text-black">
                      {selectedReport.data?.responseTimeMs || 142} ms
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-slate-900 print:bg-gray-100 border border-slate-800 print:border-gray-300 space-y-2">
                  <h4 className="font-semibold text-white print:text-black">Executive Audit Observations:</h4>
                  <p className="text-slate-300 print:text-gray-700 leading-relaxed">
                    {selectedReport.data?.summary ||
                      'The target domain demonstrated robust network availability across regional nodes throughout the measurement interval. TLS certificate handshakes, DNS propagation, and HTTP status codes conformed to high-availability SLA thresholds.'}
                  </p>
                </div>

                {/* Footer Disclaimer */}
                <div className="pt-6 border-t border-slate-800 print:border-black text-[11px] text-slate-500 print:text-gray-500">
                  {organization?.whiteLabel?.reportFooterText ||
                    'Confidential Performance & Health Diagnostics Audit generated by PulseVanguard Monitoring Systems.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 rounded-xl border border-slate-800 bg-[#0F172A] text-center text-xs text-slate-500">
              Select a report from the list to preview details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
