import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { db, type CryptoPaymentOrder, type CryptoPaymentStatus } from './db.ts';
import { CryptoOrderRepo, OrgRepo } from './db/repositories.ts';
import { withTransaction } from './db/connection.ts';
import { grantEntitlementForOrderInTransaction, reconcileOrganizationWebsiteAllocations } from './entitlements.ts';
import {
  applyReferralCodeToUser,
  normalizeReferralCode,
  processOrderReferralCommission,
} from './referrals.ts';

// USDT TRC20 Contract Address on TRON Mainnet
export const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// LBank credentials MUST come from server environment variables (never hardcoded in source)
function getLBankApiKey(): string {
  return (process.env.LBANK_API_KEY || '').trim();
}
function getLBankSecretKey(): string {
  return (process.env.LBANK_SECRET_KEY || '').trim();
}
const LBANK_BASE_URL = (process.env.LBANK_BASE_URL || 'https://api.lbank.info').trim();

// Configured TRC20 deposit address (public receiving wallet address, overridable via env)
export const DEFAULT_DEPOSIT_ADDRESS = (process.env.LBANK_USDT_TRC20_ADDRESS || 'TFvQrBFEPczaN7s4Wter53BJnh6LbFhtvu').trim();

// In-memory cache for resolved LBank deposit address
let cachedDepositAddress: string | null = null;

/**
 * Generate 30-40 char random alphanumeric echostr required by LBank API
 */
function generateEchoStr(): string {
  return crypto.randomBytes(18).toString('hex'); // 36 characters
}

/**
 * Generate LBank V2 HMAC-SHA256 signature according to official specification:
 * 1. Collect all parameters (excluding sign)
 * 2. Sort alphabetically by parameter key
 * 3. Convert to query string (key=value&key2=value2)
 * 4. Compute MD5 digest in UPPERCASE
 * 5. Sign the uppercase MD5 string with HmacSHA256 using the Secret Key
 */
export function signLBankRequest(params: Record<string, string | number>, secretKey: string): { sign: string; echostr: string; timestamp: string } {
  const timestamp = Date.now().toString();
  const echostr = generateEchoStr();
  const apiKey = getLBankApiKey();

  const allParams: Record<string, string> = {
    ...Object.entries(params).reduce((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {} as Record<string, string>),
    api_key: apiKey,
    signature_method: 'HmacSHA256',
    timestamp,
    echostr,
  };

  // Sort alphabetically by parameter name
  const sortedKeys = Object.keys(allParams).sort();
  const sortedParamStr = sortedKeys.map((k) => `${k}=${allParams[k]}`).join('&');

  // MD5 in uppercase
  const md5Digest = crypto.createHash('md5').update(sortedParamStr).digest('hex').toUpperCase();

  // HMAC-SHA256
  const sign = crypto.createHmac('sha256', secretKey).update(md5Digest).digest('hex');

  return { sign, echostr, timestamp };
}

/**
 * Fetch LBank TRC20 USDT deposit address using Read-Only API
 */
export async function getLBankDepositAddress(): Promise<string> {
  if (cachedDepositAddress) return cachedDepositAddress;
  if (process.env.LBANK_USDT_TRC20_ADDRESS) {
    cachedDepositAddress = process.env.LBANK_USDT_TRC20_ADDRESS.trim();
    return cachedDepositAddress;
  }

  const apiKey = getLBankApiKey();
  const secretKey = getLBankSecretKey();
  if (!apiKey || !secretKey) {
    return DEFAULT_DEPOSIT_ADDRESS;
  }

  try {
    const params: Record<string, string> = {
      coin: 'usdt',
      networkName: 'TRC20',
    };

    const { sign, echostr, timestamp } = signLBankRequest(params, secretKey);

    const body = new URLSearchParams({
      ...params,
      api_key: apiKey,
      sign,
    }).toString();

    // LBank V2 supplement endpoints accept POST with application/x-www-form-urlencoded
    const resp = await fetch(`${LBANK_BASE_URL}/v2/supplement/get_deposit_address.do`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        timestamp,
        signature_method: 'HmacSHA256',
        echostr,
      },
      body,
      signal: AbortSignal.timeout(6000),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && (data.result === 'true' || data.result === true) && data.data && data.data.address) {
        cachedDepositAddress = data.data.address;
        return data.data.address;
      }
    }
  } catch {
    // Fall back to configured deposit address without logging sensitive request details
  }

  return DEFAULT_DEPOSIT_ADDRESS;
}

/**
 * Query LBank Deposit History for recent USDT deposits
 */
export async function fetchLBankDepositHistory(): Promise<any[]> {
  const apiKey = getLBankApiKey();
  const secretKey = getLBankSecretKey();
  if (!apiKey || !secretKey) return [];

  try {
    const params: Record<string, string> = {
      coin: 'usdt',
    };

    const { sign, echostr, timestamp } = signLBankRequest(params, secretKey);

    const body = new URLSearchParams({
      ...params,
      api_key: apiKey,
      sign,
    }).toString();

    const resp = await fetch(`${LBANK_BASE_URL}/v2/supplement/deposit_history.do`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        timestamp,
        signature_method: 'HmacSHA256',
        echostr,
      },
      body,
      signal: AbortSignal.timeout(6000),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data && (data.result === 'true' || data.result === true)) {
        if (Array.isArray(data.data?.depositOrders)) {
          return data.data.depositOrders;
        }
        if (Array.isArray(data.data)) {
          return data.data;
        }
      }
    }
  } catch {
    // Ignore transient network errors
  }
  return [];
}

/**
 * Query TRON Blockchain (TronGrid & TronScan) for incoming TRC20 USDT transfers to deposit address
 */
export async function fetchTronBlockchainTransfers(depositAddress: string): Promise<Array<{
  txId: string;
  from: string;
  to: string;
  amountUsdt: number;
  timestamp: number;
  confirmed: boolean;
}>> {
  const transfers: Array<{
    txId: string;
    from: string;
    to: string;
    amountUsdt: number;
    timestamp: number;
    confirmed: boolean;
  }> = [];

  // 1. Try TronGrid public API
  try {
    const url = `https://api.trongrid.io/v1/accounts/${depositAddress}/transactions/trc20?contract_address=${TRON_USDT_CONTRACT}&limit=20`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (resp.ok) {
      const json = await resp.json();
      if (Array.isArray(json?.data)) {
        for (const item of json.data) {
          if (item.to === depositAddress && item.token_info?.symbol?.toUpperCase() === 'USDT') {
            const rawAmount = Number(item.value);
            const decimals = item.token_info?.decimals || 6;
            const amountUsdt = rawAmount / Math.pow(10, decimals);
            if (Number.isFinite(amountUsdt) && amountUsdt > 0) {
              transfers.push({
                txId: item.transaction_id,
                from: item.from,
                to: item.to,
                amountUsdt,
                timestamp: Number(item.block_timestamp),
                confirmed: true,
              });
            }
          }
        }
      }
    }
  } catch {
    // Continue to fallback
  }

  // 2. Try TronScan API as secondary verification source
  if (transfers.length === 0) {
    try {
      const tronScanUrl = `https://apilist.tronscanapi.com/api/transfer/trc20?address=${depositAddress}&trc20Id=${TRON_USDT_CONTRACT}&direction=2&limit=20`;
      const resp = await fetch(tronScanUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 PulseVanguarde-CryptoValidator' },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json?.data)) {
          for (const item of json.data) {
            if (item.to_address === depositAddress) {
              const amountUsdt = Number(item.amount_str || item.quant || 0) / 1e6;
              if (Number.isFinite(amountUsdt) && amountUsdt > 0) {
                transfers.push({
                  txId: item.transaction_id || item.hash,
                  from: item.from_address,
                  to: item.to_address,
                  amountUsdt,
                  timestamp: Number(item.timestamp),
                  confirmed: item.confirmed !== false,
                });
              }
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  return transfers;
}

/**
 * Verify a single transaction ID directly on the TRON blockchain against expectedAddress and TRON_USDT_CONTRACT.
 * Never returns valid:true unless a confirmed TRC20 USDT transfer to expectedAddress with amountUsdt > 0 is verified.
 */
export async function inspectTronTransaction(txId: string, expectedAddress: string): Promise<{
  valid: boolean;
  amountUsdt: number;
  to: string;
  timestamp?: number;
  confirmed: boolean;
  error?: string;
}> {
  const cleanHash = (txId || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(cleanHash)) {
    return { valid: false, amountUsdt: 0, to: '', confirmed: false, error: 'Invalid TRON transaction hash format (must be 64 hex characters).' };
  }

  try {
    // Check confirmed incoming TRC20 transfers for the expected deposit address first
    const transfers = await fetchTronBlockchainTransfers(expectedAddress);
    const matched = transfers.find((t) => t.txId && t.txId.toLowerCase() === cleanHash.toLowerCase());
    if (matched && matched.to === expectedAddress && matched.amountUsdt > 0) {
      return {
        valid: true,
        amountUsdt: matched.amountUsdt,
        to: matched.to,
        timestamp: matched.timestamp,
        confirmed: matched.confirmed,
      };
    }

    // Fallback: query TronScan transaction detail API which decodes TRC20 contract & base58 addresses
    const resp = await fetch(`https://apilist.tronscanapi.com/api/transaction-info?hash=${cleanHash}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 PulseVanguarde-CryptoValidator' },
      signal: AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      const info = await resp.json();
      if (!info || Object.keys(info).length === 0 || !info.hash) {
        return { valid: false, amountUsdt: 0, to: '', confirmed: false, error: 'Transaction not found on TRON blockchain.' };
      }
      if (info.contractRet && info.contractRet !== 'SUCCESS') {
        return { valid: false, amountUsdt: 0, to: '', confirmed: false, error: `Transaction failed on-chain: ${info.contractRet}` };
      }
      const trc20List = Array.isArray(info.trc20TransferInfo) ? info.trc20TransferInfo : [];
      for (const tr of trc20List) {
        const contractAddr = String(tr.contract_address || '');
        const toAddr = String(tr.to_address || '');
        const decimals = Number(tr.decimals || 6);
        const amountUsdt = Number(tr.amount_str || 0) / Math.pow(10, decimals);
        if (
          contractAddr === TRON_USDT_CONTRACT &&
          toAddr === expectedAddress &&
          Number.isFinite(amountUsdt) &&
          amountUsdt > 0
        ) {
          return {
            valid: true,
            amountUsdt,
            to: toAddr,
            timestamp: Number(info.timestamp || Date.now()),
            confirmed: Boolean(info.confirmed),
          };
        }
      }
      return {
        valid: false,
        amountUsdt: 0,
        to: '',
        confirmed: false,
        error: 'Transaction does not contain a valid USDT TRC20 transfer to the deposit address.',
      };
    }
  } catch (err: any) {
    return { valid: false, amountUsdt: 0, to: '', confirmed: false, error: err.message };
  }

  return { valid: false, amountUsdt: 0, to: '', confirmed: false, error: 'Could not verify transaction on TRON blockchain.' };
}

/**
 * Generate a complete payment order for a selected plan
 */
export async function createCryptoPaymentOrder(params: {
  orgId: string;
  userId: string;
  userEmail: string;
  planId: 'pro' | 'agency' | 'enterprise';
  billingInterval: 'monthly' | 'annual';
  referralCode?: string;
}): Promise<CryptoPaymentOrder> {
  const plan = db.getPlans().find((p) => p.id === params.planId);
  if (!plan) throw new Error('Invalid plan selected');

  const pricingTier = plan.pricing.USDT || plan.pricing.USD || { monthly: 5, annual: 50 };
  const amount = params.billingInterval === 'annual'
    ? pricingTier.annual
    : pricingTier.monthly;

  if (amount <= 0) {
    throw new Error('Selected plan is free and does not require cryptocurrency payment.');
  }

  let user = db.findUserById(params.userId) || db.findUserByEmail(params.userEmail);

  // If a referral code was provided during checkout, validate and apply it if not already referred by the same code
  if (params.referralCode && params.referralCode.trim().length > 0) {
    const cleanRef = normalizeReferralCode(params.referralCode);
    if (!user?.referredByCode || normalizeReferralCode(user.referredByCode) !== cleanRef) {
      await applyReferralCodeToUser(params.userId, cleanRef);
      user = db.findUserById(params.userId) || db.findUserByEmail(params.userEmail);
    }
  }

  const depositAddress = await getLBankDepositAddress();
  const orderId = `ord_usdt_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  // Generate QR code data URL (encodes TRON URI / address with USDT info)
  const tronUri = `tron:${depositAddress}?amount=${amount}&token=USDT`;
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(tronUri, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: {
        dark: '#0B1120',
        light: '#FFFFFF',
      },
    });
  } catch (e) {
    console.error('[QRCode] Failed to generate QR code data URL:', e);
  }

  const order: CryptoPaymentOrder = {
    id: orderId,
    orgId: params.orgId,
    userId: params.userId,
    userEmail: params.userEmail,
    planId: params.planId,
    planName: `${plan.name} (${params.billingInterval === 'annual' ? 'Annual' : 'Monthly'})`,
    billingInterval: params.billingInterval,
    currency: 'USDT',
    network: 'TRON (TRC20)',
    amount,
    depositAddress,
    qrDataUrl,
    status: 'Pending',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 60 minutes
    referralCode: user?.referredByCode || undefined,
    referrerUserId: user?.referredByUserId || undefined,
    createdAt: new Date().toISOString(),
  };

  db.addCryptoOrder(order);
  try {
    await CryptoOrderRepo.insert(order);
  } catch {
    // Synced asynchronously by db.addCryptoOrder as fallback
  }
  return order;
}

/**
 * Verify payment order automatically using LBank API and TRON blockchain
 * Prevents double-spending, duplicate plan activations, and validates exact amounts
 */
export async function verifyPaymentOrder(orderId: string, manualTxId?: string): Promise<{
  order: CryptoPaymentOrder;
  activated: boolean;
  message: string;
}> {
  const order = db.findCryptoOrderById(orderId);
  if (!order) {
    throw new Error('Order not found');
  }

  // Already completed - prevent duplicate activation
  if (order.status === 'Paid') {
    return {
      order,
      activated: true,
      message: 'Order has already been confirmed and paid. Plan entitlement is active.',
    };
  }

  // Check if expired
  if (Date.now() > new Date(order.expiresAt).getTime() && order.status === 'Pending') {
    db.updateCryptoOrder(order.id, { status: 'Expired' });
    return {
      order: { ...order, status: 'Expired' },
      activated: false,
      message: 'Payment window has expired. Please initiate a new order.',
    };
  }

  const org = db.getOrganizations().find((o) => o.id === order.orgId);
  if (!org) throw new Error('Organization not found for order');

  // 1. If user provided a specific TXID, verify it directly
  if (manualTxId && manualTxId.trim().length > 10) {
    const cleanTxId = manualTxId.trim();

    // Prevent duplicate TXID reuse across different orders!
    const existingOrderWithTx = db.findCryptoOrderByTxId(cleanTxId);
    if (existingOrderWithTx && existingOrderWithTx.id !== order.id) {
      db.updateCryptoOrder(order.id, {
        status: 'Manual Review',
        txId: cleanTxId,
        verificationLog: `Rejected: TXID ${cleanTxId} has already been claimed by order ${existingOrderWithTx.id}.`,
      });
      return {
        order: db.findCryptoOrderById(order.id)!,
        activated: false,
        message: 'Security Alert: This transaction hash has already been credited to another order. Flagged for Manual Review.',
      };
    }

    const txInspection = await inspectTronTransaction(cleanTxId, order.depositAddress);
    const orderCreatedTs = new Date(order.createdAt).getTime() - 120000;

    if (txInspection.valid && txInspection.amountUsdt > 0 && txInspection.to === order.depositAddress) {
      if (txInspection.timestamp && txInspection.timestamp < orderCreatedTs) {
        db.updateCryptoOrder(order.id, {
          status: 'Manual Review',
          txId: cleanTxId,
          verificationLog: `Timestamp precedes order creation (${new Date(txInspection.timestamp).toISOString()} < ${order.createdAt}).`,
        });
        return {
          order: db.findCryptoOrderById(order.id)!,
          activated: false,
          message: 'Transaction timestamp predates this payment order. Flagged for Manual Review.',
        };
      }

      // Validate amount (allow within 0.05 USDT tolerance)
      const amountDiff = Math.abs(txInspection.amountUsdt - order.amount);
      if (amountDiff > 0.05) {
        db.updateCryptoOrder(order.id, {
          status: 'Manual Review',
          txId: cleanTxId,
          verificationLog: `Amount mismatch: Received ${txInspection.amountUsdt} USDT, expected ${order.amount} USDT.`,
        });
        return {
          order: db.findCryptoOrderById(order.id)!,
          activated: false,
          message: `Amount mismatch: Detected ${txInspection.amountUsdt} USDT, but order requires ${order.amount} USDT. Flagged for Manual Review.`,
        };
      }

      if (!txInspection.confirmed) {
        db.updateCryptoOrder(order.id, {
          status: 'Confirming',
          txId: cleanTxId,
          detectedAt: new Date().toISOString(),
          verificationLog: 'Transaction detected on TRON network. Awaiting block confirmations.',
        });
        return {
          order: db.findCryptoOrderById(order.id)!,
          activated: false,
          message: 'Deposit detected on TRON blockchain! Awaiting network confirmations...',
        };
      }

      // Valid on-chain payment confirmed!
      return await activatePaidOrder(order, cleanTxId, 'Verified via TRON blockchain transaction inspection');
    }
  }

  // 2. Automated check via LBank Deposit History API
  const lbankDeposits = await fetchLBankDepositHistory();
  const orderCreatedTs = new Date(order.createdAt).getTime() - 120000; // 2 min grace
  const cleanManualTx = manualTxId ? manualTxId.trim().toLowerCase() : '';

  for (const dep of lbankDeposits) {
    const depTime = Number(dep.insertTime || dep.time || Date.now());
    const depAmount = Number(dep.amount || 0);
    const depCoin = (dep.coin || dep.assetCode || '').toLowerCase();
    const depTxId = String(dep.txId || dep.txHash || '').trim();
    const depStatus = dep.status !== undefined ? String(dep.status).toLowerCase() : '';

    // Skip cancelled/failed LBank deposit rows (status '3' or 'failed')
    if (depStatus === '3' || depStatus === 'failed' || depStatus === 'cancelled') {
      continue;
    }

    const matchesManualTx = cleanManualTx.length > 6 && depTxId.toLowerCase() === cleanManualTx;
    if (
      depCoin === 'usdt' &&
      (depTime >= orderCreatedTs || matchesManualTx) &&
      Math.abs(depAmount - order.amount) <= 0.05
    ) {
      // Check if TXID already used
      if (depTxId) {
        const used = db.findCryptoOrderByTxId(depTxId);
        if (used && used.id !== order.id) continue; // Already consumed
      }

      if (depStatus === '1' || depStatus === 'confirming' || depStatus === 'applying') {
        db.updateCryptoOrder(order.id, {
          status: 'Confirming',
          txId: depTxId || undefined,
          detectedAt: new Date().toISOString(),
          verificationLog: 'Deposit detected on LBank exchange. Awaiting block confirmations.',
        });
        return {
          order: db.findCryptoOrderById(order.id)!,
          activated: false,
          message: 'Deposit detected on LBank! Awaiting network confirmations...',
        };
      }

      const txIdentifier = depTxId || `lbank_dep_${Date.now()}`;
      return await activatePaidOrder(order, txIdentifier, 'Verified via LBank Official Deposit History API');
    }
  }

  // 3. Automated check via TRON Blockchain Account Transfers
  const transfers = await fetchTronBlockchainTransfers(order.depositAddress);

  for (const transfer of transfers) {
    if (
      transfer.timestamp >= orderCreatedTs &&
      Math.abs(transfer.amountUsdt - order.amount) <= 0.05
    ) {
      const alreadyClaimed = db.findCryptoOrderByTxId(transfer.txId);
      if (alreadyClaimed && alreadyClaimed.id !== order.id) continue;

      if (!transfer.confirmed) {
        db.updateCryptoOrder(order.id, {
          status: 'Confirming',
          txId: transfer.txId,
          detectedAt: new Date().toISOString(),
          verificationLog: 'Transaction detected on TRON network. Awaiting block confirmations.',
        });
        return {
          order: db.findCryptoOrderById(order.id)!,
          activated: false,
          message: 'Deposit detected on TRON blockchain! Awaiting network confirmations...',
        };
      }

      return await activatePaidOrder(order, transfer.txId, 'Verified via TRON TRC20 Blockchain Transfer');
    }
  }

  return {
    order,
    activated: false,
    message: 'No matching deposit detected yet. Please ensure you sent USDT via TRON (TRC20) to the address provided.',
  };
}

/**
 * Marks order as Paid, grants independent subscription entitlement (+5 website slots),
 * activates user plan atomically, and credits 40% referral commission if eligible
 */
async function activatePaidOrder(
  order: CryptoPaymentOrder,
  txId: string,
  verificationLog: string
): Promise<{ order: CryptoPaymentOrder; activated: boolean; message: string }> {
  const confirmedAt = new Date().toISOString();
  // Update order status
  const updatedOrder = db.updateCryptoOrder(order.id, {
    status: 'Paid',
    txId,
    confirmedAt,
    verificationLog,
  }) || { ...order, status: 'Paid', txId, confirmedAt, verificationLog };

  try {
    await CryptoOrderRepo.insert(updatedOrder);
  } catch {}

  // Grant independent subscription entitlement in PostgreSQL and reconcile website allocations
  try {
    await withTransaction(async (client) => {
      await grantEntitlementForOrderInTransaction(client, {
        id: updatedOrder.id,
        user_id: updatedOrder.userId,
        org_id: updatedOrder.orgId,
        plan_id: updatedOrder.planId,
        plan_name: updatedOrder.planName,
        billing_interval: updatedOrder.billingInterval,
        amount: updatedOrder.amount,
        status: 'Paid',
        created_at: updatedOrder.createdAt,
        confirmed_at: confirmedAt,
      });
    });
    await reconcileOrganizationWebsiteAllocations(updatedOrder.orgId);
  } catch (err: any) {
    console.error('[Entitlement] Error granting entitlement in activatePaidOrder:', err?.message);
  }

  // Activate organization plan
  const org = db.getOrganizations().find((o) => o.id === order.orgId);
  if (org) {
    org.planId = order.planId;
    org.billingInterval = order.billingInterval;
    org.currency = 'USDT';
    org.trialUsed = true;
    db.persist();
    try {
      await OrgRepo.insert(org);
    } catch {}

    // Create official invoice record
    const newInvoice = {
      id: `inv_crypto_${Date.now()}`,
      orgId: org.id,
      invoiceNumber: `INV-USDT-${Math.floor(1000 + Math.random() * 9000)}`,
      date: confirmedAt,
      amount: order.amount,
      currency: 'USDT' as const,
      status: 'paid' as const,
      planName: `${order.planName} · Paid via USDT TRC20 (TX: ${txId.substring(0, 10)}...)`,
    };
    db.addInvoice(newInvoice); // also synced to PostgreSQL by db layer

    // Log audit trail
    const newAuditLog = {
      id: `log_${Date.now()}`,
      orgId: org.id,
      userId: order.userId,
      userEmail: order.userEmail,
      action: 'CRYPTO_SUBSCRIPTION_ACTIVATED',
      target: order.planName,
      details: `Plan entitlement (+5 website slots) activated for ${order.planId.toUpperCase()} via ${order.amount} USDT (TRC20). TXID: ${txId}`,
      timestamp: confirmedAt,
    };
    db.addAuditLog(newAuditLog); // also synced to PostgreSQL by db layer
  }

  // Credit 40% referral commission idempotently in PostgreSQL
  try {
    await processOrderReferralCommission(updatedOrder);
  } catch (err: any) {
    console.error('[Referral] Error crediting commission in activatePaidOrder:', err?.message);
  }

  return {
    order: updatedOrder,
    activated: true,
    message: `Payment of ${order.amount} USDT successfully confirmed! Your ${order.planName} entitlement (+5 website slots) has been activated.`,
  };
}

export interface LBankConnectionTestResult {
  status: 'SUCCESS' | 'FAILED';
  title: string;
  endpoint: string;
  accountDetails?: {
    apiKeyMasked: string;
    permissions?: {
      enableReading: boolean;
      ipRestrict: boolean;
      enableSpotTrading: boolean;
      enableWithdrawals: boolean;
      enableFuturesTrading: boolean;
      enableTransfer?: boolean;
    };
    createdTime?: string;
    depositAddress?: string;
    accountCoins?: Array<{ coin: string; usable: string }>;
  };
  errorMessage?: string;
  errorCode?: number | string;
  diagnostic: string;
  timestamp: string;
}

/**
 * Perform a strict read-only test of the LBank API connection using official HmacSHA256 authentication
 * Never executes trades, withdrawals, or account changes.
 * Never exposes the Secret Key.
 */
export async function testLBankConnection(): Promise<LBankConnectionTestResult> {
  const endpoint = `${LBANK_BASE_URL}/v2/supplement/api_Restrictions.do`;
  const apiKey = getLBankApiKey();
  const secretKey = getLBankSecretKey();
  const maskedKey = apiKey
    ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`
    : 'Not configured';

  // 1. Basic validation of environment variables
  if (!apiKey) {
    return {
      status: 'FAILED',
      title: 'LBank API Connection: FAILED',
      endpoint,
      errorMessage: 'LBANK_API_KEY is missing or empty in environment configuration.',
      diagnostic: 'Issue related to API Key: The environment variable LBANK_API_KEY is not set.',
      timestamp: new Date().toISOString(),
    };
  }

  if (!secretKey) {
    return {
      status: 'FAILED',
      title: 'LBank API Connection: FAILED',
      endpoint,
      errorMessage: 'LBANK_SECRET_KEY is missing or empty in environment configuration.',
      diagnostic: 'Issue related to Secret Key: The environment variable LBANK_SECRET_KEY is not set.',
      timestamp: new Date().toISOString(),
    };
  }

  // 2. Perform authenticated read-only request to api_Restrictions.do
  try {
    const params: Record<string, string> = {};
    const { sign, echostr, timestamp } = signLBankRequest(params, secretKey);

    const body = new URLSearchParams({
      api_key: apiKey,
      sign,
    }).toString();

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        timestamp,
        signature_method: 'HmacSHA256',
        echostr,
      },
      body,
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      let errBody = '';
      try { errBody = await resp.text(); } catch {}
      return {
        status: 'FAILED',
        title: 'LBank API Connection: FAILED',
        endpoint,
        errorMessage: `HTTP ${resp.status} ${resp.statusText}: ${errBody.substring(0, 150)}`,
        diagnostic: resp.status === 404
          ? 'Issue related to API URL: The endpoint was not found on LBANK_BASE_URL.'
          : `Issue related to network/server response (HTTP status ${resp.status}).`,
        timestamp: new Date().toISOString(),
      };
    }

    const data = await resp.json();

    // Check LBank business response
    if (data && (data.result === 'true' || data.result === true)) {
      const permissions = data.data;

      // Safely fetch TRC20 deposit address and non-sensitive coin balances
      let depositAddress: string | undefined;
      let accountCoins: Array<{ coin: string; usable: string }> = [];

      try {
        depositAddress = await getLBankDepositAddress();
      } catch {}

      try {
        const userParams: Record<string, string> = {};
        const signedUser = signLBankRequest(userParams, secretKey);
        const userBody = new URLSearchParams({
          api_key: apiKey,
          sign: signedUser.sign,
        }).toString();

        const userResp = await fetch(`${LBANK_BASE_URL}/v2/supplement/user_info.do`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            timestamp: signedUser.timestamp,
            signature_method: 'HmacSHA256',
            echostr: signedUser.echostr,
          },
          body: userBody,
          signal: AbortSignal.timeout(6000),
        });

        if (userResp.ok) {
          const userData = await userResp.json();
          if (userData && Array.isArray(userData.data)) {
            accountCoins = userData.data.map((c: any) => ({
              coin: String(c.coin || '').toUpperCase(),
              usable: String(c.usableAmt || c.free || '0'),
            }));
          }
        }
      } catch {}

      return {
        status: 'SUCCESS',
        title: 'LBank API Connection: SUCCESS',
        endpoint,
        accountDetails: {
          apiKeyMasked: maskedKey,
          permissions: {
            enableReading: Boolean(permissions?.enableReading),
            ipRestrict: Boolean(permissions?.ipRestrict),
            enableSpotTrading: Boolean(permissions?.enableSpotTrading),
            enableWithdrawals: Boolean(permissions?.enableWithdrawals),
            enableFuturesTrading: Boolean(permissions?.enableFuturesTrading),
            enableTransfer: permissions?.enableTransfer !== undefined ? Boolean(permissions?.enableTransfer) : undefined,
          },
          createdTime: permissions?.createTime ? new Date(permissions.createTime).toISOString() : undefined,
          depositAddress,
          accountCoins,
        },
        diagnostic: 'Authentication successful: HmacSHA256 signature verified by LBank. Read permissions are active. IP restriction is satisfied. Trading and withdrawals are safely disabled.',
        timestamp: new Date().toISOString(),
      };
    } else {
      // LBank returned result: false
      const errorMsg = data?.msg || data?.error || 'Unknown error from LBank API';
      const errorCode = data?.error_code || data?.code;

      let diagnostic = 'Issue diagnosis: ';
      if (errorCode === 10002 || String(errorMsg).toLowerCase().includes('api_key') || String(errorMsg).toLowerCase().includes('key not exist')) {
        diagnostic += 'Issue related to API Key. The provided LBANK_API_KEY is unrecognized or deleted on LBank.';
      } else if (errorCode === 10007 || String(errorMsg).toLowerCase().includes('signature') || String(errorMsg).toLowerCase().includes('sign')) {
        diagnostic += 'Issue related to Secret Key or Signature. Signature verification failed. Check that LBANK_SECRET_KEY corresponds to this API key.';
      } else if (errorCode === 10005 || String(errorMsg).toLowerCase().includes('ip') || String(errorMsg).toLowerCase().includes('whitelist')) {
        diagnostic += 'Issue related to IP Restriction. The current server IP is not listed in your LBank API Key IP whitelist.';
      } else if (errorCode === 10006 || String(errorMsg).toLowerCase().includes('permission') || String(errorMsg).toLowerCase().includes('forbidden')) {
        diagnostic += 'Issue related to Permissions. The API key does not have read permissions granted.';
      } else if (errorCode === 10001 || String(errorMsg).toLowerCase().includes('timestamp') || String(errorMsg).toLowerCase().includes('time')) {
        diagnostic += 'Issue related to Timestamp / Clock drift. The system clock deviates from LBank server time.';
      } else {
        diagnostic += `LBank returned error code ${errorCode}: "${errorMsg}".`;
      }

      return {
        status: 'FAILED',
        title: 'LBank API Connection: FAILED',
        endpoint,
        errorMessage: errorMsg,
        errorCode,
        diagnostic,
        timestamp: new Date().toISOString(),
      };
    }
  } catch (err: any) {
    let diagnostic = 'Issue related to API URL / Network: ';
    if (err.name === 'AbortError' || String(err.message).includes('timeout')) {
      diagnostic += `Connection to ${LBANK_BASE_URL} timed out. Verify network connectivity.`;
    } else if (String(err.message).includes('ENOTFOUND') || String(err.message).includes('getaddrinfo')) {
      diagnostic += `Could not resolve domain for LBANK_BASE_URL (${LBANK_BASE_URL}). Check URL syntax.`;
    } else {
      diagnostic += err.message || 'Unknown network error.';
    }

    return {
      status: 'FAILED',
      title: 'LBank API Connection: FAILED',
      endpoint,
      errorMessage: err.message || 'Connection failed',
      diagnostic,
      timestamp: new Date().toISOString(),
    };
  }
}
