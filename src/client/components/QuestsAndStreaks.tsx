import React, { useRef, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Flame,
  Gift,
  Coins,
  Award,
  Gem,
} from 'lucide-react';
import type { PlayerState } from '../../shared/game.js';
import { formatNumber, todayKey } from '../../shared/game.js';
import { sound } from '../sound.js';

interface QuestsAndStreaksProps {
  state: PlayerState;
  onClaimDailyStreak: () => Promise<void>;
  onClaimQuest: (type: 'daily' | 'weekly', id: string) => Promise<void>;
  busy: boolean;
}

export const QuestsAndStreaks: React.FC<QuestsAndStreaksProps> = ({
  state,
  onClaimDailyStreak,
  onClaimQuest,
  busy,
}) => {
  const fmt = (n: number) => formatNumber(Number.isFinite(n) ? Math.max(0, n) : 0);
  const [claimPending, setClaimPending] = useState(false);
  const [claimError, setClaimError] = useState('');
  const claimLockRef = useRef(false);
  const runClaim = async (claim: () => Promise<void>) => {
    if (busy || claimLockRef.current) return;
    claimLockRef.current = true;
    setClaimPending(true);
    setClaimError('');
    try {
      await claim();
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'Reward claim was not confirmed. Refresh the quest state before retrying.');
    } finally {
      claimLockRef.current = false;
      setClaimPending(false);
    }
  };
  const today = todayKey();
  const questProgressPct = (progress: number, target: number, unlocked: boolean) =>
    unlocked ? Math.max(0, Math.min(100, Math.round((Math.max(0, progress) / Math.max(1, target)) * 100))) : 0;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const lastClaimDate = typeof state.streak.lastClaimDate === 'string' ? state.streak.lastClaimDate : '';
  const alreadyClaimedStreak = lastClaimDate === today;
  const streakCount = Number.isSafeInteger(state.streak.count) ? Math.max(0, state.streak.count) : 0;
  const streakIsActive = alreadyClaimedStreak || lastClaimDate === yesterday;
  const previewStreakCount = alreadyClaimedStreak ? Math.max(1, streakCount) + 1 : lastClaimDate === yesterday ? Math.max(1, streakCount) + 1 : 1;
  const streakRewardDay = ((previewStreakCount - 1) % 7) + 1;
  const streakRewards = [
    { day: 1, coins: 100, shards: 0 },
    { day: 2, coins: 200, shards: 0 },
    { day: 3, coins: 300, shards: 1 },
    { day: 4, coins: 400, shards: 0 },
    { day: 5, coins: 500, shards: 0 },
    { day: 6, coins: 600, shards: 0 },
    { day: 7, coins: 700, shards: 5 },
  ] as const;
  const streakReward = streakRewards[streakRewardDay - 1] ?? streakRewards[0];
  const reward = streakReward;
  const rawCommunity = state.dailyStreakCommunity;
  const rawCommunityTier = Number(rawCommunity?.tier ?? 1);
  const safeCommunityTier = Number.isSafeInteger(rawCommunityTier) && rawCommunityTier >= 1 ? rawCommunityTier : 1;
  const rawCommunityGoal = Number(rawCommunity?.goal ?? 250);
  const safeCommunityGoal = Number.isFinite(rawCommunityGoal) && rawCommunityGoal > 0 ? rawCommunityGoal : 250;
  const rawCommunityProgress = Number(rawCommunity?.currentProgress ?? 0);
  const safeCommunityProgress = Number.isFinite(rawCommunityProgress) ? Math.max(0, rawCommunityProgress) : 0;
  const communityProgressPct = Math.max(0, Math.min(100, Math.round(safeCommunityProgress / safeCommunityGoal * 100)));
  const rawLuckMultiplier = Number(rawCommunity?.luckMultiplier ?? 1);
  const safeLuckMultiplier = Number.isFinite(rawLuckMultiplier) ? Math.max(1, Math.min(100, rawLuckMultiplier)) : 1;
  const rawSpeedMultiplier = Number(rawCommunity?.speedMultiplier ?? 1);
  const safeSpeedMultiplier = Number.isFinite(rawSpeedMultiplier) ? Math.max(0.6, Math.min(1, rawSpeedMultiplier)) : 1;
  const progressPercent = (progress: number, target: number) => {
    const safeProgress = Number(progress), safeTarget = Number(target);
    if (!Number.isFinite(safeProgress) || !Number.isFinite(safeTarget) || safeTarget <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(safeProgress / safeTarget * 100)));
  };

  return (
    <div className="io-page-shell io-page-quests max-w-4xl mx-auto space-y-6">
      {claimError && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">{claimError}</div>}
      {/* Daily Streak */}
      <div className="io-page-hero bg-gradient-to-r from-slate-900 via-emerald-950/15 to-slate-900 border border-emerald-500/20 rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-300">
              <Flame className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-black text-white">Daily Streak</h2>
                <span className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-black text-xs px-2 py-0.5 rounded-full">
                  {alreadyClaimedStreak ? 'Claimed' : 'Ready'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Current streak: <span className="font-black text-white">{streakIsActive ? streakCount : 0}</span> days · Longest: {fmt(state.streak.longestStreak)} days.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-busy={busy || claimPending}
            onClick={() => {
              sound.playClick();
              void runClaim(onClaimDailyStreak);
            }}
            disabled={alreadyClaimedStreak || busy || claimPending}
            className={alreadyClaimedStreak ? 'bg-slate-800 text-slate-500 border border-slate-700/50 cursor-not-allowed px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-900/30 active:scale-95 px-5 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all'}
          >
            <Gift className="w-4 h-4" />
            <span>{alreadyClaimedStreak ? 'Claimed Today' : 'Claim Daily Reward'}</span>
          </button>
        </div>
        <div className="mt-3 text-[11px] text-slate-400" role="status" aria-live="polite">{alreadyClaimedStreak ? `Today's reward is claimed. The preview below shows the next reward.` : `Next claim preview: Day ${streakRewardDay} of 7.`}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {(() => {
            const day = streakRewardDay;
            return [
              <div key="coins" className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                <span className="block text-[10px] uppercase font-black text-amber-300/70">Coins</span>
                <span className="text-lg font-black text-white">+{fmt(reward.coins)}</span>
              </div>,
              <div key="shards" className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                <span className="block text-[10px] uppercase font-black text-cyan-300/70">Shards</span>
                <span className="text-lg font-black text-white">+{fmt(reward.shards)}</span>
                <span className="block text-[9px] text-cyan-400/70">Free reward; does not use the roll-earned Shard cap</span>
              </div>,
              <div key="rolls" className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-3">
                <span className="block text-[10px] uppercase font-black text-purple-300/70">Free Rolls</span>
                <span className="text-lg font-black text-white">+{day * 5}</span>
                <span className="block text-[9px] text-slate-500">Manual Free Rolls skip normal cooldown. Frenzy and Chain Patcher are used first.</span>
              </div>,
              <div key="community" className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
                <span className="block text-[10px] uppercase font-black text-fuchsia-300/70">Community Tier</span>
                <span className="text-lg font-black text-white">Tier {fmt(safeCommunityTier)}</span>
                <span className="block text-[9px] text-slate-500">Streak count adds to progress</span>
              </div>,
            ];
          })()}
        </div>
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-emerald-300">Daily Streak Community Goal</div>
              <div className="text-[11px] text-slate-500 mt-1">Each claim contributes your full streak number.</div>
            </div>
            <div className="text-right text-[10px] font-black text-slate-400">
              {fmt(safeCommunityProgress)} / {fmt(safeCommunityGoal)}
            </div>
          </div>
          <div role="progressbar" aria-label="Daily Streak Community Goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={communityProgressPct} aria-valuetext={`${fmt(safeCommunityProgress)} of ${fmt(safeCommunityGoal)}`} className="mt-2 h-2 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: communityProgressPct + "%" }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-bold">
            <span className="text-emerald-300">+{Math.max(0, Math.round((safeLuckMultiplier - 1) * 100))}% Luck</span>
            <span className="text-cyan-300">+{Math.max(0, Math.round((1 - safeSpeedMultiplier) * 100))}% Speed</span>
            <span className="text-slate-500">Next tier after the goal is completed.</span>
          </div>
        </div>
      </div>
      {/* Daily Quests (GDD Section 11) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-purple-400" />
            <h3 className="text-base font-black text-white">Daily Quests</h3>
          </div>
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Resets daily at midnight UTC</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {state.dailyQuests.map(q => {
            const isUnlocked = q.unlocked !== false;
            const progress = Number.isFinite(q.progress) && q.progress >= 0 ? q.progress : 0;
            const target = Number.isFinite(q.target) && q.target > 0 ? q.target : 1;
            const isComplete = isUnlocked && progress >= target;
            const pct = isUnlocked ? progressPercent(progress, target) : 0;

            return (
              <div
                key={q.id}
                className={`bg-slate-900/80 border rounded-2xl p-4 flex flex-col justify-between space-y-3 ${isComplete && !q.claimed ? "border-emerald-500/50 shadow-lg shadow-emerald-950/20" : "border-slate-800"}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{q.title}</h4>
                        {!isUnlocked && (
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
                            🔒 Locked
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{q.desc}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300 shrink-0">
                      <Coins className="w-3.5 h-3.5 text-amber-400" />
                      <span>+{fmt(q.rewardCoins)}</span>
                      {q.rewardShards && (
                        <span className="inline-flex items-center gap-1 text-cyan-400">+{fmt(q.rewardShards)} <Gem className="h-3 w-3" aria-hidden="true" /></span>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] font-semibold text-slate-400 mb-1">
                      <span>Progress</span>
                      <span>
                        {fmt(progress)} / {fmt(target)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800" role="progressbar" aria-label={q.title + ' progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <div
                        className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Claim Button */}
                <div>
                  {q.claimed ? (
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Claimed</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-busy={busy || claimPending}
                      aria-label={isComplete ? `Claim reward for daily quest: ${q.title}` : `${q.title}, ${fmt(progress)} of ${fmt(target)} complete`}
                      onClick={() => {
                        sound.playClick();
                        void runClaim(() => onClaimQuest('daily', q.id));
                      }}
                      disabled={!isComplete || busy || claimPending}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        isComplete
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md active:scale-95'
                          : 'bg-slate-950 text-slate-500 border border-slate-800 cursor-not-allowed'
                      }`}
                    >
                      <span>{!isUnlocked ? 'Locked' : isComplete ? 'Claim Reward' : 'In Progress'}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Weekly Quests (GDD Section 11) */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-cyan-400" />
            <h3 className="text-base font-black text-white">Weekly Quests</h3>
          </div>
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Resets weekly</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {state.weeklyQuests.map(q => {
            const isUnlocked = q.unlocked !== false;
            const progress = Number.isFinite(q.progress) && q.progress >= 0 ? q.progress : 0;
            const target = Number.isFinite(q.target) && q.target > 0 ? q.target : 1;
            const isComplete = isUnlocked && progress >= target;
            const pct = questProgressPct(progress, target, isUnlocked);

            return (
              <div
                key={q.id}
                className={`bg-slate-900/80 border rounded-2xl p-4 flex flex-col justify-between space-y-3 ${isComplete && !q.claimed ? "border-cyan-500/50 shadow-lg shadow-cyan-950/20" : "border-slate-800"}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white">{q.title}</h4>
                        {!isUnlocked && <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">Locked</span>}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{q.desc}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold shrink-0">
                      <span className="text-amber-400">+{fmt(q.rewardCoins)} 🪙</span>
                      {q.rewardShards && (
                        <span className="inline-flex items-center gap-1 text-cyan-400">+{fmt(q.rewardShards)} <Gem className="h-3 w-3" aria-hidden="true" /></span>
                      )}
                      {q.rewardTokens && (
                        <span className="inline-flex items-center gap-1 text-purple-400">+{fmt(q.rewardTokens)} <Award className="h-3 w-3" aria-hidden="true" /></span>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-[11px] font-semibold text-slate-400 mb-1">
                      <span>Progress</span>
                      <span>
                        {fmt(progress)} / {fmt(target)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800" role="progressbar" aria-label={q.title + ' progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <div
                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Claim Button */}
                <div>
                  {q.claimed ? (
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Claimed</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-busy={busy || claimPending}
                      aria-label={isComplete ? `Claim reward for weekly quest: ${q.title}` : `${q.title}, ${fmt(progress)} of ${fmt(target)} complete`}
                      onClick={() => {
                        sound.playClick();
                        void runClaim(() => onClaimQuest('weekly', q.id));
                      }}
                      disabled={!isComplete || busy || claimPending}
                      className={`w-full py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                        isComplete
                          ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md active:scale-95'
                          : 'bg-slate-950 text-slate-500 border border-slate-800 cursor-not-allowed'
                      }`}
                    >
                      <span>{!isUnlocked ? 'Locked' : isComplete ? 'Claim Reward' : 'In Progress'}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
