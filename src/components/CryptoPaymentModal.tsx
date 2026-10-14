import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Copy,
  Check,
  RefreshCw,
  QrCode,
  ShieldCheck,
  AlertCircle,
  Clock,
  Sparkles,
  Info
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { CryptoPaymentOrder, CryptoPaymentStatus } from '../types.ts';

interface CryptoPaymentModalProps {
  order: CryptoPaymentOrder;
  onClose: () => void;
  onPaymentSuccess: (order: CryptoPaymentOrder) => void;
}

export const CryptoPaymentModal: React.FC<CryptoPaymentModalProps> = ({
  order: initialOrder,
  onClose,
  onPaymentSuccess,
}) => {
  const [order, setOrder] = useState<CryptoPaymentOrder>(initialOrder);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedOrderId, setCopiedOrderId] = useState(false);
  const [txIdInput, setTxIdInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Keyboard shortcut: Escape key closes modal safely without modifying order state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Expiration countdown
  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const expires = new Date(order.expiresAt).getTime();
      const diffMs = expires - now;

      if (diffMs <= 0) {
        setTimeLeft('Expired');
        if (order.status === 'Pending') {
          setOrder((prev) => ({ ...prev, status: 'Expired' }));
        }
      } else {
        const mins = Math.floor(diffMs / 60000);
        const secs = Math.floor((diffMs % 60000) / 1000);
        setTimeLeft(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [order.expiresAt, order.status]);

  // Automatic polling for deposit detection
  useEffect(() => {
    if (order.status === 'Paid' || order.status === 'Expired' || order.status === 'Rejected' || order.status === 'Cancelled') {
      return;
    }

    const checkStatus = async () => {
      try {
        const res = await apiClient.checkCryptoOrder(order.id);
        if (res && res.order) {
          setOrder(res.order);
          if (res.activated || res.order.status === 'Paid') {
            onPaymentSuccess(res.order);
          }
        }
      } catch (err) {
        // Silent poll error
      }
    };

    // Initial check after 3 seconds
    const timeout = setTimeout(checkStatus, 3000);
    // Ongoing poll every 5 seconds
    pollTimerRef.current = setInterval(checkStatus, 5000);

    return () => {
      clearTimeout(timeout);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [order.id, order.status, onPaymentSuccess]);

  const handleCopy = (text: string, type: 'address' | 'orderId') => {
    navigator.clipboard.writeText(text);
    if (type === 'address') {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } else {
      setCopiedOrderId(true);
      setTimeout(() => setCopiedOrderId(false), 2000);
    }
  };

  const handleManualVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifying(true);
    setVerifyMessage(null);
    setVerifyError(null);

    try {
      const res = await apiClient.checkCryptoOrder(order.id, txIdInput.trim() || undefined);
      setOrder(res.order);
      setVerifyMessage(res.message);

      if (res.activated || res.order.status === 'Paid') {
        onPaymentSuccess(res.order);
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Verification check failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleCancelPayment = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await apiClient.cancelCryptoOrder(order.id);
      setOrder(res.order);
      setShowCancelConfirm(false);
      onClose();
    } catch (err: any) {
      setCancelError(err.message || 'Failed to cancel payment order.');
    } finally {
      setCancelling(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getStatusBadge = (status: CryptoPaymentStatus) => {
    switch (status) {
      case 'Paid':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <Check className="h-3.5 w-3.5" /> Paid & Activated
          </span>
        );
      case 'Confirming':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Confirming on TRON...
          </span>
        );
      case 'Manual Review':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertCircle className="h-3.5 w-3.5" /> In Review by Admin
          </span>
        );
      case 'Rejected':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <X className="h-3.5 w-3.5" /> Declined by Admin
          </span>
        );
      case 'Cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <X className="h-3.5 w-3.5" /> Cancelled
          </span>
        );
      case 'Expired':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <Clock className="h-3.5 w-3.5" /> Order Expired
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <X className="h-3.5 w-3.5" /> Failed
          </span>
        );
      case 'Pending':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" /> Awaiting Payment
          </span>
        );
    }
  };

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crypto-modal-title"
    >
      <div className="relative w-full max-w-lg bg-[#0F172A] border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-7 space-y-6 text-slate-200 my-8">
        {/* Prominent Visible X Close Button in Top-Right Corner */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close payment modal"
          title="Close (Esc)"
          className="absolute top-4 right-4 sm:top-5 sm:right-5 p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-[#E6A05A] z-20 cursor-pointer"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 pr-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#E6A05A]/10 border border-[#E6A05A]/20 text-[#E6A05A]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 id="crypto-modal-title" className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                USDT Cryptocurrency Checkout
              </h2>
              <p className="text-xs text-slate-400">
                Official LBank TRC20 Deposit Gateway
              </p>
            </div>
          </div>
        </div>

        {/* Order Summary Card */}
        <div className="rounded-xl border border-[#E6A05A]/30 bg-[#E6A05A]/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-medium">Selected Subscription</span>
            <span className="text-xs font-bold text-white">{order.planName}</span>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
            <span className="text-xs text-slate-400 font-medium">Amount Due</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-extrabold font-mono text-[#E6A05A]">
                {order.amount}
              </span>
              <span className="text-sm font-bold text-white font-mono">USDT</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
            <span className="text-slate-400 font-medium">Required Network</span>
            <span className="font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded">
              TRON (TRC20)
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <span className="text-slate-400">Order ID:</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-slate-300 text-[11px]">{order.id}</span>
              <button
                type="button"
                onClick={() => handleCopy(order.id, 'orderId')}
                className="text-slate-400 hover:text-white"
                title="Copy Order ID"
              >
                {copiedOrderId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>

        {/* Status & Expiry Bar */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Status:</span>
            {getStatusBadge(order.status)}
          </div>
          {order.status !== 'Paid' && order.status !== 'Rejected' && order.status !== 'Cancelled' && (
            <div className="flex items-center gap-1.5 font-mono text-slate-400">
              <Clock className="h-3.5 w-3.5 text-slate-500" />
              <span>Expires in:</span>
              <span className={`font-semibold ${timeLeft === 'Expired' ? 'text-rose-400' : 'text-[#E6A05A]'}`}>
                {timeLeft}
              </span>
            </div>
          )}
        </div>

        {/* Rejection Notification Banner */}
        {order.status === 'Rejected' && (
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/80 text-xs text-rose-300 space-y-1.5">
            <div className="font-semibold text-rose-200 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>Payment Declined by Administrator</span>
            </div>
            {order.rejectionReason && (
              <p className="text-[11px] text-slate-300">
                Reason: <strong className="text-white">{order.rejectionReason}</strong>
              </p>
            )}
            <p className="text-[11px] text-slate-400">
              If you have already transferred funds or believe this is in error, please contact support with your TXID.
            </p>
          </div>
        )}

        {/* Paid Confirmation Screen */}
        {order.status === 'Paid' ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-6 text-center space-y-4">
            <div className="inline-flex p-3 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Sparkles className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Payment Confirmed!</h3>
              <p className="text-xs text-slate-300 mt-1 max-w-sm mx-auto">
                Your payment of <strong className="text-white">{order.amount} USDT</strong> has been verified. Your <strong className="text-[#E6A05A]">{order.planName}</strong> subscription is now active.
              </p>
            </div>
            {order.txId && (
              <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-400 break-all text-left">
                <span className="text-slate-500">TXID: </span>
                <span className="text-emerald-400">{order.txId}</span>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-[#E6A05A] text-[#0B1120] font-bold text-xs hover:bg-[#cf863c] transition-colors shadow-lg shadow-[#E6A05A]/10 cursor-pointer"
            >
              Continue to Dashboard
            </button>
          </div>
        ) : (
          <>
            {/* QR Code & Deposit Address Display */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center gap-5 p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                {/* QR Code */}
                {order.qrDataUrl ? (
                  <div className="p-2 rounded-xl bg-white shrink-0 shadow-md">
                    <img
                      src={order.qrDataUrl}
                      alt="TRON USDT TRC20 Deposit QR"
                      className="w-32 h-32 block"
                    />
                  </div>
                ) : (
                  <div className="w-32 h-32 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                    <QrCode className="h-10 w-10 text-slate-500" />
                  </div>
                )}

                {/* Instructions */}
                <div className="space-y-2 text-xs text-left">
                  <div className="flex items-center gap-1.5 text-white font-semibold">
                    <span>How to pay:</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-slate-400 leading-relaxed text-[11px]">
                    <li>Open your TRON-compatible wallet (TronLink, Trust Wallet, Binance, LBank, etc.).</li>
                    <li>Choose <strong className="text-slate-200">USDT</strong> on the <strong className="text-emerald-400">TRON (TRC20)</strong> network.</li>
                    <li>Send exactly <strong className="text-white font-mono">{order.amount} USDT</strong> to the address below.</li>
                    <li>Payment is automatically detected within 30–60 seconds.</li>
                  </ol>
                </div>
              </div>

              {/* Deposit Address Box with Copy */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>LBank USDT Deposit Address (TRC20):</span>
                  <span className="text-[10px] text-emerald-400 font-mono">TRC20 ONLY</span>
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 p-2.5 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-white truncate select-all">
                    {order.depositAddress}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(order.depositAddress, 'address')}
                    className={`px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 cursor-pointer ${
                      copiedAddress
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {copiedAddress ? (
                      <>
                        <Check className="h-4 w-4" />
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Warning Banner */}
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/90 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="text-[11px] leading-relaxed">
                Send <strong>only USDT via TRON (TRC20)</strong> to this address. Sending any other currency or via another network (e.g. ERC20, BEP20) will result in lost funds.
              </div>
            </div>

            {/* Optional Manual TXID verification input */}
            <form onSubmit={handleManualVerify} className="pt-2 border-t border-slate-800 space-y-2">
              <label className="text-xs text-slate-400 flex items-center justify-between">
                <span>Already sent payment? Enter your Transaction Hash (TXID):</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={txIdInput}
                  onChange={(e) => setTxIdInput(e.target.value)}
                  placeholder="Paste 64-char TRON TXID here (optional)"
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#E6A05A]"
                />
                <button
                  type="submit"
                  disabled={verifying}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-white hover:bg-slate-700 transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {verifying ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 text-[#E6A05A]" />
                  )}
                  <span>Verify Now</span>
                </button>
              </div>

              {verifyMessage && (
                <p className="text-[11px] text-slate-300 font-medium pt-1">
                  {verifyMessage}
                </p>
              )}
              {verifyError && (
                <p className="text-[11px] text-rose-400 font-medium pt-1">
                  {verifyError}
                </p>
              )}
            </form>

            {/* Auto-checking indicator */}
            <div className="flex items-center justify-center gap-2 pt-1 text-[11px] text-slate-400 font-mono">
              <RefreshCw className="h-3 w-3 animate-spin text-[#E6A05A]" />
              <span>Monitoring LBank & TRON blockchain for incoming transfer...</span>
            </div>
          </>
        )}

        {/* Cancellation Confirmation Alert */}
        {showCancelConfirm && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-xs space-y-2">
            <div className="flex items-center gap-2 text-rose-300 font-semibold">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
              <span>Cancel this payment request?</span>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              This will void this payment order in the system. You can generate a new payment order anytime.
            </p>
            {cancelError && <p className="text-rose-400 text-[11px] font-medium">{cancelError}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleCancelPayment}
                disabled={cancelling}
                className="px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors disabled:opacity-50 cursor-pointer"
              >
                {cancelling ? 'Cancelling...' : 'Yes, Cancel Payment'}
              </button>
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
              >
                Keep Active
              </button>
            </div>
          </div>
        )}

        {/* Bottom Actions & Dismissal Guidance */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-[11px] text-slate-400 text-center sm:text-left flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <span>
              Closing this screen leaves your payment order intact. Resume anytime from{' '}
              <strong className="text-[#E6A05A]">My Crypto Payments</strong>.
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
            {order.status !== 'Paid' && order.status !== 'Cancelled' && (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="px-3 py-2 rounded-lg text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 transition-colors text-xs font-semibold cursor-pointer"
              >
                Cancel Payment
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors text-xs border border-slate-700 cursor-pointer"
            >
              Close Window
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
