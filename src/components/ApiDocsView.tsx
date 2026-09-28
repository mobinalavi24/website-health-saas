import React, { useState, useEffect } from 'react';
import { Terminal, Key, Plus, Trash2, Copy, Check, ExternalLink, Code2 } from 'lucide-react';
import { apiClient } from '../api/client.ts';
import type { ApiKey } from '../types.ts';

export const ApiDocsView: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    try {
      const keys = await apiClient.getApiKeys();
      setApiKeys(keys);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) return;

    try {
      const res = await apiClient.createApiKey(keyName.trim());
      setCreatedSecret(res.secretToken);
      setKeyName('');
      await loadKeys();
    } catch (err: any) {
      alert(`Error creating API key: ${err.message}`);
    }
  };

  const copyText = (txt: string, id: string) => {
    navigator.clipboard.writeText(txt).then(() => {
      setCopiedEndpoint(id);
      setTimeout(() => setCopiedEndpoint(null), 2000);
    });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
            Developer REST API & API Keys
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Programmatically query uptime metrics, trigger automated website audits, and stream incident history.
          </p>
        </div>

        <button
          onClick={() => {
            setShowKeyModal(true);
            setCreatedSecret(null);
          }}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1120] bg-[#E6A05A] rounded-lg hover:bg-[#cf863c] transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Generate API Key</span>
        </button>
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl space-y-4">
            <h2 className="text-base font-bold text-white">Create Scoped API Key</h2>

            {!createdSecret ? (
              <form onSubmit={handleCreateKey} className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Key Description / Purpose</label>
                  <input
                    type="text"
                    required
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="e.g. GitHub Actions CI/CD Pipeline"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowKeyModal(false)}
                    className="px-3 py-1.5 text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#E6A05A] text-[#0B1120] font-semibold rounded-lg hover:bg-[#cf863c]"
                  >
                    Generate Secret
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-900/60 text-amber-300">
                  Save this key now. For security purposes, it will never be displayed again.
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900 border border-slate-800 font-mono text-white text-[11px] break-all">
                  <span>{createdSecret}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(createdSecret);
                      setCopiedSecret(true);
                      setTimeout(() => setCopiedSecret(false), 2000);
                    }}
                    className="p-1 text-slate-400 hover:text-white shrink-0 ml-2"
                  >
                    {copiedSecret ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShowKeyModal(false)}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active API Keys */}
      <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Active API Keys</h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">Bearer / Header authentication</span>
        </div>

        {apiKeys.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">No API keys created yet.</p>
        ) : (
          <div className="space-y-2">
            {apiKeys.map((k) => (
              <div
                key={k.id}
                className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-semibold text-white block">{k.name}</span>
                  <span className="font-mono text-slate-400 text-[11px]">{k.prefix}••••••••••••••••</span>
                </div>
                <div className="text-right text-[11px] text-slate-400 font-mono">
                  <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* API Reference & cURL Examples */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-white">Interactive Endpoints Reference</h2>

        {/* Endpoint 1: List Websites */}
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono">
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                GET
              </span>
              <span className="text-white font-semibold">/api/v1/websites</span>
            </div>
            <button
              onClick={() => copyText('curl -H "X-API-Key: pv_live_your_key" https://pulsevanguard.com/api/v1/websites', 'ep1')}
              className="flex items-center gap-1 text-slate-400 hover:text-white"
            >
              {copiedEndpoint === 'ep1' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>Copy cURL</span>
            </button>
          </div>
          <p className="text-slate-400">
            Returns all monitored websites with their live status, response times, and 24h uptime metrics.
          </p>
          <div className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 overflow-x-auto">
            curl -X GET https://pulsevanguard.com/api/v1/websites \<br />
            &nbsp;&nbsp;-H "X-API-Key: pv_live_your_key"
          </div>
        </div>

        {/* Endpoint 2: Instant Scan */}
        <div className="rounded-xl border border-slate-800 bg-[#0F172A] p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono">
              <span className="px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 font-bold border border-sky-500/20">
                POST
              </span>
              <span className="text-white font-semibold">/api/scan</span>
            </div>
            <button
              onClick={() => copyText('curl -X POST https://pulsevanguard.com/api/scan -H "Content-Type: application/json" -d \'{"url":"github.com"}\'', 'ep2')}
              className="flex items-center gap-1 text-slate-400 hover:text-white"
            >
              {copiedEndpoint === 'ep2' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>Copy cURL</span>
            </button>
          </div>
          <p className="text-slate-400">
            Executes a real public website audit including DNS resolution, SSL handshake, HTTP latency, and security headers.
          </p>
          <div className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-slate-300 overflow-x-auto">
            curl -X POST https://pulsevanguard.com/api/scan \<br />
            &nbsp;&nbsp;-H "Content-Type: application/json" \<br />
            &nbsp;&nbsp;-d '{`{"url": "github.com"}`}'
          </div>
        </div>
      </div>
    </div>
  );
};
