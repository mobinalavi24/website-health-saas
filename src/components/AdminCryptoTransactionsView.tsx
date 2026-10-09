import React, { useState, useEffect, useMemo } from 'react';
import {
  Coins,
  Search,
  Filter,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ExternalLink,
  Copy,
  Check,
  Layers,
  DollarSign
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { CryptoPaymentOrder, CryptoPaymentStatus } from '../types.ts';

export const AdminCryptoTransactionsView: React.FC = () => {
  const [orders, setOrders] = useState<CryptoPaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | CryptoPaymentStatus>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchOrders = async () => {
    try {
      setError(null);
      const data = await apiClient.getAdminCryptoOrders();
      setOrders(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch global crypto payment transactions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchOrders();
    }, 20000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter !== 'All' && order.status !== statusFilter) {
        return false;
      }

      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const matchesEmail = order.userEmail?.toLowerCase().includes(term);
        const matchesOrderId = order.id?.toLowerCase().includes(term);
        const matchesTxId = order.txId?.toLowerCase().includes(term);
        const matchesDeposit = order.depositAddress?.toLowerCase().includes(term);
        const matchesPlan = order.planName?.toLowerCase().includes(term);
        return Boolean(matchesEmail || matchesOrderId || matchesTxId || matchesDeposit || matchesPlan);
      }

      return true;
    });
  }, [orders, statusFilter, searchTerm]);

  const stats = useMemo(() => {
    const totalTransactions = orders.length;
    const paidTransactions = orders.filter((o) => o.status === 'Paid').length;
    const pendingTransactions = orders.filter((o) => o.status === 'Pending').length;
    const confirmingTransactions = orders.filter((o) => o.status === 'Confirming').length;
    const manualReviewTransactions = orders.filter((o) => o.status === 'Manual Review').length;
    const failedOrExpiredTransactions = orders.filter((o) => o.status === 'Failed' || o.status === 'Expired').length;
    const totalConfirmedUsdt = orders
      .filter((o) => o.status === 'Paid')
      .reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

    return {
      totalTransactions,
      paidTransactions,
      pendingTransactions,
      confirmingTransactions,
      manualReviewTransactions,
      failedOrExpiredTransactions,
      totalConfirmedUsdt,
    };
  }, [orders]);

  const getStatusBadge = (status: CryptoPaymentStatus) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="h-3 w-3" />
            Paid
          </span>
        );
      case 'Confirming':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Confirming
          </span>
        );
      case 'Pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Clock className="h-3 w-3" />
            Pending
          </span>
        );
      case 'Manual Review':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
            <HelpCircle className="h-3 w-3" />
            Manual Review
          </span>
        );
      case 'Expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-700">
            <Clock className="h-3 w-3" />
            Expired
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <XCircle className="h-3 w-3" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-300">
            {status}
          </span>
        );
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-[#E6A05A]/10 border border-[#E6A05A]/20">
              <Coins className="h-5 w-5 text-[#E6A05A]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Crypto Transactions
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  Admin Only
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Global cryptocurrency payment ledger showing all platform user transactions via TRON TRC20 (USDT).
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
              autoRefresh
                ? 'bg-slate-800 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
            title={autoRefresh ? 'Live refresh active (20s)' : 'Live refresh paused'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            Live Sync
          </button>

          <button
            onClick={() => fetchOrders()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchOrders()}
            className="underline font-semibold hover:text-white ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Transactions
          </div>
          <div className="mt-2 text-2xl font-black text-white">
            {stats.totalTransactions}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
            <Layers className="h-3 w-3" />
            All registered orders
          </div>
        </div>

        <div className="p-4 rounded-xl border border-emerald-500/20 bg-[#0F172A] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
            Paid Transactions
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-400">
            {stats.paidTransactions}
          </div>
          <div className="mt-1 text-[11px] text-emerald-500/80 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Confirmed on TRON
          </div>
        </div>

        <div className="p-4 rounded-xl border border-amber-500/20 bg-[#0F172A] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
            Pending / In-Flight
          </div>
          <div className="mt-2 text-2xl font-black text-amber-400">
            {stats.pendingTransactions + stats.confirmingTransactions}
          </div>
          <div className="mt-1 text-[11px] text-amber-500/80 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Awaiting confirmation
          </div>
        </div>

        <div className="p-4 rounded-xl border border-rose-500/20 bg-[#0F172A] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
            Failed / Expired
          </div>
          <div className="mt-2 text-2xl font-black text-rose-400">
            {stats.failedOrExpiredTransactions}
          </div>
          <div className="mt-1 text-[11px] text-rose-500/80 flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Reverted or timed out
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1 p-4 rounded-xl border border-[#E6A05A]/30 bg-gradient-to-br from-[#0F172A] to-[#1e1710] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-[#E6A05A] uppercase tracking-wider flex items-center justify-between">
            <span>Total Confirmed</span>
            <DollarSign className="h-3.5 w-3.5 text-[#E6A05A]" />
          </div>
          <div className="mt-2 text-2xl font-black text-white">
            ${stats.totalConfirmedUsdt.toFixed(2)}
            <span className="text-xs font-normal text-slate-400 ml-1">USDT</span>
          </div>
          <div className="mt-1 text-[11px] text-[#E6A05A]/80">
            Platform revenue received
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by User Email, Order ID, or TXID..."
              className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-xs text-slate-500 hover:text-slate-300"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto pb-1 lg:pb-0">
            <span className="text-xs text-slate-400 font-medium mr-1 flex items-center gap-1">
              <Filter className="h-3 w-3" /> Filter:
            </span>
            {(['All', 'Paid', 'Pending', 'Confirming', 'Manual Review', 'Expired', 'Failed'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-[#E6A05A] text-[#0B1120] font-semibold'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">
              Platform Transaction Ledger
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
              Showing {filteredOrders.length} of {orders.length}
            </span>
          </div>

          <div className="text-[11px] text-slate-400">
            Network: <span className="text-emerald-400 font-mono font-medium">TRON (TRC20)</span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center space-y-3">
            <RefreshCw className="h-6 w-6 text-[#E6A05A] animate-spin mx-auto" />
            <p className="text-xs text-slate-400">Loading platform cryptocurrency orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Coins className="h-8 w-8 text-slate-600 mx-auto" />
            <h3 className="text-sm font-medium text-white">No transactions found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchTerm || statusFilter !== 'All'
                ? 'No transactions matched your current search and filter criteria.'
                : 'There are currently no cryptocurrency payment orders in the database.'}
            </p>
            {(searchTerm || statusFilter !== 'All') && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('All');
                }}
                className="mt-2 text-xs text-[#E6A05A] hover:underline font-semibold"
              >
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-medium">
                  <th className="py-3 px-4">Order ID & User</th>
                  <th className="py-3 px-4">Plan & Amount</th>
                  <th className="py-3 px-4">Network & Address</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">TXID</th>
                  <th className="py-3 px-4">Created / Expiry</th>
                  <th className="py-3 px-4">Confirmation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredOrders.map((order) => {
                  const isCopiedOrder = copiedId === order.id;
                  const isCopiedTx = copiedId === order.txId;
                  const isCopiedAddr = copiedId === order.depositAddress;

                  return (
                    <tr
                      key={order.id}
                      className="hover:bg-slate-900/50 transition-colors"
                    >
                      {/* Order ID & User */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-white font-semibold">
                              {order.id}
                            </span>
                            <button
                              onClick={() => copyToClipboard(order.id, order.id)}
                              title="Copy Order ID"
                              className="text-slate-500 hover:text-slate-300"
                            >
                              {isCopiedOrder ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                          <div className="text-slate-300 font-medium">
                            {order.userEmail}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Org: <span className="font-mono">{order.orgId}</span>
                          </div>
                        </div>
                      </td>

                      {/* Plan & Amount */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1">
                          <div className="font-semibold text-white">
                            {order.planName || order.planId}
                          </div>
                          <div className="text-emerald-400 font-bold font-mono text-sm">
                            {order.amount} USDT
                          </div>
                          <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                            {order.billingInterval} billing
                          </div>
                        </div>
                      </td>

                      {/* Network & Deposit Address */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1">
                          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                            TRON (TRC20)
                          </div>
                          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                            <span className="truncate max-w-[140px]" title={order.depositAddress}>
                              {order.depositAddress}
                            </span>
                            <button
                              onClick={() => copyToClipboard(order.depositAddress, order.depositAddress)}
                              title="Copy Deposit Address"
                              className="text-slate-500 hover:text-slate-300 shrink-0"
                            >
                              {isCopiedAddr ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1.5">
                          <div>{getStatusBadge(order.status)}</div>
                          {order.verificationLog && (
                            <div className="text-[10px] text-slate-500 max-w-[180px] leading-tight" title={order.verificationLog}>
                              {order.verificationLog}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* TXID */}
                      <td className="py-3.5 px-4 align-top">
                        {order.txId ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1 text-[11px] font-mono text-[#E6A05A]">
                              <span className="truncate max-w-[120px]" title={order.txId}>
                                {order.txId}
                              </span>
                              <button
                                onClick={() => copyToClipboard(order.txId!, order.txId!)}
                                title="Copy TXID"
                                className="text-slate-500 hover:text-slate-300 shrink-0"
                              >
                                {isCopiedTx ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              </button>
                            </div>
                            <a
                              href={`https://tronscan.org/#/transaction/${order.txId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white underline"
                            >
                              TronScan <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-slate-600 text-[11px] italic">Not attached yet</span>
                        )}
                      </td>

                      {/* Created / Expiry */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1 text-[11px]">
                          <div className="text-slate-300">
                            <span className="text-slate-500">Created:</span> {formatDate(order.createdAt)}
                          </div>
                          <div className="text-slate-400">
                            <span className="text-slate-500">Expires:</span> {formatDate(order.expiresAt)}
                          </div>
                        </div>
                      </td>

                      {/* Confirmation Date */}
                      <td className="py-3.5 px-4 align-top">
                        {order.confirmedAt ? (
                          <div className="space-y-1 text-[11px]">
                            <div className="text-emerald-400 font-medium">
                              {formatDate(order.confirmedAt)}
                            </div>
                            {order.detectedAt && (
                              <div className="text-[10px] text-slate-500">
                                Detected: {formatDate(order.detectedAt)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600 text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
