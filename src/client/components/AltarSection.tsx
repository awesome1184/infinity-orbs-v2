import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Flame,
  Coins,
  Gem,
  Sparkles,
  Zap,
  TrendingUp,
  Star,
  ShieldCheck,
  RotateCw,
} from 'lucide-react';
import type { PlayerState } from '../../shared/game.js';
import {
  formatNumber,
  formatShardAmount,
  calculateAltarMultipliers,
  altarCoinDevotionChancePercent,
  altarCoinFloor,
} from '../../shared/game.js';
import { sound } from '../sound.js';

interface AltarSectionProps {
  state: PlayerState;
  onSacrifice: (coins: number, shards: number) => Promise<PlayerState>;
  busy: boolean;
}

export const AltarSection: React.FC<AltarSectionProps> = ({
  state,
  onSacrifice,
  busy,
}) => {
  const [selectedCoinOffer, setSelectedCoinOffer] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const [selectedShardOffer, setSelectedShardOffer] = useState<number>(0);
  const [sacrificing, setSacrificing] = useState(false);
  const [sacrificeError, setSacrificeError] = useState('');
  const sacrificeLockRef = useRef(false);
  const allowMotionEffects = () =>
    typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const fmt = (n: number) => formatNumber(n);

  const sacrifices = state.sacrifices ?? {
    coinsSacrificed: 0,
    shardsSacrificed: 0,
    altarLevel: 0,
    luckSurgeUntil: 0,
  };

  const {
    coinMultiplier,
    shardMultiplier,
    surgeMultiplier,
    totalAltarMultiplier,
  } = calculateAltarMultipliers(state);

  const isSurgeActive = Boolean(sacrifices.luckSurgeUntil && sacrifices.luckSurgeUntil > now);
  const surgeMsLeft = isSurgeActive ? Math.max(0, (sacrifices.luckSurgeUntil || 0) - now) : 0;
  const surgeMins = Math.floor(surgeMsLeft / 60000);
  const surgeSecs = Math.floor((surgeMsLeft % 60000) / 1000);

  // Coin devotion is a chance-based breakthrough system.
  const altarLevel = sacrifices.altarLevel ?? 0;
  const currentTotalCoins = sacrifices.coinsSacrificed ?? 0;
  const altarPity = sacrifices.altarPity ?? 0;
  const currentCoinFloor = altarCoinFloor(altarLevel);
  const selectedCoinChance = altarCoinDevotionChancePercent(selectedCoinOffer, altarPity, altarLevel);
  const coinOfferMeetsFloor = selectedCoinOffer === 0 || selectedCoinOffer >= currentCoinFloor;
  const canSubmitOffering =
    selectedCoinOffer <= state.coins &&
    selectedShardOffer <= (state.shards ?? 0) &&
    (selectedCoinOffer <= 0 || coinOfferMeetsFloor) &&
    (selectedCoinOffer > 0 || selectedShardOffer > 0);

  const handleSacrificeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      busy || sacrificing || sacrificeLockRef.current ||
      (selectedCoinOffer <= 0 && selectedShardOffer <= 0) ||
      (selectedCoinOffer > 0 && selectedCoinOffer < currentCoinFloor) ||
      selectedCoinOffer > state.coins ||
      selectedShardOffer > (state.shards ?? 0)
    ) return;

    sacrificeLockRef.current = true;
    setSacrificing(true);
    setSacrificeError('');

    try {
      const nextState = await onSacrifice(selectedCoinOffer, selectedShardOffer);
      sound.playSacrificeSound();
      if (allowMotionEffects()) {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.65 },
          colors: ['#f59e0b', '#ef4444', '#a855f7'],
        });
      }
      const nextSacrifices = nextState.sacrifices ?? {
        coinsSacrificed: 0,
        shardsSacrificed: 0,
        altarLevel: 0,
        luckSurgeUntil: 0,
      };
      const nextFloor = altarCoinFloor(nextSacrifices.altarLevel ?? 0);
      setSelectedCoinOffer(nextState.coins >= nextFloor ? nextFloor : 0);
      setSelectedShardOffer(0);
    } catch (error) {
      setSacrificeError(error instanceof Error ? error.message : 'The offering was not confirmed. Check your balances before retrying.');
    } finally {
      sacrificeLockRef.current = false;
      setSacrificing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300 pb-12">
      {sacrificeError && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">{sacrificeError}</div>}
      {/* Altar Hero Banner */}
      <div className="bg-gradient-to-r from-orange-950/70 via-slate-900 to-purple-950/70 border border-orange-700/40 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        {/* Animated Background Rays & Star */}
        
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-400/40 text-orange-300 text-xs font-bold">
              <Flame className="w-3.5 h-3.5 fill-current text-orange-400 animate-pulse" />
              <span>DEVOTION ALTAR</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
              <span>Devotion Altar</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed">
              Offer Coins for a chance to increase Altar Rank. Each rank compounds Coin Devotion by 1.05×, while the minimum Coin offering grows by 1.5× per rank. Larger offerings improve the odds; failed attempts increase pity. Shards add permanent luck and extend the temporary Surge.
            </p>
          </div>

          {/* Current Total Altar Multiplier Jewel */}
          <div className="bg-slate-950/80 border border-orange-500/40 rounded-2xl p-4 flex items-center gap-3.5 shadow-xl">
            <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 flex items-center justify-center text-slate-950 shadow-lg shadow-orange-500/30">
              <Star className="w-6 h-6 fill-current animate-spin" style={{ animationDuration: '14s' }} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-orange-300">
                Altar Luck
              </div>
              <div className="text-2xl font-black text-white font-mono">
                {totalAltarMultiplier.toFixed(2)}×
              </div>
              <div className="text-[10px] text-emerald-400 font-medium">
                Multiplied with other luck
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Multiplicative Formula Visualizer */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-3">
        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>Luck breakdown</span>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left bg-slate-950/70 p-4 rounded-xl border border-slate-800/80">
          <div className="flex-1">
            <span className="text-[11px] text-slate-400 block">Coin Devotion</span>
            <span className="text-lg font-black text-amber-400 font-mono">{coinMultiplier.toFixed(2)}×</span>
            <span className="text-[10px] text-slate-500 block">From Lvl {altarLevel} & sacrifices</span>
          </div>

          <div className="text-slate-500 font-black text-xl">×</div>

          <div className="flex-1">
            <span className="text-[11px] text-slate-400 block">Shard infusion</span>
            <span className="text-lg font-black text-cyan-400 font-mono">{shardMultiplier.toFixed(2)}×</span>
            <span className="text-[10px] text-slate-500 block">{sacrifices.shardsSacrificed} Shards offered</span>
          </div>

          <div className="text-slate-500 font-black text-xl">×</div>

          <div className="flex-1">
            <span className="text-[11px] text-slate-400 block">Luck Surge</span>
            <span className={`text-lg font-black font-mono ${isSurgeActive ? 'text-rose-400 animate-pulse' : 'text-slate-500'}`}>
              {surgeMultiplier.toFixed(2)}×
            </span>
            <span className="text-[10px] text-slate-500 block">
              {isSurgeActive ? `${surgeMins}m ${surgeSecs}s left` : 'Inactive'}
            </span>
          </div>

          <div className="text-slate-500 font-black text-xl">=</div>

          <div className="flex-1 bg-orange-500/10 border border-orange-500/30 rounded-xl p-2.5">
            <span className="text-[11px] text-orange-300 font-bold block">Total Altar Luck</span>
            <span className="text-xl font-black text-white font-mono">{totalAltarMultiplier.toFixed(2)}×</span>
          </div>
        </div>
      </div>

      {/* Devotion Level Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Altar Rank & Breakthrough Chance */}
        <div className="bg-slate-950/70 border border-amber-500/20 rounded-2xl p-4 space-y-2">
          <div className="text-xs text-slate-400 flex items-center justify-between">
            <span>Altar Devotion Rank</span>
            <span className="font-mono text-amber-400 font-bold">Lvl {altarLevel}</span>
          </div>
          <div className="text-2xl font-black text-white font-mono">
            {coinMultiplier.toFixed(2)}× <span className="text-xs font-normal text-amber-400">Coin Luck</span>
          </div>
          <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-black tracking-wide text-amber-300">
                Coin Breakthrough Chance
              </span>
              <span className="text-lg font-black font-mono text-white">
                {selectedCoinOffer > 0 && coinOfferMeetsFloor ? (selectedCoinChance + '%') : '—'}
              </span>
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {selectedCoinOffer === 0
                ? 'Select a coin offering to see its breakthrough chance.'
                : coinOfferMeetsFloor
                ? 'Larger offerings improve the base chance. Failed attempts multiply it upward.'
                : 'Coin offerings require at least ' + formatNumber(currentCoinFloor) + ' Coins.'}
            </div>
            <div className="mt-1 text-[10px] text-orange-300 font-bold">
              Failed attempts: {altarPity} • pity multiplies chance by 1.35× per failure (cap 90%)
            </div>
          </div>
        </div>

        {/* Shard Infusion */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Gem className="w-3.5 h-3.5 text-cyan-400" />
            <span>Permanent Shard Infusion</span>
          </div>
          <div className="text-2xl font-black text-white font-mono">
            {shardMultiplier.toFixed(2)}× <span className="text-xs font-normal text-cyan-400">Shard Multiplier</span>
          </div>
          <p className="text-[11px] text-slate-400">
            {sacrifices.shardsSacrificed} Shards permanently infused (base +2% multiplicative luck per shard, before Altar Resonator and level bonuses).
          </p>
        </div>

        {/* Cumulative Coins */}
        <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4 space-y-1.5">
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span>Cumulative Coins Offered</span>
          </div>
          <div className="text-2xl font-black text-white font-mono text-amber-300">
            {fmt(currentTotalCoins)}
          </div>
          <p className="text-[11px] text-slate-400">
            Your devotion endures across runs and prestige resets.
          </p>
        </div>
      </div>

      {/* Offering Ritual Form */}
      <form onSubmit={handleSacrificeSubmit} className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-7 space-y-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="text-sm font-black text-white flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-400" />
            <span>Conduct Sacrificial Ritual</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-amber-400 font-bold">{fmt(state.coins)} Coins</span>
            <span className="text-slate-600">•</span>
            <span className="text-cyan-400 font-bold">{formatShardAmount(state.shards ?? 0)} Shards</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Coins Offering Box */}
          <div className="space-y-3 bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="altar-coin-offer" className="font-bold text-amber-300 flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-amber-400" />
                <span>Coin Sacrifice</span>
              </label>
              <span className="font-mono text-slate-400">
                Offering: {fmt(selectedCoinOffer)}
              </span>
            </div>

            <input
              id="altar-coin-offer"
              type="range"
              min={0}
              max={state.coins}
              step={Math.max(1, Math.floor(state.coins / 100))}
              value={selectedCoinOffer}
              onChange={e => setSelectedCoinOffer(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
            />

            <div className="flex gap-1.5 flex-wrap">
              {[
                { label: '0', val: 0 },
                { label: '1K', val: 1000 },
                { label: 'FLOOR', val: currentCoinFloor },
                { label: '2× FLOOR', val: currentCoinFloor * 2 },
                { label: '25%', val: Math.floor(state.coins * 0.25) },
                { label: '50%', val: Math.floor(state.coins * 0.5) },
                { label: 'MAX', val: state.coins },
              ].map(btn => (
                <button
                  type="button"
                  key={btn.label}
                  onClick={() => setSelectedCoinOffer(Math.min(state.coins, btn.val))}
                  className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-amber-500/20 hover:text-amber-300 text-[10px] font-bold text-slate-400 transition-colors"
                >
                  {btn.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500">
              Current minimum coin offering: {currentCoinFloor.toLocaleString()}. Pity compounds by 1.35× per failed coin attempt.
            </p>
          </div>

          {/* Shards Offering Box */}
          <div className="space-y-3 bg-slate-950/60 border border-slate-800/80 p-4 rounded-2xl">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor="altar-shard-offer" className="font-bold text-cyan-300 flex items-center gap-1.5">
                <Gem className="w-3.5 h-3.5 text-cyan-400" />
                <span>Shard Sacrifice</span>
              </label>
              <span className="font-mono text-slate-400">
                Offering: {selectedShardOffer} Shards
              </span>
            </div>

            <input
              id="altar-shard-offer"
              type="range"
              min={0}
              max={state.shards ?? 0}
              step={1}
              value={selectedShardOffer}
              onChange={e => setSelectedShardOffer(Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
            />

            <div className="flex gap-1.5 flex-wrap">
              {[
                { label: '0', val: 0 },
                { label: '1', val: 1 },
                { label: '5', val: 5 },
                { label: '10', val: 10 },
                { label: 'MAX', val: state.shards ?? 0 },
              ].map(btn => (
                <button
                  type="button"
                  key={btn.label}
                  onClick={() => setSelectedShardOffer(Math.min(state.shards ?? 0, btn.val))}
                  className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-cyan-500/20 hover:text-cyan-300 text-[10px] font-bold text-slate-400 transition-colors"
                >
                  {btn.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500">
              Shards do not roll for Devotion. Each adds base +2% multiplicative luck before Altar Resonator/level bonuses and extends the +25% Luck Surge by 15 minutes.
            </p>
          </div>
        </div>

        {/* Submit Sacrifice Button */}
        <button
          type="submit"
          disabled={busy || sacrificing || !canSubmitOffering}
          className={`w-full py-4 px-6 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow-xl ${
            canSubmitOffering
              ? 'bg-orange-600 hover:bg-orange-500 text-white shadow-md active:scale-[0.99] cursor-pointer'
              : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700/50'
          }`}
        >
          <Flame className="w-5 h-5 text-amber-300 " />
          <span>
            {sacrificing
              ? 'Offering...'
              : `Make Offering (${fmt(selectedCoinOffer)} Coins, ${selectedShardOffer} Shards)`}
          </span>
        </button>
      </form>
    </div>
  );
};
