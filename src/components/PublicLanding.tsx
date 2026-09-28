import React, { useState } from 'react';
import {
  Activity,
  Shield,
  Clock,
  Globe,
  Lock,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Zap,
  Users,
  Building,
  FileText,
  MailCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { PublicScanner } from './PublicScanner.tsx';
import type { SubscriptionPlan } from '../types.ts';

interface PublicLandingProps {
  onOpenAuth: (tab?: 'login' | 'register') => void;
  onOpenContact: () => void;
  onMonitorNow: (url: string) => void;
  plans: SubscriptionPlan[];
  currency: 'USD' | 'EUR' | 'GBP';
  onCurrencyChange: (c: 'USD' | 'EUR' | 'GBP') => void;
}

export const PublicLanding: React.FC<PublicLandingProps> = ({
  onOpenAuth,
  onOpenContact,
  onMonitorNow,
  plans,
  currency,
  onCurrencyChange,
}) => {
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';

  const faqs = [
    {
      q: 'Do you require hosting, cPanel, SSH, or server passwords?',
      a: 'Never. PulseVanguard operates 100% through public DNS, TLS handshakes on port 443, and standard HTTP/HTTPS endpoints. You do not need to provide server credentials, database passwords, or FTP access.',
    },
    {
      q: 'How does PulseVanguard eliminate false downtime alerts?',
      a: 'When an endpoint fails a check, our monitoring engine immediately runs a secondary confirmation retry. Only when multiple probing requests confirm the failure is an incident logged and an alert dispatched.',
    },
    {
      q: 'What is the purpose of Domain Ownership Verification?',
      a: 'Basic uptime and public SSL checks work immediately without verification. For sensitive audits, custom CNAME mapping, or high-frequency 1-minute scheduling, domain ownership can be verified via a standard DNS TXT record or HTML meta tag.',
    },
    {
      q: 'How do Agency White-Label Reports work?',
      a: 'Agencies on our Partner plan can upload their custom agency logo, define their own brand name, and customize the report legal disclaimer. All exportable PDFs and client-facing shared links reflect your agency identity.',
    },
  ];

  return (
    <div className="space-y-24 sm:space-y-32">
      {/* 1. HERO SECTION */}
      <section className="relative pt-12 sm:pt-20 text-center space-y-8">
        {/* Subtle decorative glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-[#E6A05A]/10 blur-[120px] pointer-events-none rounded-full" />

        <div className="relative mx-auto max-w-4xl space-y-4 px-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-300">
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Public Node Probing · No Hosting Passwords Needed</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight text-balance">
            Monitor Every Website. <br />
            <span className="text-[#E6A05A]">From One Dashboard.</span>
          </h1>

          <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed text-balance">
            Track uptime, security, performance, SEO, and website health in one place. Instant public scans and automated continuous 1-minute checks.
          </p>
        </div>

        {/* Free Website Scanner Widget */}
        <div className="relative px-4">
          <PublicScanner onMonitorNow={onMonitorNow} />
        </div>

        {/* High-Fidelity Product UI Mockup */}
        <div className="relative mx-auto max-w-5xl px-4 pt-6">
          <div className="relative rounded-2xl border border-slate-800 bg-[#0F172A] p-3 sm:p-5 shadow-2xl overflow-hidden group">
            {/* Mockup Window Chrome Header */}
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800/80 text-xs">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-500/80" />
                <span className="h-3 w-3 rounded-full bg-amber-500/80" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
                <div className="hidden sm:flex items-center gap-1.5 ml-3 px-3 py-1 rounded-md bg-[#0B1120] text-slate-400 font-mono text-[11px] border border-slate-800">
                  <Lock className="h-3 w-3 text-emerald-400" />
                  <span>https://app.pulsevanguard.com/fleet/production</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium text-[11px]">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  All 42 Systems Operational
                </span>
                <span className="hidden md:inline text-slate-500 font-mono text-[11px]">Interval: 60s</span>
              </div>
            </div>

            {/* Mockup Metric Overview Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="p-3 rounded-xl bg-[#0B1120] border border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Fleet Status</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xl font-bold text-white font-mono">42 / 42</span>
                  <span className="text-[11px] text-emerald-400 font-medium">100% online</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#0B1120] border border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Global Latency</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xl font-bold text-white font-mono">118 ms</span>
                  <span className="text-[11px] text-slate-400 font-mono">p95</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#0B1120] border border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">SSL Expiration</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xl font-bold text-[#E6A05A] font-mono">64 days</span>
                  <span className="text-[11px] text-slate-400">min</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#0B1120] border border-slate-800/80">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Health Index</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-xl font-bold text-emerald-400 font-mono">98/100</span>
                  <span className="text-[11px] text-emerald-400 font-semibold">Grade A+</span>
                </div>
              </div>
            </div>

            {/* Mockup Active Live Monitor Rows */}
            <div className="space-y-2 mb-4">
              <div className="p-3 rounded-xl bg-[#0B1120] border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <div>
                    <span className="font-semibold text-white font-mono">api.cloudscale.io</span>
                    <span className="text-slate-500 ml-2 hidden sm:inline text-[11px]">US-East (Virginia) · DNS Fast</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">200 OK</span>
                  <span className="text-slate-300">142ms</span>
                  <span className="text-slate-400 hidden sm:inline">TLS 1.3 · 82d left</span>
                  <span className="text-emerald-400 font-semibold">99.99%</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#0B1120] border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <div>
                    <span className="font-semibold text-white font-mono">checkout.aurora-shop.com</span>
                    <span className="text-slate-500 ml-2 hidden sm:inline text-[11px]">EU-Central (Frankfurt) · HSTS Active</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">200 OK</span>
                  <span className="text-slate-300">98ms</span>
                  <span className="text-slate-400 hidden sm:inline">TLS 1.3 · 140d left</span>
                  <span className="text-emerald-400 font-semibold">100.0%</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#0B1120] border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  <div>
                    <span className="font-semibold text-white font-mono">auth.nexus-saas.com</span>
                    <span className="text-slate-500 ml-2 hidden sm:inline text-[11px]">AP-East (Tokyo) · DMARC Verified</span>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">200 OK</span>
                  <span className="text-slate-300">112ms</span>
                  <span className="text-slate-400 hidden sm:inline">TLS 1.3 · 54d left</span>
                  <span className="text-emerald-400 font-semibold">99.98%</span>
                </div>
              </div>
            </div>

            {/* Mockup Interactive Footer Callout */}
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-[#0B1120] to-[#1E293B]/80 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-[#E6A05A] animate-ping" />
                <span className="font-semibold text-white">Multi-Region Probes Active</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400">DNS, SSL Handshake, Security Headers & Crawling</span>
              </div>
              <button
                onClick={() => onOpenAuth('register')}
                className="w-full sm:w-auto px-4 py-1.5 rounded-lg bg-[#E6A05A] text-[#0B1120] font-semibold hover:bg-[#cf863c] transition-colors"
              >
                Launch Unified Dashboard
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 2. CORE CAPABILITIES / FEATURES */}
      <section id="features" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Comprehensive Website Health Diagnostics
          </h2>
          <p className="text-sm text-slate-400">
            A unified suite of network, cryptographic, and performance monitors operating completely outside your server.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1: Uptime & Speed */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-3 hover:border-slate-700 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Activity className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-white">HTTP & HTTPS Uptime</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              1-minute interval checks with automated retry confirmation. Track TTFB latency, HTTP status codes, and redirect chains.
            </p>
          </div>

          {/* Card 2: SSL & TLS */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-3 hover:border-slate-700 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-[#E6A05A]/10 border border-[#E6A05A]/20 text-[#E6A05A] flex items-center justify-center">
              <Lock className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-white">SSL & Certificate Expiry</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Verify certificate chain validity, issuer CAs, cipher suites, and receive automated warnings 14 and 7 days prior to expiration.
            </p>
          </div>

          {/* Card 3: Security Headers */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-3 hover:border-slate-700 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Shield className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-white">Security Headers & HSTS</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Detect missing HSTS policies, Content-Security-Policy (CSP), and X-Frame-Options to safeguard visitors from clickjacking and XSS.
            </p>
          </div>

          {/* Card 4: DNS & Email */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-3 hover:border-slate-700 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center">
              <MailCheck className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-white">DNS & Email Protection</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Monitor A, AAAA, MX, and NS records. Detect SPF and DMARC misconfigurations to stop domain email spoofing.
            </p>
          </div>

          {/* Card 5: SEO Health */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-3 hover:border-slate-700 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
              <Globe className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-white">SEO & Crawler Readiness</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Automated crawling for robots.txt, sitemap.xml accessibility, canonical links, title tag lengths, and image alt attributes.
            </p>
          </div>

          {/* Card 6: Agency White-Label */}
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-3 hover:border-slate-700 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center">
              <Building className="h-5 w-5" />
            </div>
            <h3 className="text-base font-semibold text-white">Agency White-Label Hub</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Deliver branded PDF and web reports with your custom agency logo. Organize client websites with read-only portal access.
            </p>
          </div>
        </div>
      </section>

      {/* 3. HOW IT WORKS */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            How PulseVanguard Works
          </h2>
          <p className="text-sm text-slate-400">
            A non-intrusive mechanism-to-outcome architecture designed for speed, security, and developer trust.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 rounded-xl border border-slate-800 bg-[#0F172A] space-y-3">
            <span className="text-xs font-mono text-[#E6A05A] font-semibold">01. Public Endpoint Entry</span>
            <h3 className="text-base font-bold text-white">Zero Credentials Required</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Enter any public domain. We never ask for server SSH keys, database logins, or cPanel passwords.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-slate-800 bg-[#0F172A] space-y-3">
            <span className="text-xs font-mono text-[#E6A05A] font-semibold">02. Multi-Region Probing</span>
            <h3 className="text-base font-bold text-white">Independent Network Probes</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Global nodes perform concurrent DNS lookups, TLS port 443 handshakes, and HTTP latency measurements.
            </p>
          </div>

          <div className="p-6 rounded-xl border border-slate-800 bg-[#0F172A] space-y-3">
            <span className="text-xs font-mono text-[#E6A05A] font-semibold">03. Alerting & SLA Reports</span>
            <h3 className="text-base font-bold text-white">Instant Remediation Insights</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Receive notifications via email or webhooks before users notice downtime. Export white-labeled PDF audits.
            </p>
          </div>
        </div>
      </section>

      {/* 4. INTERNATIONAL PRICING SECTION */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Transparent International Pricing
          </h2>
          <p className="text-sm text-slate-400">
            Choose monthly or annual billing in USD ($), EUR (€), or GBP (£). Upgrade or cancel anytime.
          </p>

          <div className="flex items-center justify-center gap-3 pt-2">
            {/* Interval Toggle */}
            <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
              <button
                onClick={() => setBillingInterval('monthly')}
                className={`px-3 py-1 rounded transition-colors ${
                  billingInterval === 'monthly' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingInterval('annual')}
                className={`px-3 py-1 rounded transition-colors flex items-center gap-1.5 ${
                  billingInterval === 'annual' ? 'bg-slate-800 text-[#E6A05A] font-medium' : 'text-slate-400'
                }`}
              >
                <span>Annual</span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded">
                  2 Mo Free
                </span>
              </button>
            </div>

            {/* Currency Selector */}
            <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono">
              {(['USD', 'EUR', 'GBP'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => onCurrencyChange(c)}
                  className={`px-2 py-1 rounded transition-colors ${
                    currency === c ? 'bg-slate-800 text-[#E6A05A] font-semibold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((p) => {
            const price = billingInterval === 'annual'
              ? p.pricing[currency].annual
              : p.pricing[currency].monthly;

            return (
              <div
                key={p.id}
                className={`rounded-2xl border p-6 flex flex-col justify-between ${
                  p.id === 'pro'
                    ? 'border-[#E6A05A] bg-[#0F172A] shadow-xl shadow-[#E6A05A]/5'
                    : 'border-slate-800 bg-[#0F172A]/70'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      {p.badge}
                    </span>
                    {p.id === 'pro' && (
                      <span className="text-[10px] font-mono text-[#E6A05A] bg-[#E6A05A]/10 border border-[#E6A05A]/20 px-2 py-0.5 rounded">
                        RECOMMENDED
                      </span>
                    )}
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-white">{p.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{p.targetAudience}</p>
                  </div>

                  <div className="py-2">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold font-mono text-white tabular-nums">
                        {currencySymbol}{price}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        / {billingInterval === 'annual' ? 'yr' : 'mo'}
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                    {p.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-6">
                  <button
                    onClick={() => onOpenAuth('register')}
                    className={`w-full py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      p.id === 'pro'
                        ? 'bg-[#E6A05A] text-[#0B1120] hover:bg-[#cf863c]'
                        : 'bg-slate-800 text-white hover:bg-slate-700'
                    }`}
                  >
                    Start with {p.name}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 5. ATTRIBUTABLE TESTIMONIALS WITH REAL AVATARS */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="text-center space-y-2 max-w-xl mx-auto">
          <h2 className="text-2xl font-bold tracking-tight text-white">
            Trusted by DevOps Leaders & Agencies
          </h2>
          <p className="text-xs text-slate-400">
            Real reliability outcomes reported across 50,000+ monitored public domains.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Testimonial 1 */}
          <div className="p-6 rounded-2xl border border-slate-800 bg-[#0F172A] space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed italic">
              "We manage 45 client eCommerce portals. PulseVanguard caught a critical SSL expiration 12 days before customer checkout was disrupted. The white-label executive PDF reports save us 10+ engineering hours every month."
            </p>
            <div className="flex items-center gap-3 pt-2 border-t border-slate-800">
              <img
                src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=120&h=120&q=80"
                alt="Sarah Jenkins"
                className="h-10 w-10 rounded-full object-cover border border-slate-700"
              />
              <div>
                <span className="text-xs font-bold text-white block">Sarah Jenkins</span>
                <span className="text-[11px] text-slate-400">Head of Operations, Apex Scale Digital</span>
              </div>
            </div>
          </div>

          {/* Testimonial 2 */}
          <div className="p-6 rounded-2xl border border-slate-800 bg-[#0F172A] space-y-4">
            <p className="text-xs text-slate-300 leading-relaxed italic">
              "The zero-server-credential approach was essential for our enterprise compliance audit. We have continuous 1-minute monitoring and SPF/DMARC checks running across our entire microservice fleet with zero security overhead."
            </p>
            <div className="flex items-center gap-3 pt-2 border-t border-slate-800">
              <img
                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&h=120&q=80"
                alt="Alexandre Sterling"
                className="h-10 w-10 rounded-full object-cover border border-slate-700"
              />
              <div>
                <span className="text-xs font-bold text-white block">Alexandre Sterling</span>
                <span className="text-[11px] text-slate-400">Principal Systems Architect, Meridian Net</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. TECHNICAL FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 space-y-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-white">Frequently Asked Questions</h2>
          <p className="text-xs text-slate-400">Everything you need to know about our external probing architecture.</p>
        </div>

        <div className="space-y-3">
          {faqs.map((f, idx) => {
            const isOpen = openFaq === idx;
            return (
              <div
                key={idx}
                className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 transition-colors"
              >
                <button
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                  className="w-full flex items-center justify-between text-left text-xs font-semibold text-white"
                >
                  <span>{f.q}</span>
                  {isOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {isOpen && (
                  <p className="mt-3 pt-3 border-t border-slate-800 text-xs text-slate-300 leading-relaxed">
                    {f.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 7. BOTTOM CTA */}
      <section className="mx-auto max-w-5xl px-4 pb-12">
        <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-[#0F172A] to-slate-900 p-8 sm:p-12 text-center space-y-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Ready to Protect Your Website Uptime?
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto leading-relaxed">
            Start monitoring your public endpoints in 60 seconds. No credit card required for Starter Free tier.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => onOpenAuth('register')}
              className="px-6 py-3 rounded-xl bg-[#E6A05A] text-[#0B1120] font-bold text-xs sm:text-sm hover:bg-[#cf863c] transition-colors"
            >
              Get Started Free Today
            </button>
            <button
              onClick={onOpenContact}
              className="px-6 py-3 rounded-xl bg-slate-800 text-white font-medium text-xs sm:text-sm hover:bg-slate-700 transition-colors"
            >
              Talk to Solutions Engineering
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
