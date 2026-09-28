import React, { useState } from 'react';
import {
  Activity,
  Plus,
  RefreshCw,
  Search,
  ExternalLink,
  Shield,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Play,
  Pause,
  Trash2,
  FileText,
  SlidersHorizontal,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import type { Website, Incident, AlertNotification, Organization } from '../types.ts';

interface DashboardViewProps {
  websites: Website[];
  incidents: Incident[];
  alerts: AlertNotification[];
  organization: Organization | null;
  onSelectWebsite: (siteId: string) => void;
  onAddWebsite: () => void;
  onRefresh: () => void;
  onCheckNow: (siteId: string) => Promise<void>;
  onTogglePause: (siteId: string, currentStatus: string) => Promise<void>;
  onDeleteWebsite: (siteId: string) => Promise<void>;
  onNavigate: (view: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  websites,
  incidents,
  alerts,
  organization,
  onSelectWebsite,
  onAddWebsite,
  onRefresh,
  onCheckNow,
  onTogglePause,
  onDeleteWebsite,
  onNavigate,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ONLINE' | 'DEGRADED' | 'OFFLINE'>('ALL');
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());

  // Statistics
  const totalCount = websites.length;
  const onlineCount = websites.filter((w) => w.status === 'ONLINE').length;
  const degradedCount = websites.filter((w) => w.status === 'DEGRADED').length;
  const offlineCount = websites.filter((w) => w.status === 'OFFLINE').length;
  const unreadAlerts = alerts.filter((a) => !a.read).length;
  const openIncidents = incidents.filter((i) => i.status === 'OPEN');

  const avgUptime24h = totalCount > 0
    ? (websites.reduce((acc, w) => acc + (w.uptime24h || 100), 0) / totalCount).toFixed(2)
    : '100.00';

  const avgScore = totalCount > 0
    ? Math.round(websites.reduce((acc, w) => acc + (w.healthScore || 90), 0) / totalCount)
    : 95;

  // Filtered websites
  const filteredWebsites = websites.filter((w) => {
    const matchesSearch =
      w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.domain.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || w.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleRunCheck = async (siteId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckingIds((prev) => new Set(prev).add(siteId));
    try {
      await onCheckNow(siteId);
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(siteId);
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Monitored Infrastructure
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Real-time public health status, response times, and automated incident recovery.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh</span>
          </button>
          <button
            onClick={onAddWebsite}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Add Website</span>
          </button>
        </div>
      </div>

      {/* Open Incidents Alert Banner if any */}
      {openIncidents.length > 0 && (
        <div className="rounded-xl border border-rose-900/80 bg-rose-950/30 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs uppercase tracking-wider">
              <XCircle className="h-4 w-4" />
              <span>Active Downtime Incident Detected ({openIncidents.length})</span>
            </div>
            <span className="text-[11px] text-rose-300 font-mono">Automated Retries Active</span>
          </div>
          {openIncidents.map((inc) => (
            <div key={inc.id} className="text-xs text-rose-200 flex items-center justify-between pt-1">
              <span><strong>{inc.websiteName}</strong>: {inc.cause}</span>
              <span className="text-[11px] text-rose-300 font-mono">
                Started {new Date(inc.startedAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Monitored Sites */}
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Websites Monitored</span>
            <Activity className="h-4 w-4 text-slate-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {totalCount}
            </span>
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-emerald-400">{onlineCount} up</span>
              {degradedCount > 0 && <span className="text-amber-400">· {degradedCount} degraded</span>}
              {offlineCount > 0 && <span className="text-rose-400">· {offlineCount} down</span>}
            </div>
          </div>
          <div className="text-[11px] text-slate-500">
            {organization?.planId?.toUpperCase() || 'FREE'} plan quota: {totalCount} configured
          </div>
        </div>

        {/* 24h Uptime */}
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Average 24h Uptime</span>
            <TrendingUp className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
              {avgUptime24h}%
            </span>
            <span className="text-[11px] text-slate-400">Across nodes</span>
          </div>
          <div className="text-[11px] text-slate-500">SLA threshold: 99.90%</div>
        </div>

        {/* Health Score */}
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Avg Health Score</span>
            <Shield className="h-4 w-4 text-[#E6A05A]" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {avgScore} <span className="text-xs text-slate-500 font-normal">/ 100</span>
            </span>
            <span className="text-[11px] text-[#E6A05A] font-semibold">Grade A</span>
          </div>
          <div className="text-[11px] text-slate-500">SSL, Security & SEO factored</div>
        </div>

        {/* Alerts & Incidents */}
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Notifications</span>
            <Clock className="h-4 w-4 text-slate-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {unreadAlerts}
            </span>
            <span className="text-[11px] text-slate-400">Unread notifications</span>
          </div>
          <div className="text-[11px] text-slate-500">
            {openIncidents.length === 0 ? 'No active outages' : `${openIncidents.length} active outages`}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Interactive segmented controls for filtering */}
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg">
          {(['ALL', 'ONLINE', 'DEGRADED', 'OFFLINE'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === st
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {st === 'ALL' ? 'All Sites' : st.charAt(0) + st.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search domain or name..."
            className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
          />
        </div>
      </div>

      {/* Websites High-Density Table */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] overflow-hidden">
        {filteredWebsites.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Activity className="h-8 w-8 text-slate-600 mx-auto" />
            <h3 className="text-sm font-semibold text-white">No websites match your filter</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Add your first website to enable automatic 1-minute uptime checks, SSL certificate alerts, and security audits.
            </p>
            <button
              onClick={onAddWebsite}
              className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-semibold hover:bg-[#cf863c] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Your First Website</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Website</th>
                  <th className="py-3 px-4 text-right">Response Time</th>
                  <th className="py-3 px-4 text-right">24h Uptime</th>
                  <th className="py-3 px-4 text-center">Health</th>
                  <th className="py-3 px-4">Last Checked</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredWebsites.map((site) => {
                  const isChecking = checkingIds.has(site.id);
                  return (
                    <tr
                      key={site.id}
                      onClick={() => onSelectWebsite(site.id)}
                      className="group cursor-pointer hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              site.status === 'ONLINE'
                                ? 'bg-emerald-400 animate-pulse'
                                : site.status === 'DEGRADED'
                                ? 'bg-amber-400'
                                : site.status === 'PAUSED'
                                ? 'bg-slate-500'
                                : 'bg-rose-500 animate-ping'
                            }`}
                          />
                          <span
                            className={`text-xs font-sans font-semibold ${
                              site.status === 'ONLINE'
                                ? 'text-emerald-400'
                                : site.status === 'DEGRADED'
                                ? 'text-amber-400'
                                : site.status === 'PAUSED'
                                ? 'text-slate-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {site.status}
                          </span>
                        </div>
                      </td>

                      {/* Website Name & Domain */}
                      <td className="py-3.5 px-4 font-sans">
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white group-hover:text-[#E6A05A] transition-colors">
                              {site.name}
                            </span>
                            {site.groupName && (
                              <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded font-mono">
                                {site.groupName}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {site.domain}
                          </span>
                        </div>
                      </td>

                      {/* Response Time */}
                      <td className="py-3.5 px-4 text-right tabular-nums">
                        <span
                          className={`font-semibold ${
                            site.lastResponseTimeMs < 400
                              ? 'text-emerald-400'
                              : site.lastResponseTimeMs < 1200
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {site.lastResponseTimeMs} ms
                        </span>
                      </td>

                      {/* 24h Uptime */}
                      <td className="py-3.5 px-4 text-right tabular-nums text-slate-200">
                        {site.uptime24h.toFixed(2)}%
                      </td>

                      {/* Health Score */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums ${
                            site.healthScore >= 90
                              ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
                              : site.healthScore >= 75
                              ? 'text-[#E6A05A] bg-[#E6A05A]/10 border border-[#E6A05A]/20'
                              : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                          }`}
                        >
                          {site.healthScore} / 100
                        </span>
                      </td>

                      {/* Last Checked */}
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {site.lastCheckedAt ? new Date(site.lastCheckedAt).toLocaleTimeString() : 'Pending'}
                      </td>

                      {/* Quick Actions */}
                      <td className="py-3.5 px-4 text-right font-sans" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={(e) => handleRunCheck(site.id, e)}
                            disabled={isChecking}
                            title="Run instant HTTP check now"
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${isChecking ? 'animate-spin text-[#E6A05A]' : ''}`} />
                          </button>
                          <button
                            onClick={() => onSelectWebsite(site.id)}
                            title="View deep analysis"
                            className="p-1.5 text-slate-400 hover:text-[#E6A05A] hover:bg-slate-800 rounded transition-colors"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Alerts Feed Preview */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-white">Recent Real-Time Alerts</h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">Automated Dispatch</span>
        </div>

        {alerts.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">No incident alerts recorded.</p>
        ) : (
          <div className="space-y-2">
            {alerts.slice(0, 4).map((alt) => (
              <div
                key={alt.id}
                className="flex items-start justify-between gap-4 p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs"
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5">
                    {alt.severity === 'critical' ? (
                      <XCircle className="h-4 w-4 text-rose-400" />
                    ) : alt.severity === 'warning' ? (
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    )}
                  </div>
                  <div>
                    <span className="font-semibold text-white block">{alt.title}</span>
                    <span className="text-slate-300 text-[11px]">{alt.message}</span>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-slate-500 shrink-0">
                  {new Date(alt.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
