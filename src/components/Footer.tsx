import React from 'react';
import { Activity, ShieldCheck, Heart } from 'lucide-react';

interface FooterProps {
  onNavigate: (view: string) => void;
  onOpenLegal: (type: 'terms' | 'privacy' | 'security') => void;
  onOpenContact: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  onNavigate,
  onOpenLegal,
  onOpenContact,
}) => {
  return (
    <footer className="w-full border-t border-slate-800 bg-[#070B14] py-12 text-slate-400 text-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-10 border-b border-slate-800/60">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
                <Activity className="h-3.5 w-3.5" />
              </div>
              <span className="text-base font-bold tracking-tight text-white">
                PulseVanguard
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Global website health, uptime monitoring, and security audit platform. Continuous public node probing with zero server credentials required.
            </p>
            <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>All Global Probing Nodes Operational</span>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">Monitoring</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button onClick={() => onNavigate('features')} className="hover:text-white transition-colors">
                  HTTP & SSL Uptime
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('features')} className="hover:text-white transition-colors">
                  DNS & Email Security (SPF/DMARC)
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('features')} className="hover:text-white transition-colors">
                  Security Headers & HSTS
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('features')} className="hover:text-white transition-colors">
                  Core Web Vitals & SEO Health
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">Agencies & Developers</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button onClick={() => onNavigate('for-agencies')} className="hover:text-white transition-colors">
                  Client Workspaces
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('for-agencies')} className="hover:text-white transition-colors">
                  White-Label Reports
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('api-docs')} className="hover:text-white transition-colors">
                  Developer REST API
                </button>
              </li>
              <li>
                <button onClick={() => onNavigate('pricing')} className="hover:text-white transition-colors">
                  International Pricing
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">Trust & Support</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button onClick={() => onOpenLegal('security')} className="hover:text-white transition-colors">
                  Security & SSRF Safeguards
                </button>
              </li>
              <li>
                <button onClick={() => onOpenLegal('privacy')} className="hover:text-white transition-colors">
                  Privacy Policy
                </button>
              </li>
              <li>
                <button onClick={() => onOpenLegal('terms')} className="hover:text-white transition-colors">
                  Terms of Service
                </button>
              </li>
              <li>
                <button onClick={onOpenContact} className="hover:text-[#E6A05A] transition-colors">
                  Contact Support & Sales
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            © {new Date().getFullYear()} PulseVanguard Systems Inc. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <span>ISO/IEC 27001 Methodology Aligned</span>
            <span aria-hidden="true">·</span>
            <span>Zero Hosting Password Policy</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
