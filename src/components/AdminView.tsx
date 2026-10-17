import React, { useState, useEffect } from 'react';
import { Shield, Users, Server, Play, Check, AlertTriangle, RefreshCw, MessageSquare, Clock, Coins, CheckCircle2, ArrowRight, Wallet } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { SupportTicket, CryptoPaymentOrder } from '../types.ts';
import { AdminWithdrawalsView } from './AdminWithdrawalsView.tsx';

interface AdminViewProps {
  onNavigate?: (view: any) => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [paymentOrders, setPaymentOrders] = useState<CryptoPaymentOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggeringWorker, setTriggeringWorker] = useState(false);
  const [workerToast, setWorkerToast] = useState<string | null>(null);

  useEffect(() => {
    loadAdminData();
  }, []);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [st, u, t, orders] = await Promise.all([
        apiClient.getAdminOverview(),
        apiClient.getAdminUsers(),
        apiClient.getTickets(),
        apiClient.getAdminCryptoOrders().catch(() => []),
      ]);
      setStats(st);
      setUsers(u);
      setTickets(t);
      setPaymentOrders(Array.isArray(orders) ? orders : []);
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

  const pendingPayments = paymentOrders.filter(
    (o) => o.status === 'Pending' || o.status === 'Confirming' || o.status === 'Manual Review'
  );
  const pendingWithdrawalsCount =
    stats?.pendingWithdrawalRequestsCount ??
    stats?.referralOverview?.pendingWithdrawalRequestsCount ??
    0;

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
            Global system health, background monitoring workers, user tenant management, referral withdrawals, and payment approval.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onNavigate && (
            <>
              <button
                onClick={() => onNavigate('admin-withdrawals')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-500 transition-colors cursor-pointer"
              >
                <Wallet className="h-3.5 w-3.5" />
                <span>Withdrawal Requests</span>
                {pendingWithdrawalsCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-black text-amber-400 font-extrabold">
                    {pendingWithdrawalsCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => onNavigate('admin-crypto-transactions')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors cursor-pointer"
              >
                <Coins className="h-3.5 w-3.5" />
                <span>Review Payments</span>
                {pendingPayments.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-black text-[#E6A05A] font-extrabold">
                    {pendingPayments.length}
                  </span>
                )}
              </button>
            </>
          )}

          <button
            onClick={loadAdminData}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Telemetry</span>
          </button>
          <button
            onClick={handleTriggerWorker}
            disabled={triggeringWorker}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 text-[#E6A05A]" />
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

      {/* Payment Approval & Review Alert Banner */}
      <div className="rounded-xl border border-[#E6A05A]/30 bg-gradient-to-r from-[#0F172A] via-slate-900 to-[#1e1710] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-[#E6A05A]" />
            <h2 className="text-sm font-bold text-white">Cryptocurrency Payment Management & Approvals</h2>
            {pendingPayments.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-black animate-pulse">
                {pendingPayments.length} Awaiting Review
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            {pendingPayments.length > 0
              ? `There are ${pendingPayments.length} customer payment order(s) awaiting review. You can manually inspect and approve or reject subscriptions.`
              : 'All customer payment orders have been processed. Review historical settlement logs and transaction hashes.'}
          </p>
        </div>

        {onNavigate && (
          <button
            onClick={() => onNavigate('admin-crypto-transactions')}
            className="px-4 py-2 rounded-xl bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 shadow-md cursor-pointer"
          >
            <span>Open Payment Console</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Embedded Referral Commissions & Withdrawal Management Console */}
      <div className="pt-2">
        <AdminWithdrawalsView />
      </div>

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
                <th className="py-2">Referral Code</th>
                <th className="py-2">Referred By</th>
                <th className="py-2">System Role</th>
                <th className="py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {users.map((u) => (
                <tr key={u.id} className="text-slate-300">
                  <td className="py-3 font-sans font-semibold text-white">{u.name}</td>
                  <td className="py-3">{u.email}</td>
                  <td className="py-3 text-[#E6A05A] font-bold">{u.referralCode || '—'}</td>
                  <td className="py-3 text-slate-400">{u.referredByCode || '—'}</td>
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
            <MessageSquare className="h-4 w-4 text-[#E6A05A]" />
            <h2 className="text-sm font-semibold text-white">Inbound Support Tickets ({tickets.length})</h2>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('reports')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors cursor-pointer"
            >
              <span>Manage in Reports Inbox</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
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
