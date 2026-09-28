import React, { useState, useEffect } from 'react';
import { Shield, Check, CreditCard, Download, FileText, ArrowRight, Sparkles } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { SubscriptionPlan, Organization, Invoice } from '../types.ts';

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
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);
  const [actionSuccessToast, setActionSuccessToast] = useState<string | null>(null);

  useEffect(() => {
    loadBillingData();
  }, []);

  const loadBillingData = async () => {
    try {
      const [p, inv] = await Promise.all([
        apiClient.getPlans(),
        apiClient.getInvoices(),
      ]);
      setPlans(p);
      setInvoices(inv);
    } catch (e) {
      console.error('Failed to load billing data', e);
    }
  };

  const handleSelectPlan = async (planId: string) => {
    if (organization?.planId === planId && organization?.billingInterval === interval) {
      return;
    }

    setLoading(true);
    try {
      await apiClient.changePlan(planId as any, interval, currency);
      setActionSuccessToast(`Successfully updated subscription to ${planId.toUpperCase()} plan.`);
      setTimeout(() => setActionSuccessToast(null), 3500);
      await loadBillingData();
      onRefreshOrg();
    } catch (err: any) {
      alert(`Error updating plan: ${err.message}`);
    } finally {
      setLoading(false);
    }
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
            Predictable international pricing with transparent checks, frequency limits, and white-label options.
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
        </div>
      </div>

      {actionSuccessToast && (
        <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
          <Check className="h-4 w-4" />
          <span>{actionSuccessToast}</span>
        </div>
      )}

      {/* Plans Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map((plan) => {
          const isCurrent = organization?.planId === plan.id;
          const price = interval === 'annual'
            ? plan.pricing[currency].annual
            : plan.pricing[currency].monthly;

          return (
            <div
              key={plan.id}
              className={`rounded-2xl border p-6 flex flex-col justify-between transition-all ${
                isCurrent
                  ? 'border-[#E6A05A] bg-[#0F172A] shadow-lg shadow-[#E6A05A]/5'
                  : 'border-slate-800 bg-[#0F172A]/80 hover:border-slate-700'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {plan.badge}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-mono text-[#E6A05A] bg-[#E6A05A]/10 border border-[#E6A05A]/20 px-2 py-0.5 rounded">
                      ACTIVE
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{plan.targetAudience}</p>
                </div>

                <div className="py-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold font-mono text-white tabular-nums">
                      {currencySymbol}{price}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      / {interval === 'annual' ? 'yr' : 'mo'}
                    </span>
                  </div>
                </div>

                <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                  {plan.features.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-6">
                <button
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={loading || isCurrent}
                  className={`w-full py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isCurrent
                      ? 'bg-slate-800 text-slate-400 cursor-default'
                      : 'bg-[#E6A05A] text-[#0B1120] hover:bg-[#cf863c] cursor-pointer'
                  }`}
                >
                  {isCurrent ? 'Current Plan' : `Upgrade to ${plan.name}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

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
    </div>
  );
};
