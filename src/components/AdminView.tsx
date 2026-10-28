import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Users,
  Server,
  Play,
  Check,
  RefreshCw,
  MessageSquare,
  Coins,
  ArrowRight,
  Wallet,
  Search,
  X,
  KeyRound,
  Clock,
  Calendar,
  PlusCircle,
  Gift,
  Layers,
  AlertTriangle,
  Unlock,
  Eye,
  EyeOff,
  CheckCircle2,
  Sliders,
  Globe,
  FileText,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type {
  SupportTicket,
  CryptoPaymentOrder,
  AdminUserDirectoryEntry,
  AdminUserManagementDetails,
  SubscriptionEntitlement,
} from '../types.ts';
import { AdminWithdrawalsView } from './AdminWithdrawalsView.tsx';

interface AdminViewProps {
  onNavigate?: (view: any) => void;
}

type UserModalTab = 'subscriptions' | 'trial' | 'password' | 'referrals';

export const AdminView: React.FC<AdminViewProps> = ({ onNavigate }) => {
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<AdminUserDirectoryEntry[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [paymentOrders, setPaymentOrders] = useState<CryptoPaymentOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [triggeringWorker, setTriggeringWorker] = useState(false);
  const [workerToast, setWorkerToast] = useState<string | null>(null);

  // User Accounts Directory search, filters & pagination
  const [emailSearch, setEmailSearch] = useState('');
  const [exactEmailOnly, setExactEmailOnly] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Per-User Management Modal state
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetails, setUserDetails] = useState<AdminUserManagementDetails | null>(null);
  const [loadingUserDetails, setLoadingUserDetails] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<UserModalTab>('subscriptions');
  const [modalActionBanner, setModalActionBanner] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // 1. Change Password form state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordReason, setPasswordReason] = useState('');
  const [passwordConfirmed, setPasswordConfirmed] = useState(false);
  const [submittingPassword, setSubmittingPassword] = useState(false);

  // 2. Grant Trial form state
  const [trialDurationDays, setTrialDurationDays] = useState<number>(1);
  const [trialWebsiteCapacity, setTrialWebsiteCapacity] = useState<number>(1);
  const [trialReason, setTrialReason] = useState('');
  const [trialAllowDuplicate, setTrialAllowDuplicate] = useState(false);
  const [trialConfirmed, setTrialConfirmed] = useState(false);
  const [submittingTrial, setSubmittingTrial] = useState(false);

  // 3. Grant 1-Month / 1-Year Subscription form state
  const [subDuration, setSubDuration] = useState<'1_month' | '1_year'>('1_month');
  const [subPlanId, setSubPlanId] = useState<'pro' | 'agency' | 'enterprise'>('pro');
  const [subCapacity, setSubCapacity] = useState<number>(5);
  const [subReason, setSubReason] = useState('');
  const [subConfirmed, setSubConfirmed] = useState(false);
  const [submittingSub, setSubmittingSub] = useState(false);

  // 6. Set Custom Remaining Days form state
  const [editingEntitlement, setEditingEntitlement] = useState<SubscriptionEntitlement | null>(
    null
  );
  const [customRemainingDays, setCustomRemainingDays] = useState<string>('30');
  const [remainingDaysReason, setRemainingDaysReason] = useState('');
  const [remainingDaysConfirmed, setRemainingDaysConfirmed] = useState(false);
  const [submittingRemainingDays, setSubmittingRemainingDays] = useState(false);

  const loadUsersDirectory = useCallback(
    async (opts?: {
      search?: string;
      exact?: boolean;
      role?: string;
      status?: string;
    }) => {
      setUsersLoading(true);
      try {
        const list = await apiClient.getAdminUsers({
          search: (opts?.search ?? emailSearch).trim() || undefined,
          exact: opts?.exact ?? exactEmailOnly,
          role: opts?.role ?? roleFilter,
          status: opts?.status ?? statusFilter,
        });
        setUsers(Array.isArray(list) ? list : []);
      } catch (err) {
        console.error('Failed to search/load admin users directory', err);
      } finally {
        setUsersLoading(false);
      }
    },
    [emailSearch, exactEmailOnly, roleFilter, statusFilter]
  );

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [st, u, t, orders] = await Promise.all([
        apiClient.getAdminOverview(),
        apiClient.getAdminUsers({
          search: emailSearch.trim() || undefined,
          exact: exactEmailOnly,
          role: roleFilter,
          status: statusFilter,
        }),
        apiClient.getTickets(),
        apiClient.getAdminCryptoOrders().catch(() => []),
      ]);
      setStats(st);
      setUsers(Array.isArray(u) ? u : []);
      setTickets(t);
      setPaymentOrders(Array.isArray(orders) ? orders : []);
    } catch (e) {
      console.error('Failed to load admin telemetry', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  // Re-query directory when search or filters change (with slight debounce)
  useEffect(() => {
    setCurrentPage(1);
    const timer = setTimeout(() => {
      loadUsersDirectory({
        search: emailSearch,
        exact: exactEmailOnly,
        role: roleFilter,
        status: statusFilter,
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [emailSearch, exactEmailOnly, roleFilter, statusFilter, loadUsersDirectory]);

  const openUserManagementModal = async (userId: string, initialTab: UserModalTab = 'subscriptions') => {
    setSelectedUserId(userId);
    setActiveModalTab(initialTab);
    setModalActionBanner(null);
    setEditingEntitlement(null);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordReason('');
    setPasswordConfirmed(false);
    setTrialReason('');
    setTrialAllowDuplicate(false);
    setTrialConfirmed(false);
    setSubReason('');
    setSubConfirmed(false);
    setLoadingUserDetails(true);
    try {
      const detail = await apiClient.getAdminUserDetails(userId);
      setUserDetails(detail);
    } catch (err: any) {
      setModalActionBanner({
        type: 'error',
        message: err?.message || 'Failed to load user account details.',
      });
    } finally {
      setLoadingUserDetails(false);
    }
  };

  const refreshSelectedUserDetails = async (userId: string) => {
    try {
      const [detail] = await Promise.all([
        apiClient.getAdminUserDetails(userId),
        loadUsersDirectory(),
      ]);
      setUserDetails(detail);
    } catch (err: any) {
      console.error('Failed to refresh user details', err);
    }
  };

  const closeUserModal = () => {
    setSelectedUserId(null);
    setUserDetails(null);
    setEditingEntitlement(null);
    setModalActionBanner(null);
  };

  // Action 1: Change Account Password
  const handleAdminChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setModalActionBanner(null);

    if (!passwordConfirmed) {
      setModalActionBanner({
        type: 'error',
        message: 'Please check the confirmation box before changing the user password.',
      });
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      setModalActionBanner({
        type: 'error',
        message: 'New password must be at least 8 characters long.',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setModalActionBanner({
        type: 'error',
        message: 'New password and confirmation password do not match.',
      });
      return;
    }

    setSubmittingPassword(true);
    try {
      const res = await apiClient.adminChangeUserPassword(selectedUserId, {
        newPassword,
        confirmPassword,
        confirm: true,
        reason: passwordReason.trim() || 'Administrative password change',
      });
      setNewPassword('');
      setConfirmPassword('');
      setPasswordReason('');
      setPasswordConfirmed(false);
      setModalActionBanner({
        type: 'success',
        message: res.message || 'User password updated and active sessions revoked.',
      });
      await refreshSelectedUserDetails(selectedUserId);
    } catch (err: any) {
      setModalActionBanner({
        type: 'error',
        message: err?.message || 'Failed to change user password.',
      });
    } finally {
      setSubmittingPassword(false);
    }
  };

  const handleUnlockAccount = async () => {
    if (!selectedUserId) return;
    setModalActionBanner(null);
    try {
      const res = await apiClient.adminUnlockUserAccount(selectedUserId);
      setModalActionBanner({
        type: 'success',
        message: res.message || 'Account lockout cleared.',
      });
      await refreshSelectedUserDetails(selectedUserId);
    } catch (err: any) {
      setModalActionBanner({
        type: 'error',
        message: err?.message || 'Failed to unlock user account.',
      });
    }
  };

  // Action 2: Grant Trial Access Again
  const handleAdminGrantTrial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setModalActionBanner(null);

    if (!trialConfirmed) {
      setModalActionBanner({
        type: 'error',
        message: 'Please confirm before granting trial access.',
      });
      return;
    }

    setSubmittingTrial(true);
    try {
      const res = await apiClient.adminGrantUserTrial(selectedUserId, {
        durationDays: trialDurationDays,
        websiteCapacity: trialWebsiteCapacity,
        reason: trialReason.trim() || `Admin granted ${trialDurationDays}-day trial`,
        allowDuplicate: trialAllowDuplicate,
        confirm: true,
      });
      setTrialReason('');
      setTrialConfirmed(false);
      setModalActionBanner({
        type: 'success',
        message: res.message || 'Trial access granted and website limits updated immediately.',
      });
      await refreshSelectedUserDetails(selectedUserId);
    } catch (err: any) {
      setModalActionBanner({
        type: 'error',
        message: err?.message || 'Failed to grant trial access.',
      });
    } finally {
      setSubmittingTrial(false);
    }
  };

  // Action 3: Grant 1-Month or 1-Year Subscription
  const handleAdminGrantSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId) return;
    setModalActionBanner(null);

    if (!subConfirmed) {
      setModalActionBanner({
        type: 'error',
        message: 'Please confirm before granting subscription access.',
      });
      return;
    }

    setSubmittingSub(true);
    try {
      const res = await apiClient.adminGrantUserSubscription(selectedUserId, {
        duration: subDuration,
        planId: subPlanId,
        websiteCapacity: subCapacity,
        reason:
          subReason.trim() ||
          `Admin granted ${subDuration === '1_year' ? '1-year' : '1-month'} ${subPlanId.toUpperCase()} subscription`,
        confirm: true,
      });
      setSubReason('');
      setSubConfirmed(false);
      setModalActionBanner({
        type: 'success',
        message:
          res.message ||
          'Independent admin_grant subscription entitlement created and website limits updated.',
      });
      await refreshSelectedUserDetails(selectedUserId);
    } catch (err: any) {
      setModalActionBanner({
        type: 'error',
        message: err?.message || 'Failed to grant subscription access.',
      });
    } finally {
      setSubmittingSub(false);
    }
  };

  // Action 6: Set Custom Remaining Subscription Days
  const startEditingRemainingDays = (ent: SubscriptionEntitlement) => {
    setEditingEntitlement(ent);
    setCustomRemainingDays(String(ent.isActive ? ent.daysRemaining : 30));
    setRemainingDaysReason('');
    setRemainingDaysConfirmed(false);
    setModalActionBanner(null);
  };

  const handleSaveRemainingDays = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntitlement || !selectedUserId) return;
    setModalActionBanner(null);

    if (!remainingDaysConfirmed) {
      setModalActionBanner({
        type: 'error',
        message: 'Please confirm before updating remaining subscription days.',
      });
      return;
    }

    const parsedDays = Number(customRemainingDays);
    if (!Number.isFinite(parsedDays) || parsedDays < 0 || parsedDays > 3650) {
      setModalActionBanner({
        type: 'error',
        message: 'Remaining days must be a valid non-negative number between 0 and 3650.',
      });
      return;
    }

    setSubmittingRemainingDays(true);
    try {
      const res = await apiClient.adminSetEntitlementRemainingDays(editingEntitlement.id, {
        remainingDays: parsedDays,
        reason:
          remainingDaysReason.trim() ||
          `Admin set remaining subscription days to ${parsedDays}d`,
        userId: selectedUserId,
        confirm: true,
      });
      setEditingEntitlement(null);
      setRemainingDaysReason('');
      setRemainingDaysConfirmed(false);
      setModalActionBanner({
        type: 'success',
        message:
          res.message ||
          `Updated entitlement remaining days from ${res.previousDaysRemaining}d to ${res.newDaysRemaining}d.`,
      });
      await refreshSelectedUserDetails(selectedUserId);
    } catch (err: any) {
      setModalActionBanner({
        type: 'error',
        message: err?.message || 'Failed to update remaining subscription days.',
      });
    } finally {
      setSubmittingRemainingDays(false);
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

  const pendingPayments = paymentOrders.filter(
    (o) => o.status === 'Pending' || o.status === 'Confirming' || o.status === 'Manual Review'
  );
  const pendingWithdrawalsCount =
    stats?.pendingWithdrawalRequestsCount ??
    stats?.referralOverview?.pendingWithdrawalRequestsCount ??
    0;

  // Pagination slice for User Accounts Directory
  const totalUsersCount = users.length;
  const totalPages = Math.max(1, Math.ceil(totalUsersCount / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedUsers = users.slice(
    (safeCurrentPage - 1) * pageSize,
    safeCurrentPage * pageSize
  );

  // Proposed new expiration preview for Set Custom Remaining Days
  const parsedPreviewDays = Number(customRemainingDays);
  const isValidPreviewDays =
    Number.isFinite(parsedPreviewDays) && parsedPreviewDays >= 0 && parsedPreviewDays <= 3650;
  const proposedNewExpiresIso = isValidPreviewDays
    ? new Date(Date.now() + Math.round(parsedPreviewDays * 24 * 60 * 60 * 1000)).toISOString()
    : null;

  // Proposed new expiration preview for Grant Subscription
  const grantSubPreviewStart = new Date();
  const grantSubPreviewExpires = new Date(
    grantSubPreviewStart.getTime() +
      (subDuration === '1_year' ? 365 : 30) * 24 * 60 * 60 * 1000
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-[#E6A05A]" />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                Super Admin Platform Console
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Global system health, background monitoring workers, user tenant management, referral withdrawals, and payment approval.
            </p>
          </div>

          {/* Left-Side Admin Quick Navigation (Reports & Withdrawals on Left Side) */}
          {onNavigate && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onNavigate('reports')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:border-[#E6A05A] hover:text-white transition-colors cursor-pointer"
              >
                <MessageSquare className="h-3.5 w-3.5 text-[#E6A05A]" />
                <span>Reports ({tickets.length})</span>
              </button>

              <button
                onClick={() => onNavigate('admin-withdrawals')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-900 border border-slate-700 rounded-lg hover:border-[#E6A05A] hover:text-white transition-colors cursor-pointer"
              >
                <Wallet className="h-3.5 w-3.5 text-[#E6A05A]" />
                <span>Withdrawals</span>
                {pendingWithdrawalsCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-400 text-black font-extrabold">
                    {pendingWithdrawalsCount}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Right-Side Header: Keep Transactions + System Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {onNavigate && (
            <button
              onClick={() => onNavigate('admin-crypto-transactions')}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors cursor-pointer"
            >
              <Coins className="h-3.5 w-3.5" />
              <span>Transactions</span>
              {pendingPayments.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-black text-[#E6A05A] font-extrabold">
                  {pendingPayments.length}
                </span>
              )}
            </button>
          )}

          <button
            onClick={loadAdminData}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Telemetry</span>
          </button>
          <button
            onClick={handleTriggerWorker}
            disabled={triggeringWorker}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-200 bg-slate-800 border border-slate-700 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 text-[#E6A05A]" />
            <span>{triggeringWorker ? 'Triggering...' : 'Force Worker Tick'}</span>
          </button>
        </div>
      </div>

      {workerToast && (
        <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-800 text-xs text-emerald-300 flex items-center gap-2">
          <Check className="h-4 w-4" />
          <span>{workerToast}</span>
        </div>
      )}

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-xs text-slate-400">Total Users</span>
            <div className="text-2xl font-bold font-mono text-white tabular-nums">
              {stats.totalUsers}
            </div>
            <p className="text-[11px] text-slate-500">{stats.totalOrganizations} tenant workspaces</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-xs text-slate-400">Monitored Endpoints</span>
            <div className="text-2xl font-bold font-mono text-white tabular-nums">
              {stats.totalWebsites}
            </div>
            <p className="text-[11px] text-emerald-400 font-mono">{stats.onlineWebsites} active online</p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-xs text-slate-400">Worker Jobs Completed</span>
            <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
              {stats.workerStats?.totalChecksCompleted || 0}
            </div>
            <p className="text-[11px] text-slate-500 font-mono">
              Tick duration: {stats.workerStats?.lastRunDurationMs || 0}ms
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-800 bg-[#0F172A] space-y-1">
            <span className="text-xs text-slate-400">Platform Revenue</span>
            <div className="text-2xl font-bold font-mono text-[#E6A05A] tabular-nums">
              {stats.totalRevenue?.toLocaleString() || 0} USDT
            </div>
            <p className="text-[11px] text-slate-500">Processed USDT invoices</p>
          </div>
        </div>
      )}

      {/* Payment Approval & Review Alert Banner */}
      <div className="rounded-xl border border-[#E6A05A]/30 bg-gradient-to-r from-[#0F172A] via-slate-900 to-[#1e1710] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-[#E6A05A]" />
            <h2 className="text-sm font-bold text-white">Cryptocurrency Payment Management & Approvals</h2>
            {pendingPayments.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-black animate-pulse">
                {pendingPayments.length} Awaiting Review
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 max-w-xl">
            {pendingPayments.length > 0
              ? `There are ${pendingPayments.length} customer payment order(s) awaiting review. You can manually inspect and approve or reject subscriptions.`
              : 'All customer payment orders have been processed. Review historical settlement logs and transaction hashes.'}
          </p>
        </div>

        {onNavigate && (
          <button
            onClick={() => onNavigate('admin-crypto-transactions')}
            className="px-4 py-2 rounded-xl bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0 shadow-md cursor-pointer"
          >
            <span>Open Transactions</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Embedded Referral Commissions & Withdrawal Management Console */}
      <div className="pt-2">
        <AdminWithdrawalsView />
      </div>

      {/* Worker Queue Engine Status */}
      {stats?.workerStats && (
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">Monitoring Worker Node Status</h2>
            </div>
            <span className="text-xs font-mono text-emerald-400 font-semibold">
              RUNNING (EVERY {stats.settings?.workerIntervalSec || 30}s)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 font-sans">Last Heartbeat:</span>
              <p className="text-white">{new Date(stats.workerStats.lastTickAt).toLocaleTimeString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 font-sans">Active Queue Length:</span>
              <p className="text-white">{stats.workerStats.activeQueueLength} sites pending</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-400 font-sans">Active Node Failures:</span>
              <p className="text-white">{stats.workerStats.activeFailures} failures tracking</p>
            </div>
          </div>
        </div>
      )}

      {/* Upgraded User Accounts Directory */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[#E6A05A]" />
              <h2 className="text-sm sm:text-base font-bold text-white">
                User Accounts Directory
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                {totalUsersCount} {totalUsersCount === 1 ? 'account' : 'accounts'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Search users by exact or partial email and manage passwords, trial access, 1-month/1-year subscriptions, custom remaining days, and referrals.
            </p>
          </div>

          {/* Search & Filter Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-[250px] sm:min-w-[300px] flex-1">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={emailSearch}
                onChange={(e) => setEmailSearch(e.target.value)}
                placeholder="Search user by email (exact or partial)..."
                aria-label="Search users by email"
                className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
              />
              {emailSearch && (
                <button
                  type="button"
                  onClick={() => setEmailSearch('')}
                  title="Clear email search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={exactEmailOnly}
                onChange={(e) => setExactEmailOnly(e.target.checked)}
                className="rounded border-slate-700 text-[#E6A05A] focus:ring-0"
              />
              <span>Exact email</span>
            </label>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by subscription status"
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-[#E6A05A]"
            >
              <option value="all">All Statuses</option>
              <option value="active_paid">Active Paid / Grant</option>
              <option value="active_trial">Active Trial</option>
              <option value="expired">Expired</option>
            </select>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label="Filter by role"
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-[#E6A05A]"
            >
              <option value="all">All Roles</option>
              <option value="super_admin">super_admin</option>
              <option value="admin">admin</option>
              <option value="agency_admin">agency_admin</option>
              <option value="team_member">team_member</option>
            </select>

            <button
              type="button"
              onClick={() => loadUsersDirectory()}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${usersLoading ? 'animate-spin text-[#E6A05A]' : ''}`} />
              <span>Search</span>
            </button>
          </div>
        </div>

        {/* Loading & Empty States */}
        {usersLoading && users.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <RefreshCw className="h-5 w-5 animate-spin text-[#E6A05A] mx-auto" />
            <p className="text-xs text-slate-400">Searching user accounts directory...</p>
          </div>
        ) : paginatedUsers.length === 0 ? (
          <div className="py-10 text-center rounded-xl border border-slate-800/80 bg-slate-900/40 space-y-3">
            <p className="text-xs sm:text-sm font-semibold text-slate-300">
              No user accounts found matching{' '}
              {emailSearch ? (
                <span className="font-mono text-[#E6A05A]">"{emailSearch}"</span>
              ) : (
                'the selected filters'
              )}
              .
            </p>
            <p className="text-xs text-slate-500">
              Try a partial email address or reset the directory filters.
            </p>
            {(emailSearch || exactEmailOnly || roleFilter !== 'all' || statusFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setEmailSearch('');
                  setExactEmailOnly(false);
                  setRoleFilter('all');
                  setStatusFilter('all');
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white cursor-pointer"
              >
                Reset Search & Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800 pb-2">
                <tr>
                  <th className="py-2.5 pr-3">User</th>
                  <th className="py-2.5 px-2">Email</th>
                  <th className="py-2.5 px-2">Subscriptions & Remaining</th>
                  <th className="py-2.5 px-2">Website Capacity</th>
                  <th className="py-2.5 px-2">Referrals</th>
                  <th className="py-2.5 px-2">Role</th>
                  <th className="py-2.5 px-2">Created</th>
                  <th className="py-2.5 pl-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {paginatedUsers.map((u) => {
                  const entSummary = u.entitlementSummary;
                  const activeEnts = entSummary?.activeEntitlements || [];
                  const totalCap = entSummary?.totalActiveCapacity ?? 0;
                  const usedCap = entSummary?.usedWebsiteSlots ?? u.activeWebsitesCount ?? 0;
                  const availCap = entSummary?.remainingWebsiteSlots ?? Math.max(0, totalCap - usedCap);
                  const isSuperUnlim = Boolean(entSummary?.isUnlimited);
                  const earliestActive = activeEnts[0];

                  return (
                    <tr key={u.id} className="text-slate-300 hover:bg-slate-900/40 transition-colors">
                      <td className="py-3 pr-3 font-sans">
                        <div className="font-semibold text-white">{u.name}</div>
                        <div className="text-[10px] font-mono text-slate-500">{u.id}</div>
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-white font-medium">{u.email}</span>
                      </td>
                      <td className="py-3 px-2 font-sans">
                        {isSuperUnlim ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30">
                            UNLIMITED SUPER ADMIN
                          </span>
                        ) : activeEnts.length > 0 ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30">
                                {activeEnts.length} Active{' '}
                                {activeEnts.length === 1 ? 'Subscription' : 'Subscriptions'}
                              </span>
                            </div>
                            {earliestActive && (
                              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                                <Clock className="h-3 w-3 text-[#E6A05A]" />
                                <span>
                                  {earliestActive.remainingTimeFormatted ||
                                    `${earliestActive.daysRemaining}d remaining`}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold text-rose-300 bg-rose-500/10 border border-rose-500/30">
                            EXPIRED (0 Active)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 font-sans">
                        {isSuperUnlim ? (
                          <span className="text-xs text-emerald-400 font-semibold">
                            {u.websitesCount ?? 0} / Unlimited
                          </span>
                        ) : (
                          <div>
                            <span className="font-semibold text-white">
                              {usedCap} / {totalCap}
                            </span>{' '}
                            <span className="text-slate-400">used</span>
                            <div className="text-[10px] text-emerald-400">
                              {availCap} available
                              {(u.expiredWebsitesCount ?? 0) > 0 && (
                                <span className="text-rose-400 ml-1.5">
                                  • {u.expiredWebsitesCount} expired
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-2 font-sans">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-[#E6A05A]">
                            {u.referralCode || '—'}
                          </span>
                          <span className="text-slate-500">•</span>
                          <span className="text-slate-300">
                            {u.referralCount ?? 0} referred
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {u.referredByCode
                            ? `Referred by ${u.referredByEmail || u.referredByCode}`
                            : 'Direct signup'}
                        </div>
                      </td>
                      <td className="py-3 px-2 font-sans">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[#E6A05A] bg-[#E6A05A]/10 border border-[#E6A05A]/20">
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-slate-400 text-[11px]">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 pl-2 text-right font-sans">
                        <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => openUserManagementModal(u.id, 'subscriptions')}
                            className="px-2.5 py-1.5 rounded-lg bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-[11px] font-bold transition-colors cursor-pointer"
                          >
                            Manage User
                          </button>
                          <button
                            type="button"
                            onClick={() => openUserManagementModal(u.id, 'trial')}
                            title="Grant Trial Access"
                            className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-medium cursor-pointer"
                          >
                            Trial
                          </button>
                          <button
                            type="button"
                            onClick={() => openUserManagementModal(u.id, 'password')}
                            title="Change User Password"
                            className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-medium cursor-pointer"
                          >
                            Password
                          </button>
                          <button
                            type="button"
                            onClick={() => openUserManagementModal(u.id, 'referrals')}
                            title="View User Referrals"
                            className="px-2 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-medium cursor-pointer"
                          >
                            Referrals
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Directory Pagination Footer */}
        {totalUsersCount > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
            <div>
              Showing{' '}
              <span className="font-mono font-semibold text-white">
                {(safeCurrentPage - 1) * pageSize + 1}
              </span>
              –
              <span className="font-mono font-semibold text-white">
                {Math.min(totalUsersCount, safeCurrentPage * pageSize)}
              </span>{' '}
              of <span className="font-mono font-semibold text-white">{totalUsersCount}</span> accounts
            </div>

            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) || 15);
                  setCurrentPage(1);
                }}
                aria-label="Rows per page"
                className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300"
              >
                <option value={10}>10 / page</option>
                <option value={15}>15 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
              </select>

              <button
                type="button"
                disabled={safeCurrentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                Previous
              </button>
              <span className="font-mono text-slate-300">
                Page {safeCurrentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safeCurrentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Support Tickets Inbox */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[#E6A05A]" />
            <h2 className="text-sm font-semibold text-white">Inbound Support Tickets ({tickets.length})</h2>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('reports')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors cursor-pointer"
            >
              <span>Manage in Reports Inbox</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
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

      {/* Per-User Account Management Modal */}
      {selectedUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-[#0B1120] shadow-2xl overflow-hidden my-8">
            {/* Modal Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 bg-[#0F172A] border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    {userDetails?.user.name || 'User Account Management'}
                  </h3>
                  {userDetails?.user.email && (
                    <span className="font-mono text-xs px-2.5 py-0.5 rounded bg-slate-800 text-[#E6A05A] border border-slate-700">
                      {userDetails.user.email}
                    </span>
                  )}
                  {userDetails?.user.role && (
                    <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-[#E6A05A]/10 text-[#E6A05A] border border-[#E6A05A]/30">
                      {userDetails.user.role}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  User ID: <span className="font-mono text-slate-300">{selectedUserId}</span>
                  {userDetails?.organization && (
                    <>
                      {' '}
                      • Workspace:{' '}
                      <span className="text-slate-300">{userDetails.organization.name}</span>
                    </>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => refreshSelectedUserDetails(selectedUserId)}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 hover:text-white flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingUserDetails ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={closeUserModal}
                  className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-slate-900/70 border-b border-slate-800">
              <button
                type="button"
                onClick={() => setActiveModalTab('subscriptions')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeModalTab === 'subscriptions'
                    ? 'bg-[#E6A05A] text-[#0B1120]'
                    : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Subscriptions & Remaining Days</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModalTab('trial')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeModalTab === 'trial'
                    ? 'bg-[#E6A05A] text-[#0B1120]'
                    : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                <span>Grant Trial Access</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModalTab('password')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeModalTab === 'password'
                    ? 'bg-[#E6A05A] text-[#0B1120]'
                    : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Change Password</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModalTab('referrals')}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  activeModalTab === 'referrals'
                    ? 'bg-[#E6A05A] text-[#0B1120]'
                    : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                }`}
              >
                <Gift className="h-3.5 w-3.5" />
                <span>
                  Referrals ({userDetails?.referrals.totalReferredUsers ?? 0})
                </span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 max-h-[75vh] overflow-y-auto space-y-6">
              {modalActionBanner && (
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
                    modalActionBanner.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-700/70 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-700/70 text-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {modalActionBanner.type === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                    )}
                    <span>{modalActionBanner.message}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModalActionBanner(null)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {loadingUserDetails && !userDetails ? (
                <div className="py-16 text-center space-y-2">
                  <RefreshCw className="h-6 w-6 animate-spin text-[#E6A05A] mx-auto" />
                  <p className="text-xs text-slate-400">Loading user entitlements, trial status, and referral data...</p>
                </div>
              ) : userDetails ? (
                <>
                  {/* TAB 1: SUBSCRIPTIONS, GRANT 1M/1Y SUBSCRIPTION & SET CUSTOM REMAINING DAYS */}
                  {activeModalTab === 'subscriptions' && (
                    <div className="space-y-6">
                      {/* Capacity KPI Summary */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                            Total Active Capacity
                          </span>
                          <div className="text-xl font-extrabold font-mono text-white mt-0.5">
                            {userDetails.entitlementSummary.isUnlimited
                              ? 'Unlimited'
                              : `${userDetails.entitlementSummary.totalActiveCapacity} websites`}
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                            Allocated Websites
                          </span>
                          <div className="text-xl font-extrabold font-mono text-[#E6A05A] mt-0.5">
                            {userDetails.entitlementSummary.usedWebsiteSlots} used
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                            Available Capacity
                          </span>
                          <div className="text-xl font-extrabold font-mono text-emerald-400 mt-0.5">
                            {userDetails.entitlementSummary.isUnlimited
                              ? 'Unlimited'
                              : `${userDetails.entitlementSummary.remainingWebsiteSlots} free`}
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                            Active Entitlements
                          </span>
                          <div className="text-xl font-extrabold font-mono text-white mt-0.5">
                            {userDetails.entitlementSummary.activeEntitlementCount}
                          </div>
                        </div>
                      </div>

                      {/* Set Custom Remaining Days Editor (when an entitlement is selected) */}
                      {editingEntitlement && (
                        <form
                          onSubmit={handleSaveRemainingDays}
                          className="rounded-xl border-2 border-[#E6A05A]/60 bg-[#0F172A] p-5 space-y-4 shadow-xl"
                        >
                          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                            <div className="flex items-center gap-2">
                              <Sliders className="h-4 w-4 text-[#E6A05A]" />
                              <h4 className="text-sm font-bold text-white">
                                Set Custom Remaining Subscription Days — {editingEntitlement.planName}
                              </h4>
                              <span className="font-mono text-[11px] text-slate-400">
                                ({editingEntitlement.id})
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingEntitlement(null)}
                              className="text-xs text-slate-400 hover:text-white cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                              <span className="text-slate-400 block text-[11px]">
                                Original Start Date (Preserved):
                              </span>
                              <span className="font-mono font-semibold text-white">
                                {new Date(editingEntitlement.startsAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                              <span className="text-slate-400 block text-[11px]">
                                Current Expiration Date ({editingEntitlement.daysRemaining}d left):
                              </span>
                              <span className="font-mono font-semibold text-amber-300">
                                {new Date(editingEntitlement.expiresAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/60">
                              <span className="text-emerald-300/80 block text-[11px]">
                                Proposed New Expiration Date:
                              </span>
                              <span className="font-mono font-bold text-emerald-300">
                                {proposedNewExpiresIso
                                  ? new Date(proposedNewExpiresIso).toLocaleString()
                                  : 'Invalid days value'}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="block text-xs font-semibold text-slate-200">
                                Custom Remaining Days (0 to 3650)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={3650}
                                step={1}
                                value={customRemainingDays}
                                onChange={(e) => setCustomRemainingDays(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white focus:outline-none focus:border-[#E6A05A]"
                              />
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {[
                                  { label: '0d (Expire Now)', val: '0' },
                                  { label: '7 Days', val: '7' },
                                  { label: '15 Days', val: '15' },
                                  { label: '30 Days', val: '30' },
                                  { label: '90 Days', val: '90' },
                                  { label: '365 Days', val: '365' },
                                ].map((preset) => (
                                  <button
                                    key={preset.val}
                                    type="button"
                                    onClick={() => setCustomRemainingDays(preset.val)}
                                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300 cursor-pointer"
                                  >
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <label className="block text-xs font-semibold text-slate-200">
                                Administrative Reason / Audit Note
                              </label>
                              <input
                                type="text"
                                value={remainingDaysReason}
                                onChange={(e) => setRemainingDaysReason(e.target.value)}
                                placeholder="e.g. Extended customer subscription by 15 days per support ticket"
                                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
                              />
                              <p className="text-[11px] text-slate-400">
                                Allocated websites ({editingEntitlement.allocatedWebsitesCount ?? 0}) will immediately recalculate active/expired status.
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800">
                            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={remainingDaysConfirmed}
                                onChange={(e) => setRemainingDaysConfirmed(e.target.checked)}
                                className="rounded border-slate-700 text-[#E6A05A]"
                              />
                              <span>
                                I confirm updating remaining days to{' '}
                                <strong className="text-white">{customRemainingDays || 0} day(s)</strong> for this entitlement.
                              </span>
                            </label>

                            <button
                              type="submit"
                              disabled={submittingRemainingDays || !isValidPreviewDays}
                              className="px-4 py-2 rounded-lg bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-xs font-bold disabled:opacity-50 cursor-pointer"
                            >
                              {submittingRemainingDays
                                ? 'Updating Expiration...'
                                : 'Save Custom Remaining Days'}
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Active & Historical Entitlements List */}
                      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="text-sm font-bold text-white">
                              User Subscription Entitlements ({userDetails.entitlementSummary.entitlements.length})
                            </h4>
                            <p className="text-xs text-slate-400">
                              Each entitlement has its own independent start date, expiration date, website capacity, and allocated websites.
                            </p>
                          </div>
                        </div>

                        {userDetails.entitlementSummary.entitlements.length === 0 ? (
                          <p className="text-xs text-slate-400 py-4">
                            No subscription entitlements recorded for this user yet.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                                <tr>
                                  <th className="py-2 pr-3">Plan & ID</th>
                                  <th className="py-2 px-2">Source</th>
                                  <th className="py-2 px-2">Start Date</th>
                                  <th className="py-2 px-2">Expiration Date</th>
                                  <th className="py-2 px-2">Remaining Time</th>
                                  <th className="py-2 px-2">Capacity & Allocated Websites</th>
                                  <th className="py-2 px-2">Status</th>
                                  <th className="py-2 pl-2 text-right">Manage Days</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60 font-mono">
                                {userDetails.entitlementSummary.entitlements.map((ent) => {
                                  const usedCount =
                                    ent.allocatedWebsitesCount ?? ent.allocatedWebsites?.length ?? 0;
                                  const availCount =
                                    ent.availableCapacity ??
                                    (ent.isActive ? Math.max(0, ent.websiteCapacity - usedCount) : 0);
                                  const sourceLabel =
                                    ent.source === 'admin_grant'
                                      ? 'admin_grant'
                                      : ent.source === 'trial'
                                      ? 'trial'
                                      : 'paid_purchase';

                                  return (
                                    <tr key={ent.id} className="text-slate-300 align-top">
                                      <td className="py-3 pr-3 font-sans">
                                        <div className="font-semibold text-white">{ent.planName}</div>
                                        <div className="font-mono text-[10px] text-slate-500">
                                          {ent.id}
                                        </div>
                                        {ent.grantReason && (
                                          <div className="text-[10px] text-slate-400 mt-0.5">
                                            Note: {ent.grantReason}
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-3 px-2 font-sans">
                                        <span
                                          className={`inline-block px-2 py-0.5 rounded border text-[10px] font-mono font-semibold ${
                                            sourceLabel === 'admin_grant'
                                              ? 'text-purple-300 bg-purple-500/10 border-purple-500/30'
                                              : sourceLabel === 'trial'
                                              ? 'text-sky-300 bg-sky-500/10 border-sky-500/30'
                                              : 'text-[#E6A05A] bg-[#E6A05A]/10 border-[#E6A05A]/30'
                                          }`}
                                        >
                                          {sourceLabel}
                                        </span>
                                      </td>
                                      <td className="py-3 px-2 text-[11px]">
                                        {new Date(ent.startsAt).toLocaleDateString()}
                                      </td>
                                      <td className="py-3 px-2 text-[11px]">
                                        <div>{new Date(ent.expiresAt).toLocaleDateString()}</div>
                                        <div className="text-[10px] text-slate-500">
                                          {new Date(ent.expiresAt).toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                        </div>
                                      </td>
                                      <td className="py-3 px-2 font-sans">
                                        <span
                                          className={`font-semibold ${
                                            ent.isActive ? 'text-emerald-400' : 'text-rose-400'
                                          }`}
                                        >
                                          {ent.remainingTimeFormatted ||
                                            (ent.isActive ? `${ent.daysRemaining} days remaining` : 'Expired')}
                                        </span>
                                      </td>
                                      <td className="py-3 px-2 font-sans">
                                        <div className="text-xs">
                                          <span className="font-bold text-white">
                                            {ent.websiteCapacity} websites
                                          </span>{' '}
                                          •{' '}
                                          <span className="text-[#E6A05A] font-semibold">
                                            {usedCount} allocated
                                          </span>{' '}
                                          •{' '}
                                          <span className="text-emerald-400 font-semibold">
                                            {availCount} available
                                          </span>
                                        </div>
                                        {ent.allocatedWebsites && ent.allocatedWebsites.length > 0 && (
                                          <div className="flex flex-wrap gap-1 mt-1.5">
                                            {ent.allocatedWebsites.map((w) => (
                                              <span
                                                key={w.id}
                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                                                  w.accessStatus === 'expired_grace_period'
                                                    ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                                                    : 'bg-slate-800 border-slate-700 text-slate-200'
                                                }`}
                                              >
                                                <Globe className="h-2.5 w-2.5" />
                                                {w.domain}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-3 px-2 font-sans">
                                        <span
                                          className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                                            ent.isActive
                                              ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/30'
                                              : 'text-rose-300 bg-rose-500/10 border border-rose-500/30'
                                          }`}
                                        >
                                          {ent.status}
                                        </span>
                                      </td>
                                      <td className="py-3 pl-2 text-right font-sans">
                                        <button
                                          type="button"
                                          onClick={() => startEditingRemainingDays(ent)}
                                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-[#E6A05A] text-slate-200 hover:text-[#0B1120] text-[11px] font-semibold transition-colors cursor-pointer"
                                        >
                                          Set Remaining Days
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {/* Action 3: Add 1-Month or 1-Year Subscription Access */}
                      <form
                        onSubmit={handleAdminGrantSubscription}
                        className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4"
                      >
                        <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
                          <PlusCircle className="h-4 w-4 text-[#E6A05A]" />
                          <div>
                            <h4 className="text-sm font-bold text-white">
                              Add 1-Month or 1-Year Subscription Access (Admin Grant)
                            </h4>
                            <p className="text-xs text-slate-400">
                              Creates a separate independent SubscriptionEntitlement marked as <code className="text-[#E6A05A]">admin_grant</code> without overwriting existing subscriptions or creating fake payment records.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-200">
                              Subscription Duration
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => setSubDuration('1_month')}
                                className={`py-2 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                                  subDuration === '1_month'
                                    ? 'bg-[#E6A05A]/15 border-[#E6A05A] text-[#E6A05A]'
                                    : 'bg-slate-900 border-slate-800 text-slate-300'
                                }`}
                              >
                                1 Month (30d)
                              </button>
                              <button
                                type="button"
                                onClick={() => setSubDuration('1_year')}
                                className={`py-2 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                                  subDuration === '1_year'
                                    ? 'bg-[#E6A05A]/15 border-[#E6A05A] text-[#E6A05A]'
                                    : 'bg-slate-900 border-slate-800 text-slate-300'
                                }`}
                              >
                                1 Year (365d)
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-200">
                              Plan Tier
                            </label>
                            <select
                              value={subPlanId}
                              onChange={(e) => {
                                const val = e.target.value as 'pro' | 'agency' | 'enterprise';
                                setSubPlanId(val);
                                if (val === 'pro') setSubCapacity(5);
                                if (val === 'agency') setSubCapacity(25);
                                if (val === 'enterprise') setSubCapacity(100);
                              }}
                              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                            >
                              <option value="pro">Pro Plan (Default 5 Websites)</option>
                              <option value="agency">Agency Plan (25 Websites)</option>
                              <option value="enterprise">Enterprise Plan (100 Websites)</option>
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-200">
                              Website Capacity
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              value={subCapacity}
                              onChange={(e) => setSubCapacity(Math.max(1, Number(e.target.value) || 5))}
                              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white"
                            />
                          </div>
                        </div>

                        {/* Live Preview of Start, Expiration, Duration, Capacity */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs">
                          <div>
                            <span className="text-[10px] text-slate-400 block">Start Date:</span>
                            <span className="font-mono text-white">
                              {grantSubPreviewStart.toLocaleDateString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block">Expiration Date:</span>
                            <span className="font-mono text-emerald-400 font-semibold">
                              {grantSubPreviewExpires.toLocaleDateString()}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block">Duration:</span>
                            <span className="font-mono text-white">
                              {subDuration === '1_year' ? '1 Year (365 Days)' : '1 Month (30 Days)'}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block">Website Capacity:</span>
                            <span className="font-mono text-[#E6A05A] font-bold">
                              +{subCapacity} Websites
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-slate-200">
                            Administrative Grant Reason / Note
                          </label>
                          <input
                            type="text"
                            value={subReason}
                            onChange={(e) => setSubReason(e.target.value)}
                            placeholder="e.g. Complimentary 1-month Pro package for enterprise onboarding"
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500"
                          />
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={subConfirmed}
                              onChange={(e) => setSubConfirmed(e.target.checked)}
                              className="rounded border-slate-700 text-[#E6A05A]"
                            />
                            <span>
                              I confirm granting a{' '}
                              <strong className="text-white">
                                {subDuration === '1_year' ? '1-Year' : '1-Month'}
                              </strong>{' '}
                              subscription (+{subCapacity} websites) to {userDetails.user.email}.
                            </span>
                          </label>

                          <button
                            type="submit"
                            disabled={submittingSub}
                            className="px-4 py-2 rounded-lg bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {submittingSub
                              ? 'Granting Subscription...'
                              : `Grant ${subDuration === '1_year' ? '1-Year' : '1-Month'} Subscription`}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* TAB 2: GRANT TRIAL ACCESS AGAIN */}
                  {activeModalTab === 'trial' && (
                    <div className="space-y-6">
                      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-[#E6A05A]" />
                            <h4 className="text-sm font-bold text-white">Current Trial Status</h4>
                          </div>
                          <span
                            className={`px-2.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                              !userDetails.trialStatus.isExpired
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'
                            }`}
                          >
                            {!userDetails.trialStatus.isExpired ? 'ACTIVE TRIAL' : 'TRIAL EXPIRED / INACTIVE'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 block text-[11px]">Trial Started At:</span>
                            <span className="font-mono text-white">
                              {userDetails.trialStatus.trialStartedAt
                                ? new Date(userDetails.trialStatus.trialStartedAt).toLocaleString()
                                : '—'}
                            </span>
                          </div>
                          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 block text-[11px]">Trial Expires At:</span>
                            <span className="font-mono text-white">
                              {userDetails.trialStatus.trialEndsAt
                                ? new Date(userDetails.trialStatus.trialEndsAt).toLocaleString()
                                : '—'}
                            </span>
                          </div>
                          <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                            <span className="text-slate-400 block text-[11px]">Remaining Trial Time:</span>
                            <span className="font-mono font-semibold text-[#E6A05A]">
                              {!userDetails.trialStatus.isExpired && userDetails.trialStatus.remainingMs > 0
                                ? `${Math.ceil(userDetails.trialStatus.remainingMs / (60 * 60 * 1000))} hours remaining`
                                : '0h (Expired)'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <form
                        onSubmit={handleAdminGrantTrial}
                        className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4"
                      >
                        <div className="border-b border-slate-800 pb-3">
                          <h4 className="text-sm font-bold text-white">
                            Grant Trial Access Again
                          </h4>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Re-enables or grants a fresh trial entitlement with explicit <code className="text-[#E6A05A]">starts_at</code> and <code className="text-[#E6A05A]">expires_at</code> timestamps and updates website capacity immediately.
                          </p>
                        </div>

                        {!userDetails.trialStatus.isExpired && (
                          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-700/60 text-xs text-amber-200 space-y-2">
                            <div className="flex items-center gap-2 font-bold">
                              <AlertTriangle className="h-4 w-4 text-amber-400" />
                              <span>Active Trial Already Detected</span>
                            </div>
                            <p className="text-amber-200/80">
                              This user already has an active trial expiring at{' '}
                              {userDetails.trialStatus.trialEndsAt
                                ? new Date(userDetails.trialStatus.trialEndsAt).toLocaleString()
                                : 'a future date'}
                              . To prevent accidental duplicate active trials, you must explicitly check the duplicate override box below if you wish to grant another trial.
                            </p>
                            <label className="inline-flex items-center gap-2 font-semibold text-amber-300 cursor-pointer pt-1">
                              <input
                                type="checkbox"
                                checked={trialAllowDuplicate}
                                onChange={(e) => setTrialAllowDuplicate(e.target.checked)}
                                className="rounded border-amber-600"
                              />
                              <span>Allow duplicate active trial override for this user</span>
                            </label>
                          </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-200">
                              Trial Duration (Days)
                            </label>
                            <select
                              value={trialDurationDays}
                              onChange={(e) => setTrialDurationDays(Number(e.target.value) || 1)}
                              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                            >
                              <option value={1}>24 Hours (1 Day — Standard Trial)</option>
                              <option value={3}>3 Days</option>
                              <option value={7}>7 Days</option>
                              <option value={14}>14 Days</option>
                              <option value={30}>30 Days</option>
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-200">
                              Trial Website Capacity
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={25}
                              value={trialWebsiteCapacity}
                              onChange={(e) =>
                                setTrialWebsiteCapacity(Math.max(1, Number(e.target.value) || 1))
                              }
                              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-white"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-slate-200">
                            Reason / Audit Note
                          </label>
                          <input
                            type="text"
                            value={trialReason}
                            onChange={(e) => setTrialReason(e.target.value)}
                            placeholder="e.g. Re-enabled trial access after customer evaluation request"
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500"
                          />
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={trialConfirmed}
                              onChange={(e) => setTrialConfirmed(e.target.checked)}
                              className="rounded border-slate-700 text-[#E6A05A]"
                            />
                            <span>
                              I confirm granting a {trialDurationDays}-day trial ({trialWebsiteCapacity}{' '}
                              website{trialWebsiteCapacity === 1 ? '' : 's'}) to {userDetails.user.email}.
                            </span>
                          </label>

                          <button
                            type="submit"
                            disabled={submittingTrial}
                            className="px-4 py-2 rounded-lg bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {submittingTrial ? 'Granting Trial...' : 'Grant Trial Access'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* TAB 3: CHANGE ACCOUNT PASSWORD */}
                  {activeModalTab === 'password' && (
                    <div className="space-y-6">
                      <form
                        onSubmit={handleAdminChangePassword}
                        className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                          <div>
                            <h4 className="text-sm font-bold text-white">
                              Change Account Password — {userDetails.user.email}
                            </h4>
                            <p className="text-xs text-slate-400 mt-0.5">
                              Hashes the new password with <code className="text-[#E6A05A]">scrypt</code>, invalidates all existing active sessions for this user, and records the action in the security audit log without logging the password.
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={handleUnlockAccount}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-[#E6A05A] text-xs font-semibold text-slate-200 flex items-center gap-1.5 self-start cursor-pointer"
                          >
                            <Unlock className="h-3.5 w-3.5 text-[#E6A05A]" />
                            <span>Clear Login Lockout</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-200">
                              New Password (minimum 8 characters)
                            </label>
                            <div className="relative">
                              <input
                                type={showPassword ? 'text' : 'password'}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Enter strong new password..."
                                autoComplete="new-password"
                                className="w-full pl-3 pr-9 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((s) => !s)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                              >
                                {showPassword ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-200">
                              Confirm New Password
                            </label>
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              placeholder="Re-enter new password..."
                              autoComplete="new-password"
                              className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-slate-200">
                            Administrative Reason / Audit Note
                          </label>
                          <input
                            type="text"
                            value={passwordReason}
                            onChange={(e) => setPasswordReason(e.target.value)}
                            placeholder="e.g. Customer requested manual password reset via verified support ticket"
                            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500"
                          />
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-800">
                          <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={passwordConfirmed}
                              onChange={(e) => setPasswordConfirmed(e.target.checked)}
                              className="rounded border-slate-700 text-[#E6A05A]"
                            />
                            <span>
                              I confirm changing the password for{' '}
                              <strong className="text-white">{userDetails.user.email}</strong> and revoking their active sessions.
                            </span>
                          </label>

                          <button
                            type="submit"
                            disabled={submittingPassword}
                            className="px-4 py-2 rounded-lg bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] text-xs font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {submittingPassword ? 'Updating Password...' : 'Change Account Password'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {/* TAB 4: VIEW REFERRALS & COMMISSIONS */}
                  {activeModalTab === 'referrals' && (
                    <div className="space-y-6">
                      {/* Referral Overview Cards */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                            User Referral Code
                          </span>
                          <div className="text-lg font-extrabold font-mono text-[#E6A05A] mt-0.5">
                            {userDetails.referrals.referralCode || '—'}
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                            Referred Users
                          </span>
                          <div className="text-lg font-extrabold font-mono text-white mt-0.5">
                            {userDetails.referrals.totalReferredUsers}{' '}
                            <span className="text-xs font-sans font-normal text-emerald-400">
                              ({userDetails.referrals.convertedReferredUsers} converted)
                            </span>
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                            Total Commissions Earned
                          </span>
                          <div className="text-lg font-extrabold font-mono text-emerald-400 mt-0.5">
                            {userDetails.referrals.totalCommissionEarned.toFixed(2)} USDT
                          </div>
                        </div>
                        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/70">
                          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                            Available Referral Wallet
                          </span>
                          <div className="text-lg font-extrabold font-mono text-white mt-0.5">
                            {userDetails.referrals.availableReferralBalance.toFixed(2)} USDT
                          </div>
                        </div>
                      </div>

                      {/* Who Referred This User */}
                      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div>
                          <span className="text-slate-400 font-semibold">Who Referred This User: </span>
                          {userDetails.referrals.referredByUserId ? (
                            <span className="text-white font-semibold">
                              {userDetails.referrals.referredByName || 'Partner'} (
                              <span className="font-mono text-[#E6A05A]">
                                {userDetails.referrals.referredByEmail || userDetails.referrals.referredByCode}
                              </span>
                              ) — Code:{' '}
                              <span className="font-mono text-emerald-400">
                                {userDetails.referrals.referredByCode}
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              Direct Registration (Not referred by another user)
                            </span>
                          )}
                        </div>
                        {userDetails.referrals.referredAt && (
                          <span className="font-mono text-[11px] text-slate-400">
                            Linked: {new Date(userDetails.referrals.referredAt).toLocaleString()}
                          </span>
                        )}
                      </div>

                      {/* Referred Users Table */}
                      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
                        <h4 className="text-sm font-bold text-white">
                          Users Referred by {userDetails.user.email} ({userDetails.referrals.referredUsers.length})
                        </h4>

                        {userDetails.referrals.referredUsers.length === 0 ? (
                          <p className="text-xs text-slate-400 py-3">
                            This user has not referred any accounts yet.
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                              <thead className="text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                                <tr>
                                  <th className="py-2 pr-3">Referred User</th>
                                  <th className="py-2 px-2">Email</th>
                                  <th className="py-2 px-2">Registration Date</th>
                                  <th className="py-2 px-2">Referral Status</th>
                                  <th className="py-2 px-2">Qualifying Purchases</th>
                                  <th className="py-2 pl-2 text-right">Commission Generated</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60 font-mono">
                                {userDetails.referrals.referredUsers.map((refUser) => (
                                  <tr key={refUser.userId} className="text-slate-300">
                                    <td className="py-2.5 pr-3 font-sans font-semibold text-white">
                                      {refUser.name}
                                    </td>
                                    <td className="py-2.5 px-2">{refUser.email}</td>
                                    <td className="py-2.5 px-2 text-slate-400">
                                      {new Date(refUser.joinedAt).toLocaleDateString()}
                                    </td>
                                    <td className="py-2.5 px-2 font-sans">
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                          refUser.status === 'converted'
                                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                            : 'bg-slate-800 text-slate-300'
                                        }`}
                                      >
                                        {refUser.status}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-2">{refUser.purchasesCount}</td>
                                    <td className="py-2.5 pl-2 text-right text-emerald-400 font-bold">
                                      +{refUser.totalCommissionGenerated.toFixed(2)} USDT
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

                  {/* Recent Account Audit Logs Footer inside Modal */}
                  {userDetails.auditLogs && userDetails.auditLogs.length > 0 && (
                    <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 space-y-2.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                        <FileText className="h-3.5 w-3.5 text-[#E6A05A]" />
                        <span>Recent Administrative & Account Audit Log</span>
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-1.5 text-[11px] font-mono">
                        {userDetails.auditLogs.slice(0, 10).map((log) => (
                          <div
                            key={log.id}
                            className="p-2 rounded bg-slate-900/90 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-slate-300"
                          >
                            <div>
                              <span className="text-[#E6A05A] font-bold mr-2">[{log.action}]</span>
                              <span className="font-sans">{log.details}</span>
                            </div>
                            <span className="text-slate-500 shrink-0">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
