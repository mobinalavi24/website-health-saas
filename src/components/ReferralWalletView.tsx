import React, { useState, useEffect } from 'react';
import {
  Gift,
  Wallet,
  ArrowUpRight,
  Copy,
  Check,
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Users,
  Coins,
  RefreshCw,
  Loader2,
  X,
  ShieldCheck,
  Info,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { User, UserReferralProfile, WithdrawalRequestRecord } from '../types.ts';

interface ReferralWalletViewProps {
  user: User | null;
  onNavigate?: (view: string) => void;
}

export const ReferralWalletView: React.FC<ReferralWalletViewProps> = ({ user, onNavigate }) => {
  const [profile, setProfile] = useState<UserReferralProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedAddressId, setCopiedAddressId] = useState<string | null>(null);

  // Withdrawal modal state
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccessToast, setWithdrawSuccessToast] = useState<string | null>(null);

  // Manual apply code state for account (if user wasn't referred yet)
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [applyCodeInput, setApplyCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);

  // Active view tab in hub
  const [activeTab, setActiveTab] = useState<'referrals' | 'withdrawals'>('referrals');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiClient.getReferralProfile();
      setProfile(data);
    } catch (err) {
      console.error('Failed to load referral profile:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleCopyCode = () => {
    if (!profile) return;
    navigator.clipboard.writeText(profile.referralCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    if (!profile) return;
    // Build canonical public URL using current window origin if available
    const shareUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/?ref=${profile.referralCode}`
      : profile.referralUrl;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyAddress = (id: string, addr: string) => {
    navigator.clipboard.writeText(addr);
    setCopiedAddressId(id);
    setTimeout(() => setCopiedAddressId(null), 2000);
  };

  const handleOpenWithdrawModal = () => {
    setWithdrawError(null);
    setWithdrawAmount(profile && profile.availableBalance >= 4 ? profile.availableBalance.toFixed(2) : '4.00');
    setWithdrawAddress('');
    setWithdrawModalOpen(true);
  };

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError(null);
    setSubmittingWithdrawal(true);

    const amountNum = parseFloat(withdrawAmount);
    if (isNaN(amountNum) || amountNum < 4) {
      setWithdrawError('Minimum withdrawal is 4.00 USDT.');
      setSubmittingWithdrawal(false);
      return;
    }

    if (!profile || amountNum > profile.availableBalance) {
      setWithdrawError(`Amount exceeds your available balance of ${profile?.availableBalance.toFixed(2) || '0.00'} USDT.`);
      setSubmittingWithdrawal(false);
      return;
    }

    const cleanAddress = withdrawAddress.trim();
    if (!cleanAddress.startsWith('T') || cleanAddress.length !== 34) {
      setWithdrawError('Invalid TRON TRC20 wallet address. Must begin with "T" and be exactly 34 characters.');
      setSubmittingWithdrawal(false);
      return;
    }

    try {
      await apiClient.requestWithdrawal(amountNum, cleanAddress);
      setWithdrawModalOpen(false);
      setWithdrawSuccessToast(`Withdrawal request for ${amountNum.toFixed(2)} USDT submitted successfully. Funds have been reserved.`);
      setTimeout(() => setWithdrawSuccessToast(null), 5000);
      await loadProfile(true);
      setActiveTab('withdrawals');
    } catch (err: any) {
      setWithdrawError(err.message || 'Failed to submit withdrawal request.');
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const handleCancelWithdrawal = async (withdrawalId: string) => {
    if (!confirm('Are you sure you want to cancel this pending withdrawal? Funds will be restored to your available balance immediately.')) {
      return;
    }
    try {
      await apiClient.cancelWithdrawal(withdrawalId);
      setWithdrawSuccessToast('Withdrawal cancelled. Funds restored to available balance.');
      setTimeout(() => setWithdrawSuccessToast(null), 4000);
      await loadProfile(true);
    } catch (err: any) {
      alert(`Failed to cancel withdrawal: ${err.message}`);
    }
  };

  const handleApplyReferralCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyError(null);
    setApplySuccess(null);
    setApplyingCode(true);

    const cleanCode = applyCodeInput.trim().toUpperCase();
    if (!cleanCode) {
      setApplyError('Please enter a referral code.');
      setApplyingCode(false);
      return;
    }

    try {
      const res = await apiClient.applyReferralCode(cleanCode);
      setApplySuccess(res.message || 'Referral code successfully linked to your account!');
      setTimeout(() => {
        setShowApplyModal(false);
        setApplySuccess(null);
      }, 2500);
      await loadProfile(true);
    } catch (err: any) {
      setApplyError(err.message || 'Failed to apply referral code.');
    } finally {
      setApplyingCode(false);
    }
  };

  const shareableUrl = typeof window !== 'undefined' && profile
    ? `${window.location.origin}/?ref=${profile.referralCode}`
    : profile?.referralUrl || '';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-3">
        <Loader2 className="h-8 w-8 text-[#E6A05A] animate-spin" />
        <p className="text-xs text-slate-400">Loading referral wallet & commission ledger...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Toast Notification */}
      {withdrawSuccessToast && (
        <div className="fixed top-20 right-6 z-50 flex items-center gap-2 p-4 rounded-xl bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 text-xs shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{withdrawSuccessToast}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-[#E6A05A]" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Referral Hub & Commission Wallet
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Earn a generous 40% commission on every verified subscription purchase from your referred customers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => loadProfile(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white hover:border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin text-[#E6A05A]' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handleOpenWithdrawModal}
            disabled={!profile || profile.availableBalance < 4}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors shadow-lg shadow-[#E6A05A]/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Wallet className="h-3.5 w-3.5" />
            <span>Withdraw USDT</span>
          </button>
        </div>
      </div>

      {/* Referral Link & Code Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-[#E6A05A]/30 bg-gradient-to-r from-[#0F172A] via-[#1E293B] to-[#0F172A] p-6 shadow-xl">
        <div className="absolute top-0 right-0 -mr-12 -mt-12 h-48 w-48 rounded-full bg-[#E6A05A]/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-5 space-y-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#E6A05A]/15 text-[#E6A05A] border border-[#E6A05A]/30">
              <Coins className="h-3.5 w-3.5" />
              <span>40% Commission Program</span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Share PulseVanguard, Earn 40% USDT
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              When someone registers with your referral code or clicks your link and purchases a Pro plan, you immediately earn 40% (2.00 USDT on the monthly plan, 20.00 USDT on the annual plan). Withdraw directly via TRC-20!
            </p>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Referral Code Card */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
              <span className="text-[11px] font-medium text-slate-400">Your Unique Referral Code</span>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-black/40 border border-slate-700/80 font-mono">
                <span className="text-base font-extrabold text-[#E6A05A] tracking-wider">
                  {profile?.referralCode || '...'}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Copy Referral Code"
                >
                  {copiedCode ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                {copiedCode ? <span className="text-emerald-400 font-medium">Copied to clipboard!</span> : 'Can be entered during signup or checkout'}
              </p>
            </div>

            {/* Shareable URL Card */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
              <span className="text-[11px] font-medium text-slate-400">Shareable Registration Link</span>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-black/40 border border-slate-700/80 font-mono">
                <span className="text-xs text-slate-200 truncate max-w-[190px]">
                  {shareableUrl}
                </span>
                <button
                  onClick={handleCopyLink}
                  className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Copy Share Link"
                >
                  {copiedLink ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                {copiedLink ? <span className="text-emerald-400 font-medium">Link copied!</span> : 'Auto-applies your referral code upon registration'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Wallet Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Available Balance */}
        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A] relative overflow-hidden">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-slate-400">Available Balance</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Coins className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold text-white font-mono">
              {profile ? profile.availableBalance.toFixed(2) : '0.00'}
            </span>
            <span className="text-xs font-semibold text-emerald-400">USDT</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Ready for withdrawal (min. 4.00 USDT)
          </p>
        </div>

        {/* Reserved Balance */}
        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-slate-400">Pending Review</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold text-white font-mono">
              {profile ? profile.reservedBalance.toFixed(2) : '0.00'}
            </span>
            <span className="text-xs font-semibold text-amber-400">USDT</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Reserved for pending withdrawal requests
          </p>
        </div>

        {/* Total Paid Out */}
        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-slate-400">Total Paid Out</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold text-white font-mono">
              {profile ? profile.totalWithdrawn.toFixed(2) : '0.00'}
            </span>
            <span className="text-xs font-semibold text-blue-400">USDT</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Processed successfully to Tron TRC20
          </p>
        </div>

        {/* Lifetime Earnings */}
        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A]">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-medium text-slate-400">Lifetime Earnings</span>
            <div className="p-2 rounded-lg bg-[#E6A05A]/10 text-[#E6A05A] border border-[#E6A05A]/20">
              <Gift className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-extrabold text-[#E6A05A] font-mono">
              {profile ? profile.totalCommissionsEarned.toFixed(2) : '0.00'}
            </span>
            <span className="text-xs font-semibold text-[#E6A05A]">USDT</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Across {profile?.commissions.length || 0} approved purchases
          </p>
        </div>
      </div>

      {/* Tabs Switcher: Commissions / Withdrawals */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('referrals')}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === 'referrals'
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Referred Customers & Purchases ({profile?.commissions.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('withdrawals')}
              className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                activeTab === 'withdrawals'
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Withdrawal History ({profile?.withdrawals.length || 0})
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span>Network: <strong className="text-slate-200">Tron (TRC-20)</strong></span>
            <span>•</span>
            <span>Rate: <strong className="text-[#E6A05A]">40% Fixed</strong></span>
          </div>
        </div>

        {/* Tab 1: Referred Customers & Commissions Table */}
        {activeTab === 'referrals' && (
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Referred Customers & Commission Ledger</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time audit log of 40% commissions earned from verified customer subscription payments.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                Total Referred: <strong className="text-white">{profile?.totalReferrals || 0}</strong>
              </span>
            </div>

            {(!profile || profile.commissions.length === 0) ? (
              <div className="p-12 text-center rounded-xl bg-slate-900/50 border border-dashed border-slate-800 space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                  <Users className="h-6 w-6" />
                </div>
                <h4 className="text-sm font-semibold text-white">No Referred Purchases Yet</h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Share your referral link <strong className="text-[#E6A05A]">{profile?.referralCode}</strong> with friends or agency colleagues. As soon as their crypto subscription is confirmed, 40% will be credited here automatically!
                </p>
                <div className="pt-2">
                  <button
                    onClick={handleCopyLink}
                    className="px-4 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors cursor-pointer"
                  >
                    Copy Referral Link
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
                    <tr>
                      <th className="py-2.5">Date</th>
                      <th className="py-2.5">Customer</th>
                      <th className="py-2.5">Plan</th>
                      <th className="py-2.5">Order Amount</th>
                      <th className="py-2.5">Commission Rate</th>
                      <th className="py-2.5">Your Commission</th>
                      <th className="py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {profile.commissions.map((comm) => (
                      <tr key={comm.id} className="text-slate-300 hover:bg-slate-900/40 transition-colors">
                        <td className="py-3 text-slate-400">
                          {new Date(comm.createdAt).toLocaleDateString()} {new Date(comm.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 font-sans font-medium text-white">
                          {comm.referredUserEmail || 'Customer'}
                        </td>
                        <td className="py-3 font-sans">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-200 border border-slate-700">
                            {comm.planName}
                          </span>
                        </td>
                        <td className="py-3 text-slate-300">
                          {(comm.orderAmountCents / 100).toFixed(2)} USDT
                        </td>
                        <td className="py-3 text-[#E6A05A] font-semibold">
                          40%
                        </td>
                        <td className="py-3 font-extrabold text-emerald-400">
                          +{(comm.commissionAmountCents / 100).toFixed(2)} USDT
                        </td>
                        <td className="py-3 font-sans">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Credited</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Withdrawal Requests Table */}
        {activeTab === 'withdrawals' && (
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Withdrawal History & Real-Time Status</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Track payout requests to your USDT TRC-20 wallet, blockchain TXIDs, and TronScan confirmations.
                </p>
              </div>
              <button
                onClick={handleOpenWithdrawModal}
                disabled={!profile || profile.availableBalance < 4}
                className="px-3 py-1.5 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors cursor-pointer disabled:opacity-50"
              >
                + New Withdrawal
              </button>
            </div>

            {(!profile || profile.withdrawals.length === 0) ? (
              <div className="p-12 text-center rounded-xl bg-slate-900/50 border border-dashed border-slate-800 space-y-3">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                  <Wallet className="h-6 w-6" />
                </div>
                <h4 className="text-sm font-semibold text-white">No Withdrawals Requested</h4>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  When your available commission balance reaches at least 4.00 USDT, you can submit a withdrawal request to any valid Tron TRC-20 wallet.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
                    <tr>
                      <th className="py-2.5">Date</th>
                      <th className="py-2.5">Amount</th>
                      <th className="py-2.5">TRC20 Address</th>
                      <th className="py-2.5">Status</th>
                      <th className="py-2.5">Blockchain TXID / Reason</th>
                      <th className="py-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {profile.withdrawals.map((w) => (
                      <tr key={w.id} className="text-slate-300 hover:bg-slate-900/40 transition-colors">
                        <td className="py-3 text-slate-400">
                          {new Date(w.createdAt).toLocaleDateString()} {new Date(w.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 font-extrabold text-white">
                          {(w.amountCents / 100).toFixed(2)} USDT
                        </td>
                        <td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-300 truncate max-w-[140px]" title={w.trc20Address}>
                              {w.trc20Address.substring(0, 8)}...{w.trc20Address.substring(w.trc20Address.length - 6)}
                            </span>
                            <button
                              onClick={() => handleCopyAddress(w.id, w.trc20Address)}
                              className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                              title="Copy Full Address"
                            >
                              {copiedAddressId === w.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
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
                              <span>Approved / Queued</span>
                            </span>
                          )}
                          {w.status === 'pending' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              <Clock className="h-3 w-3" />
                              <span>Pending Review</span>
                            </span>
                          )}
                          {w.status === 'rejected' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              <XCircle className="h-3 w-3" />
                              <span>Declined (Refunded)</span>
                            </span>
                          )}
                          {w.status === 'cancelled' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-700/30 text-slate-400 border border-slate-700/50">
                              <span>Cancelled</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3">
                          {w.payoutTxId ? (
                            <a
                              href={`https://tronscan.org/#/transaction/${w.payoutTxId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[#E6A05A] hover:underline"
                            >
                              <span>{w.payoutTxId.substring(0, 10)}...</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : w.rejectionReason ? (
                            <span className="text-rose-300 font-sans text-[11px]">
                              {w.rejectionReason}
                            </span>
                          ) : (
                            <span className="text-slate-500 font-sans text-[11px]">
                              Awaiting admin processing
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right font-sans">
                          {w.status === 'pending' && (
                            <button
                              onClick={() => handleCancelWithdrawal(w.id)}
                              className="text-xs text-rose-400 hover:text-rose-300 underline cursor-pointer"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Withdrawal Request Modal */}
      {withdrawModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E6A05A]/10 text-[#E6A05A]">
                  <Wallet className="h-4 w-4" />
                </div>
                <h3 className="text-base font-bold text-white">Withdraw USDT (TRC-20)</h3>
              </div>
              <button
                onClick={() => setWithdrawModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {withdrawError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{withdrawError}</span>
              </div>
            )}

            <form onSubmit={handleWithdrawSubmit} className="space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-semibold">Withdrawal Amount (USDT)</label>
                  <span className="text-[11px] text-slate-400">
                    Available: <strong className="text-white font-mono">{profile?.availableBalance.toFixed(2) || '0.00'} USDT</strong>
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="4"
                    max={profile?.availableBalance || 0}
                    required
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="4.00"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 pr-16 text-white font-mono focus:outline-none focus:border-[#E6A05A]"
                  />
                  <button
                    type="button"
                    onClick={() => setWithdrawAmount(profile ? profile.availableBalance.toFixed(2) : '4.00')}
                    className="absolute right-2 top-2 px-2 py-1 rounded text-[10px] font-bold bg-slate-800 text-[#E6A05A] hover:bg-slate-700 cursor-pointer"
                  >
                    MAX
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Minimum threshold: 4.00 USDT</p>
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Destination TRC-20 Address (TRON Network)
                </label>
                <input
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  value={withdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value)}
                  placeholder="e.g. TLsV52sRDL79HXGGm9yzwKZsDchdYGeXhm"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono focus:outline-none focus:border-[#E6A05A]"
                />
              </div>

              {/* Network Warning Box */}
              <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-800/40 text-amber-300/90 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px] text-amber-200">
                  <Info className="h-3.5 w-3.5 text-amber-400" />
                  <span>Tron TRC-20 Network Only</span>
                </div>
                <p className="text-[10px] leading-relaxed">
                  Only enter a valid TRC-20 address starting with <strong>&quot;T&quot;</strong>. Do NOT provide an Ethereum (ERC-20), BSC (BEP-20), or exchange internal memo address.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setWithdrawModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-slate-300 bg-slate-900 border border-slate-800 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingWithdrawal}
                  className="px-5 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] font-semibold hover:bg-[#cf863c] transition-colors disabled:opacity-60 flex items-center gap-1.5 cursor-pointer shadow-lg shadow-[#E6A05A]/20"
                >
                  {submittingWithdrawal ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Reserving Funds...</span>
                    </>
                  ) : (
                    <span>Confirm Withdrawal</span>
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
