import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Check,
  RefreshCw,
  Clock,
  AlertCircle,
  X,
  ExternalLink,
  ShieldCheck,
  Copy,
  Receipt,
  ArrowRight
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { CryptoPaymentOrder, CryptoPaymentStatus } from '../types.ts';
import { CryptoPaymentModal } from './CryptoPaymentModal.tsx';

interface MyCryptoPaymentsViewProps {
  onNavigateToBilling?: () => void;
}

export const MyCryptoPaymentsView: React.FC<MyCryptoPaymentsViewProps> = ({
  onNavigateToBilling,
}) => {
  const [orders, setOrders] = useState<CryptoPaymentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeModalOrder, setActiveModalOrder] = useState<CryptoPaymentOrder | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      const data = await apiClient.getCryptoOrders();
      setOrders(data);
    } catch (err) {
      console.error('Failed to load user crypto orders', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadOrders();
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusBadge = (status: CryptoPaymentStatus) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <Check className="h-3 w-3" /> Paid
          </span>
        );
      case 'Pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> Pending
          </span>
        );
      case 'Confirming':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
            <RefreshCw className="h-3 w-3 animate-spin" /> Confirming
          </span>
        );
      case 'Manual Review':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertCircle className="h-3 w-3" /> Manual Review
          </span>
        );
      case 'Expired':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <Clock className="h-3 w-3" /> Expired
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <X className="h-3 w-3" /> Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
            {status}
          </span>
        );
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (statusFilter === 'ALL') return true;
    return o.status === statusFilter;
  });

  const totalPaidUsdt = orders
    .filter((o) => o.status === 'Paid')
    .reduce((sum, o) => sum + o.amount, 0);

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
              <QrCode className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              My Crypto Payments
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Personal overview of your cryptocurrency orders, real-time TRON confirmations, and LBank settlement receipts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-[#E6A05A]' : ''}`} />
            <span>Refresh Status</span>
          </button>

          {onNavigateToBilling && (
            <button
              onClick={onNavigateToBilling}
              className="px-3.5 py-2 rounded-xl bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <span>Upgrade / New Order</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-1">
          <span className="text-[11px] font-medium text-slate-400">Total Orders</span>
          <div className="text-2xl font-bold font-mono text-white">{orders.length}</div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-1">
          <span className="text-[11px] font-medium text-slate-400">Paid USDT Total</span>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {totalPaidUsdt} <span className="text-xs text-white">USDT</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-1">
          <span className="text-[11px] font-medium text-slate-400">Pending / Confirming</span>
          <div className="text-2xl font-bold font-mono text-amber-400">
            {orders.filter((o) => o.status === 'Pending' || o.status === 'Confirming').length}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-1">
          <span className="text-[11px] font-medium text-slate-400">Payment Network</span>
          <div className="text-sm font-bold font-mono text-[#E6A05A] pt-1">
            TRON (TRC20)
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 pt-2">
        <span className="text-xs text-slate-400 mr-2">Filter by Status:</span>
        {['ALL', 'Paid', 'Pending', 'Confirming', 'Manual Review', 'Expired', 'Failed'].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === st
                ? 'bg-[#E6A05A] text-[#0B1120] font-bold'
                : 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-2">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto text-[#E6A05A]" />
            <p className="text-xs">Loading cryptocurrency payment records...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
              <Receipt className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-white">No Payment Records Found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {statusFilter === 'ALL'
                ? "You haven't initiated any cryptocurrency orders yet. You can upgrade or subscribe to a plan using USDT (TRC20)."
                : `No orders matching status "${statusFilter}".`}
            </p>
            {onNavigateToBilling && statusFilter === 'ALL' && (
              <button
                onClick={onNavigateToBilling}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors"
              >
                <span>View Subscription Plans</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 bg-slate-900/60">
                <tr>
                  <th className="py-3.5 px-4">Order ID</th>
                  <th className="py-3.5 px-4">Plan Name</th>
                  <th className="py-3.5 px-4 text-right">Amount (USDT)</th>
                  <th className="py-3.5 px-4">Network</th>
                  <th className="py-3.5 px-4">Created Date</th>
                  <th className="py-3.5 px-4 text-center">Payment Status</th>
                  <th className="py-3.5 px-4">Transaction ID (TXID)</th>
                  <th className="py-3.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredOrders.map((ord) => {
                  const isPending = ord.status === 'Pending' || ord.status === 'Confirming';
                  return (
                    <tr key={ord.id} className="hover:bg-slate-900/40 transition-colors text-slate-300">
                      {/* Order ID */}
                      <td className="py-3.5 px-4 font-semibold text-white text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span>{ord.id}</span>
                          <button
                            onClick={() => handleCopy(ord.id, `ord_${ord.id}`)}
                            title="Copy Order ID"
                            className="text-slate-500 hover:text-white"
                          >
                            {copiedId === `ord_${ord.id}` ? (
                              <Check className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <Copy className="h-3 w-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Plan Name */}
                      <td className="py-3.5 px-4 font-sans text-xs font-medium text-slate-200">
                        {ord.planName}
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4 text-right font-bold text-[#E6A05A] text-sm tabular-nums">
                        {ord.amount} <span className="text-[10px] text-white">USDT</span>
                      </td>

                      {/* Network */}
                      <td className="py-3.5 px-4 font-sans">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {ord.network || 'TRON (TRC20)'}
                        </span>
                      </td>

                      {/* Created Date */}
                      <td className="py-3.5 px-4 text-slate-400 text-[11px] whitespace-nowrap">
                        {new Date(ord.createdAt).toLocaleString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>

                      {/* Payment Status */}
                      <td className="py-3.5 px-4 text-center font-sans">
                        {getStatusBadge(ord.status)}
                      </td>

                      {/* TXID */}
                      <td className="py-3.5 px-4 text-[11px] max-w-[160px]">
                        {ord.txId ? (
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-slate-300" title={ord.txId}>
                              {ord.txId.substring(0, 10)}...{ord.txId.substring(ord.txId.length - 6)}
                            </span>
                            <button
                              onClick={() => handleCopy(ord.txId!, `tx_${ord.id}`)}
                              title="Copy Transaction Hash"
                              className="text-slate-500 hover:text-white"
                            >
                              {copiedId === `tx_${ord.id}` ? (
                                <Check className="h-3 w-3 text-emerald-400" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                            <a
                              href={`https://tronscan.org/#/transaction/${encodeURIComponent(ord.txId)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-500 hover:text-[#E6A05A]"
                              title="View on TronScan Explorer"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="py-3.5 px-4 text-right font-sans">
                        {isPending ? (
                          <button
                            onClick={() => setActiveModalOrder(ord)}
                            className="px-3 py-1 rounded-lg bg-[#E6A05A] text-[#0B1120] font-bold text-xs hover:bg-[#cf863c] transition-colors shadow-sm"
                          >
                            Pay / Verify
                          </button>
                        ) : (
                          <button
                            onClick={() => setActiveModalOrder(ord)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
                          >
                            Details
                          </button>
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

      {/* Security & Architecture Note */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400 flex items-start gap-3">
        <ShieldCheck className="h-4 w-4 text-[#E6A05A] mt-0.5 shrink-0" />
        <div className="space-y-1">
          <span className="font-semibold text-white">Cryptographic Data Isolation</span>
          <p className="leading-relaxed text-[11px]">
            Your cryptocurrency orders are associated strictly with your authenticated account credentials. All incoming TRC20 transactions are confirmed via official LBank API ledger reconciliation and TRON blockchain block signatures.
          </p>
        </div>
      </div>

      {/* Crypto Payment Modal */}
      {activeModalOrder && (
        <CryptoPaymentModal
          order={activeModalOrder}
          onClose={() => setActiveModalOrder(null)}
          onPaymentSuccess={(updated) => {
            setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
            setActiveModalOrder(updated);
          }}
        />
      )}
    </div>
  );
};
