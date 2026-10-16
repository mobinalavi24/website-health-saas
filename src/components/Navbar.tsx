import React from 'react';
import { Activity, Shield, Globe, Terminal, LogIn, LayoutDashboard, UserCheck, QrCode, Coins, Gift, Wallet } from 'lucide-react';
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
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-slate-300">
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
                onClick={() => onNavigate('billing')}
                className={`transition-colors hover:text-white ${activeView === 'billing' ? 'text-[#E6A05A]' : ''}`}
              >
                Plan & Limits
              </button>
              <button
                onClick={() => onNavigate('profile-referrals')}
                className={`transition-colors hover:text-white flex items-center gap-1.5 ${
                  activeView === 'profile-referrals' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                <Gift className="h-3.5 w-3.5 text-[#E6A05A]" />
                <span>Profile & Referrals</span>
              </button>
              {user && (
                <button
                  onClick={() => onNavigate('my-crypto-payments')}
                  className={`transition-colors hover:text-white ${activeView === 'my-crypto-payments' ? 'text-[#E6A05A]' : ''}`}
                >
                  My Crypto Payments
                </button>
              )}
              {(user.role === 'admin' || user.role === 'super_admin') && (
                <>
                  <button
                    onClick={() => onNavigate('admin-crypto-transactions')}
                    className={`transition-colors hover:text-white flex items-center gap-1.5 ${
                      activeView === 'admin-crypto-transactions' ? 'text-[#E6A05A] font-semibold' : ''
                    }`}
                  >
                    <Coins className="h-3.5 w-3.5" />
                    Payment Review
                  </button>
                  <button
                    onClick={() => onNavigate('admin-withdrawals')}
                    className={`transition-colors hover:text-white flex items-center gap-1.5 ${
                      activeView === 'admin-withdrawals' ? 'text-[#E6A05A] font-semibold' : ''
                    }`}
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    Withdrawals
                  </button>
                </>
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
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => onNavigate('profile-referrals')}
                title="User Profile & Referral Wallet"
                className="hidden lg:flex flex-col text-right hover:opacity-90 transition-opacity cursor-pointer"
              >
                <span className="text-xs font-medium text-white truncate max-w-[130px]">{user.name}</span>
                {organization?.planId === 'free' ? (
                  <span className="text-[11px] font-medium">
                    {organization.trialEndsAt && new Date() >= new Date(organization.trialEndsAt) ? (
                      <span className="text-rose-400 font-semibold">Trial Expired</span>
                    ) : (
                      <span className="text-[#E6A05A]">Free Trial</span>
                    )}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400 capitalize">{organization?.planId || 'free'} plan</span>
                )}
              </button>
              {(user.role === 'admin' || user.role === 'super_admin') && (
                <>
                  <button
                    onClick={() => onNavigate('admin-withdrawals')}
                    title="Withdrawal Requests (Admin)"
                    className={`flex h-8 items-center gap-1.5 px-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      activeView === 'admin-withdrawals'
                        ? 'bg-[#E6A05A] text-[#0B1120] border-[#E6A05A]'
                        : 'bg-slate-800 border-slate-700 text-emerald-400 hover:bg-slate-700'
                    }`}
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Withdrawals</span>
                  </button>
                  <button
                    onClick={() => onNavigate('admin-crypto-transactions')}
                    title="Crypto Transactions (Admin)"
                    className={`flex h-8 items-center gap-1.5 px-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      activeView === 'admin-crypto-transactions'
                        ? 'bg-[#E6A05A] text-[#0B1120] border-[#E6A05A]'
                        : 'bg-slate-800 border-slate-700 text-[#E6A05A] hover:bg-slate-700'
                    }`}
                  >
                    <Coins className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Transactions</span>
                  </button>
                </>
              )}
              {user && (
                <>
                  <button
                    onClick={() => onNavigate('profile-referrals')}
                    title="Profile & Referral Wallet (Earn 40%)"
                    className={`flex h-8 items-center gap-1.5 px-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      activeView === 'profile-referrals'
                        ? 'bg-[#E6A05A] text-[#0B1120] border-[#E6A05A]'
                        : 'bg-slate-800 border-slate-700 text-[#E6A05A] hover:bg-slate-700'
                    }`}
                  >
                    <Gift className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Referrals</span>
                  </button>
                  <button
                    onClick={() => onNavigate('my-crypto-payments')}
                    title="My Crypto Payments"
                    className={`flex h-8 items-center gap-1.5 px-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      activeView === 'my-crypto-payments'
                        ? 'bg-[#E6A05A] text-[#0B1120] border-[#E6A05A]'
                        : 'bg-slate-800 border-slate-700 text-[#E6A05A] hover:bg-slate-700'
                    }`}
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">My Payments</span>
                  </button>
                </>
              )}
              <button
                onClick={() => onNavigate('dashboard')}
                title="Open Dashboard"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:text-white cursor-pointer"
              >
                <LayoutDashboard className="h-4 w-4" />
              </button>
              <button
                onClick={onLogout}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
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
