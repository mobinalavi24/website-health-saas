import React from 'react';
import { X, ShieldCheck } from 'lucide-react';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'terms' | 'privacy' | 'security';
}

export const LegalModal: React.FC<LegalModalProps> = ({
  isOpen,
  onClose,
  type,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0F172A] p-6 sm:p-8 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#E6A05A]" />
            <h2 className="text-base font-bold text-white">
              {type === 'terms'
                ? 'Terms of Service'
                : type === 'privacy'
                ? 'Privacy & Data Protection Policy'
                : 'Security Architecture & SSRF Safeguards'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-lg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          {type === 'security' && (
            <>
              <h3 className="text-sm font-semibold text-white">1. Zero Server Credential Requirement</h3>
              <p>
                PulseVanguard conducts all website availability, performance, and security evaluations strictly via external, publicly accessible network protocols (HTTP/HTTPS, TLS handshake, and public DNS queries). We never request or store hosting passwords, cPanel credentials, SSH keys, or FTP logins.
              </p>

              <h3 className="text-sm font-semibold text-white">2. Server-Side Request Forgery (SSRF) Safeguards</h3>
              <p>
                Our scanning engine strictly enforces automated IP validation. All requests targeting private IPv4 ranges (RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), link-local cloud metadata addresses (169.254.169.254, metadata.google.internal), loopback addresses (127.0.0.0/8, ::1), and internal subnets are proactively intercepted and rejected at DNS resolution time.
              </p>

              <h3 className="text-sm font-semibold text-white">3. Multi-Region Failure Confirmation</h3>
              <p>
                To eliminate false alarms, candidate downtime incidents are validated with automated retries and multi-region confirmation before alerts are dispatched to user notification channels.
              </p>
            </>
          )}

          {type === 'privacy' && (
            <>
              <h3 className="text-sm font-semibold text-white">1. Data Minimization & Isolation</h3>
              <p>
                We only store public domain metadata, observed response latencies, and user configuration preferences. Tenant databases are isolated by organization ID, ensuring strict multi-tenant boundaries.
              </p>

              <h3 className="text-sm font-semibold text-white">2. GDPR & CCPA Compliance</h3>
              <p>
                Users maintain full control over their account data. You may export all historical metrics or permanently delete your account and associated website records at any time from your settings.
              </p>

              <h3 className="text-sm font-semibold text-white">3. No Advertising Trackers</h3>
              <p>
                PulseVanguard never sells customer or telemetry data to third-party ad networks or brokers.
              </p>
            </>
          )}

          {type === 'terms' && (
            <>
              <h3 className="text-sm font-semibold text-white">1. Acceptable Use Policy</h3>
              <p>
                PulseVanguard is provided for legitimate website monitoring, uptime verification, and diagnostic auditing. Scanning internal corporate networks or abusing the scanner for denial-of-service testing is strictly prohibited.
              </p>

              <h3 className="text-sm font-semibold text-white">2. Service Level Agreement (SLA)</h3>
              <p>
                Paid Pro and Agency plans include a 99.9% uptime commitment on continuous monitoring node schedules. In the event of service disruption, pro-rated service credits are provided.
              </p>

              <h3 className="text-sm font-semibold text-white">3. Cancellation & Refunds</h3>
              <p>
                Subscriptions may be cancelled anytime with immediate effect or at the end of the current billing cycle. No long-term lock-in contracts are imposed.
              </p>
            </>
          )}
        </div>

        <div className="pt-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs hover:bg-slate-700"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
};
