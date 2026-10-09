import type { Organization } from './db.ts';

export interface TrialStatus {
  isTrial: boolean;
  trialStartedAt?: string;
  trialEndsAt?: string;
  trialUsed: boolean;
  isExpired: boolean;
  remainingMs: number;
}

/**
 * Calculates trial status for an account / organization.
 * Accepts an optional reference time (currentTimeMs) for testing time progression.
 */
export function getAccountTrialStatus(
  account: Pick<Organization, 'planId' | 'trialStartedAt' | 'trialEndsAt' | 'trialUsed' | 'createdAt'>,
  currentTimeMs: number = Date.now()
): TrialStatus {
  // Pro (or paid) accounts are not bound by the trial
  if (account.planId !== 'free') {
    return {
      isTrial: false,
      trialStartedAt: account.trialStartedAt,
      trialEndsAt: account.trialEndsAt,
      trialUsed: Boolean(account.trialUsed),
      isExpired: false,
      remainingMs: 0,
    };
  }

  // Account is Free plan
  const trialUsed = account.trialUsed !== undefined ? Boolean(account.trialUsed) : true;
  
  // Determine start & end timestamps
  const startedAtIso = account.trialStartedAt || account.createdAt || new Date(currentTimeMs).toISOString();
  let startedAtMs = new Date(startedAtIso).getTime();
  if (Number.isNaN(startedAtMs)) {
    startedAtMs = account.createdAt ? new Date(account.createdAt).getTime() : currentTimeMs;
    if (Number.isNaN(startedAtMs)) startedAtMs = currentTimeMs;
  }
  
  let endsAtMs: number;
  if (account.trialEndsAt) {
    endsAtMs = new Date(account.trialEndsAt).getTime();
    if (Number.isNaN(endsAtMs)) {
      endsAtMs = startedAtMs + 24 * 60 * 60 * 1000;
    }
  } else {
    endsAtMs = startedAtMs + 24 * 60 * 60 * 1000;
  }

  const endsAtIso = new Date(endsAtMs).toISOString();
  const isExpired = currentTimeMs >= endsAtMs;
  const remainingMs = isExpired ? 0 : Math.max(0, endsAtMs - currentTimeMs);

  return {
    isTrial: true,
    trialStartedAt: startedAtIso,
    trialEndsAt: endsAtIso,
    trialUsed,
    isExpired,
    remainingMs,
  };
}

/**
 * Standard error response payload for expired trial actions.
 */
export const TRIAL_EXPIRED_RESPONSE = {
  error: 'TRIAL_EXPIRED',
  message: 'Your free trial has expired. Upgrade to Pro to continue.',
};
