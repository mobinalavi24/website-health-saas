import React, { useState, useEffect } from 'react';
import {
  Briefcase,
  Plus,
  Users,
  Building,
  ExternalLink,
  Shield,
  Palette,
  Check,
  Globe,
  Share2,
  Copy,
} from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { Organization, Website } from '../types.ts';

interface AgencyWorkspaceViewProps {
  organization: Organization | null;
  websites: Website[];
  onRefreshOrg: () => void;
}

export const AgencyWorkspaceView: React.FC<AgencyWorkspaceViewProps> = ({
  organization,
  websites,
  onRefreshOrg,
}) => {
  const [clients, setClients] = useState<any[]>([]);
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [brandName, setBrandName] = useState(organization?.whiteLabel?.brandName || '');
  const [reportFooter, setReportFooter] = useState(organization?.whiteLabel?.reportFooterText || '');
  const [savingBranding, setSavingBranding] = useState(false);
  const [savedBrandingToast, setSavedBrandingToast] = useState(false);
  const [copiedClientId, setCopiedClientId] = useState<string | null>(null);

  useEffect(() => {
    loadClients();
    if (organization?.whiteLabel) {
      setBrandName(organization.whiteLabel.brandName || '');
      setReportFooter(organization.whiteLabel.reportFooterText || '');
    }
  }, [organization]);

  const loadClients = async () => {
    try {
      const data = await apiClient.getAgencyClients();
      setClients(data);
    } catch (e) {
      console.error('Failed to load agency clients', e);
    }
  };

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;

    try {
      await apiClient.createAgencyClient(newClientName.trim(), newClientEmail.trim());
      setNewClientName('');
      setNewClientEmail('');
      setShowAddClient(false);
      await loadClients();
      onRefreshOrg();
    } catch (err: any) {
      alert(`Error creating client workspace: ${err.message}`);
    }
  };

  const handleSaveBranding = async () => {
    setSavingBranding(true);
    try {
      await apiClient.updateBranding({
        enabled: true,
        brandName,
        reportFooterText: reportFooter,
      });
      setSavedBrandingToast(true);
      setTimeout(() => setSavedBrandingToast(false), 2500);
      onRefreshOrg();
    } catch (err: any) {
      alert(`Error saving branding: ${err.message}`);
    } finally {
      setSavingBranding(false);
    }
  };

  const handleCopyClientLink = (clientId: string) => {
    const origin = window.location.origin;
    const shareUrl = `${origin}/#client-portal-${clientId}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopiedClientId(clientId);
      setTimeout(() => setCopiedClientId(null), 2000);
    });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Agency Workspace & Client Hub
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Segment monitored websites by client, deliver white-labeled audit reports, and grant read-only portal access.
          </p>
        </div>

        <button
          onClick={() => setShowAddClient(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>New Client Workspace</span>
        </button>
      </div>

      {/* Add Client Modal */}
      {showAddClient && (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 max-w-lg">
          <h3 className="text-sm font-semibold text-white">Create Client Workspace</h3>
          <form onSubmit={handleCreateClient} className="space-y-3 text-xs">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Client Business Name</label>
              <input
                type="text"
                required
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                placeholder="e.g. Starlight E-Commerce"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Primary Contact Email</label>
              <input
                type="email"
                value={newClientEmail}
                onChange={(e) => setNewClientEmail(e.target.value)}
                placeholder="contact@clientdomain.com"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddClient(false)}
                className="px-3 py-1.5 text-slate-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-[#E6A05A] text-[#0B1120] font-semibold rounded-lg hover:bg-[#cf863c]"
              >
                Create Workspace
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Clients Grid */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-white">Active Client Accounts ({clients.length})</h2>

        {clients.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-8 text-center text-xs text-slate-400">
            No clients created yet. Add a client to group websites and generate client-ready reports.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map((client) => {
              const assignedSites = websites.filter((w) => w.clientId === client.id);
              return (
                <div
                  key={client.id}
                  className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-white text-sm">{client.name}</h3>
                      <p className="text-[11px] text-slate-400 font-mono">{client.contactEmail || 'No email set'}</p>
                    </div>
                    <span className="text-[10px] font-mono text-[#E6A05A] bg-[#E6A05A]/10 border border-[#E6A05A]/20 px-2 py-0.5 rounded">
                      Client Portal
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 text-xs text-slate-300 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Monitored Websites:</span>
                      <span className="font-mono font-semibold text-white">{assignedSites.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Created:</span>
                      <span className="text-slate-400">{new Date(client.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      onClick={() => handleCopyClientLink(client.id)}
                      className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white"
                    >
                      {copiedClientId === client.id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Link Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy Read-Only Portal Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* White-Label Report Customization */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-[#E6A05A]" />
            <div>
              <h2 className="text-base font-semibold text-white">White-Label Report Branding</h2>
              <p className="text-xs text-slate-400">
                Replace PulseVanguard branding with your own agency identity on all exportable PDF and public web reports.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-emerald-400 font-semibold">INCLUDED IN PRO PLAN ($5/MO)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          <div className="space-y-4">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Your Brand / Agency Name</label>
              <input
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="e.g. Acme Web Sentinel"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">Custom Report Footer Disclaimer</label>
              <textarea
                rows={3}
                value={reportFooter}
                onChange={(e) => setReportFooter(e.target.value)}
                placeholder="Confidential Performance & Health Diagnostics Audit provided by Acme Agency."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveBranding}
                disabled={savingBranding}
                className="px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] font-semibold hover:bg-[#cf863c] transition-colors"
              >
                {savingBranding ? 'Saving...' : 'Save Brand Settings'}
              </button>
              {savedBrandingToast && (
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Branding updated!
                </span>
              )}
            </div>
          </div>

          {/* Live Preview Card */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              Live Preview of Branded Client Header:
            </span>
            <div className="p-4 rounded-lg bg-[#0B1120] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-sm">
                  {brandName || 'Your Agency Name'}
                </span>
                <span className="text-[10px] font-mono text-emerald-400">SLA 99.98% VERIFIED</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Quarterly Website Performance & Security Audit Report
              </p>
              <div className="pt-2 border-t border-slate-800 text-[10px] text-slate-500 italic">
                {reportFooter || 'Confidential Performance Audit Report.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
