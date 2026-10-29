import React, { useState } from 'react';
import { X, Mail, Check, Lock } from 'lucide-react';
import { apiClient } from '../api/client.ts';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  userName?: string;
  onOpenAuth?: (tab?: 'login' | 'register') => void;
  onNavigateReports?: () => void;
}

export const ContactModal: React.FC<ContactModalProps> = ({
  isOpen,
  onClose,
  userEmail = '',
  userName = '',
  onOpenAuth,
  onNavigateReports,
}) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isAuthenticated = Boolean(userEmail);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      setError('Please enter both a subject and a detailed description.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await apiClient.createTicket({
        subject: subject.trim(),
        description: message.trim(),
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to submit support ticket.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-[#E6A05A]" />
            <h2 className="text-base font-bold text-white">Contact & Support Ticket</h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!isAuthenticated ? (
          <div className="p-4 text-center space-y-4">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
              <Lock className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-bold text-white">Sign In Required</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Please sign in to your PulseVanguarde account to create and track support tickets in the Reports center.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onNavigateReports) onNavigateReports();
                  if (onOpenAuth) onOpenAuth('login');
                }}
                className="px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] cursor-pointer"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onNavigateReports) onNavigateReports();
                  if (onOpenAuth) onOpenAuth('register');
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold hover:bg-slate-700 cursor-pointer"
              >
                Create Account
              </button>
            </div>
          </div>
        ) : submitted ? (
          <div className="p-6 text-center space-y-3">
            <Check className="h-8 w-8 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-semibold text-white">Support Ticket Created</h3>
            <p className="text-xs text-slate-400">
              Our engineering and operations team has received your ticket. You can track replies anytime in Reports.
            </p>
            <div className="flex items-center justify-center gap-2 pt-2">
              {onNavigateReports && (
                <button
                  onClick={() => {
                    setSubmitted(false);
                    setSubject('');
                    setMessage('');
                    onClose();
                    onNavigateReports();
                  }}
                  className="px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-bold hover:bg-[#cf863c] cursor-pointer"
                >
                  Open in Reports
                </button>
              )}
              <button
                onClick={() => {
                  setSubmitted(false);
                  setSubject('');
                  setMessage('');
                  onClose();
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 text-white text-xs hover:bg-slate-700 cursor-pointer"
              >
                Close Window
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            {error && (
              <div className="p-2.5 rounded bg-rose-950/30 border border-rose-900/60 text-rose-300">
                {error}
              </div>
            )}

            <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400">
              Submitting as <strong className="text-white">{userName}</strong> (
              <span className="font-mono text-[#E6A05A]">{userEmail}</span>)
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Subject <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of the issue..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Description <span className="text-rose-400">*</span>
              </label>
              <textarea
                rows={4}
                required
                maxLength={10000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Explain the problem in detail..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] font-semibold hover:bg-[#cf863c] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {loading ? 'Submitting...' : 'Submit Support Ticket'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
