import React, { useState } from 'react';
import { X, Activity, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { User, Organization } from '../types.ts';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User, organization: Organization) => void;
  initialTab?: 'login' | 'register';
  initialReferralCode?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialTab = 'login',
  initialReferralCode = '',
}) => {
  const [tab, setTab] = useState<'login' | 'register' | 'reset'>(initialTab);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [referralValidationMsg, setReferralValidationMsg] = useState<string | null>(null);
  const [referralValid, setReferralValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  React.useEffect(() => {
    setTab(initialTab);
  }, [initialTab, isOpen]);

  React.useEffect(() => {
    if (initialReferralCode) {
      setReferralCode(initialReferralCode.toUpperCase());
    }
  }, [initialReferralCode]);

  if (!isOpen) return null;

  const handleValidateReferralBlur = async () => {
    const trimmed = referralCode.trim().toUpperCase();
    if (!trimmed) {
      setReferralValidationMsg(null);
      setReferralValid(null);
      return;
    }
    try {
      const res = await apiClient.validateReferralCode(trimmed);
      setReferralValid(res.valid);
      setReferralValidationMsg(
        res.valid
          ? `Referral code verified${res.referrerName ? ` (invited by ${res.referrerName})` : ''}.`
          : res.error || 'Invalid referral code.'
      );
    } catch {
      setReferralValid(null);
      setReferralValidationMsg(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (tab === 'login') {
        // Clear any old/stale token from localStorage before attempting new login
        apiClient.clearToken();
        const res = await apiClient.login(email.trim(), password);
        onSuccess(res.user, res.organization);
        onClose();
      } else if (tab === 'register') {
        apiClient.clearToken();
        const cleanRef = referralCode.trim().toUpperCase();
        const res = await apiClient.register(
          name.trim(),
          email.trim(),
          password,
          orgName.trim(),
          cleanRef || undefined
        );
        try {
          sessionStorage.removeItem('pv_referral_code');
        } catch {}
        onSuccess(res.user, res.organization);
        onClose();
      } else if (tab === 'reset') {
        await apiClient.resetPassword(email.trim());
        setResetSent(true);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E6A05A]/10 text-[#E6A05A]">
              <Activity className="h-4 w-4" />
            </div>
            <span className="text-base font-bold text-white">PulseVanguard</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
          <button
            onClick={() => {
              setTab('login');
              setError(null);
            }}
            className={`flex-1 py-1.5 rounded font-medium transition-colors ${
              tab === 'login' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => {
              setTab('register');
              setError(null);
            }}
            className={`flex-1 py-1.5 rounded font-medium transition-colors ${
              tab === 'register' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400'
            }`}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/60 text-xs text-rose-300">
            {error}
          </div>
        )}

        {resetSent ? (
          <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-800 text-xs text-emerald-300 space-y-2">
            <p>Password reset link has been dispatched to your email address.</p>
            <button
              onClick={() => {
                setTab('login');
                setResetSent(false);
              }}
              className="text-[#E6A05A] underline"
            >
              Back to Sign In
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            {tab === 'register' && (
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Your Full Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alexandre Sterling"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                />
              </div>
            )}

            <div>
              <label className="text-slate-300 font-semibold block mb-1">Work Email</label>
              <input
                type="email"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            {tab !== 'reset' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-semibold">Password</label>
                  {tab === 'login' && (
                    <button
                      type="button"
                      onClick={() => setTab('reset')}
                      className="text-slate-400 hover:text-[#E6A05A] text-[11px]"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <input
                  type="password"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                />
              </div>
            )}

            {tab === 'register' && (
              <>
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Organization / Agency Name</label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="e.g. Acme Studio"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                  />
                </div>

                <div>
                  <label className="text-slate-300 font-semibold flex items-center justify-between mb-1">
                    <span>Referral Code (Optional)</span>
                    <span className="text-[10px] font-mono text-slate-500">INVITE CODE</span>
                  </label>
                  <input
                    type="text"
                    value={referralCode}
                    onChange={(e) => {
                      setReferralCode(e.target.value.toUpperCase());
                      setReferralValidationMsg(null);
                      setReferralValid(null);
                    }}
                    onBlur={handleValidateReferralBlur}
                    placeholder="e.g. PV-ABCD1234"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono uppercase focus:outline-none focus:border-[#E6A05A]"
                  />
                  {referralValidationMsg && (
                    <p
                      className={`mt-1 text-[11px] font-medium ${
                        referralValid ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {referralValidationMsg}
                    </p>
                  )}
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-[#E6A05A] text-[#0B1120] font-semibold text-xs hover:bg-[#cf863c] transition-colors disabled:opacity-60 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : tab === 'login' ? (
                <span>Sign In to Dashboard</span>
              ) : tab === 'register' ? (
                <span>Create Free Account</span>
              ) : (
                <span>Send Reset Link</span>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
