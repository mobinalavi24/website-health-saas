import { query, withTransaction } from './db/connection.ts';
import { db, type CryptoPaymentOrder } from './db.ts';
import { mapCryptoOrderRow } from './db/repositories.ts';
import { creditReferralCommissionInTransaction, type ReferralCommission } from './referrals.ts';

export interface AdminApprovalResult {
  success: boolean;
  order: CryptoPaymentOrder;
  alreadyApproved?: boolean;
  commission?: ReferralCommission | null;
  message: string;
}

export interface AdminRejectionResult {
  success: boolean;
  order: CryptoPaymentOrder;
  alreadyRejected?: boolean;
  message: string;
}

export interface OrderCancelResult {
  success: boolean;
  order: CryptoPaymentOrder;
  message: string;
}

/**
 * Approve a cryptocurrency payment order.
 * Strictly requires Super Admin or Admin authorization.
 * Executes in a single database transaction with row-level concurrency lock.
 * Atomically updates order, activates customer subscription, issues invoice, credits referral commission (if eligible), and writes audit log.
 */
export async function approvePaymentOrder(
  orderId: string,
  adminUser: { id: string; email: string; role: string }
): Promise<AdminApprovalResult> {
  if (adminUser.role !== 'super_admin' && adminUser.role !== 'admin') {
    throw new Error('Unauthorized: Admin privilege required to approve payments.');
  }

  return await withTransaction(async (client) => {
    // 1. Lock row for update to prevent concurrent duplicate approvals
    const res = await client.query('SELECT * FROM crypto_orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (res.rows.length === 0) {
      throw new Error('Payment order not found.');
    }
    const row = res.rows[0];

    // Idempotency: If already paid/approved, return cleanly without duplicating actions
    if (row.status === 'Paid') {
      const existing = db.findCryptoOrderById(orderId) || mapCryptoOrderRow(row);
      const comm = await creditReferralCommissionInTransaction(client, row);
      return {
        success: true,
        order: existing,
        alreadyApproved: true,
        commission: comm,
        message: 'Order has already been approved and subscription is active.',
      };
    }

    if (row.status === 'Rejected') {
      throw new Error('Cannot approve an order that has been rejected.');
    }
    if (row.status === 'Cancelled') {
      throw new Error('Cannot approve an order that has been cancelled.');
    }

    const nowIso = new Date().toISOString();
    const verificationLog = `Manually reviewed and approved by Super Admin (${adminUser.email}) on ${nowIso}`;

    // 2. Mark order as Paid with approval metadata
    await client.query(
      `UPDATE crypto_orders
       SET status = 'Paid',
           confirmed_at = NOW(),
           approved_by = $2,
           approved_at = NOW(),
           verification_log = $3
       WHERE id = $1`,
      [orderId, adminUser.email, verificationLog]
    );

    // 3. Atomically activate customer subscription on the organization
    await client.query(
      `UPDATE organizations
       SET plan_id = $1,
           billing_interval = $2,
           currency = 'USD',
           trial_used = true
       WHERE id = $3`,
      [row.plan_id, row.billing_interval, row.org_id]
    );

    // 4. Record official invoice in PostgreSQL
    const invId = `inv_crypto_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const invNum = `INV-USDT-${Math.floor(1000 + Math.random() * 9000)}`;
    const invoicePlanName = `${row.plan_name} · Approved by ${adminUser.email}`;
    await client.query(
      `INSERT INTO invoices (id, org_id, invoice_number, date, amount, currency, status, plan_name)
       VALUES ($1, $2, $3, $4, $5, 'USDT', 'paid', $6)
       ON CONFLICT (id) DO NOTHING`,
      [invId, row.org_id, invNum, nowIso, parseFloat(row.amount), invoicePlanName]
    );

    // 5. Atomically credit 40% referral commission if customer was referred
    const commResult = await creditReferralCommissionInTransaction(client, {
      ...row,
      status: 'Paid',
    });

    // 6. Record administrative audit log
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await client.query(
      `INSERT INTO audit_logs (id, org_id, user_id, user_email, action, target, details, timestamp)
       VALUES ($1, $2, $3, $4, 'ADMIN_PAYMENT_APPROVED', $5, $6, NOW())`,
      [
        logId,
        row.org_id,
        adminUser.id,
        adminUser.email,
        orderId,
        `Payment order ${orderId} (${row.amount} USDT) manually approved by ${adminUser.email}. Plan ${row.plan_id.toUpperCase()} activated for ${row.user_email}.${commResult ? ` Referral commission $${commResult.commissionAmount.toFixed(2)} credited to ${commResult.referralCode}.` : ''}`,
      ]
    );

    // 7. Synchronize in-memory runtime DB
    const updatedOrder = db.updateCryptoOrder(orderId, {
      status: 'Paid',
      confirmedAt: nowIso,
      approvedBy: adminUser.email,
      approvedAt: nowIso,
      verificationLog,
    }) || {
      ...mapCryptoOrderRow(row),
      status: 'Paid',
      confirmedAt: nowIso,
      approvedBy: adminUser.email,
      approvedAt: nowIso,
      verificationLog,
    };

    const org = db.findOrgById(row.org_id);
    if (org) {
      org.planId = row.plan_id;
      org.billingInterval = row.billing_interval;
      org.currency = 'USD';
      org.trialUsed = true;
      db.persist();

      db.addInvoice({
        id: invId,
        orgId: org.id,
        invoiceNumber: invNum,
        date: nowIso,
        amount: parseFloat(row.amount),
        currency: 'USDT',
        status: 'paid',
        planName: invoicePlanName,
      });

      db.addAuditLog({
        id: logId,
        orgId: org.id,
        userId: adminUser.id,
        userEmail: adminUser.email,
        action: 'ADMIN_PAYMENT_APPROVED',
        target: orderId,
        details: `Payment order ${orderId} (${row.amount} USDT) manually approved by ${adminUser.email}. Plan ${row.plan_id.toUpperCase()} activated for ${row.user_email}.`,
        timestamp: nowIso,
      });
    }

    return {
      success: true,
      order: updatedOrder,
      commission: commResult,
      message: `Payment of ${row.amount} USDT approved successfully! Plan ${row.plan_name} has been activated for ${row.user_email}.`,
    };
  });
}

/**
 * Reject a cryptocurrency payment order.
 * Strictly requires Super Admin or Admin authorization.
 * Updates order status to Rejected with rejection metadata.
 * Does NOT activate or extend subscriptions.
 */
export async function rejectPaymentOrder(
  orderId: string,
  adminUser: { id: string; email: string; role: string },
  reason?: string
): Promise<AdminRejectionResult> {
  if (adminUser.role !== 'super_admin' && adminUser.role !== 'admin') {
    throw new Error('Unauthorized: Admin privilege required to reject payments.');
  }

  return await withTransaction(async (client) => {
    const res = await client.query('SELECT * FROM crypto_orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (res.rows.length === 0) {
      throw new Error('Payment order not found.');
    }
    const row = res.rows[0];

    if (row.status === 'Paid') {
      throw new Error('Cannot reject a payment that has already been approved and paid.');
    }

    if (row.status === 'Rejected') {
      const existing = db.findCryptoOrderById(orderId) || mapCryptoOrderRow(row);
      return {
        success: true,
        order: existing,
        alreadyRejected: true,
        message: 'Order has already been rejected.',
      };
    }

    const nowIso = new Date().toISOString();
    const cleanReason = (reason || '').trim() || 'Declined by Administrator';
    const verificationLog = `Payment rejected by Administrator (${adminUser.email}) on ${nowIso}. Reason: ${cleanReason}`;

    // Update in PostgreSQL
    await client.query(
      `UPDATE crypto_orders
       SET status = 'Rejected',
           rejected_by = $2,
           rejected_at = NOW(),
           rejection_reason = $3,
           verification_log = $4
       WHERE id = $1`,
      [orderId, adminUser.email, cleanReason, verificationLog]
    );

    // Audit log
    const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await client.query(
      `INSERT INTO audit_logs (id, org_id, user_id, user_email, action, target, details, timestamp)
       VALUES ($1, $2, $3, $4, 'ADMIN_PAYMENT_REJECTED', $5, $6, NOW())`,
      [
        logId,
        row.org_id,
        adminUser.id,
        adminUser.email,
        orderId,
        `Payment order ${orderId} rejected by ${adminUser.email}. Reason: ${cleanReason}`,
      ]
    );

    // Synchronize in-memory db
    const updatedOrder = db.updateCryptoOrder(orderId, {
      status: 'Rejected',
      rejectedBy: adminUser.email,
      rejectedAt: nowIso,
      rejectionReason: cleanReason,
      verificationLog,
    }) || {
      ...mapCryptoOrderRow(row),
      status: 'Rejected',
      rejectedBy: adminUser.email,
      rejectedAt: nowIso,
      rejectionReason: cleanReason,
      verificationLog,
    };

    db.addAuditLog({
      id: logId,
      orgId: row.org_id,
      userId: adminUser.id,
      userEmail: adminUser.email,
      action: 'ADMIN_PAYMENT_REJECTED',
      target: orderId,
      details: `Payment order ${orderId} rejected by ${adminUser.email}. Reason: ${cleanReason}`,
      timestamp: nowIso,
    });

    return {
      success: true,
      order: updatedOrder,
      message: `Payment order ${orderId} has been rejected.`,
    };
  });
}

/**
 * Cancel a cryptocurrency payment order.
 * Can be initiated by the customer who created it (while still unpaid) or an admin.
 * Sets status to Cancelled and preserves record.
 */
export async function cancelPaymentOrder(
  orderId: string,
  user: { id: string; email: string; role: string; orgId: string }
): Promise<OrderCancelResult> {
  return await withTransaction(async (client) => {
    const res = await client.query('SELECT * FROM crypto_orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (res.rows.length === 0) {
      throw new Error('Payment order not found.');
    }
    const row = res.rows[0];

    const isOwner =
      row.user_id === user.id ||
      (row.user_email && row.user_email.toLowerCase() === user.email.toLowerCase()) ||
      row.org_id === user.orgId;

    if (!isOwner && user.role !== 'super_admin' && user.role !== 'admin') {
      throw new Error('Unauthorized to cancel this payment order.');
    }

    if (row.status === 'Paid') {
      throw new Error('Cannot cancel an order that has already been paid and activated.');
    }

    if (row.status === 'Cancelled') {
      const existing = db.findCryptoOrderById(orderId) || mapCryptoOrderRow(row);
      return {
        success: true,
        order: existing,
        message: 'Order is already cancelled.',
      };
    }

    const nowIso = new Date().toISOString();
    const verificationLog = `Order cancelled by customer (${user.email}) on ${nowIso}`;

    await client.query(
      `UPDATE crypto_orders
       SET status = 'Cancelled',
           verification_log = $2
       WHERE id = $1`,
      [orderId, verificationLog]
    );

    const updatedOrder = db.updateCryptoOrder(orderId, {
      status: 'Cancelled',
      verificationLog,
    }) || {
      ...mapCryptoOrderRow(row),
      status: 'Cancelled',
      verificationLog,
    };

    return {
      success: true,
      order: updatedOrder,
      message: 'Payment order has been cancelled.',
    };
  });
}
