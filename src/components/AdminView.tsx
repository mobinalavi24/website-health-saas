import React, { useState, useEffect } from 'react';
import { Shield, Users, Server, Play, Check, AlertTriangle, RefreshCw, MessageSquare, Clock } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { SupportTicket } from '../types.ts';

export const AdminView: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggeringWorker, setTriggeringWorker] = useState(false);
  const [workerToast, setWorkerToast] = useState<string | null>(null);

  useEffect(() => {
    loadAdminData();
  }, []);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [st, u, t] = await Promise.all([
        apiClient.getAdminOverview(),
        apiClient.getAdminUsers(),
        apiClient.getTickets(),
      ]);
      setStats(st);
      setUsers(u);
      setTickets(t);
    } catch (e) {
      console.error('Failed to load admin telemetry', e);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerWorker = async () => {
    setTriggeringWorker(true);
    try {
      const res = await apiClient.triggerWorkerTick();
      setWorkerToast('Worker tick triggered immediately.');
      setTimeout(() => setWorkerToast(null), 3000);
      await loadAdminData();
    } catch (err: any) {
      alert(`Worker trigger failed: ${err.message}`);
    } finally {
      setTriggeringWorker(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[#E6A05A]" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Super Admin Platform Console
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Global system health, background monitoring workers, user tenant management, and customer support.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadAdminData}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Telemetry</span>
          </button>
          <button
            onClick={handleTriggerWorker}
            disabled={triggeringWorker}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{triggeringWorker ? 'Triggering...' : 'Force Worker Tick'}</span>
          </button>
        </div>
      </div>

      {workerToast && (
        <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
          <Check className="h-4 w-4" />
          <span>{workerToast}</span>
        </div>
      )}

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-xs text-slate-400">Total Users</span>
            <div className="text-2xl font-bold font-mono text-white tabular-nums">
              {stats.totalUsers}
            </div>
            <p className="text-[11px] text-slate-500">{stats.totalOrganizations} tenant workspaces</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-xs text-slate-400">Monitored Endpoints</span>
            <div className="text-2xl font-bold font-mono text-white tabular-nums">
              {stats.totalWebsites}
            </div>
            <p className="text-[11px] text-emerald-400 font-mono">{stats.onlineWebsites} active online</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-xs text-slate-400">Worker Jobs Completed</span>
            <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
              {stats.workerStats?.totalChecksCompleted || 0}
            </div>
            <p className="text-[11px] text-slate-500 font-mono">
              Tick duration: {stats.workerStats?.lastRunDurationMs || 0}ms
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-xs text-slate-400">Platform Revenue</span>
            <div className="text-2xl font-bold font-mono text-[#E6A05A] tabular-nums">
              ${stats.totalRevenue?.toLocaleString() || 0}
            </div>
            <p className="text-[11px] text-slate-500">Processed invoices</p>
          </div>
        </div>
      )}

      {/* Worker Queue Engine Status */}
      {stats?.workerStats && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">Monitoring Worker Node Status</h2>
            </div>
            <span className="text-xs font-mono text-emerald-400 font-semibold">
              RUNNING (EVERY {stats.settings?.workerIntervalSec || 30}s)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 font-sans">Last Heartbeat:</span>
              <p className="text-white">{new Date(stats.workerStats.lastTickAt).toLocaleTimeString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 font-sans">Active Queue Length:</span>
              <p className="text-white">{stats.workerStats.activeQueueLength} sites pending</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 font-sans">Active Node Failures:</span>
              <p className="text-white">{stats.workerStats.activeFailures} failures tracking</p>
            </div>
          </div>
        </div>
      )}

      {/* User Directory */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
        <h2 className="text-sm font-semibold text-white">User Accounts Directory</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
              <tr>
                <th className="py-2">User</th>
                <th className="py-2">Email</th>
                <th className="py-2">System Role</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {users.map((u) => (
                <tr key={u.id} className="text-slate-300">
                  <td className="py-3 font-sans font-semibold text-white">{u.name}</td>
                  <td className="py-3">{u.email}</td>
                  <td className="py-3 font-sans">
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono text-[#E6A05A] bg-[#E6A05A]/10 border border-[#E6A05A]/20">
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Support Tickets Inbox */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Inbound Support Tickets ({tickets.length})</h2>
          </div>
        </div>

        {tickets.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">No support tickets submitted.</p>
        ) : (
          <div className="space-y-3 text-xs">
            {tickets.map((t) => (
              <div key={t.id} className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white text-sm">{t.subject}</span>
                  <span className="font-mono text-[10px] uppercase text-[#E6A05A] bg-[#E6A05A]/10 px-2 py-0.5 rounded">
                    {t.status}
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">{t.message}</p>
                <div className="pt-2 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span>From: {t.name} ({t.email})</span>
                  <span>{new Date(t.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
