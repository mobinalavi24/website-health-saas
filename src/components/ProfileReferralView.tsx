import React, { useState, useEffect } from 'react';
import {
  Copy,
  Check,
  Gift,
  Wallet,
  Users,
  Coins,
  ArrowUpRight,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  User as UserIcon,
  Send,
  Lock,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type {
  User,
  Organization,
  UserReferralSummary,
  WithdrawalStatus,
} from '../types.ts';

interface ProfileReferralViewProps {
  user: User;
  organization: Organization | null;
  onRefreshUser?: () => void;
}

export const ProfileReferralView: React.FC<ProfileReferralViewProps> = ({
  user,
  organization,
  onRefreshUser,
}) => {
  const [summary, setSummary] = useState<UserReferralSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Withdrawal form state
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [reviewingWithdrawal, setReviewingWithdrawal] = useState(false);
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);

  // Apply referral code state (if user has no referrer yet)
  const [applyCodeInput, setApplyCodeInput] = useState('');
  const [applyingCode, setApplyingCode] = useState(false);
  const [applyCodeError, setApplyCodeError] = useState<string | null>(null);
  const [applyCodeSuccess, setApplyCodeSuccess] = useState<string | null>(null);

  const loadReferralProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getReferralSummary();
      setSummary(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load referral profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReferralProfile();
  }, []);

  const referralCode = summary?.referralCode || user.referralCode || '';
  const referralUrl =
    summary?.referralUrl ||
    (referralCode
      ? `${window.location.origin}/register?ref=${encodeURIComponent(referralCode)}`
      : '');

  const handleCopy = (text: string, type: 'code' | 'url') => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (type === 'code') {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const availableBalance = summary?.availableBalance ?? 0;
  const minWithdrawal = summary?.minimumWithdrawalAmount ?? 4;

  const validateWithdrawalInputs = (): string | null => {
    const parsedAmount = Number(withdrawAmount);
    if (!withdrawAmount.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return 'Please enter a valid positive withdrawal amount in USDT.';
    }
    if (parsedAmount < minWithdrawal) {
      return `Minimum withdrawal amount is ${minWithdrawal.toFixed(2)} USDT.`;
    }
    if (parsedAmount > availableBalance) {
      return `Requested amount (${parsedAmount.toFixed(2)} USDT) exceeds your available balance (${availableBalance.toFixed(2)} USDT).`;
    }
    const cleanAddr = walletAddress.trim();
    if (!cleanAddr) {
      return 'Please enter your USDT — TRC20 (TRON) destination wallet address.';
    }
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(cleanAddr)) {
      return 'Invalid TRON (TRC20) wallet address. A valid TRC20 address starts with "T" and is 34 Base58 characters long.';
    }
    if (cleanAddr === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t') {
      return 'Do not enter the USDT smart contract address. Enter your personal TRON wallet address.';
    }
    return null;
  };

  const handleStartReview = (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError(null);
    setWithdrawSuccess(null);
    const validationErr = validateWithdrawalInputs();
    if (validationErr) {
      setWithdrawError(validationErr);
      return;
    }
    setReviewingWithdrawal(true);
  };

  const handleConfirmWithdrawal = async () => {
    setSubmittingWithdrawal(true);
    setWithdrawError(null);
    try {
      const parsedAmount = Number(Number(withdrawAmount).toFixed(2));
      const res = await apiClient.createWithdrawalRequest(parsedAmount, walletAddress.trim());
      setWithdrawSuccess(
        res.message ||
          `Withdrawal request for ${parsedAmount.toFixed(2)} USDT (TRC20) submitted! Funds have been reserved pending admin review.`
      );
      setWithdrawAmount('');
      setWalletAddress('');
      setReviewingWithdrawal(false);
      await loadReferralProfile();
    } catch (err: any) {
      setWithdrawError(err.message || 'Failed to submit withdrawal request.');
      setReviewingWithdrawal(false);
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const handleApplyReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applyCodeInput.trim()) return;
    setApplyingCode(true);
    setApplyCodeError(null);
    setApplyCodeSuccess(null);
    try {
      const res = await apiClient.applyReferralCode(applyCodeInput.trim().toUpperCase());
      setApplyCodeSuccess(res.message || 'Referral code linked to your account.');
      setApplyCodeInput('');
      await loadReferralProfile();
      if (onRefreshUser) onRefreshUser();
    } catch (err: any) {
      setApplyCodeError(err.message || 'Failed to apply referral code.');
    } finally {
      setApplyingCode(false);
    }
  };

  const getWithdrawalStatusBadge = (status: WithdrawalStatus) => {
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
      {/* Page Header & User Profile Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div className="flex items-start gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
            <UserIcon className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                My Profile — {user.name}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase bg-[#E6A05A]/10 text-[#E6A05A] border border-[#E6A05A]/30 font-bold">
                {user.role}
              </span>
              {organization && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase bg-slate-800 text-slate-300 border border-slate-700">
                  {organization.planId.toUpperCase()} PLAN
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              {user.email} · Account Profile, Partner Referral Program (40% Commission) & USDT TRC20 Wallet
            </p>
          </div>
        </div>

        <button
          onClick={loadReferralProfile}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-[#E6A05A]' : ''}`} />
          <span>Refresh Wallet</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Referral Code & Shareable Link Card */}
      <div className="rounded-2xl border border-[#E6A05A]/30 bg-gradient-to-br from-[#0F172A] via-[#0F172A] to-[#1a1510] p-6 sm:p-7 shadow-xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[#E6A05A] text-xs font-bold uppercase tracking-wider">
              <Gift className="h-4 w-4" />
              <span>40% Lifetime Referral Commission Program</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white">
              Invite Customers & Earn 40% on Every Verified Subscription
            </h2>
            <p className="text-xs text-slate-400 max-w-2xl">
              Share your unique referral code or registration link. Earn{' '}
              <strong className="text-white">2.00 USDT</strong> on every{' '}
              <strong className="text-white">5 USDT Monthly Pro</strong> purchase and{' '}
              <strong className="text-white">20.00 USDT</strong> on every{' '}
              <strong className="text-white">50 USDT Annual Pro</strong> purchase once payment is verified and approved.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-[#E6A05A]/10 border border-[#E6A05A]/20 text-center">
              <span className="block text-[10px] text-slate-400 font-mono">5 USDT Plan</span>
              <span className="font-mono font-extrabold text-[#E6A05A] text-sm">+2.00 USDT</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
              <span className="block text-[10px] text-slate-400 font-mono">50 USDT Plan</span>
              <span className="font-mono font-extrabold text-emerald-400 text-sm">+20.00 USDT</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Unique Referral Code */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 block">
              Your Unique Referral Code
            </label>
            <div className="flex items-center gap-2">
              <div
                data-testid="user-referral-code"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-sm font-bold text-[#E6A05A] tracking-wider select-all"
              >
                {referralCode || 'LOADING...'}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(referralCode, 'code')}
                className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  copiedCode
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
              </button>
            </div>
          </div>

          {/* Shareable Referral Link */}
          <div className="lg:col-span-2 space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 block">
              Your Shareable Referral Registration URL
            </label>
            <div className="flex items-center gap-2">
              <div
                data-testid="user-referral-url"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-slate-200 truncate select-all"
              >
                {referralUrl}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(referralUrl, 'url')}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                  copiedUrl
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120]'
                }`}
              >
                {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copiedUrl ? 'Link Copied!' : 'Copy Share Link'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Optional: Apply Referral Code if user has not been referred yet */}
        {summary?.canApplyReferralCode && (
          <div className="pt-4 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              Were you invited by another PulseVanguard user? Enter their referral code before your first purchase:
            </div>
            <form onSubmit={handleApplyReferral} className="flex items-center gap-2">
              <input
                type="text"
                value={applyCodeInput}
                onChange={(e) => {
                  setApplyCodeInput(e.target.value.toUpperCase());
                  setApplyCodeError(null);
                }}
                placeholder="e.g. PV-ABCD1234"
                className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono text-white uppercase focus:outline-none focus:border-[#E6A05A]"
              />
              <button
                type="submit"
                disabled={applyingCode || !applyCodeInput.trim()}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-[#E6A05A] border border-slate-700 disabled:opacity-50 cursor-pointer"
              >
                {applyingCode ? 'Linking...' : 'Apply Code'}
              </button>
            </form>
          </div>
        )}
        {applyCodeError && <p className="text-xs text-rose-400">{applyCodeError}</p>}
        {applyCodeSuccess && <p className="text-xs text-emerald-400">{applyCodeSuccess}</p>}
        {summary?.referredByCode && (
          <div className="pt-3 border-t border-slate-800/80 text-xs text-slate-400 flex items-center gap-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>
              Your account was referred with code{' '}
              <strong className="font-mono text-white">{summary.referredByCode}</strong>.
            </span>
          </div>
        )}
      </div>

      {/* Referral Wallet Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Available Withdrawal Balance</span>
            <Wallet className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-400 tabular-nums">
            {(summary?.availableBalance ?? 0).toFixed(2)} USDT
          </div>
          <p className="text-[11px] text-slate-500">
            Ready to withdraw via USDT TRC20 (Min 4.00 USDT)
          </p>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Commissions Earned</span>
            <Coins className="h-4 w-4 text-[#E6A05A]" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-[#E6A05A] tabular-nums">
            {(summary?.totalCommissionsEarned ?? 0).toFixed(2)} USDT
          </div>
          <p className="text-[11px] text-slate-500">
            40% lifetime commission on verified purchases
          </p>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Reserved for Pending Withdrawals</span>
            <Clock className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-amber-400 tabular-nums">
            {(summary?.reservedBalance ?? 0).toFixed(2)} USDT
          </div>
          <p className="text-[11px] text-slate-500">
            Atomically locked for active payout requests
          </p>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Successfully Withdrawn</span>
            <ArrowUpRight className="h-4 w-4 text-sky-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-white tabular-nums">
            {(summary?.withdrawnBalance ?? 0).toFixed(2)} USDT
          </div>
          <p className="text-[11px] text-slate-500">Completed USDT TRC20 payouts</p>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Successful Referrals</span>
            <Users className="h-4 w-4 text-[#E6A05A]" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-white tabular-nums">
            {summary?.totalSuccessfulReferrals ?? 0}
          </div>
          <p className="text-[11px] text-slate-500">Registered accounts using your code</p>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total Eligible Purchases</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold font-mono text-white tabular-nums">
            {summary?.totalEligiblePurchases ?? 0}
          </div>
          <p className="text-[11px] text-slate-500">
            Verified subscription payments by referrals
          </p>
        </div>
      </div>

      {/* Withdraw Referral Earnings Form & Withdrawal History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 5 Cols: Withdraw Referral Earnings Form */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-5 self-start">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Send className="h-4 w-4 text-[#E6A05A]" />
              <h2 className="text-base font-bold text-white">Withdraw Referral Earnings</h2>
            </div>
            <span className="px-2.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              USDT — TRC20 (TRON)
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400">Available to Withdraw:</span>
            <span className="font-mono text-base font-bold text-emerald-400">
              {availableBalance.toFixed(2)} USDT
            </span>
          </div>

          {withdrawError && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{withdrawError}</span>
            </div>
          )}

          {withdrawSuccess && (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-xs text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{withdrawSuccess}</span>
            </div>
          )}

          {!reviewingWithdrawal ? (
            <form onSubmit={handleStartReview} className="space-y-4 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-300">
                    Withdrawal Amount (USDT)
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setWithdrawAmount(availableBalance > 0 ? availableBalance.toFixed(2) : '')
                    }
                    disabled={availableBalance < minWithdrawal}
                    className="text-[11px] font-mono text-[#E6A05A] hover:underline disabled:opacity-40 cursor-pointer"
                  >
                    Withdraw Max ({availableBalance.toFixed(2)} USDT)
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min={minWithdrawal}
                    max={availableBalance > 0 ? availableBalance : undefined}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder={`Min ${minWithdrawal.toFixed(2)} USDT`}
                    className="w-full pl-3.5 pr-16 py-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-white focus:outline-none focus:border-[#E6A05A]"
                  />
                  <span className="absolute right-3.5 top-2.5 font-mono text-slate-500">
                    USDT
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Minimum withdrawal: <strong>4.00 USDT</strong> · Maximum:{' '}
                  <strong>{availableBalance.toFixed(2)} USDT</strong>
                </p>
              </div>

              <div>
                <label className="font-semibold text-slate-300 flex items-center justify-between mb-1.5">
                  <span>Destination Wallet Address</span>
                  <span className="text-[10px] font-mono text-emerald-400">
                    USDT — TRC20 (TRON)
                  </span>
                </label>
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="T... (34-character TRON TRC20 address)"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-white focus:outline-none focus:border-[#E6A05A]"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Ensure your wallet supports <strong>USDT — TRC20 (TRON)</strong>.
                </p>
              </div>

              <button
                type="submit"
                disabled={availableBalance < minWithdrawal}
                className="w-full py-3 rounded-xl bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] font-bold text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-[#E6A05A]/10"
              >
                {availableBalance < minWithdrawal
                  ? `Insufficient Balance (Min ${minWithdrawal.toFixed(2)} USDT Required)`
                  : 'Review Withdrawal Request'}
              </button>
            </form>
          ) : (
            <div className="p-4 rounded-xl bg-slate-900 border border-[#E6A05A]/40 space-y-4 text-xs">
              <div className="flex items-center gap-2 text-[#E6A05A] font-bold">
                <ShieldCheck className="h-4 w-4" />
                <span>Review & Confirm Withdrawal Details</span>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Withdrawal Amount:</span>
                  <span className="font-mono font-bold text-white text-sm">
                    {Number(withdrawAmount).toFixed(2)} USDT
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Payout Network:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    USDT — TRC20 (TRON)
                  </span>
                </div>
                <div className="space-y-1 pt-1">
                  <span className="text-slate-400 block">Destination Wallet Address:</span>
                  <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-white break-all">
                    {walletAddress.trim()}
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 leading-relaxed">
                Submitting this request will atomically reserve{' '}
                <strong>{Number(withdrawAmount).toFixed(2)} USDT</strong> from your available balance until an administrator completes or declines the payout.
              </div>

              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleConfirmWithdrawal}
                  disabled={submittingWithdrawal}
                  className="flex-1 py-2.5 rounded-xl bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] font-bold text-xs transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submittingWithdrawal ? 'Submitting...' : 'Confirm & Submit Request'}
                </button>
                <button
                  type="button"
                  onClick={() => setReviewingWithdrawal(false)}
                  disabled={submittingWithdrawal}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer"
                >
                  Edit
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-2 border-t border-slate-800/80">
            <Lock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span>
              Protected by PostgreSQL atomic ledger reservations. Rejected requests automatically return funds to your available balance.
            </span>
          </div>
        </div>

        {/* Right 7 Cols: Withdrawal Requests History */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-base font-bold text-white">Withdrawal Request History</h2>
              <p className="text-xs text-slate-400">
                Track the status of your USDT — TRC20 (TRON) payout requests
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {(summary?.withdrawals || []).length} request(s)
            </span>
          </div>

          {!summary?.withdrawals || summary.withdrawals.length === 0 ? (
            <div className="py-12 text-center space-y-2 text-xs text-slate-500">
              <Wallet className="h-8 w-8 mx-auto text-slate-600" />
              <p>You have not submitted any withdrawal requests yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 pr-3">ID / Date</th>
                    <th className="py-2.5 pr-3">Amount</th>
                    <th className="py-2.5 pr-3">Network & Wallet</th>
                    <th className="py-2.5 pr-3">Status</th>
                    <th className="py-2.5">Payout TX / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {summary.withdrawals.map((w) => (
                    <tr key={w.id} className="text-slate-300">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-white text-[11px]">{w.id}</div>
                        <div className="text-[10px] text-slate-500">
                          {new Date(w.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="py-3 pr-3 font-bold text-emerald-400 tabular-nums">
                        {w.amount.toFixed(2)} USDT
                      </td>
                      <td className="py-3 pr-3">
                        <div className="text-[10px] text-[#E6A05A] font-sans font-semibold">
                          {w.network}
                        </div>
                        <div
                          className="text-[11px] text-slate-300 truncate max-w-[160px]"
                          title={w.walletAddress}
                        >
                          {w.walletAddress}
                        </div>
                      </td>
                      <td className="py-3 pr-3 font-sans">
                        {getWithdrawalStatusBadge(w.status)}
                      </td>
                      <td className="py-3 font-sans text-[11px]">
                        {w.txHash ? (
                          <div className="space-y-0.5">
                            <span className="text-slate-400 block text-[10px]">TX Hash:</span>
                            <span
                              className="font-mono text-emerald-400 break-all"
                              title={w.txHash}
                            >
                              {w.txHash.length > 18
                                ? `${w.txHash.slice(0, 10)}...${w.txHash.slice(-6)}`
                                : w.txHash}
                            </span>
                          </div>
                        ) : w.rejectionReason ? (
                          <span className="text-rose-400">Reason: {w.rejectionReason}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Referral Commission Transaction History */}
      <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-base font-bold text-white">
              Referral Commission Transaction History
            </h2>
            <p className="text-xs text-slate-400">
              Verified subscription purchases by your referred customers (40% commission rate)
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {(summary?.commissions || []).length} commission entry(s)
          </span>
        </div>

        {!summary?.commissions || summary.commissions.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">
            No referral commissions earned yet. Share your referral link above to start earning 40% on verified purchases!
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-2.5 pr-3">Commission ID</th>
                  <th className="py-2.5 pr-3">Date</th>
                  <th className="py-2.5 pr-3">Referred Customer</th>
                  <th className="py-2.5 pr-3">Plan & Order</th>
                  <th className="py-2.5 pr-3 text-right">Purchase Amount</th>
                  <th className="py-2.5 pr-3 text-right">Commission (40%)</th>
                  <th className="py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {summary.commissions.map((c) => (
                  <tr key={c.id} className="text-slate-300">
                    <td className="py-3 pr-3 font-semibold text-white text-[11px]">{c.id}</td>
                    <td className="py-3 pr-3 text-[11px]">
                      {new Date(c.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 pr-3 font-sans">
                      <div className="text-white font-medium">
                        {c.referredUserEmail || c.referredUserId}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <span className="text-white font-semibold">{c.planName || c.planId}</span>
                      <div className="text-[10px] text-slate-500">Order: {c.orderId}</div>
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums text-slate-300">
                      {c.purchaseAmount.toFixed(2)} USDT
                    </td>
                    <td className="py-3 pr-3 text-right font-bold text-emerald-400 tabular-nums">
                      +{c.commissionAmount.toFixed(2)} USDT
                    </td>
                    <td className="py-3 text-center font-sans">
                      <span className="px-2 py-0.5 rounded text-[10px] uppercase font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {c.status}
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
  );
};
