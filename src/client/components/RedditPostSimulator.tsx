import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerState, RollResponse } from '../../shared/game.js';
import { formatRarity } from '../../shared/game.js';

interface CreatedFrenzyPost {
  postId: string;
  title: string;
  body: string;
  subredditName: string;
  ownerUsername: string;
  runAs: 'USER';
  entry: 'frenzy';
  flairId: string | null;
  rarity: number;
  isInfinity: boolean;
  createdAt: number;
  expiresAt: number;
}

interface RedditPostSimulatorProps {
  state: PlayerState;
  onClaimed: (response: RollResponse) => void;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  return typeof payload.error === 'string' ? payload.error : fallback;
}

export const RedditPostSimulator: React.FC<RedditPostSimulatorProps> = ({ state, onClaimed }) => {
  const [rarityInput, setRarityInput] = useState(() => String(Math.max(2, Number(state.highestRarity) || 2)));
  const [post, setPost] = useState<CreatedFrenzyPost | null>(null);
  const [loadingPost, setLoadingPost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const previewUrl = useMemo(() => {
    if (!post) return '';
    const url = new URL('frenzy.html', window.location.href);
    url.searchParams.set('previewPostId', post.postId);
    return url.toString();
  }, [post?.postId]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as { type?: unknown; result?: unknown } | null;
      if (message?.type !== 'io-frenzy-preview-claimed' || !message.result || typeof message.result !== 'object') return;
      const result = message.result as RollResponse;
      if (!result.state || !result.orb) return;
      onClaimed(result);
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onClaimed]);

  const createAndViewPost = async () => {
    const selectedRarity = Number(rarityInput.trim());
    if (!Number.isFinite(selectedRarity) || !Number.isInteger(selectedRarity) || selectedRarity < 2) {
      setError('Enter a whole-number rarity of at least 2. Scientific notation is accepted.');
      return;
    }
    setLoadingPost(true);
    setError(null);
    setPost(null);
    try {
      const response = await fetch('/api/frenzy/simulator/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rarity: selectedRarity }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Could not generate the Frenzy post preview.'));
      const created = await response.json() as CreatedFrenzyPost;
      setPost(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not generate the Frenzy post preview.');
    } finally {
      setLoadingPost(false);
    }
  };

  return (
    <div className="io-reddit-simulator-screen mx-auto max-w-6xl space-y-4 text-slate-100">
      <header className="io-reddit-simulator-page-head">
        <div>
          <span>POST INTEGRATION TEST</span>
          <h1>Reddit Post Simulator</h1>
          <p>Generate the same Frenzy post payload and embedded view used by the live publisher. The submission stays local and never reaches Reddit.</p>
        </div>
        <strong>LOCAL ONLY</strong>
      </header>
      <div className="rounded-2xl border border-cyan-500/30 bg-slate-900 px-4 py-3 text-xs text-cyan-100">
        <strong className="font-black uppercase tracking-wider">Real post format · Simulated submission</strong>
        <p className="mt-1 text-slate-400">
          Preview generation does not consume a roll or change your save. Claiming the preview uses the real Frenzy claim engine.
        </p>
      </div>

      <section className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-white">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-400">Orb rarity to publish</span>
            <input
              type="text"
              inputMode="decimal"
              value={rarityInput}
              onChange={event => setRarityInput(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') void createAndViewPost(); }}
              placeholder="e.g. 1000000 or 1e100"
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-mono text-white outline-none focus:border-cyan-400"
            />
          </label>
          <button
            type="button"
            onClick={() => void createAndViewPost()}
            disabled={loadingPost}
            className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-black text-white hover:bg-cyan-500 disabled:cursor-wait disabled:opacity-60"
          >
            {loadingPost ? 'Generating preview…' : post ? 'Create new post' : 'Create and view post'}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          The selected rarity is placed into the exact title, body, stored post record, and embedded Frenzy view used by a real post.
        </p>
        {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      </section>

      {!post ? (
        <div className="rounded-xl border border-slate-300 bg-white p-8 text-center">
          <div className="text-lg font-black text-slate-800">No post preview yet</div>
          <p className="mt-1 text-sm text-slate-500">Choose a rarity above to generate the real Frenzy post payload and embedded view.</p>
        </div>
      ) : (
        <article className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-xl">
          <header className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <strong className="text-slate-900">r/{post.subredditName}</strong>
              <span>·</span>
              <span>Posted by u/{post.ownerUsername}</span>
              <span>·</span>
              <span>preview</span>
            </div>
            <h2 className="mt-2 text-lg font-bold leading-snug text-slate-900">{post.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
              {post.flairId
                ? <span className="rounded bg-indigo-100 px-2 py-1 text-indigo-800">Frenzy flair applied</span>
                : <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">No flair template returned by the Pages mock</span>}
              <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">Custom post entry: {post.entry}</span>
              <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">Run as: {post.runAs}</span>
              <span className="rounded bg-slate-100 px-2 py-1 text-slate-500">Orb: 1/{formatRarity(post.rarity, post.isInfinity)}</span>
            </div>
          </header>

          <iframe
            key={post.postId}
            ref={frameRef}
            src={previewUrl}
            title="Actual Infinity Orbs Frenzy Reddit post preview"
            loading="eager"
            className="block w-full border-0 bg-[#050b13]"
            style={{ height: '1180px' }}
          />

          <details className="border-t border-slate-200 bg-slate-50 px-4 py-3">
            <summary className="cursor-pointer text-xs font-bold text-slate-700">Exact submitted Reddit text</summary>
            <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-700">{post.body}</pre>
          </details>
        </article>
      )}
    </div>
  );
};
