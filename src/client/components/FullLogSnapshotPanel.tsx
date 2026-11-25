import React, { useEffect, useState } from 'react';
import { Activity, Copy, Download, RefreshCw, Trash2 } from 'lucide-react';
import {
  clearFullLogEvents,
  getFullLogSnapshot,
  getFullLogStatus,
  getRecentFullLogEvents,
  type FullLogEvent,
  type FullLogStatus,
} from '../diagnostics/full-log-snapshot.js';

const buttonClass = 'rounded-lg border px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40';
const panelClass = 'rounded-xl border border-slate-800 bg-slate-950/70 p-3';

function eventLine(event: FullLogEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString();
  let detail = '';
  try { detail = JSON.stringify(event.detail); } catch { detail = '[unavailable]'; }
  return '[' + time + '] ' + event.type + (detail && detail !== '{}' ? ' · ' + detail : '');
}

export const FullLogSnapshotPanel: React.FC = () => {
  const [status, setStatus] = useState<FullLogStatus>(() => getFullLogStatus());
  const [feed, setFeed] = useState<FullLogEvent[]>(() => getRecentFullLogEvents(24).slice().reverse());
  const [snapshotText, setSnapshotText] = useState('');
  const [snapshotGeneratedAt, setSnapshotGeneratedAt] = useState('');
  const [message, setMessage] = useState('');

  const refreshFeed = () => {
    setStatus(getFullLogStatus());
    setFeed(getRecentFullLogEvents(24).slice().reverse());
  };

  useEffect(() => {
    refreshFeed();
    const interval = window.setInterval(refreshFeed, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const captureSnapshot = () => {
    const snapshot = getFullLogSnapshot();
    setSnapshotText(JSON.stringify(snapshot, null, 2));
    setSnapshotGeneratedAt(new Date().toLocaleTimeString());
    setMessage('Snapshot generated. Review it, then copy or download the JSON.');
    refreshFeed();
  };

  const copySnapshot = async () => {
    if (!snapshotText) return;
    try {
      await navigator.clipboard.writeText(snapshotText);
      setMessage('Full log snapshot copied. Paste the JSON into your bug report.');
    } catch {
      setMessage('Clipboard access was blocked. Select the JSON below and copy it manually.');
    }
  };

  const downloadSnapshot = () => {
    if (!snapshotText) return;
    const blob = new Blob([snapshotText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'infinity-orbs-full-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setMessage('Snapshot downloaded as a JSON file.');
  };

  const clearLog = () => {
    if (!window.confirm('Clear this browser session log? This does not change your game save.')) return;
    clearFullLogEvents();
    setSnapshotText('');
    setSnapshotGeneratedAt('');
    setMessage('Session log cleared. New events will be recorded from this point onward.');
    refreshFeed();
  };

  return (
    <section className={panelClass + ' border border-cyan-500/30 space-y-3'} data-testid="full-log-snapshot-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-cyan-200">
            <Activity className="h-4 w-4" /> Full Log Snapshot
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-400">
            Records the current browser session in order: button actions, API requests and responses, timings, failed requests,
            state applications, and browser or console errors. The history is bounded to the latest 1,500 events.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass + ' border-cyan-500/40 bg-cyan-600/20 text-cyan-100'} onClick={captureSnapshot}>
            <Activity className="mr-1 inline h-3.5 w-3.5" /> Capture Snapshot
          </button>
          <button type="button" className={buttonClass + ' border-slate-700 bg-slate-900 text-slate-200'} disabled={!snapshotText} onClick={() => void copySnapshot()}>
            <Copy className="mr-1 inline h-3.5 w-3.5" /> Copy JSON
          </button>
          <button type="button" className={buttonClass + ' border-slate-700 bg-slate-900 text-slate-200'} disabled={!snapshotText} onClick={downloadSnapshot}>
            <Download className="mr-1 inline h-3.5 w-3.5" /> Download
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-black/30 px-3 py-2"><div className="text-[9px] uppercase tracking-wider text-slate-500">Events</div><div className="text-sm font-black text-white">{status.eventCount.toLocaleString()}</div></div>
        <div className="rounded-lg bg-black/30 px-3 py-2"><div className="text-[9px] uppercase tracking-wider text-slate-500">Errors</div><div className="text-sm font-black text-rose-300">{status.errorCount.toLocaleString()}</div></div>
        <div className="rounded-lg bg-black/30 px-3 py-2"><div className="text-[9px] uppercase tracking-wider text-slate-500">Warnings</div><div className="text-sm font-black text-amber-200">{status.warningCount.toLocaleString()}</div></div>
        <div className="rounded-lg bg-black/30 px-3 py-2"><div className="text-[9px] uppercase tracking-wider text-slate-500">Dropped old events</div><div className="text-sm font-black text-white">{status.droppedEvents.toLocaleString()}</div></div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live process feed · newest first</div>
        <button type="button" onClick={refreshFeed} className={buttonClass + ' border-slate-800 bg-slate-900/80 text-slate-300'}>
          <RefreshCw className="mr-1 inline h-3 w-3" /> Refresh feed
        </button>
      </div>
      <div className="max-h-56 overflow-auto rounded-lg border border-slate-800 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-slate-300" aria-live="polite">
        {feed.length === 0 ? <div className="p-2 text-slate-500">No events recorded yet.</div> : feed.map(event => (
          <div key={event.sequence} className="border-b border-white/5 py-1 last:border-0 break-words">
            <span className="text-slate-500">#{event.sequence}</span> <span className={event.type.includes('error') ? 'text-rose-300' : 'text-cyan-200'}>{eventLine(event)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] text-slate-500">
          Session began {new Date(status.startedAt).toLocaleString()}{snapshotGeneratedAt ? ' · Snapshot captured ' + snapshotGeneratedAt : ''}
        </div>
        <button type="button" onClick={clearLog} className={buttonClass + ' border-rose-500/30 bg-rose-600/10 text-rose-200'}>
          <Trash2 className="mr-1 inline h-3.5 w-3.5" /> Clear Session Log
        </button>
      </div>
      {snapshotText && (
        <textarea
          readOnly
          value={snapshotText}
          rows={14}
          aria-label="Full log snapshot JSON"
          className="w-full resize-y rounded-lg border border-slate-700 bg-black/60 p-3 font-mono text-[10px] leading-relaxed text-slate-200 outline-none focus:border-cyan-500"
        />
      )}
      <div className="text-[10px] leading-relaxed text-slate-500">
        Privacy filter: credentials, account identifiers, usernames, and user-entered text are redacted. Player-save and private-chat response bodies are omitted.
        The exported file stays on your device unless you choose to share it. Generate the snapshot after reproducing the bug, then paste the JSON here or attach the downloaded file.
      </div>
      {message && <div role="status" className="text-[11px] text-cyan-200">{message}</div>}
    </section>
  );
};
