import React, { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  Share2,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Gem,
} from 'lucide-react';
import type { PlayerState } from '../../shared/game.js';
import {
  visibleContinuumTiers,
  getOrbInfo,
  coinsForRarity,
  formatRarity,
  formatNumber,
  bestCodexChain,
  nextCodexChainRarity,
  chainPatcherShardCost,
} from '../../shared/game.js';
import { sound } from '../sound.js';
import { RarityOrbIcon } from './RarityOrbIcon.js';

interface CollectionSectionProps {
  state: PlayerState;
  onOpenShareModal: (rarity: number, isInfinity?: boolean) => void;
  onBuyChainPatcher: () => Promise<void>;
}

interface CollectionPageItem {
  rarity: number;
  count: number;
  isInfinity?: boolean;
}

interface CollectionPageResponse {
  items: CollectionPageItem[];
  total: number;
  offset: number;
  limit: number;
}

const PAGE_SIZE = 60;

export const CollectionSection: React.FC<CollectionSectionProps> = ({
  state,
  onOpenShareModal,
  onBuyChainPatcher,
}) => {
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'rarity_desc' | 'rarity_asc' | 'count'>('rarity_desc');
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<CollectionPageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [chainPatcherNow, setChainPatcherNow] = useState(Date.now());
  const [chainPatcherBuying, setChainPatcherBuying] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setChainPatcherNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const fmt = (n: number) => formatNumber(n);
  const visibleTiers = useMemo(
    () => visibleContinuumTiers(state.highestRarity || 0),
    [state.highestRarity],
  );
  const codexChain = Math.max(0, state.codexChain ?? 0);
  const currentChainLength = Math.max(0, Math.floor(Number(state.codexChain ?? bestCodexChain(state.collection).length) || 0));
  const storedPatcherRarity = Math.floor(Number(state.chainPatcherNextRarity ?? 0) || 0);
  const patcherCharged = storedPatcherRarity >= 2;
  const patcherTarget = patcherCharged
    ? storedPatcherRarity
    : state.chainPatcherSuggestedRarity !== undefined
      ? state.chainPatcherSuggestedRarity
      : nextCodexChainRarity(state.collection);
  const patcherCost = patcherTarget == null || patcherCharged
    ? 0
    : chainPatcherShardCost(patcherTarget);
  const patcherCooldownRemaining = Math.max(
    0,
    Math.floor(Number(state.chainPatcherCooldownUntil ?? 0) || 0) - chainPatcherNow,
  );
  const patcherCooldownText = (() => {
    const totalSeconds = Math.ceil(patcherCooldownRemaining / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  })();

  const handleBuyChainPatcherClick = async () => {
    if (chainPatcherBuying) return;
    setChainPatcherBuying(true);
    try {
      await onBuyChainPatcher();
    } finally {
      setChainPatcherBuying(false);
    }
  };

  const tiersList = useMemo(
    () => ['all', ...visibleTiers.map(tier => tier.tier)],
    [visibleTiers],
  );

  useEffect(() => {
    setPage(0);
  }, [selectedTier, sortBy]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');

    const params = new URLSearchParams({
      offset: String(page * PAGE_SIZE),
      limit: String(PAGE_SIZE),
      tier: selectedTier,
      sort: sortBy,
    });

    fetch(`/api/collection?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async res => {
        const raw: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
            ? raw.error
            : 'Failed to load Codex.';
          throw new Error(message);
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Codex returned an invalid response. Refresh and try again.');
        const data = raw as Partial<CollectionPageResponse>;
        if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || Number(data.total) < 0) {
          throw new Error('Codex returned invalid collection data. Refresh and try again.');
        }
        return data as CollectionPageResponse;
      })
      .then(data => {
        if (controller.signal.aborted) return;
        const safeItems = Array.isArray(data.items) ? data.items.slice(0, PAGE_SIZE) : [];
        setItems(safeItems);
        setTotal(data.total);
        const nextLastPage = Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1);
        setPage(currentPage => Math.min(currentPage, nextLastPage));
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setItems([]);
        setTotal(0);
        setLoadError(error instanceof Error ? error.message : 'Failed to load Codex.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, selectedTier, sortBy, reloadToken]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  const pageStart = total === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, safePage * PAGE_SIZE + items.length);

  const goToPage = (nextPage: number) => {
    setPage(Math.max(0, Math.min(totalPages - 1, nextPage)));
  };

  return (
    <div className="io-page-shell io-page-codex max-w-4xl mx-auto space-y-6">
      <div className="io-page-hero bg-gradient-to-r from-slate-900 via-purple-950/20 to-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-purple-400 block mb-1">
              Continuum Codex
            </span>
            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2">
              <span>Orb Collection</span>
              <span className="text-sm font-semibold text-slate-400">
                ({fmt(total)} Unique Orbs Discovered)
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-4 bg-slate-950/60 border border-slate-800/80 rounded-2xl px-4 py-2.5">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Collection Value
              </span>
              <span className="text-lg font-black text-amber-400">{fmt(state.collectionValue)}</span>
            </div>
            <div className="w-[1px] h-8 bg-slate-800" />
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                Highest Orb
              </span>
              <span className="text-lg font-black text-purple-300">
                1 / {formatRarity(state.highestRarity || 2, state.highestRarityIsInfinity)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-slate-800">
          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <span className="text-[10px] uppercase tracking-wider font-black text-cyan-300 block">
                  Codex Devotion
                </span>
                <span className="text-xs text-slate-400">
                  Your longest consecutive rarity chain
                </span>
              </div>
              <div className="text-right">
                <div className="text-sm font-black font-mono text-white">
                  {codexChain > 0 ? `Best chain: ${codexChain}` : 'No chain yet'}
                </div>
                <div className="text-[10px] font-bold text-emerald-300 mt-0.5">
                  {codexChain > 0 ? 'Find the next adjacent rarity to extend it.' : 'Discover your first rare Orb to start a chain.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chain Patcher: shard-priced exact-rarity next-roll guarantee */}
      <section className="io-codex-patcher rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/35 via-slate-900/90 to-slate-950 p-5 sm:p-6 shadow-xl shadow-cyan-950/20 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-3 text-cyan-200">
              <Gem className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-white">Chain Patcher</h3>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
                Spend Shards to guarantee the next missing rarity that extends your longest consecutive Codex chain.
                The following roll is locked to exactly one orb of that rarity. Auto Roll pauses so it cannot consume the guarantee unexpectedly.
              </p>
            </div>
          </div>
          <div className="shrink-0 rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-3 py-2 text-right">
            <div className="text-[9px] font-black uppercase tracking-widest text-cyan-200/70">Longest Chain</div>
            <div className="text-lg font-black text-cyan-100">{fmt(currentChainLength)} <span className="text-xs font-bold text-cyan-300/70">rarities</span></div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Target Rarity</div>
            <div className="mt-1 text-lg font-black text-white">
              {patcherTarget == null ? 'Chain complete' : `1 / ${formatRarity(patcherTarget)}`}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {patcherCharged ? 'Guarantee already purchased' : 'Lowest-cost adjacent extension'}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Shard Cost</div>
            <div className="mt-1 flex items-center gap-1.5 text-lg font-black text-cyan-200">
              <Gem className="h-4 w-4" />
              {patcherCharged ? 'Paid' : patcherTarget == null ? '—' : fmt(patcherCost)}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">Cost scales with target rarity; 1/900 costs 100 Shards</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Purchase Cooldown</div>
            <div className="mt-1 text-lg font-black text-white">
              {patcherCooldownRemaining > 0 ? patcherCooldownText : 'Ready'}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">24 hours between purchases</div>
          </div>
        </div>

        {patcherCharged && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-200" role="status">
            Charged: your next accepted roll will give exactly one 1/{formatRarity(patcherTarget ?? storedPatcherRarity)} orb. Click Roll to use it.
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            sound.playClick();
            void handleBuyChainPatcherClick();
          }}
          disabled={
            chainPatcherBuying ||
            patcherCharged ||
            patcherCooldownRemaining > 0 ||
            patcherTarget == null ||
            state.shards < patcherCost
          }
          className="w-full rounded-xl border border-cyan-400/30 bg-cyan-500/15 px-4 py-3 text-xs font-black text-cyan-100 transition-colors hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900 disabled:text-slate-500"
        >
          {chainPatcherBuying
            ? 'Purchasing Chain Patcher…'
            : patcherCharged
            ? 'Chain Patcher Charged · Roll to Use'
            : patcherCooldownRemaining > 0
              ? `Cooldown · ${patcherCooldownText}`
              : patcherTarget == null
                ? 'No Adjacent Rarity Can Extend This Chain'
                : state.shards < patcherCost
                  ? `Need ${fmt(patcherCost)} Shards`
                  : `Buy Chain Patcher · ${fmt(patcherCost)} Shards`}
        </button>
      </section>

      <section className="io-codex-milestones mt-5 pt-4 border-t border-slate-800">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
          Continuum Tier Milestones
        </span>
        <div className="io-codex-milestone-grid grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2 text-center">
          {visibleTiers.map(milestone => {
            const reached = (state.highestRarity || 0) >= milestone.minRarity;
            return (
              <div
                key={milestone.tier}
                className={`io-codex-milestone-card flex flex-col items-center justify-center transition-all ${reached ? 'is-unlocked' : 'is-locked'}`}
                style={{
                  '--io-tier-color': milestone.color,
                  borderColor: reached ? `${milestone.color}70` : undefined,
                  boxShadow: reached ? `0 0 20px ${milestone.color}18` : undefined,
                } as React.CSSProperties}
              >
                <RarityOrbIcon rarity={milestone.minRarity} unlocked={reached} />
                <span
                  className="io-codex-milestone-name font-extrabold"
                  style={{ color: reached ? milestone.color : '#64748b' }}
                >
                  {milestone.tier}
                </span>
                <span className="io-codex-milestone-odds font-mono text-slate-400">
                  1/{formatRarity(milestone.minRarity)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 border border-slate-800/80 p-3 rounded-2xl">
        <div role="group" aria-label="Filter Codex by tier" className="flex items-center gap-1 overflow-x-auto max-w-full pb-1 sm:pb-0 scrollbar-thin">
          {tiersList.map(t => (
            <button
              key={t}
              type="button"
              aria-pressed={selectedTier === t}
              onClick={() => setSelectedTier(t)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase transition-all whitespace-nowrap ${
                selectedTier === t
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white bg-slate-950/40'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="io-codex-sort" className="text-xs text-slate-500 font-semibold">Sort by</label>
          <select
            id="io-codex-sort"
            aria-label="Sort Codex entries"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as 'rarity_desc' | 'rarity_asc' | 'count')}
            className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-lg px-2 py-1 font-semibold"
          >
            <option value="rarity_desc">Highest Rarity</option>
            <option value="rarity_asc">Lowest Rarity</option>
            <option value="count">Most Owned</option>
          </select>
        </div>
      </div>

      {loadError ? (
        <div className="bg-rose-950/20 border border-rose-500/30 rounded-2xl p-10 text-center space-y-2">
          <BookOpen className="w-8 h-8 text-rose-400 mx-auto" />
          <p className="text-sm font-bold text-rose-300">Codex failed to load</p>
          <p className="text-xs text-slate-500">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setLoadError('');
              setReloadToken(value => value + 1);
            }}
            className="text-xs font-bold text-cyan-300 hover:text-cyan-200"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-10 text-center">
          <Loader2 className="w-8 h-8 text-purple-400 mx-auto animate-spin" />
          <p className="text-sm font-bold text-slate-300 mt-3">Loading Codex page…</p>
          <p className="text-xs text-slate-500 mt-1">Only {PAGE_SIZE} entries are being prepared.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-10 text-center space-y-2">
          <BookOpen className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm font-bold text-slate-400">{selectedTier === 'all' ? 'No Orbs discovered yet' : 'No discoveries in this tier yet'}</p>
          <p className="text-xs text-slate-500">{selectedTier === 'all' ? 'Roll once to discover your first Orb; it will be recorded here.' : 'Try All tiers to see your other discoveries, or keep rolling to find this tier.'}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-slate-500 px-1" aria-live="polite">
            <span>Showing {fmt(pageStart)}–{fmt(pageEnd)} of {fmt(total)}</span>
            <span>Page {safePage + 1} of {totalPages}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {items.map(item => {
              const info = getOrbInfo(item.rarity, item.isInfinity);
              return (
                <div
                  key={item.isInfinity ? 'Infinity' : item.rarity}
                  className="relative rounded-2xl p-4 border bg-slate-900/90 border-slate-800 hover:border-slate-700 transition-all shadow-md"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 border border-white/10 shadow-inner relative"
                      style={{ background: info.bgGradient }}
                    >
                      <span className="text-[10px] font-black text-white/90 drop-shadow">
                        1/{formatRarity(item.rarity, item.isInfinity)}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span
                          className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border"
                          style={{
                            color: info.color,
                            borderColor: `${info.color}44`,
                            backgroundColor: `${info.color}11`,
                          }}
                        >
                          {info.tier}
                        </span>
                        <span className="text-xs font-bold text-slate-300">×{fmt(item.count)}</span>
                      </div>

                      <h3 className="text-sm font-black text-white truncate mt-1">{info.name}</h3>

                      <div className="flex items-center justify-between text-xs text-slate-400 mt-1">
                        <span className="font-mono text-[11px]">1 in {formatRarity(item.rarity, item.isInfinity)}</span>
                        <span className="text-amber-400 font-semibold text-[11px]">
                          +{fmt(coinsForRarity(item.rarity))} Coins
                        </span>
                      </div>
                    </div>
                  </div>

                  {item.rarity >= 100 && (
                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          sound.playClick();
                          onOpenShareModal(item.rarity, item.isInfinity);
                        }}
                        className="text-[11px] font-bold text-orange-400 hover:text-orange-300 flex items-center gap-1 transition-colors"
                      >
                        <Share2 className="w-3 h-3" />
                        <span>Share to Reddit</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <nav aria-label="Codex pages" className="flex items-center justify-center gap-3">
              <button
                type="button"
                aria-label="Previous Codex page"
                disabled={safePage === 0}
                onClick={() => goToPage(safePage - 1)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <span className="text-xs font-mono text-slate-500">Page {safePage + 1} / {totalPages}</span>
              <button
                type="button"
                aria-label="Next Codex page"
                disabled={safePage >= totalPages - 1}
                onClick={() => goToPage(safePage + 1)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
};
