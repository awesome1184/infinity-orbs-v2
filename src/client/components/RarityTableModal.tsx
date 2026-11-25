import React from 'react';
import { X, ShieldCheck, Coins, Sparkles } from 'lucide-react';
import {
  visibleContinuumTiers,
  CONTINUUM_DISCOVERY_UNLOCK_RARITY,
  CONTINUUM_EXPANSION_UNLOCK_RARITY,
} from '../../shared/game.js';
import type { ContinuumTierMilestone } from '../../shared/game.js';
import { RarityOrbIcon } from './RarityOrbIcon.js';

interface RarityTableModalProps {
  onClose: () => void;
  highestRarity: number;
}

export const RarityTableModal: React.FC<RarityTableModalProps> = ({ onClose, highestRarity }) => {
  const visibleTiers = visibleContinuumTiers(highestRarity);
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="io-rarity-title"
        aria-describedby="io-rarity-description"
        className="io-rarity-modal bg-slate-900 border border-cyan-300/20 rounded-3xl p-4 sm:p-6 max-w-2xl w-full space-y-4 shadow-[0_0_70px_rgba(34,211,238,.12)] relative max-h-[85dvh] overflow-hidden flex flex-col"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          aria-label="Close rarity continuum"
          title="Close rarity continuum"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <div className="io-rarity-modal-header flex items-center gap-3 rounded-2xl p-3 pr-12">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-300/20 via-violet-400/20 to-fuchsia-400/20 ring-1 ring-white/10">
            <ShieldCheck className="w-5 h-5 text-cyan-200" />
          </div>
          <div className="min-w-0">
            <h3 id="io-rarity-title" className="text-base sm:text-lg font-black tracking-tight text-white">Rarity Continuum</h3>
            <p className="text-[11px] font-semibold tracking-wide text-cyan-100/70">DROP ODDS · LEVEL-SCALED</p>
          </div>
        </div>

        <div id="io-rarity-description" className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs space-y-2">
          <div className="text-slate-300 font-semibold flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span>Economy: <strong className="text-amber-300">Coins = Rarity</strong></span>
          </div>
          <p className="text-slate-400">
            Coin rewards scale with rarity using a diminishing-return formula, so higher-rarity orbs are worth more without paying their full rarity number.
          </p>
          <p className="text-slate-300">
            At Level 1 and 1× Luck, the chance of rolling at least rarity <code className="text-cyan-200">R</code> is approximately <code className="text-cyan-200">1 / R</code>. Player level multiplies the rarity distribution linearly; Luck separately contributes a diminishing-return factor of <code className="text-cyan-200">Luck^0.08</code>, capped at <code className="text-cyan-200">25×</code>. Rune and critical multipliers apply before the final rarity floor.
          </p>
          {highestRarity < CONTINUUM_DISCOVERY_UNLOCK_RARITY ? (
            <div className="io-rarity-unlock-hint flex items-center gap-2 rounded-xl border border-amber-300/20 px-3 py-2.5 text-xs font-bold text-amber-100">
              <Sparkles className="h-4 w-4 shrink-0 text-amber-300" />
              <span>More rarities are unlocked after getting a 1/1m orb.</span>
            </div>
          ) : highestRarity < CONTINUUM_EXPANSION_UNLOCK_RARITY ? (
            <div className="io-rarity-unlock-hint flex items-center gap-2 rounded-xl border border-violet-300/20 px-3 py-2.5 text-xs font-bold text-violet-100">
              <Sparkles className="h-4 w-4 shrink-0 text-violet-200" />
              <span>New rarities are unlocked after getting a 1/e15 orb.</span>
            </div>
          ) : null}
        </div>

        {/* Continuum milestones */}
        <p className="px-1 text-[10px] font-semibold tracking-wide text-slate-400" role="status">
          {visibleTiers.length} rarity tier{visibleTiers.length === 1 ? '' : 's'} revealed
          <span className="mx-1.5 text-slate-600">•</span>
          <span className="text-cyan-200">level scales rarity 1:1</span>
        </p>
        <div
          role="table"
          aria-label="Rarity continuum thresholds, base odds, and coin yield"
          className="flex-1 min-h-0 overflow-y-auto border border-slate-800 rounded-2xl bg-slate-950/60 divide-y divide-slate-800/60 pr-1"
        >
          <div role="row" className="hidden sm:grid grid-cols-4 gap-3 px-4 py-2.5 bg-slate-900 text-[11px] font-bold text-slate-400 uppercase tracking-wider sticky top-0 z-10">
            <span role="columnheader">Tier</span>
            <span role="columnheader">Threshold</span>
            <span role="columnheader">Base Odds</span>
            <span role="columnheader" className="text-right">Coins</span>
          </div>

          {visibleTiers.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">Discover an Orb to reveal its continuum tier here.</p>
          ) : visibleTiers.map((tier: ContinuumTierMilestone, tierIndex: number) => (
            <div
              role="row"
              key={tier.tier}
              className={`io-rarity-tier-row grid grid-cols-2 sm:grid-cols-4 items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-3 text-xs transition-all duration-200 ${tierIndex === 3 ? 'io-rarity-tier-row--shifting' : ''} ${tier.minRarity >= 1e19 ? 'io-rarity-new-tier bg-violet-950/15' : 'hover:bg-slate-900/50'} ${tier.minRarity >= 1e38 ? 'io-rarity-tier-row--animated' : ''}`}
              style={{ borderLeftColor: tier.color, '--io-rarity-tier-color': tier.color } as React.CSSProperties}
            >
              <div role="cell" aria-label={`${tier.tier} tier`} className="io-rarity-tier-name-cell flex min-w-0 items-center gap-2">
                <RarityOrbIcon rarity={tier.minRarity} unlocked={highestRarity >= tier.minRarity} compact />
                <span className={`font-bold text-white break-words ${tier.minRarity >= 1e38 ? 'io-rarity-color-cycle' : ''}`} style={{ color: tier.color }}>{tier.tier}</span>
              </div>

              <div role="cell" className="min-w-0 break-words font-mono text-slate-300 font-bold">
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:hidden">Threshold</span>
                {tier.label}
              </div>

              <div role="cell" className="min-w-0 break-words text-slate-400 font-medium">
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:hidden">Odds</span>
                {tier.approxChance}
              </div>

              <div role="cell" className="min-w-0 break-words text-left sm:text-right font-mono text-amber-400 font-semibold">
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:hidden">Coins</span>
                {tier.coinsPerOrb}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
          >
            Close table
          </button>
        </div>
      </div>
    </div>
  );
};
