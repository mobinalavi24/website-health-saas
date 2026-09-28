import React, { useState } from 'react';
import { X, Globe, Plus, Loader2 } from 'lucide-react';
import type { Website } from '../types.ts';

interface AddWebsiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (data: Partial<Website>) => Promise<void>;
  prefilledUrl?: string;
}

export const AddWebsiteModal: React.FC<AddWebsiteModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  prefilledUrl = '',
}) => {
  const [url, setUrl] = useState(prefilledUrl);
  const [name, setName] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [groupName, setGroupName] = useState('Production');
  const [tagsInput, setTagsInput] = useState('Web, Core');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Please provide a valid website URL');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      await onAdd({
        url: url.trim(),
        name: name.trim() || undefined,
        intervalMinutes,
        groupName: groupName.trim() || 'Default',
        tags,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add website');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0F172A] p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E6A05A]/10 text-[#E6A05A]">
              <Globe className="h-4 w-4" />
            </div>
            <h2 className="text-base font-bold text-white">Add Website to Monitor</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/60 text-xs text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="text-slate-300 font-semibold block mb-1">
              Website URL or Domain <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              We verify availability from external nodes. No hosting passwords needed.
            </span>
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Display Label / Name (Optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Corporate Portal"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-[#E6A05A]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Check Frequency</label>
              <select
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              >
                <option value={1}>1 Minute</option>
                <option value={5}>5 Minutes</option>
                <option value={15}>15 Minutes</option>
                <option value={60}>1 Hour</option>
              </select>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">Project Group</label>
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Production"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
              />
            </div>
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Tags (Comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="SaaS, Production, API"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-[#E6A05A]"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E6A05A] text-[#0B1120] text-xs font-semibold hover:bg-[#cf863c] transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  <span>Start Monitoring</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
