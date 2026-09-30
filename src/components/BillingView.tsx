import React, { useState, useEffect } from 'react';
import { Shield, Check, CreditCard, Download, FileText, ArrowRight, Sparkles, QrCode, ExternalLink, RefreshCw, AlertCircle, X, Lock } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { SubscriptionPlan, Organization, Invoice, CryptoPaymentOrder, LBankConnectionTestResult } from '../types.ts';
import { CryptoPaymentModal } from './CryptoPaymentModal.tsx';

interface BillingViewProps {
  organization: Organization | null;
  currency: 'USD' | 'EUR' | 'GBP';
  onCurrencyChange: (c: 'USD' | 'EUR' | 'GBP') => void;
  onRefreshOrg: () => void;
}

export const BillingView: React.FC<BillingViewProps> = ({
  organization,
  currency,
  onCurrencyChange,
  onRefreshOrg,
}) => {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [cryptoOrders, setCryptoOrders] = useState<CryptoPaymentOrder[]>([]);
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);
  const [actionSuccessToast, setActionSuccessToast] = useState<string | null>(null);
  const [cryptoModalOrder, setCryptoModalOrder] = useState<CryptoPaymentOrder | null>(null);
  const [testingLBank, setTestingLBank] = useState(false);
  const [lbankTestResult, setLbankTestResult] = useState<LBankConnectionTestResult | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);

  useEffect(() => {
    loadBillingData();
  }, []);

  const loadBillingData = async () => {
    try {
      const [p, inv, cryptOrders] = await Promise.all([
        apiClient.getPlans(),
        apiClient.getInvoices(),
        apiClient.getCryptoOrders().catch(() => []),
      ]);
      setPlans(p);
      setInvoices(inv);
      setCryptoOrders(cryptOrders);
    } catch (e) {
      console.error('Failed to load billing data', e);
    }
  };

  const handleRunLBankTest = async () => {
    setTestingLBank(true);
    try {
      const res = await apiClient.testLBankConnection();
      setLbankTestResult(res);
      setShowTestModal(true);
    } catch (err: any) {
      setLbankTestResult({
        status: 'FAILED',
        title: 'LBank API Connection: FAILED',
        endpoint: 'https://api.lbank.info/v2/supplement/api_Restrictions.do',
        errorMessage: err.message || 'Request failed',
        diagnostic: 'Issue related to API URL / Network connectivity.',
        timestamp: new Date().toISOString(),
      });
      setShowTestModal(true);
    } finally {
      setTestingLBank(false);
    }
  };

  const handleSelectPlan = async (planId: string) => {
    if (organization?.planId === planId && organization?.billingInterval === interval) {
      return;
    }

    if (planId === 'free') {
      setLoading(true);
      try {
        await apiClient.changePlan('free', interval, currency);
        setActionSuccessToast('Switched to Free 24-Hour Trial.');
        setTimeout(() => setActionSuccessToast(null), 3500);
        await loadBillingData();
        onRefreshOrg();
      } catch (err: any) {
        alert(`Error updating plan: ${err.message}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Cryptocurrency Payment Flow (USDT TRC20 / LBank)
    setLoading(true);
    try {
      const res = await apiClient.createCryptoOrder(planId, interval);
      if (res.success && res.order) {
        setCryptoModalOrder(res.order);
      }
    } catch (err: any) {
      alert(`Error creating crypto payment order: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCryptoSuccess = async (order: CryptoPaymentOrder) => {
    setActionSuccessToast(`🎉 Payment of ${order.amount} USDT successfully verified! ${order.planName} is active.`);
    setTimeout(() => setActionSuccessToast(null), 6000);
    await loadBillingData();
    onRefreshOrg();
  };

  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Subscription Plans & Quotas
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Predictable international pricing: Free 24-hour trial (one time per account) or Pro for $5/month to scan 5 websites.
          </p>
        </div>

        {/* Currency & Cadence Controls */}
        <div className="flex items-center gap-3">
          {/* Monthly / Annual toggle */}
          <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
            <button
              onClick={() => setInterval('monthly')}
              className={`px-3 py-1 rounded transition-colors ${
                interval === 'monthly' ? 'bg-slate-800 text-white font-medium shadow-sm' : 'text-slate-400'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setInterval('annual')}
              className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                interval === 'annual' ? 'bg-slate-800 text-[#E6A05A] font-medium shadow-sm' : 'text-slate-400'
              }`}
            >
              <span>Annual</span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded">
                2 Mo Free
              </span>
            </button>
          </div>

          {/* Currency */}
          <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono">
            {(['USD', 'EUR', 'GBP'] as const).map((c) => (
              <button
                key={c}
                onClick={() => onCurrencyChange(c)}
                className={`px-2 py-1 rounded transition-colors ${
                  currency === c ? 'bg-slate-800 text-[#E6A05A] font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* LBank API Test Button */}
          <button
            onClick={handleRunLBankTest}
            disabled={testingLBank}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700/80 hover:border-[#E6A05A]/60 text-xs font-semibold text-slate-300 hover:text-white flex items-center gap-1.5 transition-all shadow-sm disabled:opacity-50"
            title="Perform live read-only verification of LBank API connection"
          >
            {testingLBank ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-[#E6A05A]" />
            ) : (
              <Shield className="h-3.5 w-3.5 text-[#E6A05A]" />
            )}
            <span>{testingLBank ? 'Testing API...' : 'Test LBank API'}</span>
          </button>
        </div>
      </div>

      {actionSuccessToast && (
        <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
          <Check className="h-4 w-4" />
          <span>{actionSuccessToast}</span>
        </div>
      )}

      {/* Plans Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto gap-6 sm:gap-8">
        {plans.map((plan) => {
          const isCurrent = organization?.planId === plan.id;
          const isPro = plan.id === 'pro';
          const price = interval === 'annual'
            ? plan.pricing[currency].annual
            : plan.pricing[currency].monthly;

          return (
            <div
              key={plan.id}
              className={`rounded-2xl border p-7 sm:p-8 flex flex-col justify-between transition-all ${
                isCurrent
                  ? 'border-[#E6A05A] bg-[#0F172A] shadow-xl shadow-[#E6A05A]/10 ring-1 ring-[#E6A05A]/40'
                  : 'border-slate-800 bg-[#0F172A]/80 hover:border-slate-700'
              }`}
            >
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {isPro ? 'RECOMMENDED' : '24-HOUR TRIAL'}
                  </span>
                  {isCurrent ? (
                    <span className="text-[10px] font-mono text-[#E6A05A] bg-[#E6A05A]/10 border border-[#E6A05A]/30 px-2.5 py-0.5 rounded-full font-bold">
                      ACTIVE PLAN
                    </span>
                  ) : isPro ? (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-bold">
                      MOST POPULAR
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-800/80 border border-slate-700 px-2.5 py-0.5 rounded-full">
                      ONE-TIME
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-2xl font-bold text-white">{plan.name}</h3>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    {isPro
                      ? '$5/month · Can scan 5 websites'
                      : '24 hour trial only, one time per account.'}
                  </p>
                </div>

                {/* Callout box */}
                {isPro ? (
                  <div className="rounded-xl bg-[#E6A05A]/10 border border-[#E6A05A]/30 p-3 text-xs text-[#E6A05A] font-semibold flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-[#E6A05A]" />
                    <span>Can scan 5 websites with 1-minute checks</span>
                  </div>
                ) : (
                  <div className="rounded-xl bg-slate-800/60 border border-slate-700/60 p-3 text-xs text-slate-300 flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-slate-400" />
                    <span>24 hour trial only · One time per account</span>
                  </div>
                )}

                <div className="py-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl sm:text-5xl font-extrabold font-mono text-white tabular-nums">
                      {currencySymbol}{price}
                    </span>
                    <span className="text-xs sm:text-sm text-slate-400 font-mono">
                      {isPro
                        ? `/ ${interval === 'annual' ? 'yr' : 'mo'}`
                        : 'for 24 hours'}
                    </span>
                  </div>
                  {isPro && interval === 'annual' && (
                    <p className="text-[11px] text-emerald-400 font-mono mt-1">
                      Equivalent to {currencySymbol}4.17/mo (2 months free)
                    </p>
                  )}
                </div>

                <ul className="space-y-2.5 text-xs text-slate-300 pt-3 border-t border-slate-800/80">
                  {plan.features.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <Check className={`h-4 w-4 shrink-0 mt-0.5 ${isPro ? 'text-[#E6A05A]' : 'text-emerald-400'}`} />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-8">
                <button
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={loading || isCurrent}
                  className={`w-full py-3 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                    isCurrent
                      ? 'bg-slate-800 text-slate-400 cursor-default'
                      : 'bg-[#E6A05A] text-[#0B1120] hover:bg-[#cf863c] cursor-pointer shadow-lg shadow-[#E6A05A]/10 font-bold'
                  }`}
                >
                  {isCurrent ? (
                    'Current Plan'
                  ) : isPro ? (
                    <>
                      <QrCode className="h-4 w-4" />
                      <span>{loading ? 'Creating Order...' : `Pay ${currencySymbol}${price} with USDT (TRC20)`}</span>
                    </>
                  ) : (
                    'Switch to Free 24h Trial'
                  )}
                </button>
                {isPro && !isCurrent && (
                  <p className="text-[11px] text-center text-slate-400 mt-2 font-mono flex items-center justify-center gap-1">
                    <span>Instant automatic activation via LBank USDT TRC20</span>
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Crypto Orders (USDT TRC20) History */}
      {cryptoOrders.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-[#E6A05A]" />
              <h2 className="text-sm font-semibold text-white">USDT (TRC20) Cryptocurrency Orders</h2>
            </div>
            <span className="text-xs text-slate-400 font-mono">TRON Network / LBank Gateway</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
                <tr>
                  <th className="py-2">Order ID</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Plan</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2 text-center">Status</th>
                  <th className="py-2">TXID / Details</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {cryptoOrders.map((ord) => {
                  const isPending = ord.status === 'Pending' || ord.status === 'Confirming';
                  return (
                    <tr key={ord.id} className="text-slate-300">
                      <td className="py-3 font-semibold text-white text-[11px]">{ord.id}</td>
                      <td className="py-3">{new Date(ord.createdAt).toLocaleDateString()}</td>
                      <td className="py-3 font-sans text-xs">{ord.planName}</td>
                      <td className="py-3 text-right font-bold text-[#E6A05A] tabular-nums">
                        {ord.amount} USDT
                      </td>
                      <td className="py-3 text-center font-sans">
                        <span
                          className={`text-[10px] uppercase px-2 py-0.5 rounded font-semibold ${
                            ord.status === 'Paid'
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : ord.status === 'Confirming'
                              ? 'text-indigo-400 bg-indigo-500/10'
                              : ord.status === 'Manual Review'
                              ? 'text-amber-400 bg-amber-500/10'
                              : ord.status === 'Expired'
                              ? 'text-slate-500 bg-slate-800'
                              : 'text-amber-400 bg-amber-500/10'
                          }`}
                        >
                          {ord.status}
                        </span>
                      </td>
                      <td className="py-3 text-[11px] truncate max-w-[140px] text-slate-400">
                        {ord.txId ? (
                          <span className="text-slate-300" title={ord.txId}>
                            {ord.txId.substring(0, 12)}...
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="py-3 text-right font-sans">
                        {isPending ? (
                          <button
                            onClick={() => setCryptoModalOrder(ord)}
                            className="px-2.5 py-1 rounded bg-[#E6A05A] text-[#0B1120] font-semibold text-xs hover:bg-[#cf863c] transition-colors"
                          >
                            Pay / Verify
                          </button>
                        ) : (
                          <button
                            onClick={() => setCryptoModalOrder(ord)}
                            className="text-xs text-slate-400 hover:text-white"
                          >
                            View Order
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoices List */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Billing History & Invoices</h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">All transactions logged</span>
        </div>

        {invoices.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">No invoices generated yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
                <tr>
                  <th className="py-2">Invoice #</th>
                  <th className="py-2">Date</th>
                  <th className="py-2">Plan</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="py-2 text-center">Status</th>
                  <th className="py-2 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="text-slate-300">
                    <td className="py-3 font-semibold text-white">{inv.invoiceNumber}</td>
                    <td className="py-3">{new Date(inv.date).toLocaleDateString()}</td>
                    <td className="py-3 font-sans">{inv.planName}</td>
                    <td className="py-3 text-right font-bold text-white tabular-nums">
                      {currencySymbol}{inv.amount}
                    </td>
                    <td className="py-3 text-center">
                      <span className="text-[10px] text-emerald-400 uppercase bg-emerald-500/10 px-2 py-0.5 rounded font-sans font-semibold">
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => alert(`Downloading official PDF tax receipt for ${inv.invoiceNumber}...`)}
                        className="text-xs font-sans text-[#E6A05A] hover:underline"
                      >
                        Download PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Crypto Payment Modal */}
      {cryptoModalOrder && (
        <CryptoPaymentModal
          order={cryptoModalOrder}
          onClose={() => setCryptoModalOrder(null)}
          onPaymentSuccess={handleCryptoSuccess}
        />
      )}

      {/* LBank API Connection Test Modal */}
      {showTestModal && lbankTestResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg bg-[#0F172A] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5 text-slate-200 my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-xl border ${
                    lbankTestResult.status === 'SUCCESS'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  }`}
                >
                  {lbankTestResult.status === 'SUCCESS' ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <AlertCircle className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3
                    className={`text-base font-bold tracking-tight ${
                      lbankTestResult.status === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {lbankTestResult.title}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Official HmacSHA256 Read-Only Connectivity Check
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowTestModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Endpoint Box */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                API Endpoint Tested:
              </label>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-slate-300 break-all select-all">
                {lbankTestResult.endpoint}
              </div>
            </div>

            {/* Success Account Details */}
            {lbankTestResult.status === 'SUCCESS' && lbankTestResult.accountDetails && (
              <div className="space-y-3.5">
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="text-slate-400 font-medium">API Key:</span>
                    <span className="font-mono text-white font-semibold">
                      {lbankTestResult.accountDetails.apiKeyMasked}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-300 pt-2 border-t border-slate-800/80">
                    <span className="text-slate-400 font-medium">Authentication:</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      HmacSHA256 (Verified)
                    </span>
                  </div>

                  {lbankTestResult.accountDetails.permissions && (
                    <>
                      <div className="flex items-center justify-between text-slate-300 pt-2 border-t border-slate-800/80">
                        <span className="text-slate-400 font-medium">Read Permission:</span>
                        <span className="text-emerald-400 font-semibold font-mono">
                          {lbankTestResult.accountDetails.permissions.enableReading ? 'GRANTED (true)' : 'DENIED (false)'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-slate-300 pt-1">
                        <span className="text-slate-400 font-medium">IP Restriction:</span>
                        <span className="text-slate-300 font-mono">
                          {lbankTestResult.accountDetails.permissions.ipRestrict ? 'ACTIVE (Protected)' : 'None'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-slate-300 pt-1">
                        <span className="text-slate-400 font-medium">Spot Trading:</span>
                        <span className="text-slate-400 font-mono">
                          {lbankTestResult.accountDetails.permissions.enableSpotTrading ? 'Enabled' : 'DISABLED (Read-Only Safe)'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-slate-300 pt-1">
                        <span className="text-slate-400 font-medium">Withdrawals:</span>
                        <span className="text-slate-400 font-mono">
                          {lbankTestResult.accountDetails.permissions.enableWithdrawals ? 'Enabled' : 'DISABLED (Read-Only Safe)'}
                        </span>
                      </div>
                    </>
                  )}

                  {lbankTestResult.accountDetails.depositAddress && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-1">
                      <span className="text-slate-400 font-medium block">
                        LBank USDT (TRC20) Deposit Address:
                      </span>
                      <div className="font-mono text-[11px] text-[#E6A05A] bg-slate-900/80 p-2 rounded border border-slate-800 break-all select-all">
                        {lbankTestResult.accountDetails.depositAddress}
                      </div>
                    </div>
                  )}

                  {lbankTestResult.accountDetails.accountCoins && lbankTestResult.accountDetails.accountCoins.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-1">
                      <span className="text-slate-400 font-medium block">
                        Discovered Account Assets (Read-Only Balances):
                      </span>
                      <div className="grid grid-cols-3 gap-1.5 pt-1">
                        {lbankTestResult.accountDetails.accountCoins.slice(0, 6).map((coin) => (
                          <div
                            key={coin.coin}
                            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-center font-mono text-[11px]"
                          >
                            <span className="text-slate-400 block text-[10px]">{coin.coin}</span>
                            <span className="text-white font-semibold">{coin.usable}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Diagnostic explanation */}
                <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 space-y-1 leading-relaxed">
                  <span className="font-semibold text-white block">Diagnostic Summary:</span>
                  <p>{lbankTestResult.diagnostic}</p>
                </div>
              </div>
            )}

            {/* Failure Box */}
            {lbankTestResult.status === 'FAILED' && (
              <div className="space-y-3.5 text-xs">
                <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-4 space-y-2">
                  <div className="flex items-center gap-1.5 text-rose-400 font-semibold">
                    <AlertCircle className="h-4 w-4" />
                    <span>LBank API Error Response:</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 font-mono text-rose-300 break-all">
                    {lbankTestResult.errorMessage}
                  </div>
                  {lbankTestResult.errorCode && (
                    <p className="text-slate-400">
                      Error Code: <span className="font-mono text-white">{lbankTestResult.errorCode}</span>
                    </p>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 space-y-1 leading-relaxed">
                  <span className="font-semibold text-white block">Issue Analysis:</span>
                  <p className="text-[#E6A05A] font-medium">{lbankTestResult.diagnostic}</p>
                </div>
              </div>
            )}

            {/* Security Notice */}
            <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-2 border-t border-slate-800">
              <Lock className="h-3.5 w-3.5 text-[#E6A05A] shrink-0" />
              <span>
                Read-Only verification only. API Secret Key is safely preserved on the backend and never exposed.
              </span>
            </div>

            {/* Close / Retest Button */}
            <div className="flex gap-2.5 pt-1">
              <button
                onClick={handleRunLBankTest}
                disabled={testingLBank}
                className="flex-1 py-2 rounded-xl bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${testingLBank ? 'animate-spin' : ''}`} />
                <span>Re-run Connection Test</span>
              </button>
              <button
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 rounded-xl bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
