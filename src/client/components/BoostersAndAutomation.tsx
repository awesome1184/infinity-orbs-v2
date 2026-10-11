import React, { useEffect, useState } from 'react';
import {
  Bot,
  Clock,
  Coins,
  Gauge,
  Gift,
  Sparkles,
  Star,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import type {
  AutomationId,
  GlobalBoosterId,
  GlobalBoosterSnapshot,
  PlayerState,
  PremiumBoosterId,
} from '../../shared/game.js';
import type { WorldEvent } from '../../shared/social.js';
import {
  AUTOMATIONS,
  FREE_SHARD_DAILY_CAP,
  GLOBAL_BOOSTERS,
  decayGlobalBoosterState,
  globalBoosterRemainingMs,
  globalBoosterTimeProgress,
  globalBoosterLuckMultiplier,
  globalBoosterSpeedMultiplier,
  globalBoosterCritChanceBonus,
  globalBoosterCritLuckBonus,
  globalBoosterBarColor,

  PREMIUM_BOOSTERS,
  onlinePlayerLuckMultiplier,
  premiumBoosterRemainingMs,
  formatNumber,
} from '../../shared/game.js';

interface BoostersAndAutomationProps {
  state: PlayerState;
  busy: boolean;
  globalBoosters: GlobalBoosterSnapshot;
  onActivateBooster: (id: PremiumBoosterId) => Promise<void>;
  onActivateGlobalBooster: (id: GlobalBoosterId, useCredit: boolean) => Promise<void>;
  worldEvent?: WorldEvent | null;
  onBuyAutomation: (id: AutomationId) => Promise<void>;
  onClaimCommunityReward: () => Promise<void>;
}

const boosterIcons: Record<PremiumBoosterId, React.ReactNode> = {
  fortune: <Star className="w-5 h-5 text-amber-300" />,
  hyperdrive: <Gauge className="w-5 h-5 text-cyan-300" />,
  barrage: <Zap className="w-5 h-5 text-fuchsia-300" />,
  prosperity: <Coins className="w-5 h-5 text-yellow-300" />,
  ascension: <Sparkles className="w-5 h-5 text-purple-300" />,
};

const automationIcons: Record<AutomationId, React.ReactNode> = {
  autoQuestClaim: <Gift className="w-5 h-5 text-emerald-300" />,
  autoStreakClaim: <Clock className="w-5 h-5 text-amber-300" />,
  autoCommunityClaim: <Users className="w-5 h-5 text-indigo-300" />,
  autoOfflineClaim: <Clock className="w-5 h-5 text-teal-300" />,
  autoUpgrade: <TrendingUp className="w-5 h-5 text-cyan-300" />,
};

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return days + 'd ' + hours + 'h ' + minutes + 'm';
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  return minutes + 'm ' + seconds + 's';
}

export const BoostersAndAutomation: React.FC<BoostersAndAutomationProps> = ({
  state,
  busy,
  globalBoosters,
  worldEvent,
  onActivateBooster,
  onActivateGlobalBooster,
  onBuyAutomation,
  onClaimCommunityReward,
}) => {
  const [now, setNow] = useState(Date.now());
  const [activatingGlobalBooster, setActivatingGlobalBooster] = useState<GlobalBoosterId | null>(null);

  const handleGlobalActivation = async (id: GlobalBoosterId, useCredit: boolean) => {
    if (activatingGlobalBooster) return;
    setActivatingGlobalBooster(id);
    try {
      await onActivateGlobalBooster(id, useCredit);
    } finally {
      setActivatingGlobalBooster(null);
    }
  };

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  const onlinePlayers = Math.max(1, state.onlinePlayers ?? 1);
  const onlineLuck = onlinePlayerLuckMultiplier(onlinePlayers);
  const freeShards = Math.min(FREE_SHARD_DAILY_CAP, state.freeShardsEarnedToday ?? 0);
  const completedCommunityTier = Math.max(
    0,
    Math.floor(Number(worldEvent?.completedTier ?? Math.max(0, (worldEvent?.tier ?? 1) - 1)) || 0),
  );
  const claimedCommunityTier = Math.max(0, Math.floor(Number(state.communityRewardClaimedTier ?? 0) || 0));
  const nextCommunityRewardTier = claimedCommunityTier + 1;
  const communityRewardReady = completedCommunityTier >= nextCommunityRewardTier;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <section className="rounded-3xl border border-indigo-500/25 bg-gradient-to-br from-slate-900 via-indigo-950/20 to-slate-900 p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-white">Boosters & Automation</h2>
              <Sparkles className="w-4 h-4 text-purple-300 animate-pulse" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2">
              <span className="block text-[10px] uppercase font-black text-cyan-300/70">Online</span>
              <span className="text-lg font-black text-cyan-200">{formatNumber(onlinePlayers)}</span>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
              <span className="block text-[10px] uppercase font-black text-emerald-300/70">Online Luck</span>
              <span className="text-lg font-black text-emerald-200">×{onlineLuck.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div>
            <span className="font-black text-cyan-300">Free Shards today: {freeShards}/{FREE_SHARD_DAILY_CAP}</span>
            <span className="text-slate-500 ml-2">Gameplay earnings are capped server-side.</span>
          </div>
          <div className="text-slate-400">
            {formatNumber(state.shards)} Shards available
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-fuchsia-500/20 bg-gradient-to-br from-slate-900 via-fuchsia-950/10 to-slate-900 p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-white">Global Boosters</h3>
              <Users className="w-4 h-4 text-fuchsia-300" />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Each booster runs independently. Every activation adds 2 hours to its timer.
              Higher tiers also make its timer drain faster: every tier adds 10% to the timer drain rate.
              Tier 1 = ×1.10 drain, Tier 10 = ×2.00 drain.
            </p>
          </div>
          <div className="text-[11px] font-bold text-fuchsia-200">
            Free Global Boosts: {state.globalBoosterCredits ?? 0}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
          {(Object.keys(GLOBAL_BOOSTERS) as GlobalBoosterId[]).map(id => {
            const displayed = decayGlobalBoosterState(globalBoosters[id], now);
            const remaining = globalBoosterRemainingMs(displayed, now);
            const active = remaining > 0 && displayed.tier > 0;
            const activationProgress = Math.max(0, Math.min(4, displayed.activationProgress ?? 0));
            const timeProgress = globalBoosterTimeProgress(displayed, now);
            const timerDrainRate = displayed.tier > 0 ? 1 + displayed.tier * 0.10 : 1;
            const globalCost = Number(GLOBAL_BOOSTERS[id].costShards ?? 0);
            const canAffordGlobal = Number(state.shards ?? 0) >= globalCost;
            const effect = id === 'luck'
              ? '×' + globalBoosterLuckMultiplier(displayed, now).toFixed(2) + ' Luck'
              : id === 'speed'
                ? Math.round((1 - globalBoosterSpeedMultiplier(displayed, now)) * 100) + '% faster cooldown'
                : '+' + Math.round(globalBoosterCritChanceBonus(displayed, now) * 100) + '% Crit Chance, +' +
                  globalBoosterCritLuckBonus(displayed, now).toFixed(1) + '× Crit Luck';

            return (
              <div key={id} className="rounded-2xl border border-slate-800 bg-slate-950/65 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-white">{GLOBAL_BOOSTERS[id].name}</span>
                  <span className="text-[10px] font-black text-fuchsia-300">
                    {displayed.tier > 0 ? 'Tier ' + displayed.tier : 'Inactive'}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="relative h-2.5 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                    <div className="absolute inset-0 flex" aria-label={`Global ${GLOBAL_BOOSTERS[id].name} time`}>
                      {Array.from({ length: 4 }, (_, segmentIndex) => {
                        const history = displayed.segmentTiers ?? [];
                        const segmentTier = history.length > 0
                          ? (history[segmentIndex] ?? 0)
                          : segmentIndex < activationProgress
                            ? displayed.tier
                            : displayed.tier > 1
                              ? displayed.tier - 1
                              : 0;
                        return (
                          <div
                            key={segmentIndex}
                            className="h-full flex-1 min-w-0"
                            style={{
                              backgroundColor: segmentTier > 0
                                ? globalBoosterBarColor(segmentTier)
                                : 'transparent',
                              boxShadow: segmentTier > 0
                                ? `0 0 10px ${globalBoosterBarColor(segmentTier)}`
                                : 'none',
                            }}
                          />
                        );
                      })}
                    </div>
                    <div
                      className="absolute inset-y-0 right-0 bg-slate-800"
                      style={{
                        width: `calc(${100 - timeProgress}% + 1px)`,
                      }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                    <span className={active ? 'text-emerald-300 font-bold' : 'text-slate-500'}>
                      {active
                        ? formatDuration(remaining) + ' left'
                        : displayed.tier > 0
                          ? 'Ready to continue Tier ' + displayed.tier
                          : 'Inactive'}
                    </span>
                    {displayed.tier > 0 && displayed.tier < 10 && (
                      <span className="text-fuchsia-300 font-bold">{activationProgress}/4</span>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] font-bold text-fuchsia-300">
                    {displayed.tier > 0 ? effect : ''}
                  </div>
                  {displayed.tier > 0 && (
                    <div className="mt-1 text-[10px] text-slate-400">
                      Timer drain: <span className="font-black text-amber-300">×{timerDrainRate.toFixed(2)}</span> normal
                      {' • '}{id === 'speed' && displayed.tier >= 10 ? 'Tier 10 MAX' : '10% faster per tier'}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void handleGlobalActivation(id, false)}
                    disabled={activatingGlobalBooster !== null || !canAffordGlobal}
                    className="flex-1 px-2.5 py-2 rounded-xl text-[10px] font-black bg-slate-800 hover:bg-slate-700 text-white disabled:text-slate-500 disabled:cursor-not-allowed"
                  >
                    {`+2h • ${formatNumber(globalCost)} 💎`}
                  </button>
                  <button
                    onClick={() => void handleGlobalActivation(id, true)}
                    disabled={activatingGlobalBooster !== null}
                    className="px-2.5 py-2 rounded-xl text-[10px] font-black bg-fuchsia-600/20 border border-fuchsia-500/25 text-fuchsia-200 hover:bg-fuchsia-600/30 disabled:text-slate-600 disabled:cursor-not-allowed"
                    title="Use one free Global Booster activation. The server is authoritative if the displayed credit count is stale."
                  >
                    {activatingGlobalBooster === id ? 'Activating…' : 'Free • ' + (state.globalBoosterCredits ?? 0)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Zap className="w-4 h-4 text-amber-300" />
          <h3 className="text-sm font-black text-white uppercase tracking-wide">Premium Boosters</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(Object.keys(PREMIUM_BOOSTERS) as PremiumBoosterId[]).map(id => {
            const info = PREMIUM_BOOSTERS[id];
            const remaining = premiumBoosterRemainingMs(state, id, now);
            const active = remaining > 0;
            const canAfford = state.shards >= info.costShards;

            return (
              <div key={id} className="rounded-2xl border border-slate-800 bg-slate-900/85 p-4 shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      {boosterIcons[id]}
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-white">{info.name}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">{info.desc}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-black text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-2 py-1">
                    {info.costShards} 💎
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className={active ? 'text-emerald-300 text-xs font-black' : 'text-slate-500 text-xs font-bold'}>
                    {active ? 'ACTIVE • ' + formatDuration(remaining) + ' left' : 'Ready to activate'}
                  </span>
                  <button
                    onClick={() => void onActivateBooster(id)}
                    disabled={busy || !canAfford}
                    className={
                      active
                        ? 'px-3 py-2 rounded-xl text-xs font-black transition-all bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 hover:bg-indigo-500/30 active:scale-95'
                        : canAfford
                          ? 'px-3 py-2 rounded-xl text-xs font-black transition-all bg-gradient-to-r from-cyan-600 to-indigo-600 text-white hover:from-cyan-500 hover:to-indigo-500 active:scale-95'
                          : 'px-3 py-2 rounded-xl text-xs font-black transition-all bg-slate-800 text-slate-500 cursor-not-allowed'
                    }
                  >
                    {active ? 'Extend' : 'Activate'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-slate-900 via-emerald-950/10 to-slate-900 p-5 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-emerald-300" />
              <h3 className="text-base font-black text-white">Community Reward</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              The community milestone is global and weekly. Reach the goal to raise the reward tier for everyone.
            </p>

            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="font-black text-emerald-300">
                  {formatNumber(worldEvent?.currentProgress ?? 0)} / {formatNumber(worldEvent?.goal ?? 100_000)} rolls
                </span>
                <span className="font-bold text-slate-500">
                  {communityRewardReady ? `Tier ${nextCommunityRewardTier} ready` : `Tier ${worldEvent?.tier ?? 1} in progress`}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-slate-800 overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{
                    width: Math.min(
                      100,
                      ((worldEvent?.currentProgress ?? 0) / Math.max(1, worldEvent?.goal ?? 100_000)) * 100,
                    ) + '%',
                  }}
                />
              </div>
              <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-slate-300">
                <span className="font-black text-amber-300">{worldEvent?.buffDescription ?? '+15% Global Luck Active'}</span>
                <span className="text-slate-500"> · expires in </span>
                <span className="font-black text-amber-200">
                  {worldEvent && worldEvent.endsAt > now
                    ? formatDuration(worldEvent.endsAt - now)
                    : '0m 0s'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right">
              <span className="block text-[10px] uppercase font-black text-slate-500">Reward tier</span>
              <span className={communityRewardReady ? 'text-sm font-black text-emerald-300' : 'text-sm font-black text-slate-500'}>
                {communityRewardReady ? nextCommunityRewardTier : completedCommunityTier}
              </span>
              <span className="block text-[10px] text-slate-600 mt-0.5">
                {communityRewardReady
                  ? `Claim Tier ${nextCommunityRewardTier} once`
                  : completedCommunityTier > claimedCommunityTier
                    ? `Tier ${completedCommunityTier} available`
                    : 'Complete the next community milestone'}
              </span>
            </div>
            <button
              onClick={() => void onClaimCommunityReward()}
              disabled={busy || !communityRewardReady}
              className={
                communityRewardReady
                  ? 'px-4 py-2.5 rounded-xl text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95'
                  : 'px-4 py-2.5 rounded-xl text-xs font-black bg-slate-800 text-slate-500 cursor-not-allowed'
              }
            >
              {communityRewardReady ? `Claim Tier ${nextCommunityRewardTier}` : 'No Reward'}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Bot className="w-4 h-4 text-cyan-300" />
          <h3 className="text-sm font-black text-white uppercase tracking-wide">Permanent Automation</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(Object.keys(AUTOMATIONS) as AutomationId[]).map(id => {
            const info = AUTOMATIONS[id];
            const owned = Boolean(state.automations?.[id]);
            const canAfford = state.shards >= info.costShards;

            return (
              <div key={id} className={
                owned
                  ? 'rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-4 shadow-md'
                  : 'rounded-2xl border border-slate-800 bg-slate-900/85 p-4 shadow-md'
              }>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                      {automationIcons[id]}
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-white">{info.name}</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">{info.desc}</p>
                    </div>
                  </div>
                  {owned ? (
                    <span className="text-[10px] font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-1">
                      UNLOCKED
                    </span>
                  ) : (
                    <span className="text-[10px] font-black text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-2 py-1">
                      {info.costShards} 💎
                    </span>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">
                    {id === 'autoCommunityClaim'
                      ? 'Claims community rewards as they become available.'
                      : id === 'autoQuestClaim'
                        ? 'Claims rewards as soon as objectives finish.'
                        : id === 'autoStreakClaim'
                          ? 'Keeps daily streak rewards from sitting unclaimed.'
                          : id === 'autoOfflineClaim'
                            ? 'Processes offline rolls as soon as they become claimable.'
                            : 'Keeps affordable standard upgrades flowing.'}
                  </span>
                  <button
                    onClick={() => void onBuyAutomation(id)}
                    disabled={busy || owned || !canAfford}
                    className={
                      owned
                        ? 'px-3 py-2 rounded-xl text-xs font-black bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 cursor-default'
                        : canAfford
                          ? 'px-3 py-2 rounded-xl text-xs font-black bg-slate-800 hover:bg-slate-700 text-white active:scale-95'
                          : 'px-3 py-2 rounded-xl text-xs font-black bg-slate-800 text-slate-500 cursor-not-allowed'
                    }
                  >
                    {owned ? 'Active' : 'Unlock'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
