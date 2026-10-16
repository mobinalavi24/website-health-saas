import React, { useState, useEffect } from 'react';
import {
  Wallet,
  Check,
  Copy,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Bell,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type {
  WithdrawalRequestRecord,
  WithdrawalStatus,
  AdminReferralOverview,
} from '../types.ts';

export const AdminWithdrawalsView: React.FC = () => {
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequestRecord[]>([]);
  const [metrics, setMetrics] = useState<AdminReferralOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Action Modals
  const [approveModalItem, setApproveModalItem] = useState<WithdrawalRequestRecord | null>(null);
  const [markPaidModalItem, setMarkPaidModalItem] = useState<WithdrawalRequestRecord | null>(null);
  const [txHashInput, setTxHashInput] = useState('');
  const [rejectModalItem, setRejectModalItem] = useState<WithdrawalRequestRecord | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getAdminWithdrawals();
      setWithdrawals(res.requests || []);
      setMetrics(res.overview || null);
    } catch (err: any) {
      setError(err.message || 'Failed to load withdrawal requests.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleExpandCustomers = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleApproveConfirm = async () => {
    if (!approveModalItem) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await apiClient.approveWithdrawalForPayout(approveModalItem.id);
      setToast(res.message || `Withdrawal ${approveModalItem.id} approved for payout.`);
      setTimeout(() => setToast(null), 4500);
      setApproveModalItem(null);
      await loadData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to approve withdrawal.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkPaidConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!markPaidModalItem) return;
    if (!txHashInput.trim() || txHashInput.trim().length < 8) {
      setActionError('A valid TRON (TRC20) payout transaction hash (txHash) is required.');
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await apiClient.markWithdrawalAsPaid(markPaidModalItem.id, txHashInput.trim());
      setToast(res.message || `Withdrawal ${markPaidModalItem.id} marked as paid!`);
      setTimeout(() => setToast(null), 4500);
      setMarkPaidModalItem(null);
      setTxHashInput('');
      await loadData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to mark withdrawal as paid.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRejectConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalItem) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await apiClient.rejectWithdrawalRequest(
        rejectModalItem.id,
        rejectionReasonInput.trim() || undefined
      );
      setToast(
        res.message ||
          `Withdrawal ${rejectModalItem.id} rejected and reserved funds returned to user's available balance.`
      );
      setTimeout(() => setToast(null), 4500);
      setRejectModalItem(null);
      setRejectionReasonInput('');
      await loadData();
    } catch (err: any) {
      setActionError(err.message || 'Failed to reject withdrawal.');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredWithdrawals = withdrawals.filter((w) => {
    if (statusFilter !== 'ALL' && w.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const matchId = w.id.toLowerCase().includes(q);
      const matchEmail = w.userEmail.toLowerCase().includes(q);
      const matchUser = w.userId.toLowerCase().includes(q);
      const matchCode = w.referralCode.toLowerCase().includes(q);
      const matchWallet = w.walletAddress.toLowerCase().includes(q);
      const matchTx = (w.txHash || '').toLowerCase().includes(q);
      const matchCustomer = (w.referredCustomers || []).some((rc) =>
        rc.email.toLowerCase().includes(q)
      );
      return (
        matchId ||
        matchEmail ||
        matchUser ||
        matchCode ||
        matchWallet ||
        matchTx ||
        matchCustomer
      );
    }
    return true;
  });

  const getStatusBadge = (status: WithdrawalStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="h-3 w-3" /> Paid
          </span>
        );
      case 'approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30">
            <ShieldCheck className="h-3 w-3" /> Approved for Payout
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <XCircle className="h-3 w-3" /> Rejected
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <XCircle className="h-3 w-3" /> Cancelled
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Clock className="h-3 w-3" /> Pending Review
          </span>
        );
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <Wallet className="h-5 w-5 text-[#E6A05A]" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Referral Commissions & Withdrawal Requests
            </h1>
            {metrics && metrics.pendingWithdrawalRequestsCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-400 text-black animate-pulse">
                <Bell className="h-3 w-3" />
                {metrics.pendingWithdrawalRequestsCount} Pending
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Super Admin ledger control for partner commissions, reserved liabilities, and USDT — TRC20 (TRON) payout settlements.
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="self-start sm:self-auto flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-[#E6A05A]' : ''}`} />
          <span>Refresh Ledger</span>
        </button>
      </div>

      {toast && (
        <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Admin Referral & Withdrawal Overview Metrics (6 Required KPIs) */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-[11px] text-slate-400 block">Commissions Generated</span>
            <div className="text-xl font-extrabold font-mono text-[#E6A05A] tabular-nums">
              ${metrics.totalReferralCommissionsGenerated.toFixed(2)}
            </div>
            <p className="text-[10px] text-slate-500">40% lifetime total</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-[11px] text-slate-400 block">Available Liabilities</span>
            <div className="text-xl font-extrabold font-mono text-white tabular-nums">
              ${metrics.totalAvailableReferralLiabilities.toFixed(2)}
            </div>
            <p className="text-[10px] text-slate-500">Unwithdrawn user balances</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-[11px] text-slate-400 block">Reserved for Pending</span>
            <div className="text-xl font-extrabold font-mono text-amber-400 tabular-nums">
              ${metrics.totalReservedForPendingWithdrawals.toFixed(2)}
            </div>
            <p className="text-[10px] text-slate-500">Locked for active requests</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-[11px] text-slate-400 block">Pending Requests</span>
            <div className="text-xl font-extrabold font-mono text-amber-400 tabular-nums">
              {metrics.pendingWithdrawalRequestsCount}
            </div>
            <p className="text-[10px] text-slate-500">Awaiting payout / review</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-[11px] text-slate-400 block">Successfully Paid</span>
            <div className="text-xl font-extrabold font-mono text-emerald-400 tabular-nums">
              ${metrics.totalSuccessfullyPaidWithdrawals.toFixed(2)}
            </div>
            <p className="text-[10px] text-slate-500">Completed TRC20 payouts</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-[11px] text-slate-400 block">Rejected Requests</span>
            <div className="text-xl font-extrabold font-mono text-rose-400 tabular-nums">
              {metrics.totalRejectedRequestsCount}
            </div>
            <p className="text-[10px] text-slate-500">Declined & refunded</p>
          </div>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0F172A] border border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {(['ALL', 'pending', 'approved', 'paid', 'rejected', 'cancelled'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg font-medium capitalize transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-[#E6A05A] text-[#0B1120] font-bold'
                  : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {st === 'ALL' ? 'All Requests' : st}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search ID, referrer, customer, wallet, TX..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
          />
        </div>
      </div>

      {/* Withdrawal Requests Table */}
      <div className="rounded-2xl border border-slate-800 bg-[#0F172A] overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-white">
            Withdrawal Requests ({filteredWithdrawals.length})
          </h2>
          <span className="text-xs font-mono text-emerald-400">
            Network: USDT — TRC20 (TRON)
          </span>
        </div>

        {filteredWithdrawals.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            No withdrawal requests match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 text-[11px]">
                <tr>
                  <th className="py-3 px-4">Request ID & Created</th>
                  <th className="py-3 px-4">Referrer Info</th>
                  <th className="py-3 px-4">Referred Customer(s)</th>
                  <th className="py-3 px-4 text-right">Amount & Pre-Balance</th>
                  <th className="py-3 px-4">USDT TRC20 Destination</th>
                  <th className="py-3 px-4">Status & Audit Info</th>
                  <th className="py-3 px-4 text-right">Admin Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filteredWithdrawals.map((w) => {
                  const customers = w.referredCustomers || [];
                  const isExpanded = !!expandedRows[w.id];
                  const canApprove = w.status === 'pending';
                  const canMarkPaid = w.status === 'pending' || w.status === 'approved';
                  const canReject = w.status === 'pending' || w.status === 'approved';

                  return (
                    <tr key={w.id} className="hover:bg-slate-900/40 transition-colors align-top">
                      {/* Request ID & Created Timestamp */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="font-bold text-white text-xs">{w.id}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {new Date(w.createdAt).toLocaleString()}
                        </div>
                      </td>

                      {/* Referrer Email, User ID, Referral Code */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-white">{w.userEmail}</div>
                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                          ID: <span className="text-slate-300">{w.userId}</span>
                        </div>
                        <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#E6A05A]/10 border border-[#E6A05A]/30 font-mono text-[10px] text-[#E6A05A] font-bold">
                          Code: {w.referralCode}
                        </div>
                      </td>

                      {/* Referred Customer Email(s) with expandable list */}
                      <td className="py-3.5 px-4">
                        {customers.length === 0 ? (
                          <span className="text-slate-500 text-[11px]">No linked customer records</span>
                        ) : customers.length === 1 ? (
                          <div className="space-y-0.5">
                            <span className="font-mono text-xs text-slate-200">{customers[0].email}</span>
                            {customers[0].commissionAmount !== undefined && (
                              <div className="text-[10px] text-slate-400 font-mono">
                                Commission: +${customers[0].commissionAmount.toFixed(2)}
                                {customers[0].orderId ? ` (Order ${customers[0].orderId})` : ''}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-slate-200">
                                {customers[0].email}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleExpandCustomers(w.id)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-[#E6A05A] border border-slate-700 cursor-pointer"
                              >
                                <span>
                                  {isExpanded
                                    ? 'Hide'
                                    : `+${customers.length - 1} more`}
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="h-3 w-3" />
                                ) : (
                                  <ChevronDown className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                            {isExpanded && (
                              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5 max-h-40 overflow-y-auto">
                                {customers.map((rc, idx) => (
                                  <div
                                    key={idx}
                                    className="text-[11px] font-mono text-slate-300 flex items-center justify-between gap-3 border-b border-slate-900 pb-1 last:border-none last:pb-0"
                                  >
                                    <span>{rc.email}</span>
                                    {rc.commissionAmount !== undefined && rc.commissionAmount > 0 && (
                                      <span className="text-emerald-400">
                                        +${rc.commissionAmount.toFixed(2)}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Requested Amount & Available Balance Before Request */}
                      <td className="py-3.5 px-4 text-right font-mono">
                        <div className="text-sm font-extrabold text-emerald-400 tabular-nums">
                          ${w.amount.toFixed(2)} {w.currency}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Avail. Before: <span className="text-slate-200">${w.availableBalanceBefore.toFixed(2)}</span>
                        </div>
                      </td>

                      {/* USDT TRC20 Destination Wallet Address */}
                      <td className="py-3.5 px-4 font-mono">
                        <div className="text-[10px] font-sans font-bold text-emerald-400 mb-0.5">
                          {w.network}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="text-[11px] text-slate-200 break-all max-w-[180px]"
                            title={w.walletAddress}
                          >
                            {w.walletAddress}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(w.walletAddress, `addr-${w.id}`)}
                            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white shrink-0 cursor-pointer"
                            title="Copy TRC20 Address"
                          >
                            {copiedId === `addr-${w.id}` ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Current Status, Admin Review Info, TX Hash */}
                      <td className="py-3.5 px-4 space-y-1">
                        <div>{getStatusBadge(w.status)}</div>

                        {w.approvedByEmail && (
                          <div className="text-[10px] text-slate-400">
                            Approved by <span className="text-slate-300">{w.approvedByEmail}</span>
                            {w.approvedAt && ` (${new Date(w.approvedAt).toLocaleDateString()})`}
                          </div>
                        )}

                        {w.paidByEmail && (
                          <div className="text-[10px] text-emerald-400">
                            Paid by {w.paidByEmail}
                            {w.paidAt && ` (${new Date(w.paidAt).toLocaleString()})`}
                          </div>
                        )}

                        {w.txHash && (
                          <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-800/60 px-2 py-0.5 rounded">
                            <span className="truncate max-w-[140px]" title={w.txHash}>
                              TX: {w.txHash}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(w.txHash!, `tx-${w.id}`)}
                              className="text-slate-400 hover:text-white"
                              title="Copy TX Hash"
                            >
                              {copiedId === `tx-${w.id}` ? (
                                <Check className="h-2.5 w-2.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-2.5 w-2.5" />
                              )}
                            </button>
                          </div>
                        )}

                        {w.rejectedByEmail && (
                          <div className="text-[10px] text-rose-400">
                            Rejected by {w.rejectedByEmail}
                            {w.rejectionReason && `: "${w.rejectionReason}"`}
                          </div>
                        )}
                      </td>

                      {/* Admin Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1.5">
                          {canApprove && (
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setApproveModalItem(w);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              Approve for Payout
                            </button>
                          )}

                          {canMarkPaid && (
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setTxHashInput('');
                                setMarkPaidModalItem(w);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              Mark as Paid
                            </button>
                          )}

                          {canReject && (
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setRejectionReasonInput('');
                                setRejectModalItem(w);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
                            >
                              Reject
                            </button>
                          )}

                          {!canApprove && !canMarkPaid && !canReject && (
                            <span className="text-[11px] text-slate-500 font-mono">Finalized</span>
                          )}
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

      {/* Modal 1: Approve for Payout Confirmation */}
      {approveModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4 text-xs shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
                <ShieldCheck className="h-5 w-5" />
                <span>Approve Withdrawal for Payout</span>
              </div>
              <button
                onClick={() => setApproveModalItem(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-slate-300 leading-relaxed">
              You are approving withdrawal request <strong className="font-mono text-white">{approveModalItem.id}</strong> for{' '}
              <strong className="font-mono text-emerald-400">${approveModalItem.amount.toFixed(2)} USD</strong> to{' '}
              <strong className="text-white">{approveModalItem.userEmail}</strong>.
            </p>

            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1 font-mono text-[11px]">
              <div className="text-slate-400">Destination ({approveModalItem.network}):</div>
              <div className="text-white break-all">{approveModalItem.walletAddress}</div>
            </div>

            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-300 text-[11px]">
              Note: Approving for payout marks the request as <strong>approved</strong> and keeps the funds reserved. Once you transfer the USDT TRC20 on-chain, click <strong>Mark as Paid</strong> and record the transaction hash.
            </div>

            {actionError && <p className="text-rose-400 font-medium">{actionError}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setApproveModalItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveConfirm}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Mark as Paid (Requires Payout TX Hash) */}
      {markPaidModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <form
            onSubmit={handleMarkPaidConfirm}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4 text-xs shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <CheckCircle2 className="h-5 w-5" />
                <span>Mark Withdrawal as Paid</span>
              </div>
              <button
                type="button"
                onClick={() => setMarkPaidModalItem(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Referrer:</span>
                <span className="text-white font-semibold">{markPaidModalItem.userEmail}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Payout Amount:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  ${markPaidModalItem.amount.toFixed(2)} USD (USDT)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Network:</span>
                <span className="font-mono text-[#E6A05A] font-semibold">
                  {markPaidModalItem.network}
                </span>
              </div>
              <div className="pt-1 border-t border-slate-800">
                <span className="text-slate-400 block mb-1">Recipient TRC20 Wallet:</span>
                <div className="font-mono text-[11px] text-white break-all select-all">
                  {markPaidModalItem.walletAddress}
                </div>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">
                TRON (TRC20) Payout Transaction Hash (TXID) *
              </label>
              <input
                type="text"
                required
                value={txHashInput}
                onChange={(e) => setTxHashInput(e.target.value)}
                placeholder="Enter verified TRON transaction hash..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-white focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                This action permanently finalizes the reserved balance deduction and records the payout on the user's ledger.
              </p>
            </div>

            {actionError && <p className="text-rose-400 font-medium">{actionError}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMarkPaidModalItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? 'Recording Payout...' : 'Confirm & Mark as Paid'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 3: Reject Withdrawal (Releases Reserved Balance) */}
      {rejectModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <form
            onSubmit={handleRejectConfirm}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4 text-xs shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                <XCircle className="h-5 w-5" />
                <span>Reject Withdrawal Request</span>
              </div>
              <button
                type="button"
                onClick={() => setRejectModalItem(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-slate-300 leading-relaxed">
              Rejecting request <strong className="font-mono text-white">{rejectModalItem.id}</strong> will immediately release the reserved{' '}
              <strong className="font-mono text-emerald-400">${rejectModalItem.amount.toFixed(2)} USD</strong> back to{' '}
              <strong className="text-white">{rejectModalItem.userEmail}</strong>'s available referral balance.
            </p>

            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">
                Rejection Reason (Optional)
              </label>
              <textarea
                rows={3}
                value={rejectionReasonInput}
                onChange={(e) => setRejectionReasonInput(e.target.value)}
                placeholder="Provide a reason visible to the user (e.g., invalid wallet address verification)..."
                className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            {actionError && <p className="text-rose-400 font-medium">{actionError}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectModalItem(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:text-white font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Reject & Refund Balance'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
