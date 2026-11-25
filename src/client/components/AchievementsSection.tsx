import React, { useRef, useState } from 'react';
import { Trophy, CheckCircle2, Lock, Coins, Gem, Sparkles } from 'lucide-react';
import type { Achievement } from '../../shared/social.js';
import type { PlayerState } from '../../shared/game.js';
import { sound } from '../sound.js';

interface AchievementsSectionProps {
  achievements: Achievement[];
  state: PlayerState;
  onClaimAchievement: (id: string) => Promise<void>;
  busy: boolean;
}

export const AchievementsSection: React.FC<AchievementsSectionProps> = ({
  achievements,
  state,
  onClaimAchievement,
  busy,
}) => {
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'claimed'>('all');
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState('');
  const claimLockRef = useRef(false);
  const fmt = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString();
  const handleClaim = async (id: string) => {
    if (busy || claimLockRef.current) return;
    claimLockRef.current = true;
    setClaimingId(id);
    setClaimError('');
    try {
      await onClaimAchievement(id);
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'Achievement reward could not be claimed. Please retry.');
    } finally {
      claimLockRef.current = false;
      setClaimingId(null);
    }
  };

  const total = achievements.length;
  const unlockedCount = achievements.filter(a => a.unlocked).length;
  const claimedCount = achievements.filter(a => a.claimed).length;
  const readyToClaimCount = achievements.filter(a => a.unlocked && !a.claimed).length;
  const progressPct = total > 0 ? Math.max(0, Math.min(100, Math.round((unlockedCount / total) * 100))) : 0;

  const filtered = achievements.filter(a => {
    if (filter === 'unlocked') return a.unlocked && !a.claimed;
    if (filter === 'claimed') return a.claimed;
    return true;
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {claimError && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/30 px-4 py-3 text-xs text-rose-200">{claimError}</div>}
      {/* Header Overview Card */}
      <div className="bg-gradient-to-r from-slate-900 via-amber-950/20 to-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-400">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-white">Achievements & Trophies</h2>
                <span className="text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  {unlockedCount} / {total} Unlocked
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Hit milestones to earn Coins, Shards, and prestigious badges.
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-500 block">
              Claimed Rewards
            </span>
            <span className="text-base font-black text-white">
              {claimedCount} / {unlockedCount} Claimed
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800" role="progressbar" aria-label="Achievement unlock progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct}>
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div role="group" aria-label="Filter achievements" className="flex flex-wrap items-center gap-2">
        <button
          type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            filter === 'all'
              ? 'bg-amber-500 text-slate-950 font-black shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          All ({total})
        </button>
        <button
          type="button" aria-pressed={filter === 'unlocked'} onClick={() => setFilter('unlocked')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            filter === 'unlocked'
              ? 'bg-emerald-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          Ready to Claim ({readyToClaimCount})
        </button>
        <button
          type="button" aria-pressed={filter === 'claimed'} onClick={() => setFilter('claimed')}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
            filter === 'claimed'
              ? 'bg-slate-700 text-white shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          Claimed ({claimedCount})
        </button>
      </div>

      {/* Achievements List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center space-y-2" role="status" aria-live="polite">
          <Trophy className="w-7 h-7 mx-auto text-slate-600" />
          <p className="text-sm font-bold text-slate-300">
            {filter === 'unlocked' ? 'No rewards ready to claim' : filter === 'claimed' ? 'No rewards collected yet' : 'No achievements found'}
          </p>
          <p className="text-xs text-slate-500">
            {filter === 'unlocked' ? 'Keep playing to unlock your next achievement.' : filter === 'claimed' ? 'Claim an unlocked achievement and it will appear here.' : 'Achievement progress will appear here as you play.'}
          </p>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {filtered.map(ach => (
          <div
            key={ach.id}
            className={`rounded-2xl p-4 border transition-all flex flex-col justify-between space-y-3 ${
              ach.claimed
                ? 'bg-slate-950/60 border-slate-800/80 opacity-70'
                : ach.unlocked
                ? 'bg-gradient-to-br from-slate-900 to-amber-950/20 border-amber-500/40 shadow-lg'
                : 'bg-slate-950/50 border-slate-900 text-slate-500'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-xl text-sm ${
                    ach.claimed
                      ? 'bg-slate-900 text-emerald-400 border border-slate-800'
                      : ach.unlocked
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-slate-950 text-slate-600 border border-slate-900'
                  }`}
                >
                  {ach.claimed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : ach.unlocked ? (
                    <Trophy className="w-5 h-5 text-amber-400" />
                  ) : (
                    <Lock className="w-5 h-5 text-slate-600" />
                  )}
                </div>
                <div>
                  <h4
                    className={`text-sm font-bold ${
                      ach.unlocked ? 'text-white' : 'text-slate-400'
                    }`}
                  >
                    {ach.name}
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">{ach.description}</p>
                </div>
              </div>

              {/* Rewards Indicator */}
              <div className="text-right shrink-0 text-xs font-bold space-y-0.5">
                <div className="inline-flex items-center justify-end gap-1 text-amber-400"><Coins className="h-3 w-3" aria-hidden="true" /> +{fmt(ach.rewardCoins)}</div>
                {ach.rewardShards && (
                  <div className="inline-flex items-center justify-end gap-1 text-cyan-400"><Gem className="h-3 w-3" aria-hidden="true" /> +{fmt(ach.rewardShards)}</div>
                )}
              </div>
            </div>

            {/* Action Area */}
            <div className="pt-2 border-t border-slate-800/50 flex justify-end">
              {ach.claimed ? (
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Reward Collected</span>
                </span>
              ) : ach.unlocked ? (
                <button
                  type="button"
                  onClick={() => {
                    sound.playClick();
                    void handleClaim(ach.id);
                  }}
                  aria-label={`Claim ${ach.name} reward: ${fmt(ach.rewardCoins)} Coins${ach.rewardShards ? ` and ${fmt(ach.rewardShards)} Shards` : ""}`}
                  disabled={busy || claimingId !== null}
                  aria-busy={busy}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-slate-950 font-black text-xs shadow-md active:scale-95 transition-all"
                >
                  {claimingId === ach.id ? 'Claiming…' : 'Claim Reward'}
                </button>
              ) : (
                <span className="text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  <span>Locked</span>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
};
