import React, { useState, useEffect } from 'react';
import {
  Shield,
  Users,
  Server,
  Play,
  Check,
  AlertTriangle,
  RefreshCw,
  MessageSquare,
  Clock,
  Coins,
  CheckCircle2,
  ArrowRight,
  Gift,
  Wallet,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  X,
  Loader2,
  XCircle,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type {
  SupportTicket,
  CryptoPaymentOrder,
  AdminReferralOverview,
  WithdrawalRequestRecord,
  ReferralCommissionRecord,
} from '../types.ts';

interface AdminViewProps {
  onNavigate?: (view: any) => void;
}

export const AdminView: React.FC<AdminViewProps> = ({ onNavigate }) => {
  const [activeAdminTab, setActiveAdminTab] = useState<'system' | 'referrals'>('referrals');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [paymentOrders, setPaymentOrders] = useState<CryptoPaymentOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggeringWorker, setTriggeringWorker] = useState(false);
  const [workerToast, setWorkerToast] = useState<string | null>(null);

  // Referral & Withdrawal Management State
  const [referralOverview, setReferralOverview] = useState<AdminReferralOverview | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestRecord[]>([]);
  const [commissions, setCommissions] = useState<ReferralCommissionRecord[]>([]);
  const [expandedWithdrawalId, setExpandedWithdrawalId] = useState<string | null>(null);

  // Pay Modal State
  const [payModalWithdrawal, setPayModalWithdrawal] = useState<WithdrawalRequestRecord | null>(null);
  const [payoutTxIdInput, setPayoutTxIdInput] = useState('');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Reject Modal State
  const [rejectModalWithdrawal, setRejectModalWithdrawal] = useState<WithdrawalRequestRecord | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    loadAdminData();
  }, []);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [st, u, t, orders, refOverview, wthList, commList] = await Promise.all([
        apiClient.getAdminOverview().catch(() => null),
        apiClient.getAdminUsers().catch(() => []),
        apiClient.getTickets().catch(() => []),
        apiClient.getAdminCryptoOrders().catch(() => []),
        apiClient.getAdminReferralOverview().catch(() => null),
        apiClient.getAdminWithdrawals().catch(() => []),
        apiClient.getAdminCommissions().catch(() => []),
      ]);
      setStats(st);
      setUsers(Array.isArray(u) ? u : []);
      setTickets(Array.isArray(t) ? t : []);
      setPaymentOrders(Array.isArray(orders) ? orders : []);
      setReferralOverview(refOverview);
      setWithdrawals(Array.isArray(wthList) ? wthList : []);
      setCommissions(Array.isArray(commList) ? commList : []);
    } catch (e) {
      console.error('Failed to load admin telemetry', e);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerWorker = async () => {
    setTriggeringWorker(true);
    try {
      await apiClient.triggerWorkerTick();
      setWorkerToast('Worker tick triggered immediately.');
      setTimeout(() => setWorkerToast(null), 3000);
      await loadAdminData();
    } catch (err: any) {
      alert(`Worker trigger failed: ${err.message}`);
    } finally {
      setTriggeringWorker(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenPayModal = (w: WithdrawalRequestRecord) => {
    setPayModalWithdrawal(w);
    setPayoutTxIdInput('');
    setPayError(null);
  };

  const handleConfirmPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModalWithdrawal) return;
    const cleanTx = payoutTxIdInput.trim();
    if (!cleanTx || cleanTx.length < 10) {
      setPayError('Please enter a valid Tron transaction hash (TXID).');
      return;
    }
    setPaying(true);
    setPayError(null);
    try {
      await apiClient.payAdminWithdrawal(payModalWithdrawal.id, cleanTx);
      setPayModalWithdrawal(null);
      setWorkerToast(`Withdrawal marked as paid! TXID: ${cleanTx}`);
      setTimeout(() => setWorkerToast(null), 5000);
      await loadAdminData();
    } catch (err: any) {
      setPayError(err.message || 'Failed to finalize payout.');
    } finally {
      setPaying(false);
    }
  };

  const handleOpenRejectModal = (w: WithdrawalRequestRecord) => {
    setRejectModalWithdrawal(w);
    setRejectReasonInput('Declined after compliance review. Funds restored to balance.');
    setRejectError(null);
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalWithdrawal) return;
    setRejecting(true);
    setRejectError(null);
    try {
      await apiClient.rejectAdminWithdrawal(rejectModalWithdrawal.id, rejectReasonInput.trim());
      setRejectModalWithdrawal(null);
      setWorkerToast('Withdrawal rejected. Reserved funds refunded to user balance.');
      setTimeout(() => setWorkerToast(null), 5000);
      await loadAdminData();
    } catch (err: any) {
      setRejectError(err.message || 'Failed to reject withdrawal.');
    } finally {
      setRejecting(false);
    }
  };

  const pendingPayments = paymentOrders.filter(
    (o) => o.status === 'Pending' || o.status === 'Confirming' || o.status === 'Manual Review'
  );
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');

  return (
    <div className="space-y-8">
      {/* Toast */}
      {workerToast && (
        <div className="fixed top-20 right-6 z-50 flex items-center gap-2 p-4 rounded-xl bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 text-xs shadow-2xl backdrop-blur-md animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{workerToast}</span>
        </div>
      )}

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
            Global system health, 40% referral commission & withdrawal management, background workers, and payment reviews.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onNavigate && (
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
          )}

          <button
            onClick={loadAdminData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-[#E6A05A]' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleTriggerWorker}
            disabled={triggeringWorker}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 text-[#E6A05A]" />
            <span>{triggeringWorker ? 'Triggering...' : 'Force Worker'}</span>
          </button>
        </div>
      </div>

      {/* Admin Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveAdminTab('referrals')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
            activeAdminTab === 'referrals'
              ? 'bg-[#E6A05A] text-[#0B1120] shadow-md shadow-[#E6A05A]/20'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Gift className="h-4 w-4" />
          <span>Referral Commissions & Withdrawals</span>
          {pendingWithdrawals.length > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
              activeAdminTab === 'referrals' ? 'bg-black text-[#E6A05A]' : 'bg-[#E6A05A] text-black'
            }`}>
              {pendingWithdrawals.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveAdminTab('system')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
            activeAdminTab === 'system'
              ? 'bg-[#E6A05A] text-[#0B1120] shadow-md shadow-[#E6A05A]/20'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Server className="h-4 w-4" />
          <span>System Overview & Accounts</span>
        </button>
      </div>

      {/* TAB 1: REFERRAL & WITHDRAWAL MANAGEMENT */}
      {activeAdminTab === 'referrals' && (
        <div className="space-y-6 animate-in fade-in">
          {/* Overview KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] font-medium text-slate-400">Total Commissions Awarded</span>
              <div className="text-xl font-bold font-mono text-white mt-1">
                {referralOverview ? referralOverview.totalCommissionsGenerated.toFixed(2) : '0.00'}{' '}
                <span className="text-xs text-[#E6A05A]">USDT</span>
              </div>
              <span className="text-[10px] text-slate-500">40% share of approved sales</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] font-medium text-slate-400">Total Paid Out</span>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                {referralOverview ? referralOverview.totalPaidWithdrawals.toFixed(2) : '0.00'}{' '}
                <span className="text-xs text-emerald-300">USDT</span>
              </div>
              <span className="text-[10px] text-slate-500">Completed TRC-20 transfers</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] font-medium text-slate-400">Pending Requests</span>
              <div className="text-xl font-bold font-mono text-amber-400 mt-1 flex items-center gap-1.5">
                <span>{referralOverview ? referralOverview.pendingWithdrawalsCount : 0}</span>
                <span className="text-xs font-normal text-slate-400">requests</span>
              </div>
              <span className="text-[10px] text-amber-400/80">Requires admin review</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] font-medium text-slate-400">Reserved / Held</span>
              <div className="text-xl font-bold font-mono text-amber-300 mt-1">
                {referralOverview ? referralOverview.totalFundsReserved.toFixed(2) : '0.00'}{' '}
                <span className="text-xs text-amber-200">USDT</span>
              </div>
              <span className="text-[10px] text-slate-500">Locked in pending payouts</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] font-medium text-slate-400">Available Liabilities</span>
              <div className="text-xl font-bold font-mono text-blue-400 mt-1">
                {referralOverview ? referralOverview.totalAvailableLiabilities.toFixed(2) : '0.00'}{' '}
                <span className="text-xs text-blue-300">USDT</span>
              </div>
              <span className="text-[10px] text-slate-500">In user wallets awaiting withdrawal</span>
            </div>
          </div>

          {/* Withdrawal Management Table */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-[#E6A05A]" />
                <h2 className="text-base font-bold text-white">Withdrawal Requests Management ({withdrawals.length})</h2>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Network: <strong>USDT — TRC20 (TRON)</strong>
              </span>
            </div>

            {withdrawals.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No withdrawal requests recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
                    <tr>
                      <th className="py-2.5">User / Referrer</th>
                      <th className="py-2.5">Code</th>
                      <th className="py-2.5">Amount</th>
                      <th className="py-2.5">TRC20 Destination</th>
                      <th className="py-2.5">Requested</th>
                      <th className="py-2.5">Status</th>
                      <th className="py-2.5 text-right">Actions / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {withdrawals.map((w) => {
                      const isExpanded = expandedWithdrawalId === w.id;
                      const hasCustomers = w.associatedCustomers && w.associatedCustomers.length > 0;

                      return (
                        <React.Fragment key={w.id}>
                          <tr className={`text-slate-300 hover:bg-slate-900/40 transition-colors ${
                            w.status === 'pending' ? 'bg-amber-950/10' : ''
                          }`}>
                            <td className="py-3 font-sans">
                              <span className="font-semibold text-white block">{w.userEmail || w.userId}</span>
                              <span className="text-[10px] text-slate-500 font-mono">ID: {w.userId}</span>
                            </td>
                            <td className="py-3 font-mono font-bold text-[#E6A05A]">
                              {w.referralCode || '—'}
                            </td>
                            <td className="py-3 font-extrabold text-white text-sm">
                              {(w.amountCents / 100).toFixed(2)} USDT
                            </td>
                            <td className="py-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-300 truncate max-w-[130px]" title={w.trc20Address}>
                                  {w.trc20Address.substring(0, 8)}...{w.trc20Address.substring(w.trc20Address.length - 6)}
                                </span>
                                <button
                                  onClick={() => handleCopy(w.id, w.trc20Address)}
                                  className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                                  title="Copy address"
                                >
                                  {copiedId === w.id ? (
                                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            </td>
                            <td className="py-3 text-slate-400 text-[11px]">
                              {new Date(w.createdAt).toLocaleDateString()} {new Date(w.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-3 font-sans">
                              {w.status === 'paid' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  <CheckCircle2 className="h-3 w-3" />
                                  <span>Paid</span>
                                </span>
                              )}
                              {w.status === 'approved' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  <Clock className="h-3 w-3" />
                                  <span>Approved</span>
                                </span>
                              )}
                              {w.status === 'pending' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  <Clock className="h-3 w-3" />
                                  <span>Pending</span>
                                </span>
                              )}
                              {w.status === 'rejected' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">
                                  <XCircle className="h-3 w-3" />
                                  <span>Declined</span>
                                </span>
                              )}
                              {w.status === 'cancelled' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-700/30 text-slate-400 border border-slate-700/50">
                                  <span>Cancelled</span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 text-right font-sans">
                              <div className="flex items-center justify-end gap-2">
                                {(w.status === 'pending' || w.status === 'approved') && (
                                  <>
                                    <button
                                      onClick={() => handleOpenPayModal(w)}
                                      className="px-2.5 py-1 text-[11px] font-semibold text-[#0B1120] bg-emerald-400 hover:bg-emerald-300 rounded transition-colors cursor-pointer"
                                    >
                                      Approve & Pay
                                    </button>
                                    <button
                                      onClick={() => handleOpenRejectModal(w)}
                                      className="px-2 py-1 text-[11px] font-medium text-rose-300 hover:text-white bg-rose-950/40 border border-rose-900 rounded transition-colors cursor-pointer"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}

                                {w.status === 'paid' && w.payoutTxId && (
                                  <a
                                    href={`https://tronscan.org/#/transaction/${w.payoutTxId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#E6A05A] hover:bg-slate-800"
                                  >
                                    <span>TronScan</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}

                                <button
                                  onClick={() => setExpandedWithdrawalId(isExpanded ? null : w.id)}
                                  className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
                                  title="View associated referred customers"
                                >
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Customer Attribution Accordion */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={7} className="p-4 bg-slate-900/70 border-b border-slate-800">
                                <div className="space-y-3">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-white flex items-center gap-1.5">
                                      <Users className="h-4 w-4 text-[#E6A05A]" />
                                      Associated Referred Customers for {w.userEmail}
                                    </span>
                                    {w.payoutTxId && (
                                      <span className="text-[11px] font-mono text-slate-400">
                                        Payout TXID: <strong className="text-white">{w.payoutTxId}</strong>
                                      </span>
                                    )}
                                  </div>

                                  {!hasCustomers ? (
                                    <p className="text-[11px] text-slate-400 italic">No customer purchase history mapped to this user.</p>
                                  ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px] font-mono">
                                      {w.associatedCustomers?.map((c, idx) => (
                                        <div key={idx} className="p-2.5 rounded-lg bg-black/40 border border-slate-800 space-y-1">
                                          <div className="flex items-center justify-between font-sans">
                                            <span className="font-semibold text-slate-200">{c.email}</span>
                                            <span className="text-emerald-400 font-mono font-bold">+{(c.commissionCents / 100).toFixed(2)} USDT</span>
                                          </div>
                                          <div className="text-[10px] text-slate-400 flex items-center justify-between">
                                            <span>{c.planName}</span>
                                            <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Global Commission Audit Ledger Table */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-[#E6A05A]" />
                <h2 className="text-base font-bold text-white">Platform Referral Commissions Audit Log ({commissions.length})</h2>
              </div>
              <span className="text-xs text-slate-400 font-mono">Immutable 40% Ledger</span>
            </div>

            {commissions.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No commissions earned across the platform yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
                    <tr>
                      <th className="py-2.5">Date</th>
                      <th className="py-2.5">Referrer</th>
                      <th className="py-2.5">Referred Customer</th>
                      <th className="py-2.5">Order / Plan</th>
                      <th className="py-2.5">Paid Amount</th>
                      <th className="py-2.5">40% Commission</th>
                      <th className="py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {commissions.map((comm) => (
                      <tr key={comm.id} className="text-slate-300 hover:bg-slate-900/40 transition-colors">
                        <td className="py-3 text-slate-400">
                          {new Date(comm.createdAt).toLocaleDateString()} {new Date(comm.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 font-sans">
                          <span className="font-semibold text-white block">{(comm as any).referrerEmail || comm.referrerId}</span>
                          <span className="text-[10px] text-[#E6A05A] font-mono">Code: {comm.referralCode}</span>
                        </td>
                        <td className="py-3 font-sans">
                          <span className="text-slate-300">{(comm as any).referredUserEmail || comm.referredUserId}</span>
                        </td>
                        <td className="py-3">
                          <span className="px-2 py-0.5 rounded text-[11px] font-sans font-semibold bg-slate-800 text-slate-200 border border-slate-700">
                            {comm.planName}
                          </span>
                        </td>
                        <td className="py-3">
                          {(comm.orderAmountCents / 100).toFixed(2)} USDT
                        </td>
                        <td className="py-3 font-extrabold text-emerald-400">
                          +{(comm.commissionAmountCents / 100).toFixed(2)} USDT
                        </td>
                        <td className="py-3 font-sans">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Earned</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SYSTEM HEALTH, USERS & TICKETS */}
      {activeAdminTab === 'system' && (
        <div className="space-y-6 animate-in fade-in">
          {/* KPI Cards */}
          {stats && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-xs font-medium text-slate-400">Total Users</span>
                  <Users className="h-4 w-4 text-slate-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">{stats.totalUsers}</div>
              </div>

              <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-xs font-medium text-slate-400">Organizations</span>
                  <Server className="h-4 w-4 text-slate-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">{stats.totalOrganizations}</div>
              </div>

              <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-xs font-medium text-slate-400">Monitored Websites</span>
                  <Server className="h-4 w-4 text-slate-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-white">{stats.totalWebsites}</div>
                <div className="flex items-center gap-2 text-[10px] font-mono mt-2">
                  <span className="text-emerald-400">{stats.onlineWebsites} Online</span>
                  <span className="text-amber-400">{stats.degradedWebsites} Degraded</span>
                  <span className="text-rose-400">{stats.offlineWebsites} Offline</span>
                </div>
              </div>

              <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-xs font-medium text-slate-400">Active Incidents</span>
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold font-mono text-amber-400">{stats.activeIncidents}</div>
              </div>
            </div>
          )}

          {/* User Directory */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <h2 className="text-sm font-semibold text-white">User Accounts Directory ({users.length})</h2>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
                  <tr>
                    <th className="py-2">User</th>
                    <th className="py-2">Email</th>
                    <th className="py-2">Referral Code</th>
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
      )}

      {/* Pay Modal */}
      {payModalWithdrawal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <h3 className="text-base font-bold text-white">Approve & Mark Payout as Paid</h3>
              </div>
              <button
                onClick={() => setPayModalWithdrawal(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {payError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
                {payError}
              </div>
            )}

            <form onSubmit={handleConfirmPayout} className="space-y-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">User:</span>
                  <span className="text-white font-sans">{payModalWithdrawal.userEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Payout Amount:</span>
                  <span className="text-emerald-400 font-extrabold text-sm">
                    {(payModalWithdrawal.amountCents / 100).toFixed(2)} USDT
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Network:</span>
                  <span className="text-white">Tron (USDT-TRC20)</span>
                </div>
                <div className="flex flex-col pt-1">
                  <span className="text-slate-400 text-[10px]">Destination Address:</span>
                  <span className="text-white font-bold break-all bg-black/40 p-2 rounded mt-1 border border-slate-800">
                    {payModalWithdrawal.trc20Address}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Blockchain Payout Transaction Hash (TXID)
                </label>
                <input
                  type="text"
                  required
                  value={payoutTxIdInput}
                  onChange={(e) => setPayoutTxIdInput(e.target.value)}
                  placeholder="e.g. 84f4e240b91e98bbcfec2e07eb2305567b4..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono focus:outline-none focus:border-emerald-400"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  This transaction ID will be stored permanently and linked directly to TronScan for the user.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPayModalWithdrawal(null)}
                  className="px-4 py-2 rounded-lg text-slate-300 bg-slate-900 border border-slate-800 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paying}
                  className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition-colors disabled:opacity-60 flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/20"
                >
                  {paying ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Finalizing Payout...</span>
                    </>
                  ) : (
                    <span>Record Payout Completed</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Modal */}
      {rejectModalWithdrawal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <XCircle className="h-5 w-5 text-rose-400" />
                <h3 className="text-base font-bold text-white">Decline Withdrawal Request</h3>
              </div>
              <button
                onClick={() => setRejectModalWithdrawal(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {rejectError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
                {rejectError}
              </div>
            )}

            <form onSubmit={handleConfirmReject} className="space-y-4 text-xs">
              <p className="text-slate-300">
                Rejecting this request will immediately refund{' '}
                <strong className="text-white font-mono">
                  {(rejectModalWithdrawal.amountCents / 100).toFixed(2)} USDT
                </strong>{' '}
                back to <strong>{rejectModalWithdrawal.userEmail}</strong>&apos;s available referral wallet balance.
              </p>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Reason for Rejection (Visible to User)
                </label>
                <textarea
                  rows={3}
                  required
                  value={rejectReasonInput}
                  onChange={(e) => setRejectReasonInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-rose-400"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRejectModalWithdrawal(null)}
                  className="px-4 py-2 rounded-lg text-slate-300 bg-slate-900 border border-slate-800 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rejecting}
                  className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors disabled:opacity-60 flex items-center gap-1.5 cursor-pointer"
                >
                  {rejecting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Declining...</span>
                    </>
                  ) : (
                    <span>Decline & Refund Funds</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
