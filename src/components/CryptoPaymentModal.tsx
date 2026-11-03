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
  Info,
  ArrowRight,
  ArrowLeft,
  Coins,
  ChevronDown,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type {
  CryptoPaymentOrder,
  CryptoPaymentStatus,
  CryptoPaymentCurrency,
  CryptoPaymentOptionsResponse,
  SupportedCryptoPaymentOption,
} from '../types.ts';

interface CryptoPaymentModalProps {
  order?: CryptoPaymentOrder | null;
  checkoutConfig?: {
    planId: 'pro' | 'agency' | 'enterprise';
    interval: 'monthly' | 'annual';
    referralCode?: string;
    initialCurrency?: CryptoPaymentCurrency;
  } | null;
  onClose: () => void;
  onPaymentSuccess: (order: CryptoPaymentOrder) => void;
  onOrderCreated?: (order: CryptoPaymentOrder) => void;
}

type CheckoutStep = 1 | 2 | 3 | 4;

export const CryptoPaymentModal: React.FC<CryptoPaymentModalProps> = ({
  order: initialOrder,
  checkoutConfig,
  onClose,
  onPaymentSuccess,
  onOrderCreated,
}) => {
  const [order, setOrder] = useState<CryptoPaymentOrder | null>(initialOrder || null);
  const [step, setStep] = useState<CheckoutStep>(() => {
    if (initialOrder) {
      return initialOrder.status === 'Paid' ? 4 : 3;
    }
    return 1;
  });

  // Step 1 & Step 2 state (Select Currency & Review Payment Details)
  const [optionsData, setOptionsData] = useState<CryptoPaymentOptionsResponse | null>(null);
  const [loadingOptions, setLoadingOptions] = useState<boolean>(!initialOrder);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<CryptoPaymentCurrency>(
    initialOrder?.currency || checkoutConfig?.initialCurrency || 'USDT'
  );
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Step 3 & Step 4 state (Complete Payment & Confirm Payment)
  const [copiedField, setCopiedField] = useState<'address' | 'orderId' | 'amount' | null>(null);
  const [txIdInput, setTxIdInput] = useState(initialOrder?.txId || '');
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync if prop order changes
  useEffect(() => {
    if (initialOrder) {
      setOrder(initialOrder);
      setSelectedCurrency(initialOrder.currency || 'USDT');
      if (initialOrder.status === 'Paid') {
        setStep(4);
      } else if (step < 3) {
        setStep(3);
      }
    }
  }, [initialOrder]);

  // Load supported payment options when opened in checkout mode
  const loadPaymentOptions = async () => {
    if (initialOrder) return;
    const planId = checkoutConfig?.planId || 'pro';
    const interval = checkoutConfig?.interval || 'monthly';
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const data = await apiClient.getCryptoPaymentOptions(planId, interval);
      setOptionsData(data);
      const preferred = data.options.find(
        (o) => o.currency === selectedCurrency && o.available
      );
      if (!preferred) {
        const firstAvailable = data.options.find((o) => o.available);
        if (firstAvailable) {
          setSelectedCurrency(firstAvailable.currency);
        }
      }
    } catch (err: any) {
      setOptionsError(err?.message || 'Could not load supported cryptocurrency options.');
    } finally {
      setLoadingOptions(false);
    }
  };

  useEffect(() => {
    if (!initialOrder) {
      loadPaymentOptions();
    }
  }, [initialOrder, checkoutConfig?.planId, checkoutConfig?.interval]);

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

  // Expiration countdown for active order
  useEffect(() => {
    if (!order) return;
    const updateCountdown = () => {
      const now = Date.now();
      const expires = new Date(order.expiresAt).getTime();
      const diffMs = expires - now;

      if (diffMs <= 0) {
        setTimeLeft('Expired');
        if (order.status === 'Pending') {
          setOrder((prev) => (prev ? { ...prev, status: 'Expired' } : prev));
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
  }, [order?.expiresAt, order?.status]);

  // Automatic polling for deposit detection once order exists
  useEffect(() => {
    if (
      !order ||
      order.status === 'Paid' ||
      order.status === 'Expired' ||
      order.status === 'Rejected' ||
      order.status === 'Cancelled'
    ) {
      return;
    }

    const checkStatus = async () => {
      try {
        const res = await apiClient.checkCryptoOrder(order.id);
        if (res && res.order) {
          setOrder(res.order);
          if (res.activated || res.order.status === 'Paid') {
            setStep(4);
            onPaymentSuccess(res.order);
          }
        }
      } catch {
        // Silent poll error
      }
    };

    const timeout = setTimeout(checkStatus, 3500);
    pollTimerRef.current = setInterval(checkStatus, 12000);

    return () => {
      clearTimeout(timeout);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [order?.id, order?.status, onPaymentSuccess]);

  const handleCopy = (text: string, field: 'address' | 'orderId' | 'amount') => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const selectedOption: SupportedCryptoPaymentOption | undefined =
    optionsData?.options.find((o) => o.currency === selectedCurrency) ||
    optionsData?.options[0];

  const handleGenerateOrderAndProceed = async () => {
    if (!selectedOption || !selectedOption.available) {
      setCreateError(
        selectedOption?.unavailableReason ||
          'Selected cryptocurrency is currently unavailable.'
      );
      return;
    }

    setCreatingOrder(true);
    setCreateError(null);
    try {
      const planId = checkoutConfig?.planId || optionsData?.planId || 'pro';
      const interval = checkoutConfig?.interval || optionsData?.billingInterval || 'monthly';
      const res = await apiClient.createCryptoOrder(
        planId,
        interval,
        checkoutConfig?.referralCode,
        selectedCurrency
      );
      if (res.success && res.order) {
        setOrder(res.order);
        setStep(3);
        onOrderCreated?.(res.order);
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Failed to generate cryptocurrency deposit order.');
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleManualVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setVerifying(true);
    setVerifyMessage(null);
    setVerifyError(null);

    try {
      const res = await apiClient.checkCryptoOrder(order.id, txIdInput.trim() || undefined);
      setOrder(res.order);
      setVerifyMessage(res.message);

      if (res.activated || res.order.status === 'Paid') {
        setStep(4);
        onPaymentSuccess(res.order);
      } else if (res.order.status === 'Confirming' || res.order.status === 'Manual Review') {
        setStep(4);
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Verification check failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleCancelPayment = async () => {
    if (!order) return;
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

  const getStatusBadge = (status: CryptoPaymentStatus, currency: CryptoPaymentCurrency = 'USDT') => {
    const netLabel = currency === 'GRAM' ? 'TONCOIN / LBank' : 'TRON';
    switch (status) {
      case 'Paid':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <Check className="h-3 w-3" /> Paid & Activated
          </span>
        );
      case 'Confirming':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
            <RefreshCw className="h-3 w-3 animate-spin" /> Confirming on {netLabel}...
          </span>
        );
      case 'Manual Review':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertCircle className="h-3 w-3" /> In Review by Admin
          </span>
        );
      case 'Rejected':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <X className="h-3 w-3" /> Declined by Admin
          </span>
        );
      case 'Cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            <X className="h-3 w-3" /> Cancelled
          </span>
        );
      case 'Expired':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <Clock className="h-3 w-3" /> Order Expired
          </span>
        );
      case 'Failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <X className="h-3 w-3" /> Failed
          </span>
        );
      case 'Pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> Awaiting Deposit
          </span>
        );
    }
  };

  const renderCurrencyIcon = (currency: CryptoPaymentCurrency, size: 'sm' | 'md' = 'md') => {
    const dim = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';
    if (currency === 'GRAM') {
      return (
        <div
          className={`${dim} rounded-xl bg-sky-500/15 border border-sky-400/40 text-sky-300 font-extrabold font-mono flex items-center justify-center shrink-0 shadow-inner`}
          aria-hidden="true"
        >
          G
        </div>
      );
    }
    return (
      <div
        className={`${dim} rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 font-extrabold font-mono flex items-center justify-center shrink-0 shadow-inner`}
        aria-hidden="true"
      >
        ₮
      </div>
    );
  };

  const activeCurrency: CryptoPaymentCurrency = order?.currency || selectedCurrency;
  const activeNetwork =
    order?.network ||
    selectedOption?.network ||
    (activeCurrency === 'GRAM' ? 'TONCOIN (LBank GRAM)' : 'TRON (TRC20)');
  const baseUsdtPrice =
    order?.baseAmountUsdt ??
    optionsData?.baseAmountUsdt ??
    (checkoutConfig?.interval === 'annual' ? 50 : 5);

  const stepsList: { num: CheckoutStep; label: string; shortLabel: string }[] = [
    { num: 1, label: 'Select Currency', shortLabel: 'Currency' },
    { num: 2, label: 'Review Details', shortLabel: 'Review' },
    { num: 3, label: 'Complete Payment', shortLabel: 'Deposit' },
    { num: 4, label: 'Confirm Payment', shortLabel: 'Verify' },
  ];

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crypto-modal-title"
    >
      <div className="relative w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[#0F172A] border border-slate-800 rounded-2xl shadow-2xl p-4 sm:p-6 space-y-4 text-slate-200 my-auto">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close payment modal"
          title="Close (Esc)"
          className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 p-1.5 sm:p-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700/60 transition-all shadow-md focus:outline-none focus:ring-2 focus:ring-[#E6A05A] z-20 cursor-pointer"
        >
          <X className="h-4 w-4 sm:h-5 sm:w-5" />
        </button>

        {/* Compact Header */}
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800 pr-9">
          <div className="p-2 rounded-xl bg-[#E6A05A]/10 border border-[#E6A05A]/25 text-[#E6A05A] shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2
              id="crypto-modal-title"
              className="text-base sm:text-lg font-bold text-white tracking-tight truncate"
            >
              Cryptocurrency Deposit Checkout
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              Official LBank Gateway · USDT (TRC20) & GRAM (TONCOIN)
            </p>
          </div>
        </div>

        {/* 4-Step Progress Indicator */}
        <div
          className="grid grid-cols-4 gap-1.5 p-1.5 rounded-xl bg-slate-900/90 border border-slate-800/90"
          aria-label="Payment Steps"
        >
          {stepsList.map((st) => {
            const isCurrent = step === st.num;
            const isCompleted = step > st.num || (order?.status === 'Paid' && st.num <= 4);
            const canClick =
              (!order && st.num <= 2 && !creatingOrder) ||
              (Boolean(order) && st.num >= 3);

            return (
              <button
                key={st.num}
                type="button"
                disabled={!canClick}
                onClick={() => {
                  if (canClick) setStep(st.num);
                }}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-lg text-center transition-all ${
                  isCurrent
                    ? 'bg-[#E6A05A]/15 border border-[#E6A05A]/50 text-[#E6A05A]'
                    : isCompleted
                    ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400'
                    : 'bg-slate-900/40 border border-transparent text-slate-500'
                } ${canClick ? 'cursor-pointer hover:border-slate-700' : 'cursor-default'}`}
              >
                <div className="flex items-center gap-1 text-[10px] font-mono font-bold">
                  {isCompleted && !isCurrent ? (
                    <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                  ) : (
                    <span>{st.num}.</span>
                  )}
                  <span className="hidden sm:inline truncate">{st.label}</span>
                  <span className="sm:hidden truncate">{st.shortLabel}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* =========================================================
            STEP 1: SELECT CURRENCY
           ========================================================= */}
        {step === 1 && !order && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Coins className="h-4 w-4 text-[#E6A05A]" />
                  <span>Step 1: Select Payment Currency</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Choose your preferred cryptocurrency and network for this subscription.
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-[#E6A05A] bg-[#E6A05A]/10 border border-[#E6A05A]/30 px-2.5 py-1 rounded-lg shrink-0">
                {baseUsdtPrice} USDT Plan
              </span>
            </div>

            {loadingOptions ? (
              <div className="p-8 rounded-xl border border-slate-800 bg-slate-900/50 text-center space-y-2">
                <RefreshCw className="h-5 w-5 animate-spin text-[#E6A05A] mx-auto" />
                <p className="text-xs text-slate-400">
                  Loading live cryptocurrency networks and LBank conversion rates...
                </p>
              </div>
            ) : optionsError ? (
              <div className="p-4 rounded-xl border border-rose-800/80 bg-rose-950/30 text-xs text-rose-300 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>Failed to load payment currencies</span>
                </div>
                <p className="text-[11px] text-slate-300">{optionsError}</p>
                <button
                  type="button"
                  onClick={loadPaymentOptions}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {(optionsData?.options || []).map((opt) => {
                  const isSelected = selectedCurrency === opt.currency;
                  return (
                    <button
                      key={opt.currency}
                      type="button"
                      disabled={!opt.available}
                      onClick={() => {
                        if (opt.available) {
                          setSelectedCurrency(opt.currency);
                          setCreateError(null);
                        }
                      }}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                        !opt.available
                          ? 'border-slate-800/80 bg-slate-900/30 opacity-60 cursor-not-allowed'
                          : isSelected
                          ? 'border-[#E6A05A] bg-[#E6A05A]/10 ring-1 ring-[#E6A05A]/40 cursor-pointer'
                          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {renderCurrencyIcon(opt.currency)}
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-bold text-white">{opt.name}</span>
                            <span className="text-xs font-mono font-bold text-[#E6A05A] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-700">
                              {opt.symbol}
                            </span>
                            <span
                              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                                opt.currency === 'GRAM'
                                  ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              }`}
                            >
                              {opt.network}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">
                            {opt.available ? opt.description : opt.unavailableReason}
                          </p>
                          {opt.available && opt.currency === 'GRAM' && opt.exchangeRateUsdt > 0 && (
                            <div className="text-[10px] font-mono text-slate-400">
                              Live LBank Rate: <strong className="text-slate-200">1 GRAM ≈ {opt.exchangeRateUsdt} USDT</strong>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0 flex flex-col items-end justify-between self-stretch">
                        {opt.available ? (
                          <>
                            <div className="font-mono font-extrabold text-sm sm:text-base text-white tabular-nums">
                              {opt.requiredAmount} <span className="text-xs text-[#E6A05A]">{opt.symbol}</span>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                isSelected
                                  ? 'bg-[#E6A05A] text-[#0B1120] font-bold'
                                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              }`}
                            >
                              {isSelected ? (
                                <>
                                  <Check className="h-2.5 w-2.5" /> Selected
                                </>
                              ) : (
                                'Available'
                              )}
                            </span>
                          </>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                            Unavailable
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loadingOptions || !selectedOption || !selectedOption.available}
                onClick={() => setStep(2)}
                className="px-4 py-2.5 rounded-xl bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-lg shadow-[#E6A05A]/10"
              >
                <span>Review Payment Details</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            STEP 2: REVIEW PAYMENT DETAILS
           ========================================================= */}
        {step === 2 && !order && selectedOption && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white">
                Step 2: Review Payment Details
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Verify your selected cryptocurrency, network, and exact payment amount before generating your deposit address.
              </p>
            </div>

            <div className="rounded-xl border border-[#E6A05A]/30 bg-[#E6A05A]/5 p-3.5 sm:p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Subscription Package</span>
                <span className="font-bold text-white text-right">
                  {optionsData?.planName || 'Pro (+5 Websites)'}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <span className="text-slate-400">Website Capacity Added</span>
                <span className="font-mono font-bold text-emerald-400">
                  +{optionsData?.websiteSlotsAdded || 5} Websites (Independent Expiry)
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <span className="text-slate-400">Base Plan Price</span>
                <span className="font-mono font-semibold text-slate-200">
                  {selectedOption.baseAmountUsdt} USDT
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <span className="text-slate-400">Selected Cryptocurrency</span>
                <span className="font-mono font-bold text-white">
                  {selectedOption.name} ({selectedOption.symbol})
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <span className="text-slate-400">Supported Network</span>
                <span
                  className={`font-mono font-bold px-2 py-0.5 rounded text-[11px] border ${
                    selectedOption.currency === 'GRAM'
                      ? 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  }`}
                >
                  {selectedOption.network}
                </span>
              </div>

              {selectedOption.currency === 'GRAM' && (
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <span className="text-slate-400">Conversion Rate (LBank)</span>
                  <span className="font-mono text-slate-300">
                    1 GRAM = {selectedOption.exchangeRateUsdt} USDT
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-800">
                <span className="text-slate-300 font-semibold">Required Payment Amount</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl sm:text-2xl font-extrabold font-mono text-[#E6A05A] tabular-nums">
                    {selectedOption.requiredAmount}
                  </span>
                  <span className="text-xs font-bold font-mono text-white">
                    {selectedOption.symbol}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                <span className="text-slate-400">Payment Status</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                  Ready to Initiate Deposit
                </span>
              </div>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{createError}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                disabled={creatingOrder}
                onClick={() => setStep(1)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Change Currency</span>
              </button>

              <button
                type="button"
                disabled={creatingOrder}
                onClick={handleGenerateOrderAndProceed}
                className="px-4 py-2.5 rounded-xl bg-[#E6A05A] hover:bg-[#cf863c] text-[#0B1120] font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-lg shadow-[#E6A05A]/10"
              >
                {creatingOrder ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Generating Deposit Address...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="h-3.5 w-3.5" />
                    <span>Proceed to Deposit ({selectedOption.requiredAmount} {selectedOption.symbol})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* =========================================================
            STEP 3 & STEP 4: COMPLETE PAYMENT & CONFIRM PAYMENT
           ========================================================= */}
        {order && (
          <div className="space-y-3.5">
            {/* Compact Order Summary Strip */}
            <div className="rounded-xl border border-[#E6A05A]/30 bg-[#E6A05A]/5 p-3 sm:p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {renderCurrencyIcon(order.currency || 'USDT', 'sm')}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{order.planName}</div>
                    <div className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5">
                      <span>Order: {order.id}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(order.id, 'orderId')}
                        className="text-slate-400 hover:text-white cursor-pointer"
                        title="Copy Order ID"
                      >
                        {copiedField === 'orderId' ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <span className="text-lg sm:text-xl font-extrabold font-mono text-[#E6A05A] tabular-nums">
                      {order.amount}
                    </span>
                    <span className="text-xs font-bold text-white font-mono">
                      {order.currency || 'USDT'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(String(order.amount), 'amount')}
                      className="p-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                      title="Copy exact amount"
                    >
                      {copiedField === 'amount' ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                  {order.currency === 'GRAM' && (
                    <div className="text-[10px] font-mono text-slate-400">
                      ≈ {order.baseAmountUsdt ?? baseUsdtPrice} USDT
                      {order.exchangeRateUsdt ? ` @ ${order.exchangeRateUsdt} USDT/GRAM` : ''}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Network:</span>
                  <span
                    className={`font-mono font-bold px-2 py-0.5 rounded border ${
                      order.currency === 'GRAM'
                        ? 'text-sky-300 bg-sky-500/10 border-sky-500/30'
                        : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                    }`}
                  >
                    {activeNetwork}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {getStatusBadge(order.status, order.currency)}
                  {order.status !== 'Paid' &&
                    order.status !== 'Rejected' &&
                    order.status !== 'Cancelled' && (
                      <span
                        className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold ${
                          timeLeft === 'Expired' ? 'text-rose-400' : 'text-[#E6A05A]'
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {timeLeft}
                      </span>
                    )}
                </div>
              </div>
            </div>

            {/* Rejection Notification Banner */}
            {order.status === 'Rejected' && (
              <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/80 text-xs text-rose-300 space-y-1">
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

            {/* Paid Confirmation View (Step 4 Completed) */}
            {order.status === 'Paid' ? (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-5 text-center space-y-3.5">
                <div className="inline-flex p-2.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Sparkles className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white">Payment Confirmed!</h3>
                  <p className="text-xs text-slate-300 mt-1 max-w-sm mx-auto">
                    Your deposit of{' '}
                    <strong className="text-white">
                      {order.amount} {order.currency || 'USDT'}
                    </strong>{' '}
                    on <strong className="text-slate-200">{activeNetwork}</strong> has been verified. Your{' '}
                    <strong className="text-[#E6A05A]">{order.planName}</strong> entitlement (+5 websites) is now active.
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
                {/* QR Code & Deposit Address Box */}
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row items-center gap-3.5">
                    {/* Compact QR Code */}
                    {order.qrDataUrl && order.depositAddress ? (
                      <div className="p-2 rounded-xl bg-white shrink-0 shadow-md">
                        <img
                          src={order.qrDataUrl}
                          alt={`${order.currency} ${activeNetwork} Deposit QR`}
                          className="w-28 h-28 sm:w-32 sm:h-32 block"
                        />
                      </div>
                    ) : (
                      <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                        <QrCode className="h-9 w-9 text-slate-500" />
                      </div>
                    )}

                    {/* Primary Deposit Address & Copy Action */}
                    <div className="w-full min-w-0 space-y-2 text-left">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] font-semibold text-slate-300">
                          Receiving {order.currency} Address:
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold ${
                            order.currency === 'GRAM' ? 'text-sky-400' : 'text-emerald-400'
                          }`}
                        >
                          {order.currency === 'GRAM' ? 'TONCOIN ONLY' : 'TRC20 ONLY'}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 font-mono text-[11px] text-white break-all select-all leading-relaxed">
                        {order.depositAddress}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(order.depositAddress, 'address')}
                          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                            copiedField === 'address'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-[#E6A05A] text-[#0B1120] hover:bg-[#cf863c]'
                          }`}
                        >
                          {copiedField === 'address' ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              <span>Address Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copy Deposit Address</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Warning Banner */}
                  <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 flex items-start gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-0.5" />
                    <div className="leading-snug">
                      Send{' '}
                      <strong>
                        only {order.currency} via {activeNetwork}
                      </strong>{' '}
                      (exact amount: <strong className="font-mono">{order.amount} {order.currency}</strong>). No memo/tag is required.
                    </div>
                  </div>

                  {/* Collapsible Step-by-Step Instructions to keep modal compact on mobile */}
                  <details className="group rounded-lg border border-slate-800/80 bg-slate-900/50 px-3 py-2 text-xs">
                    <summary className="flex items-center justify-between cursor-pointer font-semibold text-slate-300 select-none list-none">
                      <span>How to complete your {order.currency} transfer</span>
                      <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-180" />
                    </summary>
                    <ol className="list-decimal list-inside space-y-1 text-slate-400 leading-relaxed text-[11px] mt-2 pt-2 border-t border-slate-800/80">
                      <li>
                        Open your {order.currency === 'GRAM' ? 'TON/GRAM-compatible wallet or LBank app' : 'TRON-compatible wallet (TronLink, Trust Wallet, LBank, etc.)'}.
                      </li>
                      <li>
                        Select <strong className="text-slate-200">{order.currency}</strong> on the{' '}
                        <strong className="text-emerald-400">{activeNetwork}</strong> network.
                      </li>
                      <li>
                        Send exactly{' '}
                        <strong className="text-white font-mono">
                          {order.amount} {order.currency}
                        </strong>{' '}
                        to the receiving address above.
                      </li>
                      <li>
                        Paste your TXID below or wait 30–60 seconds for automatic LBank & blockchain verification.
                      </li>
                    </ol>
                  </details>
                </div>

                {/* Step 4: TXID Verification Form */}
                <form
                  onSubmit={handleManualVerify}
                  className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white">
                      Step 4: Confirm Payment / Submit TXID
                    </label>
                    <span className="text-[10px] font-mono text-slate-400">
                      Auto-checking every 12s
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={txIdInput}
                      onChange={(e) => setTxIdInput(e.target.value)}
                      placeholder={
                        order.currency === 'GRAM'
                          ? 'Paste GRAM / TON transaction hash (TXID)'
                          : 'Paste 64-char TRON TXID (optional)'
                      }
                      className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A] min-w-0"
                    />
                    <button
                      type="submit"
                      disabled={verifying}
                      className="px-4 py-2 rounded-xl bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] transition-colors flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                    >
                      {verifying ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                      <span>{verifying ? 'Checking...' : 'Verify Payment'}</span>
                    </button>
                  </div>

                  {verifyMessage && (
                    <p
                      className={`text-[11px] font-medium pt-0.5 leading-snug ${
                        order.status === 'Manual Review' ? 'text-amber-300' : 'text-slate-300'
                      }`}
                    >
                      {verifyMessage}
                    </p>
                  )}
                  {verifyError && (
                    <p className="text-[11px] text-rose-400 font-medium pt-0.5">{verifyError}</p>
                  )}

                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono pt-0.5">
                    <RefreshCw className="h-3 w-3 animate-spin text-[#E6A05A] shrink-0" />
                    <span className="truncate">
                      Monitoring LBank & {order.currency === 'GRAM' ? 'TONCOIN' : 'TRON'} ledger for incoming transfer...
                    </span>
                  </div>
                </form>
              </>
            )}

            {/* Cancellation Confirmation Alert */}
            {showCancelConfirm && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-xs space-y-2">
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
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {cancelling ? 'Cancelling...' : 'Yes, Cancel Payment'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(false)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium cursor-pointer"
                  >
                    Keep Active
                  </button>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="pt-2.5 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs">
              <div className="text-[10px] sm:text-[11px] text-slate-400 text-center sm:text-left flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                <span>
                  Closing keeps your order saved in{' '}
                  <strong className="text-[#E6A05A]">My Crypto Payments</strong>.
                </span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
                {order.status !== 'Paid' && order.status !== 'Cancelled' && (
                  <button
                    type="button"
                    onClick={() => setShowCancelConfirm(true)}
                    className="px-3 py-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 border border-rose-500/30 transition-colors text-xs font-semibold cursor-pointer"
                  >
                    Cancel Order
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors text-xs border border-slate-700 cursor-pointer"
                >
                  Close Window
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
