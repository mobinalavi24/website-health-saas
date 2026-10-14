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
  DollarSign,
  ShieldCheck,
  User,
  X,
  ChevronLeft,
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { CryptoPaymentOrder, CryptoPaymentStatus } from '../types.ts';

export const AdminCryptoTransactionsView: React.FC = () => {
  const [orders, setOrders] = useState<CryptoPaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pending Review' | 'Approved' | 'Rejected' | 'Expired/Cancelled'>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Approval Modal State
  const [approvingOrder, setApprovingOrder] = useState<CryptoPaymentOrder | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionSuccessToast, setActionSuccessToast] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Rejection Modal State
  const [rejectingOrder, setRejectingOrder] = useState<CryptoPaymentOrder | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

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

  const handleApproveConfirm = async () => {
    if (!approvingOrder) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await apiClient.approveCryptoOrder(approvingOrder.id);
      setActionSuccessToast(res.message || `Payment ${approvingOrder.id} successfully approved!`);
      setTimeout(() => setActionSuccessToast(null), 5000);
      setApprovingOrder(null);
      await fetchOrders();
    } catch (err: any) {
      setActionError(err.message || 'Failed to approve payment.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectingOrder) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await apiClient.rejectCryptoOrder(rejectingOrder.id, rejectionReason.trim() || undefined);
      setActionSuccessToast(res.message || `Payment ${rejectingOrder.id} rejected.`);
      setTimeout(() => setActionSuccessToast(null), 5000);
      setRejectingOrder(null);
      setRejectionReason('');
      await fetchOrders();
    } catch (err: any) {
      setActionError(err.message || 'Failed to reject payment.');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter === 'Pending Review') {
        if (order.status !== 'Pending' && order.status !== 'Confirming' && order.status !== 'Manual Review') {
          return false;
        }
      } else if (statusFilter === 'Approved') {
        if (order.status !== 'Paid') return false;
      } else if (statusFilter === 'Rejected') {
        if (order.status !== 'Rejected') return false;
      } else if (statusFilter === 'Expired/Cancelled') {
        if (order.status !== 'Expired' && order.status !== 'Cancelled' && order.status !== 'Failed') {
          return false;
        }
      }

      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const matchesEmail = order.userEmail?.toLowerCase().includes(term);
        const matchesUserId = order.userId?.toLowerCase().includes(term);
        const matchesOrderId = order.id?.toLowerCase().includes(term);
        const matchesTxId = order.txId?.toLowerCase().includes(term);
        const matchesDeposit = order.depositAddress?.toLowerCase().includes(term);
        const matchesPlan = order.planName?.toLowerCase().includes(term);
        return Boolean(matchesEmail || matchesUserId || matchesOrderId || matchesTxId || matchesDeposit || matchesPlan);
      }

      return true;
    });
  }, [orders, statusFilter, searchTerm]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredOrders.slice(start, start + pageSize);
  }, [filteredOrders, currentPage, pageSize]);

  const stats = useMemo(() => {
    const totalTransactions = orders.length;
    const paidTransactions = orders.filter((o) => o.status === 'Paid').length;
    const pendingReviewTransactions = orders.filter((o) => o.status === 'Pending' || o.status === 'Confirming' || o.status === 'Manual Review').length;
    const rejectedTransactions = orders.filter((o) => o.status === 'Rejected').length;
    const failedOrExpiredTransactions = orders.filter((o) => o.status === 'Failed' || o.status === 'Expired' || o.status === 'Cancelled').length;
    const totalConfirmedUsdt = orders
      .filter((o) => o.status === 'Paid')
      .reduce((sum, o) => sum + (Number(o.amount) || 0), 0);

    return {
      totalTransactions,
      paidTransactions,
      pendingReviewTransactions,
      rejectedTransactions,
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
            Approved / Paid
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
            Awaiting Review / Payment
          </span>
        );
      case 'Manual Review':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
            <HelpCircle className="h-3 w-3" />
            Awaiting Admin Review
          </span>
        );
      case 'Rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <XCircle className="h-3 w-3" />
            Rejected by Admin
          </span>
        );
      case 'Cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <XCircle className="h-3 w-3" />
            Cancelled
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
                  Payment Management & Approval Console
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  Super Admin
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Centralized cryptocurrency order ledger for reviewing, approving, and rejecting customer subscription payments.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors cursor-pointer ${
              autoRefresh
                ? 'bg-slate-800 text-emerald-400 border-emerald-500/30'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
            }`}
            title={autoRefresh ? 'Live sync active (20s)' : 'Live sync paused'}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            Live Sync
          </button>

          <button
            onClick={() => fetchOrders()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Success Toast */}
      {actionSuccessToast && (
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-700 text-emerald-200 text-xs flex items-center gap-2 shadow-lg animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="font-medium">{actionSuccessToast}</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => fetchOrders()}
            className="underline font-semibold hover:text-white ml-4 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Orders
          </div>
          <div className="mt-2 text-2xl font-black text-white">
            {stats.totalTransactions}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
            <Layers className="h-3 w-3" />
            All registered payments
          </div>
        </div>

        <div className="p-4 rounded-xl border border-amber-500/30 bg-[#0F172A] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider flex items-center justify-between">
            <span>Pending Review</span>
            {stats.pendingReviewTransactions > 0 && (
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
            )}
          </div>
          <div className="mt-2 text-2xl font-black text-amber-400">
            {stats.pendingReviewTransactions}
          </div>
          <div className="mt-1 text-[11px] text-amber-500/80 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Awaiting verification/approval
          </div>
        </div>

        <div className="p-4 rounded-xl border border-emerald-500/20 bg-[#0F172A] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
            Approved / Paid
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-400">
            {stats.paidTransactions}
          </div>
          <div className="mt-1 text-[11px] text-emerald-500/80 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Active subscriptions
          </div>
        </div>

        <div className="p-4 rounded-xl border border-rose-500/20 bg-[#0F172A] relative overflow-hidden">
          <div className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
            Rejected
          </div>
          <div className="mt-2 text-2xl font-black text-rose-400">
            {stats.rejectedTransactions}
          </div>
          <div className="mt-1 text-[11px] text-rose-500/80 flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Declined orders
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
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by User Email, User ID, Order ID, or TXID..."
              className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
            />
            {searchTerm && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 top-2.5 text-xs text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap overflow-x-auto pb-1 lg:pb-0">
            <span className="text-xs text-slate-400 font-medium mr-1 flex items-center gap-1">
              <Filter className="h-3 w-3" /> View:
            </span>
            {(['All', 'Pending Review', 'Approved', 'Rejected', 'Expired/Cancelled'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setStatusFilter(tab);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  statusFilter === tab
                    ? 'bg-[#E6A05A] text-[#0B1120] font-bold shadow-md'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {tab}
                {tab === 'Pending Review' && stats.pendingReviewTransactions > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-black font-extrabold">
                    {stats.pendingReviewTransactions}
                  </span>
                )}
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
              Customer Payment Orders
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-800 text-slate-300 border border-slate-700">
              Showing {paginatedOrders.length} of {filteredOrders.length}
            </span>
          </div>

          <div className="text-[11px] text-slate-400">
            Settlement Network: <span className="text-emerald-400 font-mono font-medium">TRON TRC20 (USDT)</span>
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
            <h3 className="text-sm font-medium text-white">No payment records found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchTerm || statusFilter !== 'All'
                ? 'No transactions matched your search or filter.'
                : 'There are currently no cryptocurrency payment orders in the database.'}
            </p>
            {(searchTerm || statusFilter !== 'All') && (
              <button
                onClick={() => {
                  setSearchTerm('');
                  setStatusFilter('All');
                  setCurrentPage(1);
                }}
                className="mt-2 text-xs text-[#E6A05A] hover:underline font-semibold cursor-pointer"
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
                  <th className="py-3 px-4">Order ID & Customer</th>
                  <th className="py-3 px-4">Subscription & Amount</th>
                  <th className="py-3 px-4">Network & Wallet</th>
                  <th className="py-3 px-4">Status & Details</th>
                  <th className="py-3 px-4">Transaction (TXID)</th>
                  <th className="py-3 px-4">Timeline</th>
                  <th className="py-3 px-4 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {paginatedOrders.map((order) => {
                  const isCopiedOrder = copiedId === order.id;
                  const isCopiedTx = copiedId === order.txId;
                  const isCopiedAddr = copiedId === order.depositAddress;
                  const canReview = order.status === 'Pending' || order.status === 'Confirming' || order.status === 'Manual Review';

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
                              className="text-slate-500 hover:text-slate-300 cursor-pointer"
                            >
                              {isCopiedOrder ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            </button>
                          </div>
                          <div className="text-slate-200 font-medium flex items-center gap-1.5">
                            <User className="h-3 w-3 text-slate-500" />
                            <span>{order.userEmail}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            UID: {order.userId} · Org: {order.orgId}
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
                          <div className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                            {order.billingInterval} billing
                          </div>
                        </div>
                      </td>

                      {/* Network & Deposit Address */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1">
                          <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            TRON (TRC20)
                          </div>
                          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400">
                            <span className="truncate max-w-[130px]" title={order.depositAddress}>
                              {order.depositAddress}
                            </span>
                            <button
                              onClick={() => copyToClipboard(order.depositAddress, order.depositAddress)}
                              title="Copy Deposit Address"
                              className="text-slate-500 hover:text-slate-300 shrink-0 cursor-pointer"
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
                          {order.rejectionReason && (
                            <div className="text-[11px] text-rose-300 bg-rose-950/30 p-1.5 rounded border border-rose-800/40">
                              <span className="font-semibold block text-[10px] uppercase text-rose-400">Reason:</span>
                              {order.rejectionReason}
                            </div>
                          )}
                          {order.approvedBy && (
                            <div className="text-[10px] text-emerald-400">
                              Approved by: {order.approvedBy}
                            </div>
                          )}
                          {order.verificationLog && !order.rejectionReason && (
                            <div className="text-[10px] text-slate-500 max-w-[180px] leading-tight truncate" title={order.verificationLog}>
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
                                className="text-slate-500 hover:text-slate-300 shrink-0 cursor-pointer"
                              >
                                {isCopiedTx ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              </button>
                            </div>
                            <a
                              href={`https://tronscan.org/#/transaction/${order.txId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
                            >
                              TronScan <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-slate-600 text-[11px] italic">Not attached yet</span>
                        )}
                      </td>

                      {/* Timeline */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1 text-[11px]">
                          <div className="text-slate-300">
                            <span className="text-slate-500">Created:</span> {formatDate(order.createdAt)}
                          </div>
                          {order.confirmedAt && (
                            <div className="text-emerald-400 font-medium">
                              <span className="text-slate-500">Confirmed:</span> {formatDate(order.confirmedAt)}
                            </div>
                          )}
                          {order.rejectedAt && (
                            <div className="text-rose-400">
                              <span className="text-slate-500">Rejected:</span> {formatDate(order.rejectedAt)}
                            </div>
                          )}
                          {order.status !== 'Paid' && order.status !== 'Rejected' && order.status !== 'Cancelled' && (
                            <div className="text-slate-400">
                              <span className="text-slate-500">Expires:</span> {formatDate(order.expiresAt)}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Admin Actions */}
                      <td className="py-3.5 px-4 align-top text-right">
                        {canReview ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setApprovingOrder(order);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center gap-1 shadow-sm cursor-pointer"
                              title="Approve payment and activate subscription"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Approve</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setRejectionReason('');
                                setRejectingOrder(order);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400 hover:text-rose-200 border border-slate-700 hover:border-rose-800 font-semibold text-xs transition-colors flex items-center gap-1 cursor-pointer"
                              title="Reject payment request"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        ) : order.status === 'Paid' ? (
                          <span className="text-emerald-400 font-medium text-xs flex items-center justify-end gap-1">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            Active Plan
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs italic">
                            Closed
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <div>
              Page <span className="text-white font-medium">{currentPage}</span> of{' '}
              <span className="text-white font-medium">{totalPages}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal: Approve Payment */}
      {approvingOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !actionLoading) setApprovingOrder(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md bg-[#0F172A] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5 text-slate-200">
            <button
              onClick={() => !actionLoading && setApprovingOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Confirm Payment Approval</h3>
                <p className="text-xs text-slate-400">Grant subscription and issue official receipt</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Customer:</span>
                <span className="text-white font-medium">{approvingOrder.userEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Plan:</span>
                <span className="text-[#E6A05A] font-bold">{approvingOrder.planName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount:</span>
                <span className="font-mono text-emerald-400 font-bold">{approvingOrder.amount} USDT</span>
              </div>
              {approvingOrder.txId && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-400">TXID:</span>
                  <span className="font-mono text-slate-300 truncate max-w-[180px]">{approvingOrder.txId}</span>
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/40 text-xs text-emerald-300 leading-relaxed">
              Approving this payment will immediately upgrade the customer's organization to the <strong className="text-white">{approvingOrder.planName}</strong> plan and record your administrator account as the approver.
            </div>

            {actionError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setApprovingOrder(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleApproveConfirm}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-lg shadow-emerald-900/30 disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing Approval...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Confirm & Activate Subscription</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Reject Payment */}
      {rejectingOrder && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !actionLoading) setRejectingOrder(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md bg-[#0F172A] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5 text-slate-200">
            <button
              onClick={() => !actionLoading && setRejectingOrder(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
                <XCircle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Decline Payment Order</h3>
                <p className="text-xs text-slate-400">Mark order as Rejected without activating subscription</p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Customer:</span>
                <span className="text-white font-medium">{rejectingOrder.userEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Order ID:</span>
                <span className="font-mono text-slate-300">{rejectingOrder.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Amount:</span>
                <span className="font-mono text-white font-bold">{rejectingOrder.amount} USDT</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 block">
                Rejection Reason (Visible to Customer):
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Transaction hash not found on TRON blockchain, insufficient transfer amount, or invalid deposit."
                rows={3}
                className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            {actionError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{actionError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setRejectingOrder(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleRejectConfirm}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 shadow-lg shadow-rose-900/30 disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Rejecting...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Confirm Rejection</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
