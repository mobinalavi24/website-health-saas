import React, { useState } from 'react';
import { X, Mail, Check, Loader2 } from 'lucide-react';
import { apiClient } from '../api/client.ts';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  userName?: string;
}

export const ContactModal: React.FC<ContactModalProps> = ({
  isOpen,
  onClose,
  userEmail = '',
  userName = '',
}) => {
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<'technical' | 'billing' | 'monitoring' | 'feature'>('technical');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !subject.trim() || !message.trim()) {
      setError('Please fill in all required fields.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await apiClient.createTicket({
        name: name.trim() || 'Valued User',
        email: email.trim(),
        subject: subject.trim(),
        category,
        message: message.trim(),
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to submit inquiry.');
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
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg">
            <X className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="p-6 text-center space-y-3">
            <Check className="h-8 w-8 text-emerald-400 mx-auto" />
            <h3 className="text-sm font-semibold text-white">Support Ticket Created</h3>
            <p className="text-xs text-slate-400">
              Our engineering and operations team has received your ticket. We typically respond within 2 hours.
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-xs hover:bg-slate-700"
            >
              Close Window
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 text-xs">
            {error && (
              <div className="p-2.5 rounded bg-rose-950/30 border border-rose-900/60 text-rose-300">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Your Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alexandre"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                />
              </div>
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Email <span className="text-rose-400">*</span></label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@domain.com"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                />
              </div>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              >
                <option value="technical">Technical Monitoring & Node Probes</option>
                <option value="billing">International Billing & Enterprise Plans</option>
                <option value="feature">White-Label & Agency Feature Request</option>
              </select>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">Subject <span className="text-rose-400">*</span></label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Question regarding custom CNAME or SSL alerts"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">Message <span className="text-rose-400">*</span></label>
              <textarea
                rows={4}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Please provide any relevant details or URLs..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] font-semibold hover:bg-[#cf863c] transition-colors disabled:opacity-50"
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
