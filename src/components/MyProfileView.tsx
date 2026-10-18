import React, { useState, useEffect } from 'react';
import {
  User as UserIcon,
  Layers,
  Gift,
  Receipt,
  Check,
  Copy,
  ExternalLink,
  Clock,
  ShieldCheck,
  AlertCircle,
  PlusCircle,
  RefreshCw,
  QrCode,
  DollarSign,
  ArrowRight,
  TrendingUp,
  X,
  Loader2,
  Calendar,
  Building,
  Mail,
  Key,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type {
  User,
  Organization,
  UserCapacityInfo,
  SubscriptionEntitlement,
  CryptoPaymentOrder,
  UserReferralProfile,
  WithdrawalRequestRecord,
} from '../types.ts';
import { CryptoPaymentModal } from './CryptoPaymentModal.tsx';

interface MyProfileViewProps {
  user: User;
  organization: Organization | null;
  initialTab?: 'account' | 'subscriptions' | 'referrals' | 'payments';
  onNavigate: (view: string) => void;
  onRefreshUserData: () => void;
}

export const MyProfileView: React.FC<MyProfileViewProps> = ({
  user,
  organization,
  initialTab = 'account',
  onNavigate,
  onRefreshUserData,
}) => {
  const [activeTab, setActiveTab] = useState<'account' | 'subscriptions' | 'referrals' | 'payments'>(initialTab);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Subscriptions & Capacity
  const [capacityInfo, setCapacityInfo] = useState<UserCapacityInfo | null>(null);
  const [loadingCapacity, setLoadingCapacity] = useState(false);

  // Payments History
  const [orders, setOrders] = useState<CryptoPaymentOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [orderFilter, setOrderFilter] = useState<string>('ALL');
  const [activePaymentModalOrder, setActivePaymentModalOrder] = useState<CryptoPaymentOrder | null>(null);

  // Referrals
  const [refProfile, setRefProfile] = useState<UserReferralProfile | null>(null);
  const [loadingRef, setLoadingRef] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [submittingWithdraw, setSubmittingWithdraw] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccessMsg, setWithdrawSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    loadAllProfileData();
  }, [user.id, activeTab]);

  const loadAllProfileData = async () => {
    if (activeTab === 'subscriptions' || activeTab === 'account') {
      loadCapacity();
    }
    if (activeTab === 'payments') {
      loadOrders();
    }
    if (activeTab === 'referrals') {
      loadReferrals();
    }
  };

  const loadCapacity = async () => {
    setLoadingCapacity(true);
    try {
      const res = await apiClient.getUserSubscriptions();
      setCapacityInfo(res.capacity);
    } catch (e) {
      console.error('Failed to load user subscriptions/capacity', e);
    } finally {
      setLoadingCapacity(false);
    }
  };

  const loadOrders = async () => {
    setLoadingOrders(true);
    try {
      const res = await apiClient.getCryptoOrders();
      setOrders(res);
    } catch (e) {
      console.error('Failed to load payment orders', e);
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadReferrals = async () => {
    setLoadingRef(true);
    try {
      const p = await apiClient.getReferralProfile();
      setRefProfile(p);
    } catch (e) {
      console.error('Failed to load referral profile', e);
    } finally {
      setLoadingRef(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2200);
  };

  const getShareUrl = () => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      const code = refProfile?.referralCode || user.referralCode || '';
      return `${origin}/register?ref=${code}`;
    }
    return '';
  };

  const handleCreateWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError(null);
    setWithdrawSuccessMsg(null);

    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt <= 0) {
      setWithdrawError('Please enter a valid withdrawal amount.');
      return;
    }
    if (amt < 5) {
      setWithdrawError('Minimum withdrawal is 5.00 USDT.');
      return;
    }
    const cleanAddr = withdrawAddress.trim();
    if (!cleanAddr.startsWith('T') || cleanAddr.length !== 34) {
      setWithdrawError('Invalid Tron TRC20 address. Must start with "T" and be exactly 34 characters.');
      return;
    }

    setSubmittingWithdraw(true);
    try {
      await apiClient.requestWithdrawal(amt, cleanAddr);
      setWithdrawSuccessMsg('Withdrawal request created successfully.');
      setWithdrawAmount('');
      setWithdrawAddress('');
      setTimeout(() => {
        setIsWithdrawModalOpen(false);
        setWithdrawSuccessMsg(null);
      }, 2500);
      loadReferrals();
    } catch (err: any) {
      setWithdrawError(err.message || 'Failed to submit withdrawal request.');
    } finally {
      setSubmittingWithdraw(false);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (orderFilter === 'ALL') return true;
    return o.status.toUpperCase() === orderFilter.toUpperCase();
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16">
      {/* Header Profile Card */}
      <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#E6A05A]/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-4 sm:gap-5">
            <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl bg-[#E6A05A]/10 border border-[#E6A05A]/30 flex items-center justify-center text-[#E6A05A] text-2xl font-bold">
              {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{user.name}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                  {user.role.replace('_', ' ')}
                </span>
                {organization?.planId === 'pro' ? (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#E6A05A]/15 text-[#E6A05A] border border-[#E6A05A]/30">
                    Pro Active
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Free Trial
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-slate-500" />
                <span>{user.email}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => onNavigate('billing')}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-[#E6A05A] text-[#0B1120] text-xs sm:text-sm font-bold hover:bg-[#cf863c] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#E6A05A]/10"
            >
              <PlusCircle className="h-4 w-4" />
              <span>Add Capacity</span>
            </button>
            <button
              onClick={() => onNavigate('dashboard')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs sm:text-sm font-semibold transition-colors"
            >
              Dashboard
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 sm:gap-2 mt-8 pt-6 border-t border-slate-800/80 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('account')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'account'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <UserIcon className="h-4 w-4 text-[#E6A05A]" />
            <span>Account Details</span>
          </button>

          <button
            onClick={() => setActiveTab('subscriptions')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'subscriptions'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Layers className="h-4 w-4 text-[#E6A05A]" />
            <span>My Subscriptions</span>
            {capacityInfo && (
              <span className="px-1.5 py-0.2 rounded text-[11px] font-mono bg-[#E6A05A]/20 text-[#E6A05A]">
                {capacityInfo.totalSlots} Slots
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('referrals')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'referrals'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Gift className="h-4 w-4 text-[#E6A05A]" />
            <span>My Referrals (40%)</span>
          </button>

          <button
            onClick={() => setActiveTab('payments')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'payments'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Receipt className="h-4 w-4 text-[#E6A05A]" />
            <span>Payment History</span>
            {orders.length > 0 && (
              <span className="px-1.5 py-0.2 rounded text-[11px] font-mono bg-slate-700 text-slate-300">
                {orders.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* TAB 1: ACCOUNT DETAILS */}
      {activeTab === 'account' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4">
              <UserIcon className="h-5 w-5 text-[#E6A05A]" />
              <h2 className="text-base font-bold text-white">Identity & Account Profile</h2>
            </div>

            <div className="space-y-4 text-xs sm:text-sm">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Full Name</label>
                <div className="text-white font-medium bg-slate-900/80 px-3.5 py-2.5 rounded-xl border border-slate-800">
                  {user.name}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Email Address</label>
                <div className="text-white font-medium bg-slate-900/80 px-3.5 py-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
                  <span>{user.email}</span>
                  <span className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" /> Verified
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">User Identifier</label>
                <div className="text-slate-300 font-mono text-xs bg-slate-900/80 px-3.5 py-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
                  <span>{user.id}</span>
                  <button
                    onClick={() => copyToClipboard(user.id, 'userId')}
                    className="text-slate-400 hover:text-white transition-colors"
                    title="Copy User ID"
                  >
                    {copiedText === 'userId' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Member Since</label>
                <div className="text-slate-300 bg-slate-900/80 px-3.5 py-2.5 rounded-xl border border-slate-800 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  <span>{new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-5">
            <div className="flex items-center gap-2.5 border-b border-slate-800 pb-4">
              <Building className="h-5 w-5 text-[#E6A05A]" />
              <h2 className="text-base font-bold text-white">Organization & Workspace</h2>
            </div>

            <div className="space-y-4 text-xs sm:text-sm">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Organization Name</label>
                <div className="text-white font-medium bg-slate-900/80 px-3.5 py-2.5 rounded-xl border border-slate-800">
                  {organization?.name || 'Default Workspace'}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Assigned Role</label>
                <div className="text-white font-medium bg-slate-900/80 px-3.5 py-2.5 rounded-xl border border-slate-800 capitalize">
                  {user.role.replace('_', ' ')}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Assigned Referral Code</label>
                <div className="text-white font-mono font-bold bg-slate-900/80 px-3.5 py-2.5 rounded-xl border border-slate-800 flex items-center justify-between">
                  <span className="text-[#E6A05A]">{user.referralCode || 'Pending Assignment'}</span>
                  {user.referralCode && (
                    <button
                      onClick={() => copyToClipboard(user.referralCode!, 'refCodeAccount')}
                      className="text-slate-400 hover:text-white transition-colors"
                      title="Copy Referral Code"
                    >
                      {copiedText === 'refCodeAccount' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Quick Links</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab('subscriptions')}
                    className="flex-1 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors text-center"
                  >
                    View Subscriptions
                  </button>
                  <button
                    onClick={() => setActiveTab('payments')}
                    className="flex-1 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors text-center"
                  >
                    Payment History
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MY SUBSCRIPTIONS (STACKING ENTITLEMENTS) */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-6">
          {/* Capacity Summary Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5">
              <span className="text-xs font-medium text-slate-400 block mb-1">Total Active Capacity</span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-white">
                  {capacityInfo ? capacityInfo.totalSlots : '...'}
                </span>
                <span className="text-xs text-slate-400">websites</span>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-mono">
                {capacityInfo?.activeEntitlements?.length || 0} active subscriptions stacked
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5">
              <span className="text-xs font-medium text-slate-400 block mb-1">Currently Monitored</span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-[#E6A05A]">
                  {capacityInfo ? capacityInfo.usedSlots : '...'}
                </span>
                <span className="text-xs text-slate-400">used slots</span>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-mono">
                Active endpoints in monitoring loop
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5">
              <span className="text-xs font-medium text-slate-400 block mb-1">Remaining Available Slots</span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-emerald-400">
                  {capacityInfo ? capacityInfo.remainingSlots : '...'}
                </span>
                <span className="text-xs text-slate-400">slots free</span>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-mono">
                Ready for immediate site addition
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 flex flex-col justify-between">
              <div>
                <span className="text-xs font-medium text-slate-400 block mb-1">Expand Capacity</span>
                <p className="text-[11px] text-slate-300 leading-snug">
                  Stack an additional +5 website capacity at any time.
                </p>
              </div>
              <button
                onClick={() => onNavigate('billing')}
                className="mt-3 w-full py-2 bg-[#E6A05A] text-[#0B1120] rounded-lg text-xs font-bold hover:bg-[#cf863c] transition-colors flex items-center justify-center gap-1.5"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                <span>+ Buy 5 Sites</span>
              </button>
            </div>
          </div>

          {/* Stacking Rule Callout */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/60 p-4 text-xs text-slate-300 flex items-start gap-3">
            <Layers className="h-5 w-5 text-[#E6A05A] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-bold text-white text-xs">How Subscription Stacking Works in PulseVanguard</h4>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Each purchased subscription entitlement independently grants 5 website slots for its full duration (30 days for monthly or 365 days for annual). Purchasing additional subscriptions increases your total capacity without modifying, overwriting, or resetting existing expiration dates.
              </p>
            </div>
          </div>

          {/* Active Subscriptions List */}
          <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-white">Active Subscription Entitlements</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Currently active subscription capacity contributing to your website quota.
                </p>
              </div>
              <button
                onClick={loadCapacity}
                disabled={loadingCapacity}
                className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Refresh Subscriptions"
              >
                <RefreshCw className={`h-4 w-4 ${loadingCapacity ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingCapacity ? (
              <div className="py-12 text-center text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-[#E6A05A]" />
                <span className="text-xs">Loading active subscriptions...</span>
              </div>
            ) : capacityInfo?.activeEntitlements && capacityInfo.activeEntitlements.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {capacityInfo.activeEntitlements.map((ent, idx) => {
                  const expiresDate = new Date(ent.expiresAt);
                  const now = new Date();
                  const daysLeft = Math.max(0, Math.ceil((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

                  return (
                    <div
                      key={ent.id}
                      className="rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-5 space-y-3 relative overflow-hidden"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{ent.planName}</span>
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Active
                          </span>
                        </div>
                        <span className="text-xs font-mono font-bold text-[#E6A05A]">
                          +{ent.websiteSlots} Slots
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-800/60">
                        <div>
                          <span className="text-slate-500 text-[11px] block">Activated</span>
                          <span className="text-slate-300 font-mono text-xs">
                            {new Date(ent.startedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 text-[11px] block">Expires In</span>
                          <span className="text-emerald-300 font-mono text-xs font-semibold">
                            {daysLeft} days ({expiresDate.toLocaleDateString()})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                        <span>Interval: {ent.billingInterval === 'annual' ? 'Annual (365 days)' : 'Monthly (30 days)'}</span>
                        {ent.orderId && (
                          <span className="font-mono text-slate-400">Order #{ent.orderId.substring(0, 10)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center space-y-3">
                <AlertCircle className="h-8 w-8 text-amber-400/80 mx-auto" />
                <div className="max-w-md mx-auto text-xs text-slate-400">
                  {capacityInfo?.isTrial ? (
                    <p>
                      You are currently operating under the 24-Hour Free Trial (1 website slot). Purchase a Pro subscription to unlock 5 or more website slots.
                    </p>
                  ) : (
                    <p>No active subscriptions found. Upgrade to Pro to monitor websites 24/7.</p>
                  )}
                </div>
                <button
                  onClick={() => onNavigate('billing')}
                  className="px-4 py-2 bg-[#E6A05A] text-[#0B1120] text-xs font-bold rounded-lg hover:bg-[#cf863c] transition-colors"
                >
                  View Subscription Plans
                </button>
              </div>
            )}
          </div>

          {/* Expired / Inactive Subscriptions (if any) */}
          {capacityInfo?.allEntitlements &&
            capacityInfo.allEntitlements.filter((e) => e.status === 'expired' || new Date(e.expiresAt) <= new Date()).length > 0 && (
              <div className="rounded-2xl border border-slate-800/80 bg-[#0F172A]/60 p-6 space-y-4">
                <div className="border-b border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-300">Expired Subscription History</h3>
                  <p className="text-xs text-slate-500">
                    Past subscriptions whose allocated capacity has concluded. Websites previously associated remain preserved.
                  </p>
                </div>

                <div className="space-y-2">
                  {capacityInfo.allEntitlements
                    .filter((e) => e.status === 'expired' || new Date(e.expiresAt) <= new Date())
                    .map((ent) => (
                      <div
                        key={ent.id}
                        className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-300">{ent.planName}</span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                              Expired
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500">
                            Ran from {new Date(ent.startedAt).toLocaleDateString()} to {new Date(ent.expiresAt).toLocaleDateString()}
                          </span>
                        </div>
                        <span className="text-slate-400 font-mono">+{ent.websiteSlots} slots</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
        </div>
      )}

      {/* TAB 3: MY REFERRALS (EMBEDDED REFERRAL & COMMISSION WALLET) */}
      {activeTab === 'referrals' && (
        <div className="space-y-6">
          {/* Share Referral Link Card */}
          <div className="rounded-2xl border border-[#E6A05A]/30 bg-gradient-to-br from-[#0F172A] to-[#1E293B] p-6 sm:p-8 space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Gift className="h-5 w-5 text-[#E6A05A]" />
                  <h2 className="text-lg font-bold text-white">40% Referral Program</h2>
                </div>
                <p className="text-xs text-slate-300 mt-1 max-w-xl">
                  Invite clients, developers, and partners. Earn exactly 40% USDT commission on every approved subscription purchase made through your referral link.
                </p>
              </div>

              <div className="px-3.5 py-1.5 rounded-xl bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A] text-xs font-bold font-mono">
                $5 Plan → Earn $2.00 USDT · $50 Plan → Earn $20.00 USDT
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Your Referral Code</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={refProfile?.referralCode || user.referralCode || ''}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono font-bold tracking-wider text-sm focus:outline-none"
                  />
                  <button
                    onClick={() => copyToClipboard(refProfile?.referralCode || user.referralCode || '', 'refCodeTab')}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition-colors"
                  >
                    {copiedText === 'refCodeTab' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    <span>{copiedText === 'refCodeTab' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Shareable Referral Link</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={getShareUrl()}
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-300 font-mono text-xs focus:outline-none truncate"
                  />
                  <button
                    onClick={() => copyToClipboard(getShareUrl(), 'shareUrl')}
                    className="px-4 py-2.5 bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-md shadow-[#E6A05A]/10"
                  >
                    {copiedText === 'shareUrl' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    <span>{copiedText === 'shareUrl' ? 'Link Copied' : 'Copy Link'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Referral Wallet Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5">
              <span className="text-xs font-medium text-slate-400 block mb-1">Available for Withdrawal</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-emerald-400">
                  {refProfile ? refProfile.availableBalance.toFixed(2) : '0.00'}
                </span>
                <span className="text-xs text-slate-400 font-mono">USDT</span>
              </div>
              <button
                onClick={() => setIsWithdrawModalOpen(true)}
                disabled={(refProfile?.availableBalance || 0) < 5}
                className="mt-3 w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold transition-colors"
              >
                Request Payout (Min $5)
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5">
              <span className="text-xs font-medium text-slate-400 block mb-1">Total Earned (40%)</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-[#E6A05A]">
                  {refProfile ? refProfile.totalCommissionsEarned.toFixed(2) : '0.00'}
                </span>
                <span className="text-xs text-slate-400 font-mono">USDT</span>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-mono">
                From {refProfile?.totalEligiblePurchases || 0} approved purchases
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5">
              <span className="text-xs font-medium text-slate-400 block mb-1">Pending Reserved</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-amber-400">
                  {refProfile ? refProfile.reservedBalance.toFixed(2) : '0.00'}
                </span>
                <span className="text-xs text-slate-400 font-mono">USDT</span>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-mono">
                Locked in active payout requests
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5">
              <span className="text-xs font-medium text-slate-400 block mb-1">Total Paid Out</span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-extrabold text-white">
                  {refProfile ? refProfile.totalWithdrawn.toFixed(2) : '0.00'}
                </span>
                <span className="text-xs text-slate-400 font-mono">USDT</span>
              </div>
              <span className="text-[11px] text-slate-500 mt-2 block font-mono">
                Sent to your TRON TRC20 wallet
              </span>
            </div>
          </div>

          {/* Referred Customers & Commission Ledger */}
          <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Earned Commissions</h3>
                <p className="text-xs text-slate-400">
                  Commissions credited upon successful approval of referred customer payments.
                </p>
              </div>
              <button
                onClick={loadReferrals}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white transition-colors"
                title="Refresh Referrals"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>

            {loadingRef ? (
              <div className="py-8 text-center text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2 text-[#E6A05A]" />
                <span className="text-xs">Loading referral commissions...</span>
              </div>
            ) : refProfile?.commissions && refProfile.commissions.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/80 text-slate-400 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Plan Purchased</th>
                      <th className="py-3 px-4">Order Amount</th>
                      <th className="py-3 px-4">Rate</th>
                      <th className="py-3 px-4 text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono">
                    {refProfile.commissions.map((comm) => (
                      <tr key={comm.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 text-slate-400">
                          {new Date(comm.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-white font-sans font-medium">
                          {comm.referredUserEmail || 'Referred User'}
                        </td>
                        <td className="py-3 px-4 text-slate-300 font-sans">{comm.planName}</td>
                        <td className="py-3 px-4 text-slate-300">
                          {(comm.orderAmountCents / 100).toFixed(2)} USDT
                        </td>
                        <td className="py-3 px-4 text-emerald-400 font-bold">40%</td>
                        <td className="py-3 px-4 text-right text-emerald-400 font-bold">
                          +{(comm.commissionAmountCents / 100).toFixed(2)} USDT
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">
                No referral commissions earned yet. Share your referral link to begin earning 40% on every purchase!
              </div>
            )}
          </div>

          {/* Withdrawal Requests History */}
          <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Withdrawal Requests (Payouts)</h3>
              <p className="text-xs text-slate-400">
                Track status of your USDT (TRC20) payout requests.
              </p>
            </div>

            {refProfile?.withdrawals && refProfile.withdrawals.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/80 text-slate-400 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">TRON TRC20 Address</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Transaction Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono">
                    {refProfile.withdrawals.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 text-slate-400">
                          {new Date(w.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 font-bold text-white">
                          {(w.amountCents / 100).toFixed(2)} USDT
                        </td>
                        <td className="py-3 px-4 text-slate-400 truncate max-w-[180px]" title={w.trc20Address}>
                          {w.trc20Address}
                        </td>
                        <td className="py-3 px-4 font-sans">
                          {w.status === 'paid' && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              Paid
                            </span>
                          )}
                          {w.status === 'approved' && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                              Approved (Processing)
                            </span>
                          )}
                          {w.status === 'pending' && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              Pending Review
                            </span>
                          )}
                          {w.status === 'rejected' && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30" title={w.rejectionReason || undefined}>
                              Rejected
                            </span>
                          )}
                          {w.status === 'cancelled' && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-800 text-slate-400">
                              Cancelled
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {w.payoutTxId ? (
                            <a
                              href={`https://tronscan.org/#/transaction/${w.payoutTxId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#E6A05A] hover:underline flex items-center justify-end gap-1"
                            >
                              <span>{w.payoutTxId.substring(0, 10)}...</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-slate-500">
                No withdrawal requests submitted yet.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: MY PAYMENTS / PAYMENT HISTORY */}
      {activeTab === 'payments' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-white">Payment & Purchase History</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Record of all cryptocurrency subscription purchases, verification status, and granted entitlements.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={orderFilter}
                  onChange={(e) => setOrderFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-[#E6A05A]"
                >
                  <option value="ALL">All Payments</option>
                  <option value="PAID">Paid / Approved</option>
                  <option value="PENDING">Pending / Review</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>

                <button
                  onClick={loadOrders}
                  disabled={loadingOrders}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="Refresh Orders"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingOrders ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {loadingOrders ? (
              <div className="py-12 text-center text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-[#E6A05A]" />
                <span className="text-xs">Loading payment orders...</span>
              </div>
            ) : filteredOrders.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/80 text-slate-400 text-[11px] uppercase tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Order ID</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Purchased Plan</th>
                      <th className="py-3 px-4">Amount</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Entitlement Granted</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 font-mono">
                    {filteredOrders.map((order) => {
                      const isPending = order.status === 'Pending' || order.status === 'Confirming' || order.status === 'Manual Review';
                      const isPaid = order.status === 'Paid';
                      const isRejected = order.status === 'Rejected';

                      return (
                        <tr key={order.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-300">
                            <span className="truncate max-w-[120px] block" title={order.id}>
                              {order.id}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-slate-400 font-sans">
                            {new Date(order.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-3.5 px-4 text-white font-sans font-medium">
                            {order.planName} ({order.billingInterval === 'annual' ? 'Annual' : 'Monthly'})
                          </td>
                          <td className="py-3.5 px-4 font-bold text-white">
                            {order.amount} USDT
                          </td>
                          <td className="py-3.5 px-4 font-sans">
                            {isPaid && (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                Paid & Active
                              </span>
                            )}
                            {isPending && (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 w-fit">
                                <Clock className="h-3 w-3" />
                                <span>{order.status}</span>
                              </span>
                            )}
                            {isRejected && (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30" title={order.rejectionReason}>
                                Rejected
                              </span>
                            )}
                            {order.status === 'Cancelled' && (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400">
                                Cancelled
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 font-sans text-xs">
                            {isPaid ? (
                              <span className="text-emerald-400 font-medium flex items-center gap-1">
                                <Check className="h-3.5 w-3.5" />
                                <span>+5 Website Slots Active</span>
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            {isPending ? (
                              <button
                                onClick={() => setActivePaymentModalOrder(order)}
                                className="px-3 py-1 bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1"
                              >
                                <QrCode className="h-3.5 w-3.5" />
                                <span>Complete</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => setActivePaymentModalOrder(order)}
                                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors"
                              >
                                View Details
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center space-y-3">
                <Receipt className="h-8 w-8 text-slate-600 mx-auto" />
                <p className="text-xs text-slate-400">No payment orders found matching this filter.</p>
                <button
                  onClick={() => onNavigate('billing')}
                  className="px-4 py-2 bg-[#E6A05A] text-[#0B1120] text-xs font-bold rounded-lg hover:bg-[#cf863c] transition-colors"
                >
                  Purchase Subscription
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Withdrawal Request Modal */}
      {isWithdrawModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#0F172A] border border-slate-800 w-full max-w-md rounded-2xl p-6 sm:p-8 space-y-5 relative shadow-2xl">
            <button
              onClick={() => setIsWithdrawModalOpen(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-emerald-400" />
                <span>Request Commission Payout</span>
              </h3>
              <p className="text-xs text-slate-400">
                Withdraw your earned USDT directly to your TRON TRC20 wallet address.
              </p>
            </div>

            {withdrawError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{withdrawError}</span>
              </div>
            )}

            {withdrawSuccessMsg && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2">
                <Check className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{withdrawSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateWithdrawal} className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-300 font-semibold">Withdrawal Amount (USDT)</label>
                  <span className="text-slate-400 font-mono">
                    Available: {refProfile?.availableBalance.toFixed(2) || '0.00'} USDT
                  </span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="5"
                  max={refProfile?.availableBalance || 0}
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="Minimum 5.00 USDT"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="text-slate-300 font-semibold block mb-1">
                  Your TRON (TRC20) Destination Address
                </label>
                <input
                  type="text"
                  value={withdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value.trim())}
                  placeholder="Starts with 'T' (34 characters)"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  required
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Ensure this is a valid TRC20 address. Transfers cannot be reversed.
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submittingWithdraw}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  {submittingWithdraw ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Submitting Payout Request...</span>
                    </>
                  ) : (
                    <span>Submit Payout Request</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Crypto Payment Modal for Orders */}
      {activePaymentModalOrder && (
        <CryptoPaymentModal
          order={activePaymentModalOrder}
          onClose={() => setActivePaymentModalOrder(null)}
          onPaymentSuccess={() => {
            setActivePaymentModalOrder(null);
            loadOrders();
            loadCapacity();
            onRefreshUserData();
          }}
        />
      )}
    </div>
  );
};
