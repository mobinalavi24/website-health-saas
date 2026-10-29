import crypto from 'node:crypto';
import { db, type User, type SupportTicket, type TicketStatus, type TicketReply } from './db.ts';
import { query, withTransaction } from './db/connection.ts';
import { mapTicketRow } from './db/repositories.ts';
import { applySupportTicketingSchemaMigration } from './db/migrate.ts';

export const DESIGNATED_SUPER_ADMIN_EMAIL = 'mobinalavi7491@gmail.com';

export const VALID_TICKET_STATUSES: TicketStatus[] = [
  'open',
  'in_progress',
  'waiting_for_customer',
  'resolved',
  'closed',
];

export class TicketValidationError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'TicketValidationError';
  }
}

export class TicketAccessDeniedError extends Error {
  statusCode = 403;
  constructor(message = 'Access denied. You do not have permission to access this ticket.') {
    super(message);
    this.name = 'TicketAccessDeniedError';
  }
}

export class TicketNotFoundError extends Error {
  statusCode = 404;
  constructor(message = 'Support ticket not found.') {
    super(message);
    this.name = 'TicketNotFoundError';
  }
}

export interface EmailDispatchResult {
  id: string;
  ticketId: string;
  messageId?: string;
  eventType: 'ticket_created_admin_notify' | 'admin_reply_customer_notify';
  recipientEmail: string;
  subject: string;
  sent: boolean;
  status: 'sent' | 'skipped_unconfigured' | 'failed';
  provider: string;
  diagnostic: string;
  createdAt: string;
}

export interface EnrichedSupportTicket extends SupportTicket {
  description: string;
  customerName: string;
  customerEmail: string;
  messages: TicketReply[];
  latestMessagePreview: string;
  replyCount: number;
  emailNotification?: EmailDispatchResult;
}

export interface AdminTicketInboxStats {
  total: number;
  open: number;
  in_progress: number;
  waiting_for_customer: number;
  resolved: number;
  closed: number;
  needsAdminResponseCount: number;
}

let ticketingSchemaEnsured = false;
async function ensureTicketingSchema(): Promise<void> {
  await db.ensureSchema();
  if (!ticketingSchemaEnsured) {
    await applySupportTicketingSchemaMigration();
    ticketingSchemaEnsured = true;
  }
}

export function isAdminUser(user: Pick<User, 'role'> | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'super_admin' || user.role === 'admin';
}

export function isTicketOwner(ticket: SupportTicket, user: Pick<User, 'id' | 'email'>): boolean {
  if (ticket.userId) {
    return ticket.userId === user.id;
  }
  return ticket.email.trim().toLowerCase() === user.email.trim().toLowerCase();
}

function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Dispatches an email notification via configured provider (Resend API, SendGrid API, or custom Webhook)
 * and logs the honest delivery outcome in PostgreSQL `ticket_email_logs`.
 * Never fabricates success when no email provider is configured, and never throws to break ticket persistence.
 */
export async function dispatchSupportEmailNotification(params: {
  ticketId: string;
  messageId?: string;
  eventType: 'ticket_created_admin_notify' | 'admin_reply_customer_notify';
  recipientEmail: string;
  subject: string;
  textBody: string;
  htmlBody: string;
}): Promise<EmailDispatchResult> {
  const logId = `eml_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const createdAt = new Date().toISOString();
  const fromAddress = process.env.SUPPORT_EMAIL_FROM || process.env.EMAIL_FROM || 'PulseVanguarde Support <support@pulsevanguard.com>';

  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  const sendgridApiKey = (process.env.SENDGRID_API_KEY || '').trim();
  const emailWebhookUrl = (process.env.SUPPORT_EMAIL_WEBHOOK_URL || process.env.EMAIL_WEBHOOK_URL || '').trim();

  let sent = false;
  let status: 'sent' | 'skipped_unconfigured' | 'failed' = 'skipped_unconfigured';
  let provider = 'none';
  let diagnostic = '';

  try {
    if (resendApiKey) {
      provider = 'resend';
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [params.recipientEmail],
          subject: params.subject,
          text: params.textBody,
          html: params.htmlBody,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        sent = true;
        status = 'sent';
        diagnostic = `Delivered via Resend API to ${params.recipientEmail}.`;
      } else {
        const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
        status = 'failed';
        diagnostic = `Resend API returned HTTP ${resp.status}: ${errText.slice(0, 200)}`;
      }
    } else if (sendgridApiKey) {
      provider = 'sendgrid';
      const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: params.recipientEmail }] }],
          from: { email: fromAddress.includes('<') ? fromAddress.split('<')[1].replace('>', '').trim() : fromAddress },
          subject: params.subject,
          content: [
            { type: 'text/plain', value: params.textBody },
            { type: 'text/html', value: params.htmlBody },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok || resp.status === 202) {
        sent = true;
        status = 'sent';
        diagnostic = `Delivered via SendGrid API to ${params.recipientEmail}.`;
      } else {
        const errText = await resp.text().catch(() => `HTTP ${resp.status}`);
        status = 'failed';
        diagnostic = `SendGrid API returned HTTP ${resp.status}: ${errText.slice(0, 200)}`;
      }
    } else if (emailWebhookUrl) {
      provider = 'webhook';
      const resp = await fetch(emailWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: params.recipientEmail,
          from: fromAddress,
          subject: params.subject,
          text: params.textBody,
          html: params.htmlBody,
          ticketId: params.ticketId,
          eventType: params.eventType,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) {
        sent = true;
        status = 'sent';
        diagnostic = `Dispatched via configured email webhook to ${params.recipientEmail}.`;
      } else {
        status = 'failed';
        diagnostic = `Email webhook returned HTTP ${resp.status}.`;
      }
    } else {
      provider = 'unconfigured';
      status = 'skipped_unconfigured';
      diagnostic = `No outbound email provider (RESEND_API_KEY, SENDGRID_API_KEY, or SUPPORT_EMAIL_WEBHOOK_URL) is configured in environment. Ticket event persisted in database; email notification queued/logged for ${params.recipientEmail}.`;
    }
  } catch (err: any) {
    status = 'failed';
    diagnostic = `Email dispatch error (${provider}): ${err?.message || 'Network error'}`;
  }

  try {
    await query(
      `INSERT INTO ticket_email_logs (
         id, ticket_id, message_id, event_type, recipient_email, subject, status, provider, diagnostic, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        logId,
        params.ticketId,
        params.messageId || null,
        params.eventType,
        params.recipientEmail,
        params.subject,
        status,
        provider,
        diagnostic,
        createdAt,
      ]
    );
  } catch (logErr: any) {
    console.warn('[Support Email Log Warning]:', logErr?.message);
  }

  return {
    id: logId,
    ticketId: params.ticketId,
    messageId: params.messageId,
    eventType: params.eventType,
    recipientEmail: params.recipientEmail,
    subject: params.subject,
    sent,
    status,
    provider,
    diagnostic,
    createdAt,
  };
}

/**
 * Loads chronological messages for a ticket from `ticket_messages` table,
 * ensuring the initial customer description and any legacy `replies` are included in order.
 */
async function loadTicketConversationMessages(ticket: SupportTicket): Promise<TicketReply[]> {
  let dbMessages: TicketReply[] = [];
  try {
    const res = await query(
      'SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticket.id]
    );
    dbMessages = res.rows.map((r: any) => ({
      id: r.id,
      ticketId: r.ticket_id,
      senderUserId: r.sender_user_id,
      sender: r.sender_name,
      senderEmail: r.sender_email,
      role: r.sender_role,
      message: r.body,
      timestamp: new Date(r.created_at).toISOString(),
    }));
  } catch {
    // Fallback if table not queried
  }

  const initialMsgId = `msg_init_${ticket.id}`;
  const hasInitialInDb = dbMessages.some((m) => m.id === initialMsgId);

  const initialEntry: TicketReply = {
    id: initialMsgId,
    ticketId: ticket.id,
    senderUserId: ticket.userId,
    sender: ticket.name,
    senderEmail: ticket.email,
    role: 'customer',
    message: ticket.message,
    timestamp: ticket.createdAt,
  };

  if (dbMessages.length > 0) {
    return hasInitialInDb ? dbMessages : [initialEntry, ...dbMessages];
  }

  const legacyReplies: TicketReply[] = Array.isArray(ticket.replies)
    ? ticket.replies.map((r, idx) => ({
        id: r.id || `msg_leg_${ticket.id}_${idx}`,
        ticketId: ticket.id,
        senderUserId: r.senderUserId,
        sender: r.sender,
        senderEmail: r.senderEmail,
        role: r.role === 'super_admin' || r.role === 'admin' ? 'admin' : r.role || 'customer',
        message: r.message,
        timestamp: r.timestamp || ticket.createdAt,
      }))
    : [];

  return [initialEntry, ...legacyReplies];
}

export async function enrichTicket(
  ticket: SupportTicket,
  emailNotification?: EmailDispatchResult
): Promise<EnrichedSupportTicket> {
  const messages = await loadTicketConversationMessages(ticket);
  const latestMsg = messages[messages.length - 1];
  const latestPreview = latestMsg
    ? latestMsg.message.length > 140
      ? `${latestMsg.message.slice(0, 140)}...`
      : latestMsg.message
    : ticket.message;

  const nonInitialReplies = messages.filter((m) => m.id !== `msg_init_${ticket.id}`);

  return {
    ...ticket,
    description: ticket.message,
    customerName: ticket.name,
    customerEmail: ticket.email,
    updatedAt: ticket.updatedAt || ticket.createdAt,
    lastMessageAt: ticket.lastMessageAt || latestMsg?.timestamp || ticket.createdAt,
    needsAdminResponse:
      ticket.needsAdminResponse !== undefined
        ? ticket.needsAdminResponse
        : ticket.status === 'open',
    replies: nonInitialReplies,
    messages,
    latestMessagePreview: latestPreview,
    replyCount: nonInitialReplies.length,
    ...(emailNotification ? { emailNotification } : {}),
  };
}

/**
 * Loads all tickets from PostgreSQL (or falls back to in-memory cache if empty)
 */
async function fetchAllTicketsFromDb(): Promise<SupportTicket[]> {
  await ensureTicketingSchema();
  try {
    const res = await query(
      'SELECT * FROM support_tickets ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC'
    );
    if (res.rows.length > 0) {
      return res.rows.map(mapTicketRow);
    }
  } catch (err: any) {
    console.warn('[Support Tickets DB Fetch Warning]:', err?.message);
  }
  return db.getTickets();
}

async function fetchTicketByIdFromDb(ticketId: string): Promise<SupportTicket | null> {
  await ensureTicketingSchema();
  const cleanId = (ticketId || '').trim();
  if (!cleanId) return null;
  try {
    const res = await query('SELECT * FROM support_tickets WHERE id = $1 LIMIT 1', [cleanId]);
    if (res.rows.length > 0) {
      return mapTicketRow(res.rows[0]);
    }
  } catch (err: any) {
    console.warn('[Support Ticket Find Warning]:', err?.message);
  }
  return db.findTicketById(cleanId) || null;
}

/**
 * Creates a new support ticket for the authenticated user.
 * Identity (`userId`, `name`, `email`) is strictly derived from `sessionUser` in the database.
 */
export async function createSupportTicket(
  sessionUser: User,
  input: {
    subject?: unknown;
    description?: unknown;
    message?: unknown;
    category?: unknown;
    priority?: unknown;
    idempotencyKey?: unknown;
  },
  originUrl = 'https://pulsevanguard.com'
): Promise<{ ticket: EnrichedSupportTicket; alreadyCreated?: boolean }> {
  await ensureTicketingSchema();

  if (!sessionUser || !sessionUser.id || !sessionUser.email) {
    throw new TicketAccessDeniedError('Authentication required to create a support ticket.');
  }

  // Always obtain canonical user record from database if available
  const canonicalUser = db.findUserById(sessionUser.id) || sessionUser;
  const userId = canonicalUser.id;
  const customerName = sanitizeText(canonicalUser.name || 'Customer', 120) || 'Customer';
  const customerEmail = canonicalUser.email.trim().toLowerCase();

  const subject = sanitizeText(input.subject, 200);
  const rawDescription = input.description !== undefined ? input.description : input.message;
  const description = sanitizeText(rawDescription, 10000);

  if (!subject || subject.length < 3) {
    throw new TicketValidationError('Subject is required and must be at least 3 characters.');
  }
  if (subject.length > 200) {
    throw new TicketValidationError('Subject must be 200 characters or fewer.');
  }
  if (!description || description.length < 5) {
    throw new TicketValidationError('Description is required and must be at least 5 characters.');
  }
  if (description.length > 10000) {
    throw new TicketValidationError('Description must be 10,000 characters or fewer.');
  }

  const validCategories = ['technical', 'billing', 'monitoring', 'feature', 'general'] as const;
  const rawCat = typeof input.category === 'string' ? input.category.trim().toLowerCase() : 'general';
  const category = (validCategories.includes(rawCat as any) ? rawCat : 'general') as SupportTicket['category'];

  const validPriorities = ['low', 'medium', 'high'] as const;
  const rawPrio = typeof input.priority === 'string' ? input.priority.trim().toLowerCase() : 'medium';
  const priority = (validPriorities.includes(rawPrio as any) ? rawPrio : 'medium') as SupportTicket['priority'];

  const idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
      ? sanitizeText(input.idempotencyKey, 120)
      : undefined;

  // Duplicate prevention: check recent tickets from this user within the last 15 seconds
  const existingTickets = await fetchAllTicketsFromDb();
  const nowMs = Date.now();
  const duplicateRecent = existingTickets.find((t) => {
    const sameUser = t.userId === userId || t.email.toLowerCase() === customerEmail;
    if (!sameUser) return false;
    const sameContent =
      t.subject.trim().toLowerCase() === subject.toLowerCase() &&
      t.message.trim().toLowerCase() === description.toLowerCase();
    const createdMs = new Date(t.createdAt).getTime();
    return sameContent && Math.abs(nowMs - createdMs) < 15000;
  });

  if (duplicateRecent) {
    const enrichedDup = await enrichTicket(duplicateRecent);
    return { ticket: enrichedDup, alreadyCreated: true };
  }

  const nowIso = new Date().toISOString();
  const ticketId = `tkt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const initialMsgId = `msg_init_${ticketId}`;

  const newTicket: SupportTicket = {
    id: ticketId,
    userId,
    name: customerName,
    email: customerEmail,
    subject,
    category,
    message: description,
    status: 'open',
    priority,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastMessageAt: nowIso,
    lastReplyByRole: 'customer',
    needsAdminResponse: true,
    unreadByAdmin: true,
    unreadByCustomer: false,
    replies: [],
  };

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO support_tickets (
         id, user_id, name, email, subject, category, message, status, priority,
         created_at, updated_at, last_message_at, last_reply_by_role,
         needs_admin_response, unread_by_admin, unread_by_customer, replies
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        newTicket.id,
        newTicket.userId,
        newTicket.name,
        newTicket.email,
        newTicket.subject,
        newTicket.category,
        newTicket.message,
        newTicket.status,
        newTicket.priority,
        nowIso,
        nowIso,
        nowIso,
        'customer',
        true,
        true,
        false,
        JSON.stringify([]),
      ]
    );

    await client.query(
      `INSERT INTO ticket_messages (
         id, ticket_id, sender_user_id, sender_name, sender_email, sender_role, body, idempotency_key, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        initialMsgId,
        newTicket.id,
        userId,
        customerName,
        customerEmail,
        'customer',
        description,
        idempotencyKey || initialMsgId,
        nowIso,
      ]
    );
  });

  // Sync with in-memory + JSON file
  db.addTicket(newTicket);

  // Send admin notification email to mobinalavi7491@gmail.com
  const adminTicketLink = `${originUrl.replace(/\/+$/, '')}/?view=reports&ticketId=${encodeURIComponent(newTicket.id)}`;
  const emailSubject = `[PulseVanguarde Support] New Ticket #${newTicket.id} — ${newTicket.subject}`;
  const textBody = [
    `New Support Ticket Submitted on PulseVanguarde`,
    `---------------------------------------------`,
    `Ticket ID: ${newTicket.id}`,
    `Customer Name: ${newTicket.name}`,
    `Customer Email: ${newTicket.email}`,
    `Subject: ${newTicket.subject}`,
    `Created At: ${newTicket.createdAt}`,
    ``,
    `Description:`,
    newTicket.message,
    ``,
    `Open Ticket in Admin Reports Inbox:`,
    adminTicketLink,
  ].join('\n');

  const htmlBody = `
    <div style="font-family: sans-serif; color: #0f172a; max-width: 600px;">
      <h2 style="color: #0b1120;">New Support Ticket #${newTicket.id}</h2>
      <p><strong>Customer:</strong> ${newTicket.name} (${newTicket.email})</p>
      <p><strong>Subject:</strong> ${newTicket.subject}</p>
      <p><strong>Created At:</strong> ${newTicket.createdAt}</p>
      <hr style="border: none; border-top: 1px solid #cbd5e1; margin: 16px 0;" />
      <p style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 8px;">${newTicket.message}</p>
      <p style="margin-top: 20px;">
        <a href="${adminTicketLink}" style="background: #E6A05A; color: #0B1120; padding: 10px 16px; border-radius: 6px; text-decoration: none; font-weight: bold;">
          Open Ticket in Admin Inbox
        </a>
      </p>
    </div>
  `.trim();

  const emailResult = await dispatchSupportEmailNotification({
    ticketId: newTicket.id,
    messageId: initialMsgId,
    eventType: 'ticket_created_admin_notify',
    recipientEmail: DESIGNATED_SUPER_ADMIN_EMAIL,
    subject: emailSubject,
    textBody,
    htmlBody,
  });

  const enriched = await enrichTicket(newTicket, emailResult);
  return { ticket: enriched, alreadyCreated: false };
}

/**
 * Lists only the authenticated customer's own tickets, sorted newest activity first.
 */
export async function listCustomerSupportTickets(sessionUser: User): Promise<EnrichedSupportTicket[]> {
  const all = await fetchAllTicketsFromDb();
  const ownTickets = all.filter((t) => isTicketOwner(t, sessionUser));
  ownTickets.sort((a, b) => {
    const timeA = new Date(a.lastMessageAt || a.updatedAt || a.createdAt).getTime();
    const timeB = new Date(b.lastMessageAt || b.updatedAt || b.createdAt).getTime();
    return timeB - timeA;
  });
  return Promise.all(ownTickets.map((t) => enrichTicket(t)));
}

/**
 * Lists all support tickets for an authorized administrator with search, status filtering, and inbox counters.
 */
export async function listAdminSupportTickets(
  sessionUser: User,
  filters: { status?: string; search?: string } = {}
): Promise<{ tickets: EnrichedSupportTicket[]; stats: AdminTicketInboxStats }> {
  if (!isAdminUser(sessionUser)) {
    throw new TicketAccessDeniedError('Administrator privileges are required to access the global support inbox.');
  }

  const all = await fetchAllTicketsFromDb();
  const enrichedAll = await Promise.all(all.map((t) => enrichTicket(t)));

  const stats: AdminTicketInboxStats = {
    total: enrichedAll.length,
    open: enrichedAll.filter((t) => t.status === 'open').length,
    in_progress: enrichedAll.filter((t) => t.status === 'in_progress').length,
    waiting_for_customer: enrichedAll.filter((t) => t.status === 'waiting_for_customer').length,
    resolved: enrichedAll.filter((t) => t.status === 'resolved').length,
    closed: enrichedAll.filter((t) => t.status === 'closed').length,
    needsAdminResponseCount: enrichedAll.filter(
      (t) => t.needsAdminResponse && t.status !== 'closed' && t.status !== 'resolved'
    ).length,
  };

  let filtered = [...enrichedAll];

  const statusFilter = (filters.status || '').trim().toLowerCase();
  if (statusFilter && statusFilter !== 'all' && VALID_TICKET_STATUSES.includes(statusFilter as TicketStatus)) {
    filtered = filtered.filter((t) => t.status === statusFilter);
  }

  const searchTerm = (filters.search || '').trim().toLowerCase();
  if (searchTerm) {
    filtered = filtered.filter(
      (t) =>
        t.id.toLowerCase().includes(searchTerm) ||
        t.email.toLowerCase().includes(searchTerm) ||
        t.name.toLowerCase().includes(searchTerm) ||
        t.subject.toLowerCase().includes(searchTerm) ||
        t.message.toLowerCase().includes(searchTerm)
    );
  }

  // Sort: tickets requiring admin response first (among active tickets), then by most recent activity
  filtered.sort((a, b) => {
    const aNeeds = Boolean(a.needsAdminResponse && a.status !== 'closed' && a.status !== 'resolved');
    const bNeeds = Boolean(b.needsAdminResponse && b.status !== 'closed' && b.status !== 'resolved');
    if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
    const timeA = new Date(a.lastMessageAt || a.updatedAt || a.createdAt).getTime();
    const timeB = new Date(b.lastMessageAt || b.updatedAt || b.createdAt).getTime();
    return timeB - timeA;
  });

  return { tickets: filtered, stats };
}

/**
 * Retrieves a single ticket and its complete conversation history, enforcing ownership or admin role.
 */
export async function getSupportTicketDetail(
  ticketId: string,
  sessionUser: User
): Promise<EnrichedSupportTicket> {
  const ticket = await fetchTicketByIdFromDb(ticketId);
  if (!ticket) {
    throw new TicketNotFoundError();
  }

  const admin = isAdminUser(sessionUser);
  const owner = isTicketOwner(ticket, sessionUser);

  if (!admin && !owner) {
    throw new TicketAccessDeniedError('Access denied. You can only view your own support tickets.');
  }

  // Mark unread flag as read for the viewing party
  if (admin && ticket.unreadByAdmin) {
    ticket.unreadByAdmin = false;
    db.updateTicket(ticket.id, { unreadByAdmin: false });
  } else if (owner && !admin && ticket.unreadByCustomer) {
    ticket.unreadByCustomer = false;
    db.updateTicket(ticket.id, { unreadByCustomer: false });
  }

  return enrichTicket(ticket);
}

/**
 * Adds a reply message to a support ticket (either by an administrator or by the ticket owner).
 */
export async function replyToSupportTicket(
  ticketId: string,
  sessionUser: User,
  input: {
    message?: unknown;
    body?: unknown;
    status?: unknown;
    idempotencyKey?: unknown;
    replyAsAdmin?: boolean;
  },
  originUrl = 'https://pulsevanguard.com'
): Promise<{ ticket: EnrichedSupportTicket; reply: TicketReply; emailNotification?: EmailDispatchResult }> {
  await ensureTicketingSchema();

  const ticket = await fetchTicketByIdFromDb(ticketId);
  if (!ticket) {
    throw new TicketNotFoundError();
  }

  const admin = isAdminUser(sessionUser);
  const owner = isTicketOwner(ticket, sessionUser);

  if (!admin && !owner) {
    throw new TicketAccessDeniedError('Access denied. You cannot reply to another user’s support ticket.');
  }

  const rawBody = input.message !== undefined ? input.message : input.body;
  const messageText = sanitizeText(rawBody, 10000);
  if (!messageText || messageText.length < 2) {
    throw new TicketValidationError('Reply message is required and cannot be empty.');
  }

  // Determine whether this reply is sent as an administrator or as the customer
  // If the user is an admin and either is not the ticket owner or is replying from the admin inbox, senderRole is 'admin'
  const senderRole: 'admin' | 'customer' =
    admin && (input.replyAsAdmin !== false) ? 'admin' : 'customer';

  const canonicalUser = db.findUserById(sessionUser.id) || sessionUser;
  const senderName =
    senderRole === 'admin'
      ? `${canonicalUser.name || 'PulseVanguarde Support'} (Admin)`
      : canonicalUser.name || ticket.name;
  const senderEmail = canonicalUser.email.trim().toLowerCase();

  // Determine new status
  let nextStatus: TicketStatus = ticket.status;
  const requestedStatus = typeof input.status === 'string' ? input.status.trim().toLowerCase() : '';

  if (senderRole === 'admin') {
    if (requestedStatus && VALID_TICKET_STATUSES.includes(requestedStatus as TicketStatus)) {
      nextStatus = requestedStatus as TicketStatus;
    } else {
      nextStatus = 'waiting_for_customer';
    }
  } else {
    // Customer reply transitions waiting_for_customer or resolved back to open
    if (ticket.status === 'waiting_for_customer' || ticket.status === 'resolved') {
      nextStatus = 'open';
    }
  }

  const nowIso = new Date().toISOString();
  const messageId = `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const idempotencyKey =
    typeof input.idempotencyKey === 'string' && input.idempotencyKey.trim()
      ? sanitizeText(input.idempotencyKey, 120)
      : messageId;

  const newReply: TicketReply = {
    id: messageId,
    ticketId: ticket.id,
    senderUserId: canonicalUser.id,
    sender: senderName,
    senderEmail,
    role: senderRole,
    message: messageText,
    timestamp: nowIso,
  };

  const updatedReplies: TicketReply[] = [...(ticket.replies || []), newReply];
  const needsAdminResponse = senderRole === 'customer';
  const unreadByAdmin = senderRole === 'customer';
  const unreadByCustomer = senderRole === 'admin';

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO ticket_messages (
         id, ticket_id, sender_user_id, sender_name, sender_email, sender_role, body, idempotency_key, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        messageId,
        ticket.id,
        canonicalUser.id,
        senderName,
        senderEmail,
        senderRole,
        messageText,
        idempotencyKey,
        nowIso,
      ]
    );

    await client.query(
      `UPDATE support_tickets
       SET status = $1,
           updated_at = $2,
           last_message_at = $3,
           last_reply_by_role = $4,
           needs_admin_response = $5,
           unread_by_admin = $6,
           unread_by_customer = $7,
           replies = $8
       WHERE id = $9`,
      [
        nextStatus,
        nowIso,
        nowIso,
        senderRole,
        needsAdminResponse,
        unreadByAdmin,
        unreadByCustomer,
        JSON.stringify(updatedReplies),
        ticket.id,
      ]
    );
  });

  const updatedTicket: SupportTicket = {
    ...ticket,
    status: nextStatus,
    updatedAt: nowIso,
    lastMessageAt: nowIso,
    lastReplyByRole: senderRole,
    needsAdminResponse,
    unreadByAdmin,
    unreadByCustomer,
    replies: updatedReplies,
  };

  db.updateTicket(ticket.id, updatedTicket);

  let emailNotification: EmailDispatchResult | undefined;

  if (senderRole === 'admin') {
    const customerTicketLink = `${originUrl.replace(/\/+$/, '')}/?view=reports&ticketId=${encodeURIComponent(ticket.id)}`;
    const emailSubject = `Re: [PulseVanguarde Support] Ticket #${ticket.id} — ${ticket.subject}`;
    const textBody = [
      `Hello ${ticket.name},`,
      ``,
      `Our support team has replied to your ticket #${ticket.id} ("${ticket.subject}").`,
      ``,
      `--- Administrator Reply ---`,
      messageText,
      `---------------------------`,
      ``,
      `Current Ticket Status: ${nextStatus.toUpperCase()}`,
      `View the full conversation and reply inside PulseVanguarde:`,
      customerTicketLink,
    ].join('\n');

    const htmlBody = `
      <div style="font-family: sans-serif; color: #0f172a; max-width: 600px;">
        <h2 style="color: #0b1120;">Update on Support Ticket #${ticket.id}</h2>
        <p>Hello <strong>${ticket.name}</strong>,</p>
        <p>An administrator has replied to your support ticket regarding <strong>${ticket.subject}</strong>:</p>
        <div style="white-space: pre-wrap; background: #f8fafc; border-left: 4px solid #E6A05A; padding: 14px; border-radius: 6px; margin: 16px 0;">${messageText}</div>
        <p><strong>Ticket Status:</strong> ${nextStatus}</p>
        <p style="margin-top: 20px;">
          <a href="${customerTicketLink}" style="background: #E6A05A; color: #0B1120; padding: 10px 16px; border-radius: 6px; text-decoration: none; font-weight: bold;">
            View Conversation in PulseVanguarde
          </a>
        </p>
      </div>
    `.trim();

    emailNotification = await dispatchSupportEmailNotification({
      ticketId: ticket.id,
      messageId,
      eventType: 'admin_reply_customer_notify',
      recipientEmail: ticket.email,
      subject: emailSubject,
      textBody,
      htmlBody,
    });
  }

  const enriched = await enrichTicket(updatedTicket, emailNotification);
  return {
    ticket: enriched,
    reply: newReply,
    emailNotification,
  };
}

/**
 * Updates the status of a support ticket (Admin only).
 */
export async function updateSupportTicketStatus(
  ticketId: string,
  sessionUser: User,
  newStatusInput: unknown
): Promise<EnrichedSupportTicket> {
  await ensureTicketingSchema();

  if (!isAdminUser(sessionUser)) {
    throw new TicketAccessDeniedError('Administrator privileges are required to change ticket status.');
  }

  const ticket = await fetchTicketByIdFromDb(ticketId);
  if (!ticket) {
    throw new TicketNotFoundError();
  }

  const cleanStatus = typeof newStatusInput === 'string' ? newStatusInput.trim().toLowerCase() : '';
  if (!VALID_TICKET_STATUSES.includes(cleanStatus as TicketStatus)) {
    throw new TicketValidationError(
      `Invalid ticket status "${cleanStatus}". Allowed values: ${VALID_TICKET_STATUSES.join(', ')}.`
    );
  }

  const nextStatus = cleanStatus as TicketStatus;
  const nowIso = new Date().toISOString();
  const needsAdminResponse =
    nextStatus === 'resolved' || nextStatus === 'closed' || nextStatus === 'waiting_for_customer'
      ? false
      : ticket.needsAdminResponse ?? true;

  await query(
    `UPDATE support_tickets
     SET status = $1,
         updated_at = $2,
         needs_admin_response = $3,
         unread_by_admin = false
     WHERE id = $4`,
    [nextStatus, nowIso, needsAdminResponse, ticket.id]
  );

  const updatedTicket: SupportTicket = {
    ...ticket,
    status: nextStatus,
    updatedAt: nowIso,
    needsAdminResponse,
    unreadByAdmin: false,
  };

  db.updateTicket(ticket.id, updatedTicket);
  return enrichTicket(updatedTicket);
}

/**
 * Returns email notification logs for a ticket (Admin or test inspection).
 */
export async function getTicketEmailLogs(ticketId: string): Promise<EmailDispatchResult[]> {
  await ensureTicketingSchema();
  try {
    const res = await query(
      'SELECT * FROM ticket_email_logs WHERE ticket_id = $1 ORDER BY created_at ASC',
      [ticketId]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      ticketId: r.ticket_id,
      messageId: r.message_id || undefined,
      eventType: r.event_type,
      recipientEmail: r.recipient_email,
      subject: r.subject,
      sent: r.status === 'sent',
      status: r.status,
      provider: r.provider,
      diagnostic: r.diagnostic,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  } catch {
    return [];
  }
}
