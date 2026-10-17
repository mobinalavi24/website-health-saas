import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Plus,
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  Send,
  ArrowLeft,
  RefreshCw,
  Shield,
  User as UserIcon,
  Mail,
  Lock,
  Sparkles,
  Inbox,
  Filter,
  ChevronRight,
  Check,
  FileText,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type {
  User,
  Organization,
  SupportTicket,
  TicketStatus,
  TicketReply,
  AdminTicketInboxStats,
  ReportItem,
  Website,
} from '../types.ts';

interface ReportsViewProps {
  user: User | null;
  organization: Organization | null;
  onOpenAuth: (tab?: 'login' | 'register') => void;
  reports?: ReportItem[];
  websites?: Website[];
  onRefreshReports?: () => void;
}

const STATUS_META: Record<
  TicketStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  open: {
    label: 'Open',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    dotClass: 'bg-amber-400',
  },
  in_progress: {
    label: 'In Progress',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    dotClass: 'bg-sky-400',
  },
  waiting_for_customer: {
    label: 'Waiting for Customer',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    dotClass: 'bg-purple-400',
  },
  resolved: {
    label: 'Resolved',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dotClass: 'bg-emerald-400',
  },
  closed: {
    label: 'Closed',
    badgeClass: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
    dotClass: 'bg-slate-400',
  },
};

export const ReportsView: React.FC<ReportsViewProps> = ({
  user,
  onOpenAuth,
}) => {
  const isAdmin = Boolean(user && (user.role === 'super_admin' || user.role === 'admin'));

  // Shared state
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [adminStats, setAdminStats] = useState<AdminTicketInboxStats | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('ticketId') || null;
  });
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Customer Create Ticket form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formIdempotencyKey, setFormIdempotencyKey] = useState<string>(() => `tkt_idem_${Date.now()}`);

  // Admin filters & search state
  const [statusFilter, setStatusFilter] = useState<'all' | TicketStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Reply composer state (both Admin & Customer)
  const [replyText, setReplyText] = useState('');
  const [replyTargetStatus, setReplyTargetStatus] = useState<TicketStatus | ''>('');
  const [sendingReply, setSendingReply] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const loadTickets = useCallback(async () => {
    if (!user) return;
    setLoadingList(true);
    try {
      if (isAdmin) {
        const res = await apiClient.getAdminTickets({
          status: statusFilter === 'all' ? undefined : statusFilter,
          search: searchQuery.trim() || undefined,
        });
        setTickets(res.tickets || []);
        setAdminStats(res.stats || null);
      } else {
        const list = await apiClient.getTickets({ scope: 'own' });
        setTickets(Array.isArray(list) ? list : []);
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to load support tickets.',
      });
    } finally {
      setLoadingList(false);
    }
  }, [user, isAdmin, statusFilter, searchQuery]);

  const loadTicketDetail = useCallback(
    async (ticketId: string) => {
      if (!user || !ticketId) return;
      setLoadingDetail(true);
      try {
        const detail = await apiClient.getTicketDetail(ticketId);
        setSelectedTicket(detail);
        // Also update the ticket in the list
        setTickets((prev) => prev.map((t) => (t.id === detail.id ? detail : t)));
      } catch (err: any) {
        setFeedback({
          type: 'error',
          message: err.message || 'Could not open support ticket.',
        });
        setSelectedTicketId(null);
        setSelectedTicket(null);
      } finally {
        setLoadingDetail(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (user) {
      loadTickets();
    } else {
      setTickets([]);
      setSelectedTicket(null);
    }
  }, [user, loadTickets]);

  useEffect(() => {
    if (user && selectedTicketId) {
      loadTicketDetail(selectedTicketId);
    } else {
      setSelectedTicket(null);
    }
  }, [user, selectedTicketId, loadTicketDetail]);

  // 1. UNAUTHENTICATED VISITOR GUARD
  if (!user) {
    return (
      <div className="max-w-xl mx-auto my-12 rounded-2xl border border-slate-800 bg-[#0F172A] p-8 text-center space-y-5 shadow-2xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
          <Lock className="h-6 w-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-white">Authentication Required</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            You must be signed in to your PulseVanguard account before creating or viewing support tickets in the Reports center.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => onOpenAuth('login')}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors cursor-pointer"
          >
            Sign In to Continue
          </button>
          <button
            onClick={() => onOpenAuth('register')}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold hover:bg-slate-700 hover:text-white transition-colors cursor-pointer"
          >
            Create Free Account
          </button>
        </div>
      </div>
    );
  }

  // Handle Customer Ticket Creation
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingTicket) return;

    const cleanSubject = subject.trim();
    const cleanDescription = description.trim();

    if (cleanSubject.length < 3) {
      setFormError('Please enter a subject of at least 3 characters.');
      return;
    }
    if (cleanSubject.length > 200) {
      setFormError('Subject must be 200 characters or fewer.');
      return;
    }
    if (cleanDescription.length < 5) {
      setFormError('Please provide a description of at least 5 characters explaining the issue.');
      return;
    }

    setSubmittingTicket(true);
    setFormError(null);
    setFeedback(null);

    try {
      const created = await apiClient.createTicket({
        subject: cleanSubject,
        description: cleanDescription,
        idempotencyKey: formIdempotencyKey,
      });

      setSubject('');
      setDescription('');
      setFormIdempotencyKey(`tkt_idem_${Date.now()}`);
      setShowCreateForm(false);

      await loadTickets();
      setSelectedTicketId(created.id);
      setSelectedTicket(created);

      setFeedback({
        type: 'success',
        message: `Support ticket #${created.id} has been created and our team has been notified.`,
      });
    } catch (err: any) {
      setFormError(err.message || 'Failed to submit support ticket.');
    } finally {
      setSubmittingTicket(false);
    }
  };

  // Handle Reply (Admin or Customer)
  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || sendingReply) return;

    const cleanReply = replyText.trim();
    if (cleanReply.length < 2) {
      setFeedback({ type: 'error', message: 'Please enter a reply message before sending.' });
      return;
    }

    setSendingReply(true);
    setFeedback(null);

    try {
      const res = await apiClient.replyToTicket(selectedTicket.id, {
        message: cleanReply,
        status: isAdmin && replyTargetStatus ? replyTargetStatus : undefined,
        replyAsAdmin: isAdmin,
      });

      setReplyText('');
      setReplyTargetStatus('');
      setSelectedTicket(res.ticket);
      await loadTickets();

      if (isAdmin) {
        const emailNote = res.emailNotification?.sent
          ? `Customer notification email sent to ${res.ticket.email}.`
          : `Reply saved to database (status: ${STATUS_META[res.ticket.status]?.label || res.ticket.status}).`;
        setFeedback({
          type: 'success',
          message: `Reply posted to ticket #${selectedTicket.id}. ${emailNote}`,
        });
      } else {
        setFeedback({
          type: 'success',
          message: 'Your reply has been added to the support conversation.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to send reply.',
      });
    } finally {
      setSendingReply(false);
    }
  };

  // Handle Admin Status Update
  const handleAdminStatusChange = async (newStatus: TicketStatus) => {
    if (!selectedTicket || !isAdmin || updatingStatus) return;
    setUpdatingStatus(true);
    setFeedback(null);
    try {
      const res = await apiClient.updateTicketStatus(selectedTicket.id, newStatus);
      setSelectedTicket(res.ticket);
      await loadTickets();
      setFeedback({
        type: 'success',
        message: `Ticket #${selectedTicket.id} status updated to "${STATUS_META[newStatus].label}".`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to update ticket status.',
      });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const renderStatusBadge = (status: TicketStatus) => {
    const meta = STATUS_META[status] || STATUS_META.open;
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${meta.badgeClass}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
        <span>{meta.label}</span>
      </span>
    );
  };

  const conversationMessages: TicketReply[] = selectedTicket
    ? selectedTicket.messages && selectedTicket.messages.length > 0
      ? selectedTicket.messages
      : [
          {
            id: `msg_init_${selectedTicket.id}`,
            sender: selectedTicket.name,
            senderEmail: selectedTicket.email,
            role: 'customer',
            message: selectedTicket.message,
            timestamp: selectedTicket.createdAt,
          },
          ...(selectedTicket.replies || []),
        ]
    : [];

  // ============================================================================
  // 2. ADMINISTRATOR REPORTS INTERFACE (Support Ticket Management Inbox)
  // ============================================================================
  if (isAdmin) {
    return (
      <div className="space-y-6">
        {/* Admin Inbox Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
                <Inbox className="h-4 w-4" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                Support Ticket Management Inbox
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[#E6A05A]/15 text-[#E6A05A] border border-[#E6A05A]/30">
                Admin Console
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Review customer support tickets across all accounts, manage ticket statuses, and send official replies.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {selectedTicket && (
              <button
                onClick={() => {
                  setSelectedTicketId(null);
                  setSelectedTicket(null);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Inbox</span>
              </button>
            )}
            <button
              onClick={() => {
                loadTickets();
                if (selectedTicketId) loadTicketDetail(selectedTicketId);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-900 border border-slate-800 rounded-lg hover:text-white cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingList || loadingDetail ? 'animate-spin text-[#E6A05A]' : ''}`} />
              <span>Refresh Inbox</span>
            </button>
          </div>
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
              feedback.type === 'error'
                ? 'bg-rose-950/40 border-rose-800 text-rose-200'
                : 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === 'error' ? (
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-white px-1.5 cursor-pointer"
            >
              ×
            </button>
          </div>
        )}

        {/* Admin KPI Counters */}
        {adminStats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] text-slate-400 block">Total Tickets</span>
              <span className="text-xl font-bold font-mono text-white">{adminStats.total}</span>
            </div>
            <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5">
              <span className="text-[11px] text-amber-300 block font-medium">Awaiting Admin Reply</span>
              <span className="text-xl font-bold font-mono text-amber-400">
                {adminStats.needsAdminResponseCount}
              </span>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] text-slate-400 block">Open</span>
              <span className="text-xl font-bold font-mono text-amber-300">{adminStats.open}</span>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] text-slate-400 block">In Progress</span>
              <span className="text-xl font-bold font-mono text-sky-400">{adminStats.in_progress}</span>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] text-slate-400 block">Waiting for Customer</span>
              <span className="text-xl font-bold font-mono text-purple-400">
                {adminStats.waiting_for_customer}
              </span>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0F172A]">
              <span className="text-[11px] text-slate-400 block">Resolved / Closed</span>
              <span className="text-xl font-bold font-mono text-emerald-400">
                {adminStats.resolved + adminStats.closed}
              </span>
            </div>
          </div>
        )}

        {/* Admin Detail / Conversation View vs Inbox Table */}
        {selectedTicket ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left/Main Column: Conversation History & Reply Composer */}
            <div className="lg:col-span-2 space-y-6">
              {/* Ticket Header Card */}
              <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-800">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-[#E6A05A] font-semibold">
                        #{selectedTicket.id}
                      </span>
                      {renderStatusBadge(selectedTicket.status)}
                      {selectedTicket.needsAdminResponse &&
                        selectedTicket.status !== 'closed' &&
                        selectedTicket.status !== 'resolved' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Requires Admin Response
                          </span>
                        )}
                    </div>
                    <h2 className="text-lg font-bold text-white">{selectedTicket.subject}</h2>
                  </div>
                  <div className="text-right text-[11px] text-slate-400 font-mono">
                    <div>Created: {new Date(selectedTicket.createdAt).toLocaleString()}</div>
                    <div>
                      Updated:{' '}
                      {new Date(selectedTicket.updatedAt || selectedTicket.createdAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Conversation Thread */}
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Conversation History ({conversationMessages.length}{' '}
                    {conversationMessages.length === 1 ? 'message' : 'messages'})
                  </h3>

                  <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                    {conversationMessages.map((msg, idx) => {
                      const isMsgAdmin =
                        msg.role === 'admin' || msg.role === 'super_admin';
                      return (
                        <div
                          key={msg.id || idx}
                          className={`p-4 rounded-xl border text-xs space-y-2 ${
                            isMsgAdmin
                              ? 'bg-[#E6A05A]/10 border-[#E6A05A]/30 ml-4 sm:ml-8'
                              : 'bg-slate-900/90 border-slate-800 mr-4 sm:mr-8'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
                            <div className="flex items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                  isMsgAdmin
                                    ? 'bg-[#E6A05A] text-[#0B1120]'
                                    : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                }`}
                              >
                                {isMsgAdmin ? 'Admin Support Reply' : 'Customer Message'}
                              </span>
                              <span className="font-semibold text-white">{msg.sender}</span>
                              {msg.senderEmail && (
                                <span className="text-slate-400 font-mono text-[11px]">
                                  &lt;{msg.senderEmail}&gt;
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-slate-400">
                              {new Date(msg.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">
                            {msg.message}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Admin Reply Composer */}
              <form
                onSubmit={handleSendReply}
                className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-[#E6A05A]" />
                    <h3 className="text-sm font-bold text-white">
                      Send Official Administrator Reply
                    </h3>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Replying to <strong className="text-slate-200">{selectedTicket.email}</strong>
                  </span>
                </div>

                <div>
                  <textarea
                    rows={5}
                    required
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`Write your response to ${selectedTicket.name}...`}
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 p-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-2 text-xs">
                    <label className="text-slate-400 font-medium whitespace-nowrap">
                      Status on Reply:
                    </label>
                    <select
                      value={replyTargetStatus}
                      onChange={(e) => setReplyTargetStatus(e.target.value as TicketStatus | '')}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#E6A05A]"
                    >
                      <option value="">Auto → Waiting for Customer</option>
                      <option value="waiting_for_customer">Waiting for Customer</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                      <option value="open">Open</option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={sendingReply || !replyText.trim()}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>{sendingReply ? 'Sending Reply...' : 'Send Reply'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Right Column: Customer Metadata & Ticket Status Controls */}
            <div className="space-y-6">
              {/* Customer Identity Card */}
              <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-800">
                  Customer Account Details
                </h3>
                <div className="space-y-3 text-xs">
                  <div className="flex items-start gap-2.5">
                    <UserIcon className="h-4 w-4 text-[#E6A05A] shrink-0 mt-0.5" />
                    <div>
                      <span className="text-slate-400 block text-[11px]">Account Name</span>
                      <span className="font-semibold text-white">{selectedTicket.name}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <Mail className="h-4 w-4 text-[#E6A05A] shrink-0 mt-0.5" />
                    <div>
                      <span className="text-slate-400 block text-[11px]">Verified Email Address</span>
                      <span className="font-mono text-white break-all">{selectedTicket.email}</span>
                    </div>
                  </div>
                  {selectedTicket.userId && (
                    <div className="flex items-start gap-2.5">
                      <Shield className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-slate-400 block text-[11px]">User ID</span>
                        <span className="font-mono text-slate-300 text-[11px]">
                          {selectedTicket.userId}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Ticket Status Controls */}
              <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 pb-2 border-b border-slate-800">
                  Ticket Status Controls
                </h3>
                <p className="text-[11px] text-slate-400">
                  Select a status below to immediately update this ticket in PostgreSQL:
                </p>
                <div className="space-y-2">
                  {(
                    [
                      'open',
                      'in_progress',
                      'waiting_for_customer',
                      'resolved',
                      'closed',
                    ] as TicketStatus[]
                  ).map((st) => {
                    const active = selectedTicket.status === st;
                    const meta = STATUS_META[st];
                    return (
                      <button
                        key={st}
                        type="button"
                        disabled={updatingStatus || active}
                        onClick={() => handleAdminStatusChange(st)}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                          active
                            ? 'bg-[#E6A05A]/15 border-[#E6A05A] text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                          <span>{meta.label}</span>
                        </div>
                        {active && <Check className="h-3.5 w-3.5 text-[#E6A05A]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Admin Filter Bar & Searchable Ticket List */
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl">
                {(
                  [
                    { id: 'all', label: 'All Tickets' },
                    { id: 'open', label: 'Open' },
                    { id: 'in_progress', label: 'In Progress' },
                    { id: 'waiting_for_customer', label: 'Waiting for Customer' },
                    { id: 'resolved', label: 'Resolved' },
                    { id: 'closed', label: 'Closed' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setStatusFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      statusFilter === tab.id
                        ? 'bg-[#E6A05A] text-[#0B1120]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search Box */}
              <div className="relative w-full lg:w-80">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ID, email, customer, or subject..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
                />
              </div>
            </div>

            {/* Tickets Inbox Table */}
            <div className="rounded-xl border border-slate-800 bg-[#0F172A] overflow-hidden">
              {loadingList && tickets.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-400">
                  Loading support ticket inbox...
                </div>
              ) : tickets.length === 0 ? (
                <div className="p-12 text-center space-y-2">
                  <Inbox className="h-8 w-8 text-slate-600 mx-auto" />
                  <h3 className="text-sm font-semibold text-white">No support tickets match your filter</h3>
                  <p className="text-xs text-slate-400">
                    When customers submit support tickets from their Reports page, they appear here in real time.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-900/70 text-slate-400 uppercase tracking-wider font-semibold">
                      <tr>
                        <th className="py-3.5 px-4">Ticket ID</th>
                        <th className="py-3.5 px-4">Customer</th>
                        <th className="py-3.5 px-4">Subject & Preview</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4">Created</th>
                        <th className="py-3.5 px-4">Last Activity</th>
                        <th className="py-3.5 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {tickets.map((t) => {
                        const needsResponse =
                          t.needsAdminResponse &&
                          t.status !== 'closed' &&
                          t.status !== 'resolved';
                        return (
                          <tr
                            key={t.id}
                            onClick={() => setSelectedTicketId(t.id)}
                            className={`group cursor-pointer transition-colors ${
                              needsResponse
                                ? 'bg-amber-500/[0.03] hover:bg-amber-500/[0.07]'
                                : 'hover:bg-slate-800/40'
                            }`}
                          >
                            <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <span className="text-[#E6A05A] font-semibold">#{t.id}</span>
                                {needsResponse && (
                                  <span
                                    title="Requires Admin Response"
                                    className="px-1.5 py-0.5 rounded text-[10px] font-sans font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                  >
                                    Needs Reply
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-semibold text-white">{t.name}</div>
                              <div className="text-[11px] font-mono text-slate-400">{t.email}</div>
                            </td>
                            <td className="py-3.5 px-4 max-w-md">
                              <div className="font-semibold text-white group-hover:text-[#E6A05A] transition-colors truncate">
                                {t.subject}
                              </div>
                              <div className="text-[11px] text-slate-400 truncate mt-0.5">
                                {t.latestMessagePreview || t.message}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {renderStatusBadge(t.status)}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                              {new Date(t.createdAt).toLocaleDateString()}{' '}
                              {new Date(t.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                              {new Date(
                                t.lastMessageAt || t.updatedAt || t.createdAt
                              ).toLocaleDateString()}{' '}
                              {new Date(
                                t.lastMessageAt || t.updatedAt || t.createdAt
                              ).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTicketId(t.id);
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 hover:bg-[#E6A05A] hover:text-[#0B1120] hover:border-[#E6A05A] transition-colors cursor-pointer"
                              >
                                <span>Open Ticket</span>
                                <ChevronRight className="h-3.5 w-3.5" />
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
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // 3. CUSTOMER REPORTS INTERFACE (Create & Track Own Support Tickets)
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* Customer Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
              <MessageSquare className="h-4 w-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Reports & Support Center
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Submit support tickets to our engineering team and track your conversation history.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {selectedTicket && (
            <button
              onClick={() => {
                setSelectedTicketId(null);
                setSelectedTicket(null);
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>All My Tickets</span>
            </button>
          )}
          <button
            onClick={() => {
              loadTickets();
              if (selectedTicketId) loadTicketDetail(selectedTicketId);
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 rounded-lg hover:text-white cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingList || loadingDetail ? 'animate-spin text-[#E6A05A]' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => {
              setSelectedTicketId(null);
              setSelectedTicket(null);
              setShowCreateForm((prev) => !prev);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Create Support Ticket</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            feedback.type === 'error'
              ? 'bg-rose-950/40 border-rose-800 text-rose-200'
              : 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'error' ? (
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white px-1.5 cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* Create Support Ticket Form */}
      {(showCreateForm || (tickets.length === 0 && !selectedTicket && !loadingList)) && (
        <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-5 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-base font-bold text-white">Create a Support Ticket</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Submitting as <strong className="text-slate-200">{user.name}</strong> (
                <span className="font-mono text-[#E6A05A]">{user.email}</span>)
              </p>
            </div>
            {tickets.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="text-xs text-slate-400 hover:text-white cursor-pointer"
              >
                Close
              </button>
            )}
          </div>

          <form onSubmit={handleCreateTicket} className="space-y-4 text-xs">
            {formError && (
              <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-200 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-semibold text-slate-200">
                  Subject <span className="text-rose-400">*</span>
                </label>
                <span className="text-[11px] font-mono text-slate-500">
                  {subject.length}/200
                </span>
              </div>
              <input
                type="text"
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of the issue or request..."
                className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-semibold text-slate-200">
                  Description <span className="text-rose-400">*</span>
                </label>
                <span className="text-[11px] font-mono text-slate-500">
                  {description.length}/10000
                </span>
              </div>
              <textarea
                rows={5}
                required
                maxLength={10000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the problem in detail, including any relevant domains, timestamps, or steps to reproduce..."
                className="w-full rounded-xl bg-slate-900 border border-slate-800 p-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              {tickets.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={submittingTicket}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E6A05A] text-[#0B1120] font-bold hover:bg-[#cf863c] transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{submittingTicket ? 'Submitting Ticket...' : 'Submit Support Ticket'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer Ticket Detail & Conversation History */}
      {selectedTicket ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs text-[#E6A05A] font-semibold">
                    #{selectedTicket.id}
                  </span>
                  {renderStatusBadge(selectedTicket.status)}
                </div>
                <h2 className="text-lg font-bold text-white">{selectedTicket.subject}</h2>
              </div>
              <div className="text-right text-[11px] font-mono text-slate-400">
                <div>Created: {new Date(selectedTicket.createdAt).toLocaleString()}</div>
                <div>
                  Last Update:{' '}
                  {new Date(selectedTicket.updatedAt || selectedTicket.createdAt).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Conversation Messages */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Ticket Conversation
              </h3>
              <div className="space-y-3">
                {conversationMessages.map((msg, idx) => {
                  const isMsgAdmin = msg.role === 'admin' || msg.role === 'super_admin';
                  return (
                    <div
                      key={msg.id || idx}
                      className={`p-4 rounded-xl border text-xs space-y-2 ${
                        isMsgAdmin
                          ? 'bg-[#E6A05A]/10 border-[#E6A05A]/30'
                          : 'bg-slate-900/90 border-slate-800'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              isMsgAdmin
                                ? 'bg-[#E6A05A] text-[#0B1120]'
                                : 'bg-slate-800 text-slate-200 border border-slate-700'
                            }`}
                          >
                            {isMsgAdmin ? 'PulseVanguard Support' : 'You'}
                          </span>
                          <span className="font-semibold text-white">{msg.sender}</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">
                          {new Date(msg.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">
                        {msg.message}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Customer Follow-up Reply Box */}
          {selectedTicket.status !== 'closed' && (
            <form
              onSubmit={handleSendReply}
              className="rounded-2xl border border-slate-800 bg-[#0F172A] p-6 space-y-4"
            >
              <h3 className="text-sm font-bold text-white">Add a Reply</h3>
              <textarea
                rows={4}
                required
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a follow-up message or provide additional details..."
                className="w-full rounded-xl bg-slate-900 border border-slate-800 p-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={sendingReply || !replyText.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{sendingReply ? 'Sending...' : 'Send Reply'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        /* Customer Ticket List */
        <div className="rounded-2xl border border-slate-800 bg-[#0F172A] overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">
              My Support Tickets ({tickets.length})
            </h2>
          </div>

          {loadingList && tickets.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-400">
              Loading your support tickets...
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <MessageSquare className="h-7 w-7 text-slate-600 mx-auto" />
              <p className="text-xs text-slate-400">
                You haven&apos;t created any support tickets yet. Use the form above to submit a ticket.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {tickets.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTicketId(t.id)}
                  className="p-5 hover:bg-slate-800/40 transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-[#E6A05A] font-semibold">
                        #{t.id}
                      </span>
                      {renderStatusBadge(t.status)}
                      {t.unreadByCustomer && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6A05A] text-[#0B1120]">
                          New Support Reply
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-white">{t.subject}</h3>
                    <p className="text-xs text-slate-400 line-clamp-2">
                      {t.latestMessagePreview || t.message}
                    </p>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0 text-[11px] font-mono text-slate-400">
                    <div>Created: {new Date(t.createdAt).toLocaleDateString()}</div>
                    <div>
                      Updated:{' '}
                      {new Date(t.updatedAt || t.createdAt).toLocaleDateString()}{' '}
                      {new Date(t.updatedAt || t.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-sans font-semibold text-[#E6A05A]">
                      <span>View Conversation</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
