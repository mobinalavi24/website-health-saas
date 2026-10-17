import React, { useState } from 'react';
import {
  Activity,
  LayoutDashboard,
  Coins,
  User as UserIcon,
  Wallet,
  MessageSquare,
  Menu,
  X,
} from 'lucide-react';
import type { User, Organization } from '../types.ts';

interface NavbarProps {
  user: User | null;
  organization: Organization | null;
  activeView: string;
  onNavigate: (view: string) => void;
  onOpenAuth: (initialTab?: 'login' | 'register') => void;
  onLogout: () => void;
  currency?: string;
  onCurrencyChange?: (c: any) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  organization,
  activeView,
  onNavigate,
  onOpenAuth,
  onLogout,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (view: string) => {
    setMobileMenuOpen(false);
    onNavigate(view);
  };

  const activePaidEntitlements =
    organization?.entitlementSummary?.activeEntitlements?.length || 0;
  const totalCapacity =
    organization?.entitlementSummary?.totalActiveCapacity ??
    organization?.maxWebsites ??
    1;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-[#0B1120]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Brand wordmark */}
        <button
          onClick={() => handleNavClick(user ? 'dashboard' : 'home')}
          className="group flex items-center gap-2 text-left focus:outline-none cursor-pointer"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E6A05A]/10 border border-[#E6A05A]/30 text-[#E6A05A]">
            <Activity className="h-4 w-4" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white group-hover:text-[#E6A05A] transition-colors">
            PulseVanguard
          </span>
        </button>

        {/* Zone 2: Standardized Left-Side Primary Navigation Links */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-slate-300">
          {!user ? (
            <>
              <button
                onClick={() => handleNavClick('home')}
                className={`transition-colors hover:text-white cursor-pointer ${
                  activeView === 'home' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => handleNavClick('features')}
                className={`transition-colors hover:text-white cursor-pointer ${
                  activeView === 'features' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                Capabilities
              </button>
              <button
                onClick={() => handleNavClick('how-it-works')}
                className={`transition-colors hover:text-white cursor-pointer ${
                  activeView === 'how-it-works' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                How It Works
              </button>
              <button
                onClick={() => handleNavClick('pricing')}
                className={`transition-colors hover:text-white cursor-pointer ${
                  activeView === 'pricing' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                Pricing
              </button>
              <button
                onClick={() => handleNavClick('reports')}
                className={`transition-colors hover:text-white flex items-center gap-1.5 cursor-pointer ${
                  activeView === 'reports' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 text-[#E6A05A]" />
                <span>Reports</span>
              </button>
              <button
                onClick={() => handleNavClick('security')}
                className={`transition-colors hover:text-white cursor-pointer ${
                  activeView === 'security' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                Security & Trust
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleNavClick('dashboard')}
                className={`transition-colors hover:text-white cursor-pointer ${
                  activeView === 'dashboard' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                Monitored Sites
              </button>
              <button
                onClick={() => handleNavClick('reports')}
                className={`transition-colors hover:text-white flex items-center gap-1.5 cursor-pointer ${
                  activeView === 'reports' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5 text-[#E6A05A]" />
                <span>Reports</span>
              </button>
              <button
                onClick={() => handleNavClick('billing')}
                className={`transition-colors hover:text-white cursor-pointer ${
                  activeView === 'billing' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                Plan & Limits
              </button>
              <button
                onClick={() => handleNavClick('profile-referrals')}
                className={`transition-colors hover:text-white flex items-center gap-1.5 cursor-pointer ${
                  activeView === 'profile-referrals' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                <UserIcon className="h-3.5 w-3.5 text-[#E6A05A]" />
                <span>My Profile</span>
              </button>
              <button
                onClick={() => handleNavClick('my-crypto-payments')}
                className={`transition-colors hover:text-white cursor-pointer ${
                  activeView === 'my-crypto-payments' ? 'text-[#E6A05A] font-semibold' : ''
                }`}
              >
                My Crypto Payments
              </button>
              {(user.role === 'admin' || user.role === 'super_admin') && (
                <button
                  onClick={() => handleNavClick('admin-withdrawals')}
                  className={`transition-colors hover:text-white flex items-center gap-1.5 cursor-pointer ${
                    activeView === 'admin-withdrawals' ? 'text-[#E6A05A] font-semibold' : ''
                  }`}
                >
                  <Wallet className="h-3.5 w-3.5 text-[#E6A05A]" />
                  <span>Withdrawals</span>
                </button>
              )}
              {user.role === 'super_admin' && (
                <button
                  onClick={() => handleNavClick('admin')}
                  className={`transition-colors hover:text-white cursor-pointer ${
                    activeView === 'admin' ? 'text-[#E6A05A] font-semibold' : ''
                  }`}
                >
                  Admin Control
                </button>
              )}
            </>
          )}
        </nav>

        {/* Zone 3: Right-Side Header Actions & Mobile Toggle */}
        <div className="flex items-center gap-2.5">
          {!user ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenAuth('login')}
                className="px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                Sign In
              </button>
              <button
                onClick={() => onOpenAuth('register')}
                className="px-3.5 py-1.5 text-sm font-medium text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors whitespace-nowrap cursor-pointer"
              >
                Get Started Free
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleNavClick('profile-referrals')}
                title="My Profile & Referral Wallet"
                className="hidden lg:flex flex-col text-right hover:opacity-90 transition-opacity cursor-pointer"
              >
                <span className="text-xs font-medium text-white truncate max-w-[130px]">
                  {user.name}
                </span>
                {organization?.planId === 'free' && activePaidEntitlements === 0 ? (
                  <span className="text-[11px] font-medium">
                    {organization.trialEndsAt && new Date() >= new Date(organization.trialEndsAt) ? (
                      <span className="text-rose-400 font-semibold">Trial Expired</span>
                    ) : (
                      <span className="text-[#E6A05A]">Free Trial (1 site)</span>
                    )}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400 capitalize">
                    {organization?.planId || 'pro'} · {totalCapacity} sites
                  </span>
                )}
              </button>

              {(user.role === 'admin' || user.role === 'super_admin') && (
                <button
                  onClick={() => handleNavClick('admin-crypto-transactions')}
                  title="Crypto Transactions (Admin)"
                  className={`hidden sm:flex h-8 items-center gap-1.5 px-2.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    activeView === 'admin-crypto-transactions'
                      ? 'bg-[#E6A05A] text-[#0B1120] border-[#E6A05A]'
                      : 'bg-slate-800 border-slate-700 text-[#E6A05A] hover:bg-slate-700'
                  }`}
                >
                  <Coins className="h-3.5 w-3.5" />
                  <span>Transactions</span>
                </button>
              )}

              <button
                onClick={() => handleNavClick('dashboard')}
                title="Open Dashboard"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:text-white cursor-pointer"
              >
                <LayoutDashboard className="h-4 w-4" />
              </button>

              <button
                onClick={onLogout}
                className="hidden sm:inline-block px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          )}

          {/* Mobile Navigation Menu Button */}
          <button
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle Navigation Menu"
            className="md:hidden flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-800 bg-[#0B1120] px-4 py-3 space-y-1.5 text-xs font-medium">
          {!user ? (
            <>
              <button
                onClick={() => handleNavClick('home')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'home' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => handleNavClick('features')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'features' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                Capabilities
              </button>
              <button
                onClick={() => handleNavClick('how-it-works')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'how-it-works' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                How It Works
              </button>
              <button
                onClick={() => handleNavClick('pricing')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'pricing' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                Pricing
              </button>
              <button
                onClick={() => handleNavClick('reports')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'reports' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                Reports
              </button>
              <button
                onClick={() => handleNavClick('security')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'security' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                Security & Trust
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleNavClick('dashboard')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'dashboard' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                Monitored Sites
              </button>
              <button
                onClick={() => handleNavClick('reports')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'reports' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                Reports
              </button>
              <button
                onClick={() => handleNavClick('billing')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'billing' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                Plan & Limits
              </button>
              <button
                onClick={() => handleNavClick('profile-referrals')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'profile-referrals' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                My Profile
              </button>
              <button
                onClick={() => handleNavClick('my-crypto-payments')}
                className={`block w-full text-left px-3 py-2 rounded-lg ${
                  activeView === 'my-crypto-payments' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                }`}
              >
                My Crypto Payments
              </button>
              {(user.role === 'admin' || user.role === 'super_admin') && (
                <>
                  <button
                    onClick={() => handleNavClick('admin-withdrawals')}
                    className={`block w-full text-left px-3 py-2 rounded-lg ${
                      activeView === 'admin-withdrawals'
                        ? 'bg-slate-800 text-[#E6A05A]'
                        : 'text-slate-300'
                    }`}
                  >
                    Withdrawals
                  </button>
                  <button
                    onClick={() => handleNavClick('admin-crypto-transactions')}
                    className={`block w-full text-left px-3 py-2 rounded-lg ${
                      activeView === 'admin-crypto-transactions'
                        ? 'bg-slate-800 text-[#E6A05A]'
                        : 'text-slate-300'
                    }`}
                  >
                    Transactions
                  </button>
                </>
              )}
              {user.role === 'super_admin' && (
                <button
                  onClick={() => handleNavClick('admin')}
                  className={`block w-full text-left px-3 py-2 rounded-lg ${
                    activeView === 'admin' ? 'bg-slate-800 text-[#E6A05A]' : 'text-slate-300'
                  }`}
                >
                  Admin Control
                </button>
              )}
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onLogout();
                }}
                className="block w-full text-left px-3 py-2 rounded-lg text-rose-400 hover:bg-slate-800"
              >
                Sign Out
              </button>
            </>
          )}
        </div>
      )}
    </header>
  );
};
