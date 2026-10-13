import React, { useState } from 'react';
import {
  Sparkles,
  Palette,
  RotateCcw,
  Check,
  Clover,
  Clock,
  Archive,
  BarChart3,
  Gem,
  BellRing,
  FastForward,
  Zap,
  Filter,
  Compass,
  Magnet,
  Flame,
  Wand2,
  Hammer,
  ShieldAlert,
  Star,
  Award,
  Crown,
} from 'lucide-react';
import type {
  PlayerState,
  PrestigeUpgradeId,
  PrestigeUpgradeInfo,
  CosmeticItem,
} from '../../shared/game.js';
import {
  calculateCosmicDust,
  xpRequiredForLevel,
  LEVEL_MILESTONES,
  COSMETICS,
  PRESTIGE_UPGRADES,
  prestigeUpgradeCost,
  SHARD_SYNTHESIS_COST,
  getLevelBenefits,
  formatNumber,
} from '../../shared/game.js';
import { sound } from '../sound.js';

interface ProfileAndPrestigeProps {
  state: PlayerState;
  onPrestige: () => Promise<void>;
  onBuyPrestigeUpgrade: (id: PrestigeUpgradeId) => Promise<void>;
  onSynthesizeDust: () => Promise<void>;
  onBuyCosmetic: (id: string) => Promise<void>;
  busy: boolean;
}

export const ProfileAndPrestige: React.FC<ProfileAndPrestigeProps> = ({
  state,
  onPrestige,
  onBuyPrestigeUpgrade,
  onSynthesizeDust,
  onBuyCosmetic,
  busy,
}) => {
  const [confirmingPrestige, setConfirmingPrestige] = useState(false);
  const [filterCategory, setFilterCategory] = useState<'all' | 'qol' | 'core' | 'alchemy'>('all');
  const fmt = (n: number) => formatNumber(n);

  const currentRunVal = state.collectionValue ?? 0;
  const pendingDust = calculateCosmicDust(state);
  const canPrestige = pendingDust > 0 && currentRunVal >= 1_000_000;

  const luckRatio = state.highestRarity > 0 ? state.totalRolls / state.highestRarity : 1;
  const luckRating =
    state.highestRarity >= 100000 && state.totalRolls < 5000
      ? 'Very Lucky'
      : luckRatio < 0.5
      ? 'Above Average'
      : luckRatio > 2.5
      ? 'Below Average'
      : 'Average';

  const hasForgeUpgrade = (state.prestigeUpgrades?.shardSynthesis ?? 0) > 0;
  const canSynthesize = (state.shards ?? 0) >= SHARD_SYNTHESIS_COST;

  const upgradeKeys = Object.keys(PRESTIGE_UPGRADES) as PrestigeUpgradeId[];
  const filteredUpgrades = upgradeKeys.filter(id => {
    if (filterCategory === 'all') return true;
    return PRESTIGE_UPGRADES[id].category === filterCategory;
  });

  const getUpgradeIcon = (id: PrestigeUpgradeId) => {
    switch (id) {
      case 'permLuck':
        return <Clover className="w-4 h-4 text-emerald-400" />;
      case 'cosmicReserve':
        return <Clover className="w-4 h-4 text-fuchsia-400" />;
      case 'permSpeed':
        return <Clock className="w-4 h-4 text-cyan-400" />;
      case 'vaultCap':
        return <Archive className="w-4 h-4 text-amber-400" />;
      case 'dustBounty':
        return <Sparkles className="w-4 h-4 text-fuchsia-400" />;
      case 'sonarPing':
        return <BellRing className="w-4 h-4 text-cyan-400 animate-pulse" />;
      case 'instantReveal':
        return <FastForward className="w-4 h-4 text-purple-400" />;
      case 'autoOverclock':
        return <Zap className="w-4 h-4 text-yellow-400" />;
      case 'autoFilter':
        return <Filter className="w-4 h-4 text-emerald-400" />;
      case 'resonanceMeter':
        return <Compass className="w-4 h-4 text-indigo-400" />;
      case 'stellarMagnet':
        return <Magnet className="w-4 h-4 text-rose-400" />;
      case 'chronoOverdrive':
        return <Flame className="w-4 h-4 text-amber-400" />;
      case 'transmutation':
        return <Wand2 className="w-4 h-4 text-fuchsia-400" />;
      case 'shardSynthesis':
        return <Hammer className="w-4 h-4 text-orange-400" />;
      case 'astralBarrage':
        return <Sparkles className="w-4 h-4 text-purple-400" />;
      case 'cosmicInheritance':
        return <Archive className="w-4 h-4 text-amber-400" />;
      case 'autoBuyer':
        return <Zap className="w-4 h-4 text-cyan-400" />;
      case 'supernova':
        return <Flame className="w-4 h-4 text-rose-400 animate-pulse" />;
      case 'altarResonator':
        return <Flame className="w-4 h-4 text-orange-400" />;
      case 'offlineOverdrive':
        return <Clock className="w-4 h-4 text-teal-400" />;
      case 'singularityTithe':
        return <Gem className="w-4 h-4 text-yellow-400" />;
      case 'luckyFloor':
        return <Clover className="w-4 h-4 text-emerald-400" />;
      case 'astralArsenal':
        return <Sparkles className="w-4 h-4 text-purple-400" />;
      case 'deepVault':
        return <Archive className="w-4 h-4 text-amber-400" />;
      case 'masteryEngine':
        return <Award className="w-4 h-4 text-indigo-400" />;
      case 'steadyHands':
        return <Clock className="w-4 h-4 text-cyan-400" />;
      case 'offlineFortune':
        return <Zap className="w-4 h-4 text-teal-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-fuchsia-400" />;
    }
  };

  const displayedLevel = Math.max(1, state.level || 1);
  let xpBeforeLevel = 0;
  for (let level = 1; level < displayedLevel; level++) {
    xpBeforeLevel += xpRequiredForLevel(level);
  }
  const levelXpRequired = xpRequiredForLevel(displayedLevel);
  const currentLevelXp = Math.max(0, (state.xp || 0) - xpBeforeLevel);
  const levelInfo = {
    level: displayedLevel,
    currentLevelXp,
    nextLevelXp: levelXpRequired,
    progressPercent: Math.min(100, Math.round((currentLevelXp / levelXpRequired) * 100)),
  };
  const levelBenefits = getLevelBenefits(displayedLevel);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 1. Level Perks & Milestones Section */}
      <div className="bg-gradient-to-r from-purple-950/70 via-slate-900 to-indigo-950/70 border border-purple-800/40 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-purple-800/30 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/30">
              <Star className="w-6 h-6 fill-current text-amber-300 animate-spin" style={{ animationDuration: '14s' }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-white">Orbmaster Level {levelInfo.level}</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  {fmt(state.xp || 0)} Total EXP
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Each level grants permanent passive multipliers, milestone perks, and Mastery Points.
              </p>
            </div>
          </div>

          <div className="bg-slate-950/80 border border-purple-500/30 px-4 py-2 rounded-2xl text-right">
            <div className="text-[10px] font-bold uppercase text-purple-300">Level Passives</div>
            <div className="text-xs font-mono text-emerald-400 font-bold">
              {levelBenefits.luckMultiplier.toFixed(2)}× Multiplicative Luck
            </div>
            <div className="text-[10px] font-mono text-amber-300 font-bold">
              {levelBenefits.coinsMultiplier.toFixed(2)}× Multiplicative Coins
            </div>
          </div>
        </div>

        {/* EXP Progress Bar */}
        <div className="space-y-2 bg-slate-950/60 border border-purple-900/40 p-4 rounded-2xl">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-300 font-bold">Progress to Level {levelInfo.level + 1}</span>
            <span className="text-purple-300">
              {fmt(levelInfo.currentLevelXp)} / {fmt(levelInfo.nextLevelXp)} XP ({levelInfo.progressPercent}%)
            </span>
          </div>
          <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-800 p-0.5">
            <div
              className="h-full bg-gradient-to-r from-purple-500 via-indigo-400 to-cyan-400 rounded-full transition-all duration-500 shadow-[0_0_12px_rgba(168,85,247,0.8)] relative"
              style={{ width: `${levelInfo.progressPercent}%` }}
            >
              <div className="absolute inset-0 bg-white/25 animate-pulse" />
            </div>
          </div>
        </div>

        {/* Milestone Perks Grid */}
        <div className="space-y-2.5">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-amber-400" />
            <span>Level Milestone Perks</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {LEVEL_MILESTONES.map(m => {
              const isUnlocked = levelInfo.level >= m.level;
              return (
                <div
                  key={m.level}
                  className={`p-3 rounded-xl border text-xs space-y-1 transition-all ${
                    isUnlocked
                      ? 'bg-purple-950/30 border-purple-500/40 text-purple-200'
                      : 'bg-slate-950/40 border-slate-800/80 text-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className="flex items-center gap-1.5">
                      {isUnlocked ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Crown className="w-3.5 h-3.5 text-slate-600" />
                      )}
                      <span>Lvl {m.level}: {m.name}</span>
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                      isUnlocked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-600'
                    }`}>
                      {isUnlocked ? 'UNLOCKED' : 'LOCKED'}
                    </span>
                  </div>
                  <p className={`text-[11px] leading-relaxed ${isUnlocked ? 'text-slate-300' : 'text-slate-600'}`}>
                    {m.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. Statistics */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-2.5">
          <BarChart3 className="w-5 h-5 text-indigo-400" />
          <h2 className="text-lg font-black text-white">Player Statistics</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Luck Rating
            </span>
            <span className="text-sm font-black text-cyan-300 block truncate">
              {luckRating}
            </span>
            <span className="text-[10px] text-slate-500">Odds vs Rolls</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Rolls Since Best
            </span>
            <span className="text-sm font-black text-white block">
              {fmt(state.rollsSinceBest ?? 0)}
            </span>
            <span className="text-[10px] text-slate-500">Dry streak rolls</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Run Rolls
            </span>
            <span className="text-sm font-black text-white block">
              {fmt(state.currentRunRolls ?? state.totalRolls)}
            </span>
            <span className="text-[10px] text-slate-500">Total: {fmt(state.totalRolls)}</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Prestiges
            </span>
            <span className="text-sm font-black text-fuchsia-300 block">
              {state.prestigeCount}
            </span>
            <span className="text-[10px] text-slate-500">Resets completed</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Current Run Value
            </span>
            <span className="text-sm font-black text-amber-300 block">
              {fmt(state.collectionValue ?? 0)}
            </span>
            <span className="text-[10px] text-slate-500">For prestige</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Quests Completed
            </span>
            <span className="text-sm font-black text-emerald-300 block">
              {state.questsCompleted ?? 0}
            </span>
            <span className="text-[10px] text-slate-500">Daily & weekly</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Total Crits
            </span>
            <span className="text-sm font-black text-rose-300 block">
              {fmt(state.totalCrits ?? 0)}
            </span>
            <span className="text-[10px] text-slate-500">Critical rolls</span>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
              Guild Contribution
            </span>
            <span className="text-sm font-black text-purple-300 block">
              {fmt(state.guildContribution ?? 0)}
            </span>
            <span className="text-[10px] text-slate-500">Points & donations</span>
          </div>
        </div>
      </div>

      {/* 2. Prestige System */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-fuchsia-400">
              <RotateCcw className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-black text-white">Prestige</h2>
                <span className="text-xs font-bold bg-fuchsia-500/20 text-fuchsia-300 px-2.5 py-0.5 rounded-full border border-fuchsia-500/30">
                  {fmt(state.cosmicDust)} Cosmic Dust
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Resets current run collection value, coins, and base upgrades to 0. Permanent upgrades, discovered collection, and cosmetics are kept.
              </p>
            </div>
          </div>

          {confirmingPrestige ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  sound.playClick();
                  setConfirmingPrestige(false);
                  void onPrestige();
                }}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl text-xs font-black bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-md active:scale-95 transition-all cursor-pointer"
              >
                Confirm Reset (+{pendingDust} Dust)
              </button>
              <button
                onClick={() => {
                  sound.playClick();
                  setConfirmingPrestige(false);
                }}
                className="px-3 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                sound.playClick();
                setConfirmingPrestige(true);
              }}
              disabled={!canPrestige || busy}
              className={`px-5 py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                canPrestige
                  ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-md active:scale-95 cursor-pointer'
                  : 'bg-slate-950 text-slate-500 border border-slate-800 cursor-not-allowed'
              }`}
            >
              <Sparkles className="w-4 h-4 text-fuchsia-300" />
              <span>
                {canPrestige
                  ? `Prestige (+${pendingDust} Cosmic Dust)`
                  : `Requires 1,000,000 Collection Value (${fmt(currentRunVal)} / 1,000,000)`}
              </span>
            </button>
          )}
        </div>

        {/* Shard Synthesis (Unlocks with shardSynthesis prestige upgrade) */}
        {hasForgeUpgrade && (
          <div className="bg-gradient-to-r from-slate-950 via-orange-950/20 to-slate-950 border border-orange-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400">
                <Hammer className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-white">Dust Synthesis</h3>
                  <span className="text-[10px] font-bold uppercase bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">
                    Active
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Convert 10 Shards into 1 Cosmic Dust.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                sound.playClick();
                void onSynthesizeDust();
              }}
              disabled={!canSynthesize || busy}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
                canSynthesize
                  ? 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow-lg active:scale-95 cursor-pointer'
                  : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Forge 1 Dust ({SHARD_SYNTHESIS_COST} Shards)</span>
            </button>
          </div>
        )}

        {/* Category Filters for Prestige Tree */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              onClick={() => {
                sound.playClick();
                setFilterCategory('all');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                filterCategory === 'all'
                  ? 'bg-fuchsia-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-950/60'
              }`}
            >
              All Upgrades ({upgradeKeys.length})
            </button>

            <button
              onClick={() => {
                sound.playClick();
                setFilterCategory('qol');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterCategory === 'qol'
                  ? 'bg-cyan-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-950/60'
              }`}
            >
              <BellRing className="w-3.5 h-3.5 text-cyan-400" />
              <span>QoL & Controls</span>
            </button>

            <button
              onClick={() => {
                sound.playClick();
                setFilterCategory('core');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterCategory === 'core'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-950/60'
              }`}
            >
              <Clover className="w-3.5 h-3.5 text-purple-400" />
              <span>Core</span>
            </button>

            <button
              onClick={() => {
                sound.playClick();
                setFilterCategory('alchemy');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                filterCategory === 'alchemy'
                  ? 'bg-amber-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white bg-slate-950/60'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Alchemy</span>
            </button>
          </div>

          <span className="text-xs font-mono text-fuchsia-300">
            {fmt(state.cosmicDust)} Dust Available
          </span>
        </div>

        {/* Permanent Upgrades Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filteredUpgrades.map(id => {
            const info: PrestigeUpgradeInfo = PRESTIGE_UPGRADES[id];
            const currentLevel = state.prestigeUpgrades?.[id] ?? 0;
            const isMax = currentLevel >= info.maxLevel;
            const cost = isMax ? 0 : prestigeUpgradeCost(id, currentLevel);
            const canAfford = state.cosmicDust >= cost && !isMax;

            return (
              <div
                key={id}
                className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3 hover:border-slate-700/80 transition-all shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-slate-900 border border-slate-800">
                        {getUpgradeIcon(id)}
                      </div>
                      <div>
                        <span className="text-sm font-bold text-white block">{info.name}</span>
                        {info.qol && (
                          <span className="text-[9px] uppercase font-black tracking-wider text-cyan-400 bg-cyan-500/10 px-1.5 py-0.2 rounded">
                            QoL Feature
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs font-bold text-fuchsia-400 bg-fuchsia-950/40 border border-fuchsia-800/40 px-2 py-0.5 rounded-lg">
                      Lv {currentLevel}/{info.maxLevel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">{info.desc}</p>
                </div>

                <button
                  onClick={() => {
                    sound.playClick();
                    void onBuyPrestigeUpgrade(id);
                  }}
                  disabled={!canAfford || busy || isMax}
                  className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    isMax
                      ? 'bg-slate-900 text-slate-500 border border-slate-800 cursor-default'
                      : canAfford
                      ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white shadow-md active:scale-95 cursor-pointer'
                      : 'bg-slate-900 text-slate-500 border border-slate-800/80 cursor-not-allowed'
                  }`}
                >
                  {isMax ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Maxed Out</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Upgrade ({cost} Cosmic Dust)</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Cosmetics & Customization */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Palette className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-black text-white">Orb Skins & Auras</h3>
          </div>
          <span className="text-xs text-slate-400">
            {state.unlockedCosmetics.length}/{COSMETICS.length} Unlocked
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {COSMETICS.map((cosmetic: CosmeticItem) => {
            const isOwned = state.unlockedCosmetics.includes(cosmetic.id);
            const isActive = state.activeCosmetic === cosmetic.id;
            const canAfford =
              state.coins >= cosmetic.costCoins &&
              (state.shards ?? 0) >= cosmetic.costShards;

            return (
              <div
                key={cosmetic.id}
                className={`bg-slate-950/60 border rounded-2xl p-4 flex flex-col justify-between space-y-3 transition-all ${
                  isActive
                    ? 'border-cyan-500 ring-2 ring-cyan-500/20'
                    : isOwned
                    ? 'border-slate-700'
                    : 'border-slate-800/80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white">{cosmetic.name}</span>
                    {isActive && (
                      <span className="text-[10px] font-bold bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded">
                        EQUIPPED
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{cosmetic.desc}</p>
                </div>

                {isOwned ? (
                  <button
                    onClick={() => {
                      sound.playClick();
                      void onBuyCosmetic(cosmetic.id);
                    }}
                    disabled={isActive || busy}
                    className={`w-full py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-slate-500 cursor-default'
                        : 'bg-slate-800 hover:bg-slate-700 text-white'
                    }`}
                  >
                    {isActive ? 'Equipped' : 'Equip Skin'}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      sound.playClick();
                      void onBuyCosmetic(cosmetic.id);
                    }}
                    disabled={!canAfford || busy}
                    className={`w-full py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                      canAfford
                        ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md active:scale-95 cursor-pointer'
                        : 'bg-slate-900 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <Gem className="w-3.5 h-3.5" />
                    <span>
                      Unlock ({cosmetic.costShards > 0 ? `${cosmetic.costShards} Shards` : `${fmt(cosmetic.costCoins)} Coins`})
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
