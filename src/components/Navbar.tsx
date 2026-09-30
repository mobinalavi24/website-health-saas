import React from 'react';
import { Activity, Shield, Globe, Terminal, LogIn, LayoutDashboard, UserCheck, QrCode } from 'lucide-react';
import type { User, Organization } from '../types.ts';

interface NavbarProps {
  user: User | null;
  organization: Organization | null;
  activeView: string;
  onNavigate: (view: string) => void;
  onOpenAuth: (initialTab?: 'login' | 'register') => void;
  onLogout: () => void;
  currency: 'USD' | 'EUR' | 'GBP';
  onCurrencyChange: (c: 'USD' | 'EUR' | 'GBP') => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  organization,
  activeView,
  onNavigate,
  onOpenAuth,
  onLogout,
  currency,
  onCurrencyChange,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-[#0B1120]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single text element brand wordmark */}
        <button
          onClick={() => onNavigate(user ? 'dashboard' : 'home')}
          className="group flex items-center gap-2 text-left focus:outline-none"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
            <Activity className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white group-hover:text-[#E6A05A] transition-colors">
            PulseVanguard
          </span>
        </button>

        {/* Zone 2: 4-6 clean text navigation links with subtle hover underlines */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
          {!user ? (
            <>
              <button
                onClick={() => onNavigate('home')}
                className={`transition-colors hover:text-white ${activeView === 'home' ? 'text-[#E6A05A]' : ''}`}
              >
                Overview
              </button>
              <button
                onClick={() => onNavigate('features')}
                className={`transition-colors hover:text-white ${activeView === 'features' ? 'text-[#E6A05A]' : ''}`}
              >
                Capabilities
              </button>
              <button
                onClick={() => onNavigate('how-it-works')}
                className={`transition-colors hover:text-white ${activeView === 'how-it-works' ? 'text-[#E6A05A]' : ''}`}
              >
                How It Works
              </button>
              <button
                onClick={() => onNavigate('pricing')}
                className={`transition-colors hover:text-white ${activeView === 'pricing' ? 'text-[#E6A05A]' : ''}`}
              >
                Pricing
              </button>
              <button
                onClick={() => onNavigate('for-agencies')}
                className={`transition-colors hover:text-white ${activeView === 'for-agencies' ? 'text-[#E6A05A]' : ''}`}
              >
                For Agencies
              </button>
              <button
                onClick={() => onNavigate('security')}
                className={`transition-colors hover:text-white ${activeView === 'security' ? 'text-[#E6A05A]' : ''}`}
              >
                Security & Trust
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onNavigate('dashboard')}
                className={`transition-colors hover:text-white ${activeView === 'dashboard' ? 'text-[#E6A05A]' : ''}`}
              >
                Monitored Sites
              </button>
              <button
                onClick={() => onNavigate('scanner')}
                className={`transition-colors hover:text-white ${activeView === 'scanner' ? 'text-[#E6A05A]' : ''}`}
              >
                Instant Scanner
              </button>
              <button
                onClick={() => onNavigate('agency')}
                className={`transition-colors hover:text-white ${activeView === 'agency' ? 'text-[#E6A05A]' : ''}`}
              >
                Agency & Clients
              </button>
              <button
                onClick={() => onNavigate('reports')}
                className={`transition-colors hover:text-white ${activeView === 'reports' ? 'text-[#E6A05A]' : ''}`}
              >
                Reports
              </button>
              <button
                onClick={() => onNavigate('billing')}
                className={`transition-colors hover:text-white ${activeView === 'billing' ? 'text-[#E6A05A]' : ''}`}
              >
                Plan & Limits
              </button>
              <button
                onClick={() => onNavigate('api-docs')}
                className={`transition-colors hover:text-white ${activeView === 'api-docs' ? 'text-[#E6A05A]' : ''}`}
              >
                API Keys
              </button>
              {user.email?.toLowerCase() === 'mobinalavi7491@gmail.com' && (
                <button
                  onClick={() => onNavigate('my-crypto-payments')}
                  className={`transition-colors hover:text-white ${activeView === 'my-crypto-payments' ? 'text-[#E6A05A]' : ''}`}
                >
                  My Crypto Payments
                </button>
              )}
              {user.role === 'super_admin' && (
                <button
                  onClick={() => onNavigate('admin')}
                  className={`transition-colors hover:text-white ${activeView === 'admin' ? 'text-[#E6A05A]' : ''}`}
                >
                  Admin Control
                </button>
              )}
            </>
          )}
        </nav>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-3">
          {/* Currency Selector (international SaaS requirement) */}
          <div className="hidden sm:flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-xs text-slate-300">
            {(['USD', 'EUR', 'GBP'] as const).map((curr) => (
              <button
                key={curr}
                onClick={() => onCurrencyChange(curr)}
                className={`px-2 py-1 rounded font-mono transition-colors ${
                  currency === curr
                    ? 'bg-slate-800 text-[#E6A05A] font-semibold'
                    : 'hover:text-white'
                }`}
              >
                {curr === 'USD' ? '$' : curr === 'EUR' ? '€' : '£'} {curr}
              </button>
            ))}
          </div>

          {!user ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenAuth('login')}
                className="px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white transition-colors"
              >
                Sign In
              </button>
              <button
                onClick={() => onOpenAuth('register')}
                className="px-3.5 py-1.5 text-sm font-medium text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors whitespace-nowrap"
              >
                Get Started Free
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="hidden lg:flex flex-col text-right">
                <span className="text-xs font-medium text-white truncate max-w-[130px]">{user.name}</span>
                <span className="text-[11px] text-slate-400 capitalize">{organization?.planId || 'free'} plan</span>
              </div>
              {user.email?.toLowerCase() === 'mobinalavi7491@gmail.com' && (
                <button
                  onClick={() => onNavigate('my-crypto-payments')}
                  title="My Crypto Payments"
                  className={`flex h-8 items-center gap-1.5 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${
                    activeView === 'my-crypto-payments'
                      ? 'bg-[#E6A05A] text-[#0B1120] border-[#E6A05A]'
                      : 'bg-slate-800 border-slate-700 text-[#E6A05A] hover:bg-slate-700'
                  }`}
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">My Payments</span>
                </button>
              )}
              <button
                onClick={() => onNavigate('dashboard')}
                title="Open Dashboard"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:text-white"
              >
                <LayoutDashboard className="h-4 w-4" />
              </button>
              <button
                onClick={onLogout}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-rose-400 transition-colors"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
