import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gem, RefreshCw, ShieldCheck, Sparkles, Swords } from 'lucide-react';
import type { RuneBonuses, RuneItem, RuneRarity } from '../../shared/runes.js';
import { RUNE_EQUIPMENT_SLOTS, RUNE_INVENTORY_CAP, runeBonusesSummary, runeStatsSummary } from '../../shared/runes.js';

interface RuneResponse {
  runes: RuneItem[];
  equippedRunes: string[];
  bonuses: RuneBonuses;
}

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({})) as { error?: unknown } & Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Rune request failed.');
  return data as T;
}

const rarityClass: Record<RuneRarity, string> = {
  Common: 'border-slate-500/50 bg-slate-900/70 text-slate-300',
  Uncommon: 'border-cyan-500/50 bg-cyan-950/35 text-cyan-200',
  Rare: 'border-violet-500/55 bg-violet-950/35 text-violet-200',
  Epic: 'border-orange-500/55 bg-orange-950/30 text-orange-200',
  Legendary: 'border-emerald-500/55 bg-emerald-950/30 text-emerald-200',
  Mythic: 'border-fuchsia-400/70 bg-fuchsia-950/40 text-fuchsia-100 shadow-[0_0_20px_rgba(217,70,239,0.12)]',
};
const fmtPct = (value: number) => '+' + (Math.max(0, value) * 100).toFixed(2).replace(/\.?0+$/, '') + '%';

export const RunesSection: React.FC = () => {
  const [data, setData] = useState<RuneResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRune, setBusyRune] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await request<RuneResponse>('/api/runes'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Runes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const equipped = data?.equippedRunes ?? [];
  const runes = data?.runes ?? [];
  const sortedRunes = useMemo(() => [...runes].sort((a, b) => {
    const order: Record<RuneRarity, number> = { Mythic: 6, Legendary: 5, Epic: 4, Rare: 3, Uncommon: 2, Common: 1 };
    return order[b.rarity] - order[a.rarity] || b.sourceDepth - a.sourceDepth || b.obtainedAt - a.obtainedAt;
  }), [runes]);
  const visibleRunes = showAll ? sortedRunes : sortedRunes.slice(0, 24);

  const toggleRune = async (runeId: string, equip: boolean) => {
    setBusyRune(runeId);
    try {
      const next = await request<RuneResponse>('/api/runes/equip', 'POST', { runeId, equip });
      setData(next);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your Rune loadout.');
    } finally {
      setBusyRune(null);
    }
  };

  const bonusRows = runeBonusesSummary(data?.bonuses ?? { luckMultiplier: 1, coinMultiplier: 1, xpMultiplier: 1, shardChanceBonus: 0, equippedCount: 0 });

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-slate-950 via-indigo-950/45 to-slate-950 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-violet-300"><Gem className="h-4 w-4" /> Combat → Main Game</div>
            <h1 className="mt-2 text-3xl font-black text-white">Runes</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">Monsters drop Runes that you can equip here. Their bonuses apply to normal Orb rolls, so a deeper Combat run can make your whole account stronger.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Equipped', value: equipped.length + ' / ' + RUNE_EQUIPMENT_SLOTS },
            { label: 'In stash', value: runes.length + ' / ' + RUNE_INVENTORY_CAP },
            { label: 'Luck', value: fmtPct((data?.bonuses.luckMultiplier ?? 1) - 1) },
            { label: 'Coin bonus', value: fmtPct((data?.bonuses.coinMultiplier ?? 1) - 1) },
          ].map(row => <div key={row.label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-3"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{row.label}</div><div className="mt-1 text-lg font-black text-white">{row.value}</div></div>)}
        </div>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" /><h2 className="text-lg font-black text-white">Equipped loadout</h2></div>
        <p className="mt-1 text-xs text-slate-500">Equipped Runes are permanent passive bonuses. You can change them at any time, including between battles.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: RUNE_EQUIPMENT_SLOTS }, (_, slot) => {
            const rune = runes.find(item => item.id === equipped[slot]);
            return <div key={slot} className={'min-h-28 rounded-xl border p-3 ' + (rune ? rarityClass[rune.rarity] : 'border-dashed border-slate-700 bg-slate-900/40')}>
              <div className="text-[10px] font-black uppercase tracking-widest opacity-70">Rune slot {slot + 1}</div>
              {rune ? <>
                <div className="mt-2 font-black">{rune.name}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-wider">{rune.rarity} · Depth {rune.sourceDepth}</div>
                <div className="mt-2 text-xs leading-relaxed">{runeStatsSummary(rune)}</div>
                <button type="button" disabled={busyRune === rune.id} onClick={() => void toggleRune(rune.id, false)} className="mt-3 rounded-lg border border-white/15 bg-black/20 px-3 py-1.5 text-xs font-bold hover:bg-black/35 disabled:opacity-50">{busyRune === rune.id ? 'Saving…' : 'Unequip'}</button>
              </> : <div className="mt-4 text-sm font-semibold text-slate-500">Empty slot</div>}
            </div>;
          })}
        </div>
        <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-950/15 p-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Active main-game effects</div>
          <div className="mt-2 flex flex-wrap gap-2">{bonusRows.map(row => <span key={row} className="rounded-lg border border-emerald-500/20 bg-emerald-900/20 px-2.5 py-1.5 text-xs font-semibold text-emerald-100">{row}</span>)}</div>
          <p className="mt-2 text-[11px] text-slate-500">Bonuses are server-applied to rolls. Luck changes the rarity distribution; it does not directly multiply a roll's final rarity.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-black text-white">Rune stash</h2><p className="mt-1 text-xs text-slate-500">Higher rarity Runes roll more stats. Bosses always drop a Rune; elites and common monsters can drop them too.</p></div>
          <div className="text-xs font-bold text-slate-400">{runes.length} / {RUNE_INVENTORY_CAP} owned</div>
        </div>
        {loading && !data ? <div className="py-10 text-center text-sm text-slate-500">Loading Rune stash…</div> : runes.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/30 px-4 py-8 text-center"><Gem className="mx-auto h-8 w-8 text-violet-400" /><div className="mt-3 font-bold text-white">No Runes yet</div><p className="mt-1 text-sm text-slate-500">Enter Combat and defeat monsters to find your first Rune.</p><div className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-violet-300"><Swords className="h-3.5 w-3.5" /> Fight → claim drops → equip here</div></div> : <>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleRunes.map(rune => {
              const isEquipped = equipped.includes(rune.id);
              const canEquip = isEquipped || equipped.length < RUNE_EQUIPMENT_SLOTS;
              return <article key={rune.id} className={'rounded-xl border p-3 ' + rarityClass[rune.rarity]}>
                <div className="flex items-start justify-between gap-2">
                  <div><div className="text-[10px] font-black uppercase tracking-widest opacity-75">{rune.rarity} Rune</div><h3 className="mt-1 font-black">{rune.name}</h3></div>
                  <span className="rounded-lg border border-current/20 bg-black/20 px-2 py-1 text-[10px] font-bold">Depth {rune.sourceDepth}</span>
                </div>
                <div className="mt-3 space-y-1 text-xs leading-relaxed">{runeStatsSummary(rune).split(' · ').map(stat => <div key={stat} className="flex items-start gap-1.5"><Sparkles className="mt-0.5 h-3 w-3 shrink-0 opacity-70" /><span>{stat}</span></div>)}</div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold opacity-60">{isEquipped ? 'Active bonus' : 'Stored'}</span>
                  <button type="button" disabled={busyRune === rune.id || (!isEquipped && !canEquip)} onClick={() => void toggleRune(rune.id, !isEquipped)} className="rounded-lg border border-current/25 bg-black/20 px-3 py-2 text-xs font-black hover:bg-black/35 disabled:cursor-not-allowed disabled:opacity-40">{busyRune === rune.id ? 'Saving…' : isEquipped ? 'Unequip' : canEquip ? 'Equip Rune' : 'Loadout full'}</button>
                </div>
              </article>;
            })}
          </div>
          {sortedRunes.length > 24 && <button type="button" onClick={() => setShowAll(value => !value)} className="mt-4 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800">{showAll ? 'Show fewer' : 'Show all ' + sortedRunes.length + ' Runes'}</button>}
        </>}
      </section>
    </section>
  );
};
