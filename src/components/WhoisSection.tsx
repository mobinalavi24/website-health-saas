import React, { useState, useEffect } from 'react';
import {
  Globe,
  RefreshCw,
  Calendar,
  Shield,
  Server,
  Building2,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import type { WhoisLookupResult, WhoisContactInfo } from '../types.ts';
import { apiClient } from '../api/client.ts';

interface WhoisSectionProps {
  websiteId: string;
  domain: string;
  initialData?: WhoisLookupResult | null;
  onDataUpdated?: (data: WhoisLookupResult) => void;
}

export const WhoisSection: React.FC<WhoisSectionProps> = ({
  websiteId,
  domain,
  initialData,
  onDataUpdated,
}) => {
  const [data, setData] = useState<WhoisLookupResult | null>(initialData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedNs, setCopiedNs] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const [showRawWhois, setShowRawWhois] = useState(true);

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setError(null);
    }
  }, [initialData]);

  useEffect(() => {
    if (!initialData && websiteId && !data && !loading) {
      handleFetchWhois(false);
    }
  }, [websiteId, domain]);

  const handleFetchWhois = async (forceRefresh = false) => {
    if (!websiteId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getWebsiteWhois(websiteId, forceRefresh);
      setData(res);
      if (onDataUpdated) {
        onDataUpdated(res);
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to retrieve WHOIS registration data.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return 'Not available';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }) + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleCopyNameServers = () => {
    if (!data?.nameServers?.length) return;
    navigator.clipboard.writeText(data.nameServers.join('\n')).then(() => {
      setCopiedNs(true);
      setTimeout(() => setCopiedNs(false), 2000);
    });
  };

  const renderContactCard = (title: string, contact: WhoisContactInfo | null | undefined) => {
    const isRedacted = Boolean(contact?.redacted);
    return (
      <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-[#E6A05A]" />
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider">{title}</h4>
          </div>
          {isRedacted && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20">
              <Lock className="h-2.5 w-2.5" /> Privacy Redacted
            </span>
          )}
        </div>

        {!contact ? (
          <div className="py-4 text-center text-xs text-slate-500 font-mono">
            Not available
          </div>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Organization</span>
              <span className="font-mono text-slate-200 text-right break-all">
                {contact.organization || (isRedacted ? 'Redacted for Privacy' : 'Not available')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Contact Name</span>
              <span className="font-mono text-slate-200 text-right break-all">
                {contact.name || (isRedacted ? 'Redacted for Privacy' : 'Not available')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Country / State</span>
              <span className="font-mono text-slate-200 text-right">
                {[contact.city, contact.state, contact.country, contact.postalCode].filter(Boolean).join(', ') || 'Not available'}
              </span>
            </div>
            {contact.street && (
              <div className="flex items-start justify-between gap-2">
                <span className="text-slate-400 shrink-0">Address</span>
                <span className="font-mono text-slate-200 text-right break-words">
                  {contact.street}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Email</span>
              <span className="font-mono text-slate-200 text-right break-all">
                {contact.email || (isRedacted ? 'Redacted for Privacy' : 'Not available')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Phone</span>
              <span className="font-mono text-slate-200 text-right">
                {contact.phone || 'Not available'}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-[#E6A05A]" />
            <h3 className="text-base font-bold text-white">
              Domain WHOIS & Registry Ownership
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Authoritative registrar, registration lifecycle dates, domain status flags, and delegation records for{' '}
            <span className="font-mono text-slate-200 font-semibold">{domain}</span>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data?.checkedAt && (
            <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
              <Clock className="h-3.5 w-3.5 text-slate-500" />
              Last checked: {new Date(data.checkedAt).toLocaleTimeString()}
              {data.cached ? ' (Cached)' : ''}
            </span>
          )}
          <button
            onClick={() => handleFetchWhois(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-semibold hover:bg-[#cf863c] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Checking WHOIS...' : data ? 'Refresh WHOIS' : 'Check WHOIS'}</span>
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 rounded-xl border border-rose-800/80 bg-rose-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white block">WHOIS Lookup Notice</span>
              <span>{error}</span>
            </div>
          </div>
          <button
            onClick={() => handleFetchWhois(true)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold shrink-0 transition-colors"
          >
            Retry Lookup
          </button>
        </div>
      )}

      {/* Provider Fallback Notice if any */}
      {data?.providerError && (
        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>{data.providerError}</span>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !data && (
        <div className="py-12 text-center space-y-3">
          <RefreshCw className="h-7 w-7 text-[#E6A05A] animate-spin mx-auto" />
          <p className="text-xs text-slate-300 font-medium">
            Querying domain registry WHOIS records for <span className="font-mono text-white">{domain}</span>...
          </p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !data && !error && (
        <div className="py-10 text-center space-y-3 border border-slate-800/80 rounded-xl bg-slate-900/40">
          <Globe className="h-8 w-8 text-slate-500 mx-auto" />
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-white">No WHOIS Record Loaded Yet</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Click "Check WHOIS" to retrieve registrar details, domain expiration dates, status codes, and name servers.
            </p>
          </div>
          <button
            onClick={() => handleFetchWhois(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-semibold hover:bg-[#cf863c] transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Check WHOIS</span>
          </button>
        </div>
      )}

      {/* Main WHOIS Data Display */}
      {data && (
        <div className="space-y-6">
          {/* Top Overview Cards: Domain, Registrar, Lifecycle Dates */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Domain & DNSSEC */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">
                Domain Name
              </span>
              <div className="text-sm font-bold text-white font-mono break-all">
                {data.domainName || domain}
              </div>
              <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-400">
                <span>DNSSEC:</span>
                <span className="font-mono text-slate-200">
                  {data.dnssec || 'Not available'}
                </span>
              </div>
              {data.whoisServer && (
                <div className="flex items-center gap-2 text-[11px] text-slate-400 truncate" title={data.whoisServer}>
                  <span>WHOIS Server:</span>
                  <span className="font-mono text-slate-300 truncate">{data.whoisServer}</span>
                </div>
              )}
            </div>

            {/* Registrar */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">
                  Domain Registrar
                </span>
                <Building2 className="h-3.5 w-3.5 text-[#E6A05A]" />
              </div>
              <div className="text-sm font-bold text-white break-words">
                {data.registrar || 'Not available'}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400 font-mono">
                {data.registrarIanaId && <span>IANA ID: {data.registrarIanaId}</span>}
                {data.registrarUrl && (
                  <a
                    href={data.registrarUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-[#E6A05A] hover:underline"
                  >
                    <span>Website</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Registration & Last Updated */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">
                  Registration & Updated
                </span>
                <Calendar className="h-3.5 w-3.5 text-slate-400" />
              </div>
              <div className="text-xs text-slate-300 space-y-1">
                <div>
                  <span className="text-slate-500 block text-[10px]">Registered:</span>
                  <span className="font-mono text-white font-semibold">
                    {formatDate(data.registrationDate)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Last Updated:</span>
                  <span className="font-mono text-slate-200">
                    {formatDate(data.updatedDate)}
                  </span>
                </div>
              </div>
            </div>

            {/* Expiration Date */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">
                  Registry Expiration
                </span>
                {typeof data.daysUntilExpiration === 'number' && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                      data.daysUntilExpiration <= 14
                        ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        : data.daysUntilExpiration <= 45
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {data.daysUntilExpiration > 0
                      ? `${data.daysUntilExpiration} days left`
                      : 'Expired'}
                  </span>
                )}
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {formatDate(data.expirationDate)}
              </div>
              {data.abuseContactEmail && (
                <div className="text-[11px] text-slate-400 pt-1 truncate" title={data.abuseContactEmail}>
                  Abuse Email: <span className="font-mono text-slate-300">{data.abuseContactEmail}</span>
                </div>
              )}
              {data.abuseContactPhone && (
                <div className="text-[11px] text-slate-400 truncate" title={data.abuseContactPhone}>
                  Abuse Phone: <span className="font-mono text-slate-300">{data.abuseContactPhone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Domain Status Codes & Name Servers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Domain Status Codes */}
            <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-[#E6A05A]" />
                  <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
                    EPP / Registry Status Codes ({data.statusCodes?.length || 0})
                  </h4>
                </div>
              </div>
              {!data.statusCodes || data.statusCodes.length === 0 ? (
                <p className="text-xs text-slate-500 font-mono py-2">Not available</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.statusCodes.map((code, idx) => (
                    <span
                      key={`${code}-${idx}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono bg-slate-950 border border-slate-800 text-slate-200"
                    >
                      <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                      <span>{code}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Name Servers */}
            <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-[#E6A05A]" />
                  <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
                    Authoritative Name Servers ({data.nameServers?.length || 0})
                  </h4>
                </div>
                {data.nameServers && data.nameServers.length > 0 && (
                  <button
                    onClick={handleCopyNameServers}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 transition-colors"
                  >
                    {copiedNs ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                )}
              </div>
              {!data.nameServers || data.nameServers.length === 0 ? (
                <p className="text-xs text-slate-500 font-mono py-2">Not available</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {data.nameServers.map((ns, idx) => (
                    <div
                      key={`${ns}-${idx}`}
                      className="px-3 py-1.5 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 truncate"
                    >
                      {ns}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Registrant, Administrative, and Technical Contacts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {renderContactCard('Registrant Contact', data.registrant)}
            {renderContactCard('Administrative Contact', data.adminContact)}
            {renderContactCard('Technical Contact', data.techContact)}
          </div>

          {/* Complete Raw WHOIS Registry / Registrar Output (like whois.com) */}
          {data.rawText && (
            <div className="rounded-xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
                <button
                  type="button"
                  onClick={() => setShowRawWhois((v) => !v)}
                  className="flex items-center gap-2 text-xs font-semibold text-white uppercase tracking-wider cursor-pointer"
                >
                  <Server className="h-4 w-4 text-[#E6A05A]" />
                  <span>Full Raw WHOIS Record (Registry & Registrar Output)</span>
                  <span className="text-[10px] font-mono text-slate-400 normal-case">
                    ({showRawWhois ? 'Hide' : 'Show'})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!data.rawText) return;
                    navigator.clipboard.writeText(data.rawText).then(() => {
                      setCopiedRaw(true);
                      setTimeout(() => setCopiedRaw(false), 2000);
                    });
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 transition-colors cursor-pointer"
                >
                  {copiedRaw ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy Raw WHOIS</span>
                    </>
                  )}
                </button>
              </div>
              {showRawWhois && (
                <pre className="p-4 text-[11px] leading-relaxed font-mono text-slate-300 bg-slate-950/90 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
                  {data.rawText}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
