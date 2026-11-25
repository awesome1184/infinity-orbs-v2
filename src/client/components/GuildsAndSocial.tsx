import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Users,
  Trophy,
  Globe,
  Plus,
  LogOut,
  Sparkles,
  Flame,
  Clover,
  Clock,
  Archive,
  Gem,
  Check,
  Coins,
  Zap,
  UserCheck,
  UserPlus,
  UserMinus,
  RefreshCw,
} from 'lucide-react';
import type {
  Guild,
  LeaderboardEntry,
  WorldEvent,
  GuildPerkId,
  LeaderboardBoards,
  LeaderboardId,
} from '../../shared/social.js';
import {
  formatRarity,
  formatNumber,
  decayGuildComboState,
  guildComboRemainingMs,
  guildComboLuckMultiplier,
  guildComboSpeedMultiplier,
  guildComboCritChanceBonus,
  guildComboCritLuckBonus,
  guildComboTimeProgress,
} from '../../shared/game.js';
import { sound } from '../sound.js';

interface GuildsAndSocialProps {
  guilds: Guild[];
  myGuild: Guild | null;
  leaderboard: LeaderboardEntry[];
  leaderboards?: LeaderboardBoards;
  worldEvent: WorldEvent | null;
  onCreateGuild: (name: string, tag: string) => Promise<boolean>;
  onJoinGuild: (id: string) => Promise<void>;
  onLeaveGuild: () => Promise<void>;
  onBuyGuildPerk?: (perk: GuildPerkId) => Promise<void>;
  onToggleGuildTrust?: (username: string, trusted: boolean) => Promise<void>;
  onKickGuildMember?: (username: string) => Promise<void>;
  playerUsername?: string;
  playerHasShared?: boolean;
  onRefreshLeaderboards?: (force?: boolean) => Promise<void>;
  leaderboardLoading?: boolean;
  leaderboardLoaded?: boolean;
  leaderboardLoadError?: string | null;
  guildLoadError?: string | null;
  guildLoading?: boolean;
  guildDataLoaded?: boolean;
  onRefreshGuildData?: () => Promise<void>;
  busy: boolean;
}

export const RollingCounter: React.FC<{ value: number; durationMs?: number }> = ({ value, durationMs = 600 }) => {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    let startTimestamp: number | null = null;
    const startVal = displayValue;
    const diff = value - startVal;
    if (diff === 0) return;

    let frameId: number;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / durationMs, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(startVal + diff * easeOut));
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      }
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [value, durationMs]);

  return <span>{formatNumber(displayValue)}</span>;
};

export const GuildsAndSocial: React.FC<GuildsAndSocialProps> = ({
  guilds,
  myGuild,
  leaderboard,
  leaderboards,
  worldEvent,
  onCreateGuild,
  onJoinGuild,
  onLeaveGuild,
  onBuyGuildPerk,
  onToggleGuildTrust,
  onKickGuildMember,
  playerUsername = '',
  playerHasShared = false,
  onRefreshLeaderboards,
  leaderboardLoading = false,
  leaderboardLoaded = false,
  leaderboardLoadError = null,
  guildLoadError = null,
  guildLoading = false,
  guildDataLoaded = false,
  onRefreshGuildData,
  busy,
}) => {
  const [activeTab, setActiveTab] = useState<'guild' | 'leaderboard' | 'event'>('guild');
  const [now, setNow] = useState(Date.now());
  const [createName, setCreateName] = useState('');
  const [createTag, setCreateTag] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingGuild, setCreatingGuild] = useState(false);
  const createGuildInFlightRef = useRef(false);
  const [socialError, setSocialError] = useState('');
  const [socialNotice, setSocialNotice] = useState('');
  const [activeLeaderboard, setActiveLeaderboard] = useState<LeaderboardId>('collectionValue');
  const leaderboardBoards: LeaderboardBoards = leaderboards ?? {
    collectionValue: leaderboard,
    mostRolls: [],
    highestDryStreak: [],
    currentDryStreak: [],
    bestOrb: [],
    mostPlaytime: [],
    chainLength: [],
    highestDepthReached: [],
  };
  const leaderboardMeta: Array<{ id: LeaderboardId; label: string }> = [
    { id: 'collectionValue', label: 'Collection Value' },
    { id: 'mostRolls', label: 'Most Rolls' },
    { id: 'highestDryStreak', label: 'Highest Dry Streak' },
    { id: 'currentDryStreak', label: 'Current Dry Streak' },
    { id: 'bestOrb', label: 'Best Orb' },
    { id: 'mostPlaytime', label: 'Most Playtime' },
    { id: 'chainLength', label: 'Chain Length' },
    { id: 'highestDepthReached', label: 'Highest Depth Reached' },
  ];
  const displayedLeaderboard = Array.isArray(leaderboardBoards[activeLeaderboard]) ? leaderboardBoards[activeLeaderboard] : [];
  const leaderboardMetric = (entry: LeaderboardEntry): string => {
    switch (activeLeaderboard) {
      case 'collectionValue': return `${fmt(entry.value)} Val`;
      case 'mostRolls': return `${fmt(entry.totalRolls)} Rolls`;
      case 'highestDryStreak': return `${fmt(entry.highestDryStreak ?? 0)} Dry`;
      case 'currentDryStreak': return `${fmt(entry.currentDryStreak ?? 0)} Dry`;
      case 'bestOrb': {
        const rarity = Number.isFinite(entry.highestRarity) && entry.highestRarity > 0 ? entry.highestRarity : 1;
        return `1/${formatRarity(rarity)}`;
      }
      case 'mostPlaytime': {
        const rawPlaytime = Number(entry.playtimeMs ?? 0);
        const minutes = Math.floor((Number.isFinite(rawPlaytime) ? Math.max(0, rawPlaytime) : 0) / 60000);
        const hours = Math.floor(minutes / 60);
        return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
      }
      case 'chainLength': return `${fmt(entry.chainLength ?? 0)} Rarities`;
      case 'highestDepthReached': return `Depth ${fmt(entry.bestDepth ?? 0)}`;
    }
  };

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTab !== 'leaderboard' || !onRefreshLeaderboards) return;
    void onRefreshLeaderboards().catch(() => null);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void onRefreshLeaderboards().catch(() => null);
    };
    const interval = window.setInterval(refreshWhenVisible, 30_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeTab, onRefreshLeaderboards]);


  const fmt = (n: number) => formatNumber(Number.isFinite(n) ? Math.max(0, n) : 0);
  const normalizeUsername = (value: string) => value.trim().toLowerCase();
  const currentGuildMember = myGuild?.members.find(m => normalizeUsername(m.username) === normalizeUsername(playerUsername));
  const canManageGuild = currentGuildMember?.role === 'owner' ||
    currentGuildMember?.role === 'officer' ||
    currentGuildMember?.trusted === true;
  const canSeeLastLogins = canManageGuild;
  const canKickGuildMember = (member: Guild['members'][number]): boolean => {
    if (!currentGuildMember || normalizeUsername(member.username) === normalizeUsername(playerUsername) || member.role === 'owner') return false;
    if (currentGuildMember.role === 'owner') return true;
    return canManageGuild && member.role !== 'officer' && member.trusted !== true;
  };

  const handleCreateGuild = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    const tag = createTag.trim().replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase();
    if (name.length < 3 || tag.length < 2 || busy || creatingGuild || createGuildInFlightRef.current) {
      setSocialError('Guild name must be at least 3 characters and tag must be 2–5 letters or numbers.');
      setSocialNotice('');
      return;
    }
    createGuildInFlightRef.current = true;
    setCreatingGuild(true);
    setSocialError('');
    setSocialNotice('');
    sound.playClick();
    try {
      const created = await onCreateGuild(name, tag);
      if (created) {
        setCreateName('');
        setCreateTag('');
        setShowCreateModal(false);
        setSocialNotice('Guild created successfully.');
      } else {
        setSocialError('Guild could not be created. Check the name and tag, then try again.');
      }
    } catch (error) {
      setSocialError(error instanceof Error ? error.message : 'Guild could not be created. Please try again.');
    } finally {
      createGuildInFlightRef.current = false;
      setCreatingGuild(false);
    }
  };

  return (
    <div className="io-page-shell io-page-social max-w-4xl mx-auto space-y-6">
      {guildLoadError && (
        <div role="alert" aria-live="assertive" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200">
          <div>
            <strong>Guild data could not be loaded.</strong>
            <p className="mt-1">{guildLoadError} {guildDataLoaded ? 'Your last loaded guild data is still shown.' : 'The directory will appear when the connection returns.'} Retry below.</p>
          </div>
          {onRefreshGuildData && (
            <button type="button" disabled={busy || guildLoading} onClick={() => void onRefreshGuildData().catch(() => undefined)} className="shrink-0 rounded-lg border border-rose-400/40 px-3 py-2 font-bold hover:bg-rose-500/10 disabled:opacity-50">
              {guildLoading ? 'Retrying…' : 'Retry loading'}
            </button>
          )}
        </div>
      )}
      {guildLoading && guildDataLoaded && <p role="status" aria-live="polite" className="text-[10px] text-slate-500">Refreshing guild activity…</p>}
      {(socialError || socialNotice) && <div role={socialError ? 'alert' : 'status'} aria-live={socialError ? 'assertive' : 'polite'} className={socialError ? 'rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200' : 'rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-3 text-xs text-emerald-200'}>{socialError || socialNotice}</div>}
      {/* Sub-navigation */}
      <div role="group" aria-label="Guilds and social sections" className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <button
          type="button"
          aria-pressed={activeTab === 'guild'}
          onClick={() => {
            sound.playClick();
            setActiveTab('guild');
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'guild'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Guild Headquarters</span>
        </button>

        <button
          type="button"
          aria-pressed={activeTab === 'leaderboard'}
          onClick={() => {
            sound.playClick();
            setActiveTab('leaderboard');
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'leaderboard'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          <Trophy className="w-3.5 h-3.5" />
          <span>Leaderboard</span>
        </button>

        <button
          type="button"
          aria-pressed={activeTab === 'event'}
          onClick={() => {
            sound.playClick();
            setActiveTab('event');
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'event'
              ? 'bg-purple-600 text-white shadow-md'
              : 'text-slate-400 hover:text-white bg-slate-900/60'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Community Event</span>
        </button>
      </div>

      {/* 1. GUILD TAB */}
      {activeTab === 'guild' && (
        <div className="space-y-6">
          {guildLoading && !guildDataLoaded ? (
            <div role="status" aria-busy="true" className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="h-5 w-40 animate-pulse rounded bg-slate-800" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded bg-slate-800/80" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {[0, 1, 2, 3].map(item => <div key={item} className="h-20 animate-pulse rounded-2xl border border-slate-800 bg-slate-950/60" />)}
              </div>
              <span className="sr-only">Loading guilds and your guild details…</span>
            </div>
          ) : guildLoadError && !guildDataLoaded ? (
            <div role="status" className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 text-center text-xs text-slate-400">
              Your guild directory is waiting for a connection. Use Retry loading above when you’re ready.
            </div>
          ) : myGuild ? (
            /* Player Is In A Guild */
            <div className="space-y-6">
              {/* Guild Header Hero */}
              <div className="bg-gradient-to-r from-slate-900 via-purple-950/30 to-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center font-black text-purple-300 text-lg">
                      {myGuild.tag}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-black text-white">{myGuild.name}</h2>
                        </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {myGuild.members.length} / {10 + Math.min(40, myGuild.perks?.memberCapacityRank ?? 0)} Members • {fmt(myGuild.tokens ?? 0)} Guild Tokens
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      sound.playClick();
                      void onLeaveGuild();
                    }}
                    disabled={busy}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-all w-fit cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Leave Guild</span>
                  </button>
                </div>

                {/* Guild Tasks */}
                <div className="mt-5 pt-4 border-t border-slate-800/80 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Flame className="w-4 h-4 text-amber-400" />
                        <span className="text-sm font-black text-white">Guild Tasks</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Guild Tokens come only from completing these tasks. Each completion makes that task harder.
                      </p>
                    </div>
                    <span className="text-[10px] font-bold text-amber-300">
                      {fmt(myGuild.taskCompletions ?? 0)} completed
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
                    {(myGuild.tasks ?? []).map(task => {
                      const rawTarget = Number(task.target);
                      const target = Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : 1;
                      const rawProgress = Number(task.progress);
                      const progress = Number.isFinite(rawProgress) ? Math.max(0, Math.min(target, rawProgress)) : 0;
                      const percent = Math.max(0, Math.min(100, (progress / target) * 100));
                      return (
                        <div key={task.id} className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-black text-purple-200">{task.type.toUpperCase()}</span>
                            <span className="text-[10px] font-black text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-lg px-2 py-0.5">
                              Tier {task.tier}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-white mt-2">{task.label}</p>
                          <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800 mt-2" role="progressbar" aria-label={task.label+' progress'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} aria-valuetext={fmt(progress)+' of '+fmt(target)+' complete'}>
                            <div
                              className="h-full bg-gradient-to-r from-purple-500 to-amber-400 transition-all"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                            <span>{fmt(progress)} / {fmt(target)}</span>
                            <span className="text-amber-300">+{fmt(task.reward)} Tokens</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(() => {
                    const combo = decayGuildComboState(myGuild.combo, now);
                    const remaining = guildComboRemainingMs(combo, now);
                    const active = combo.tier > 0 && remaining > 0;
                    const effectLuck = guildComboLuckMultiplier(combo, now);
                    const effectSpeed = guildComboSpeedMultiplier(combo, now);
                    const effectCrit = guildComboCritChanceBonus(combo, now);
                    const effectCritPower = guildComboCritLuckBonus(combo, now);
                    const durationProgress = guildComboTimeProgress(combo, now);
                    return (
                      <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-950/15 p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <Zap className="w-4 h-4 text-fuchsia-300" />
                              <span className="text-sm font-black text-white">Guild Combo</span>
                              <span className="text-[10px] font-black text-fuchsia-200 border border-fuchsia-500/30 bg-fuchsia-500/10 rounded-lg px-2 py-0.5">
                                {active ? `Tier ${combo.tier}` : 'Inactive'}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1">
                              Complete Guild Tasks to charge it. Combo can climb to Tier 100, and all three bonuses scale with tier.
                            </p>
                          </div>
                          <div className="text-center sm:text-right min-w-[150px]">
                            {active ? (
                              <div className="rounded-xl border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-2 shadow-lg shadow-fuchsia-950/30">
                                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-fuchsia-300">
                                  Time Remaining
                                </div>
                                <div className="font-mono text-2xl sm:text-3xl font-black leading-none text-white mt-1 tabular-nums">
                                  {Math.ceil(remaining / 1000)}s
                                </div>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-500">Waiting for task completions</span>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex gap-1">
                          {Array.from({ length: 4 }, (_, index) => (
                            <div
                              key={index}
                              className={`h-2.5 flex-1 rounded-full border ${index < (combo.activationProgress ?? 0)
                                ? 'bg-fuchsia-400 border-fuchsia-300'
                                : 'bg-slate-900 border-slate-800'}`}
                            />
                          ))}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mt-3 text-[10px]">
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-2">
                            <div className="text-slate-500">Luck</div>
                            <div className="font-black text-emerald-300">×{effectLuck.toFixed(2)}</div>
                          </div>
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-2">
                            <div className="text-slate-500">Speed</div>
                            <div className="font-black text-cyan-300">{Math.round((1 - effectSpeed) * 100)}% faster</div>
                          </div>
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-2">
                            <div className="text-slate-500">Crit Chance</div>
                            <div className="font-black text-rose-300">+{Math.round(effectCrit * 100)}%</div>
                          </div>
                          <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-2">
                            <div className="text-slate-500">Crit Multiplier</div>
                            <div className="font-black text-amber-300">+{effectCritPower.toFixed(2)}×</div>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                            <span>Time left / earned</span>
                            <span>{active ? `${durationProgress.toFixed(1)}% of gained time left` : 'Expired'}</span>
                          </div>
                          <div
                            className="h-2.5 w-full overflow-hidden rounded-full border border-slate-800 bg-slate-950"
                            role="progressbar"
                            aria-label="Guild combo time remaining relative to total time earned"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={active ? durationProgress : 0}
                            aria-valuetext={active ? `${durationProgress.toFixed(1)}% of time earned remains` : 'Combo expired'}
                          >
                            <div
                              className="h-full rounded-full bg-fuchsia-400 transition-all duration-1000"
                              style={{ width: `${active ? durationProgress : 0}%` }}
                            />
                          </div>
                        </div>
                        <div className="mt-2 text-[10px] text-slate-500">
                          {active
                            ? 'Higher combo tiers drain faster and add less time per task completion.'
                            : 'Combo expired. All Guild Tasks reset to Tier 1.'}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Guild Perks Chamber */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-amber-400" />
                      <h3 className="text-base font-black text-white">Guild Upgrades (7 Passive Bonuses)</h3>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Passive bonuses applied to all guild members. Upgrade using shared Guild Tokens.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 px-3 py-1.5 rounded-xl text-xs font-bold w-fit">
                    <Gem className="w-4 h-4 text-amber-400" />
                    <span>{fmt(myGuild.tokens ?? 0)} Guild Tokens</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                  {[
                    {
                      id: 'luckRank' as const,
                      name: 'Guild Luck Aura',
                      desc: '+2% luck per rank for all guild members.',
                      icon: <Clover className="w-4 h-4 text-emerald-400" />,
                      rank: myGuild.perks?.luckRank ?? 0,
                      max: 10,
                      effect: `+${((myGuild.perks?.luckRank ?? 0) * 2)}% Luck`,
                    },
                    {
                      id: 'speedRank' as const,
                      name: 'Guild Speed Blessing',
                      desc: '-40ms cooldown per rank for all guild members.',
                      icon: <Clock className="w-4 h-4 text-cyan-400" />,
                      rank: myGuild.perks?.speedRank ?? 0,
                      max: 10,
                      effect: `-${((myGuild.perks?.speedRank ?? 0) * 40)}ms Cooldown`,
                    },
                    {
                      id: 'vaultRank' as const,
                      name: 'Guild Vault Expansion',
                      desc: '+100 offline roll capacity per rank for all guild members.',
                      icon: <Archive className="w-4 h-4 text-amber-400" />,
                      rank: myGuild.perks?.vaultRank ?? 0,
                      max: 10,
                      effect: `+${((myGuild.perks?.vaultRank ?? 0) * 100)} Offline Cap`,
                    },
                    {
                      id: 'shardRank' as const,
                      name: 'Cosmic Shard Attunement',
                      desc: '+0.2% shard drop chance per rank for all members.',
                      icon: <Gem className="w-4 h-4 text-cyan-300" />,
                      rank: myGuild.perks?.shardRank ?? 0,
                      max: 10,
                      effect: `+${(((myGuild.perks?.shardRank ?? 0) * 0.2)).toFixed(1)}% Shard Drop`,
                    },
                    {
                      id: 'critRank' as const,
                      name: 'Critical Alignment',
                      desc: '+1.5% critical roll chance per rank for all members.',
                      icon: <Zap className="w-4 h-4 text-rose-400" />,
                      rank: myGuild.perks?.critRank ?? 0,
                      max: 10,
                      effect: `+${(((myGuild.perks?.critRank ?? 0) * 1.5)).toFixed(1)}% Crit Chance`,
                    },
                    {
                      id: 'coinRank' as const,
                      name: 'Prosperity Sigil',
                      desc: '+10% coins earned from rolls per rank for all members.',
                      icon: <Coins className="w-4 h-4 text-yellow-400" />,
                      rank: myGuild.perks?.coinRank ?? 0,
                      max: 10,
                      effect: `+${((myGuild.perks?.coinRank ?? 0) * 10)}% Coins`,
                    },
                    {
                      id: 'memberCapacityRank' as const,
                      name: 'Member Capacity',
                      desc: '+1 maximum guild member per rank.',
                      icon: <UserPlus className="w-4 h-4 text-indigo-400" />,
                      rank: myGuild.perks?.memberCapacityRank ?? 0,
                      max: 40,
                      effect: `+${Math.min(40, myGuild.perks?.memberCapacityRank ?? 0)} Max Members (10 base)`,
                    },

                  ].map(perk => {
                    const isMax = perk.rank >= perk.max;
                    const costBase = perk.id === 'memberCapacityRank' ? 250 : 100;
                    const exponent = perk.id === 'memberCapacityRank' ? 1.45 : 1.65;
                    const cost = Math.max(1, Math.round(costBase * Math.pow(perk.rank + 1, exponent)));
                    const canAfford = (myGuild.tokens ?? 0) >= cost && !isMax;
                    return (
                      <div
                        key={perk.id}
                        className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-col justify-between space-y-3"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              {perk.icon}
                              <span className="text-xs font-bold text-white">{perk.name}</span>
                            </div>
                            <span className="text-[11px] font-bold text-purple-300 bg-purple-950/40 border border-purple-800/40 px-2 py-0.5 rounded-lg">
                              Rank {perk.rank}/{perk.max}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{perk.desc}</p>
                          <div className="text-[11px] font-semibold text-emerald-400 mt-2 font-mono">
                            Current Buff: {perk.effect}
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            if (onBuyGuildPerk) {
                              sound.playClick();
                              void onBuyGuildPerk(perk.id);
                            }
                          }}
                          disabled={!canAfford || busy || isMax || !canManageGuild}
                          className={`w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                            isMax
                              ? 'bg-slate-900 text-slate-500 border border-slate-800 cursor-default'
                              : canAfford && canManageGuild
                              ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-md active:scale-95 cursor-pointer'
                              : 'bg-slate-900 text-slate-500 border border-slate-800/80 cursor-not-allowed'
                          }`}
                        >
                          {isMax ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Max Rank</span>
                            </>
                          ) : canManageGuild ? (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Upgrade ({fmt(cost)} Tokens)</span>
                            </>
                          ) : (
                            <span>Trusted Members Only</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* New Guild Rewards */}
                <div className="rounded-2xl border border-fuchsia-500/25 bg-fuchsia-950/10 p-4 space-y-3 mb-3.5">
                  <div>
                    <h4 className="text-sm font-black text-white flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-fuchsia-300" />
                      Guild Rewards
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Spend task-earned Guild Tokens on bonuses tied to the task loop.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      {
                        id: 'taskBountyRank' as const,
                        name: 'Task Bounty',
                        desc: '+5% Guild Tokens from completed tasks per rank.',
                        rank: myGuild.perks?.taskBountyRank ?? myGuild.perks?.tokenYieldRank ?? 0,
                        max: 20,
                        effect: `+${((myGuild.perks?.taskBountyRank ?? myGuild.perks?.tokenYieldRank ?? 0) * 5)}% Task Tokens`,
                      },
                      {
                        id: 'comboRank' as const,
                        name: 'Combo Reserve',
                        desc: '+5% Guild Combo duration per rank.',
                        rank: myGuild.perks?.comboRank ?? 0,
                        max: 10,
                        effect: `+${((myGuild.perks?.comboRank ?? 0) * 5)}% Combo Time`,
                      },
                    ].map(reward => {
                      const isMax = reward.rank >= reward.max;
                      const costBase = reward.id === 'comboRank' ? 150 : 100;
                      const exponent = reward.id === 'comboRank' ? 1.55 : 1.65;
                      const cost = Math.max(1, Math.round(costBase * Math.pow(reward.rank + 1, exponent)));
                      const canAfford = (myGuild.tokens ?? 0) >= cost && !isMax;
                      return (
                        <div key={reward.id} className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-white">{reward.name}</span>
                            <span className="text-[10px] font-bold text-fuchsia-200 bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-lg px-2 py-0.5">
                              Rank {reward.rank}/{reward.max}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1">{reward.desc}</p>
                          <div className="text-[10px] font-semibold text-emerald-300 mt-2">{reward.effect}</div>
                          <button
                            onClick={() => {
                              if (onBuyGuildPerk) {
                                sound.playClick();
                                void onBuyGuildPerk(reward.id);
                              }
                            }}
                            disabled={!canAfford || busy || isMax || !canManageGuild}
                            className={`w-full py-2 mt-3 rounded-xl text-[11px] font-bold transition-all ${isMax
                              ? 'bg-slate-900 text-slate-500 border border-slate-800'
                              : canAfford && canManageGuild
                              ? 'bg-fuchsia-600 hover:bg-fuchsia-500 text-white cursor-pointer'
                              : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'}`}
                          >
                            {isMax ? 'Max Rank' : canManageGuild ? `Upgrade (${fmt(cost)} Tokens)` : 'Trusted Members Only'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

              {/* Members List & Chat Columns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Member Roster */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-purple-400" />
                      <span>Guild Players</span>
                    </h3>
                    <span className="text-xs text-slate-400">
                      {myGuild.members.length} / 50
                    </span>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {myGuild.members
                      .sort((a, b) => b.contribution - a.contribution)
                      .map((m, idx) => (
                        <div
                          key={m.username}
                          className="flex items-center justify-between bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold text-slate-500">#{idx + 1}</span>
                            <span className="font-bold text-slate-200 truncate">{m.username}</span>
                            {m.role === 'owner' && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded">
                                Owner
                              </span>
                            )}
                            {m.trusted && m.role !== 'owner' && (
                              <span className="text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-1.5 py-0.2 rounded">
                                Trusted
                              </span>
                            )}
                            {canSeeLastLogins && m.lastLoginAt ? (
                              <span className="text-[9px] text-slate-600">
                                Last login {new Date(m.lastLoginAt).toLocaleDateString()}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-amber-400 font-semibold">
                              +{fmt(m.contribution)}
                            </span>
                            {playerUsername === myGuild.members.find(x => x.role === 'owner')?.username &&
                              m.username !== playerUsername && onToggleGuildTrust && (
                              <button
                                type="button"
                                onClick={() => {
                                  sound.playClick();
                                  void onToggleGuildTrust(m.username, m.trusted !== true);
                                }}
                                disabled={busy}
                                className={`px-2 py-1 rounded-lg text-[9px] font-bold border ${
                                  m.trusted
                                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                                    : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-white'
                                }`}
                              >
                                <UserCheck className="w-3 h-3 inline mr-1" />
                                {m.trusted ? 'Untrust' : 'Trust'}
                              </button>
                            )}
                            {canKickGuildMember(m) && onKickGuildMember && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!window.confirm('Kick u/' + m.username + ' from the guild?')) return;
                                  sound.playClick();
                                  void onKickGuildMember(m.username);
                                }}
                                disabled={busy}
                                className="px-2 py-1 rounded-lg text-[9px] font-bold border bg-rose-500/10 border-rose-500/30 text-rose-300 hover:bg-rose-500/20"
                              >
                                <UserMinus className="w-3 h-3 inline mr-1" />
                                Kick
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>


              </div>
            </div>
          ) : (
            /* Player Is NOT in a guild */
            <div className="space-y-6">
              <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 text-center space-y-3">
                <Shield className="w-12 h-12 text-purple-400 mx-auto" />
                <h3 className="text-lg font-black text-white">Guilds</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Join a guild or create one. Guild members pool rolls toward challenges, earn Guild Tokens, and unlock shared perks.
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-lg inline-flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Found a New Guild</span>
                </button>
              </div>

              {/* Guild Directory */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-white">Active Guild Directory</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {guilds.length === 0 && <p className="col-span-full rounded-2xl border border-slate-800 bg-slate-950/50 p-5 text-center text-xs text-slate-400">No guilds are listed yet. You can create one and invite other players.</p>}
                  {guilds.map(g => (
                    <div
                      key={g.id}
                      className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-md"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center font-black text-purple-300 text-xs">
                          {g.tag}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white">{g.name}</h4>
                          <span className="text-xs text-slate-400">
                            {g.members.length}/{10 + Math.min(40, g.perks?.memberCapacityRank ?? 0)} Members
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label={g.members.length >= 10 + Math.min(40, g.perks?.memberCapacityRank ?? 0) ? `${g.name} is full` : `Join guild ${g.name}`}
                        onClick={() => {
                          sound.playClick();
                          void onJoinGuild(g.id);
                        }}
                        disabled={busy || g.members.length >= 10 + Math.min(40, g.perks?.memberCapacityRank ?? 0)}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all cursor-pointer disabled:cursor-not-allowed"
                      >
                        {g.members.length >= 10 + Math.min(40, g.perks?.memberCapacityRank ?? 0) ? 'Full' : 'Join'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Create Guild Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div role="dialog" aria-modal="true" aria-labelledby="io-create-guild-title" className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
                <h3 id="io-create-guild-title" className="text-lg font-black text-white">Found a New Guild</h3>
                <p className="text-xs text-slate-400">
                  Choose a custom guild name and a 2–5 character tag.
                </p>
                <form onSubmit={handleCreateGuild} className="space-y-3">
                  <div>
                    <label htmlFor="io-create-guild-name" className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                      Guild Name
                    </label>
                    <input
                      id="io-create-guild-name"
                      type="text"
                      value={createName}
                      onChange={e => setCreateName(e.target.value.slice(0, 32))}
                      placeholder="Enter a guild name"
                      maxLength={32}
                      minLength={3}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="io-create-guild-tag" className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                      Guild Tag (2–5 Characters)
                    </label>
                    <input
                      id="io-create-guild-tag"
                      type="text"
                      value={createTag}
                      onChange={e => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                      placeholder="TAG"
                      maxLength={5}
                      minLength={2}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white uppercase focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy || creatingGuild || createName.trim().length < 3 || createTag.trim().length < 2}
                      aria-busy={creatingGuild}
                      className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer disabled:cursor-wait disabled:opacity-60"
                    >
                      {creatingGuild ? 'Creating…' : 'Create'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. LEADERBOARD TAB */}
      {activeTab === 'leaderboard' && (
        <div className="space-y-4" aria-busy={leaderboardLoading}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-black text-white flex items-center gap-2"><Trophy className="w-5 h-5 text-amber-400" /><span>{leaderboardMeta.find(item => item.id === activeLeaderboard)?.label ?? 'Leaderboard'}</span></h3>
              <span className="text-xs text-slate-400">Public rankings require at least one shared Orb post.</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={playerHasShared ? 'text-right text-[10px] font-bold text-emerald-300' : 'text-right text-[10px] font-bold text-amber-300'}>
                {playerHasShared ? 'Leaderboard eligible' : 'Share an Orb post to appear'}
              </div>
              {onRefreshLeaderboards && (
                <button type="button" disabled={leaderboardLoading} onClick={() => void onRefreshLeaderboards(true).catch(() => null)} aria-label="Refresh leaderboards" className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50">
                  <RefreshCw className={`h-3 w-3 ${leaderboardLoading ? 'animate-spin' : ''}`} />
                  {leaderboardLoading ? 'Loading…' : 'Refresh'}
                </button>
              )}
            </div>
          </div>
          {leaderboardLoadError && (
            <div role="alert" aria-live="assertive" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200">
              <span>{leaderboardLoaded ? 'Showing the last loaded rankings.' : 'Rankings could not be loaded.'} {leaderboardLoadError}</span>
              {onRefreshLeaderboards && <button type="button" disabled={leaderboardLoading} onClick={() => void onRefreshLeaderboards(true).catch(() => null)} className="shrink-0 rounded-lg border border-rose-400/40 px-3 py-2 font-bold hover:bg-rose-500/10 disabled:opacity-50">{leaderboardLoading ? 'Retrying…' : 'Try again'}</button>}
            </div>
          )}
          <div role="group" aria-label="Choose leaderboard metric" className="flex gap-1.5 overflow-x-auto pb-1">
            {leaderboardMeta.map(board => (
              <button key={board.id} type="button" aria-pressed={activeLeaderboard === board.id} onClick={() => { sound.playClick(); setActiveLeaderboard(board.id); }}
                className={activeLeaderboard === board.id ? 'px-3 py-2 rounded-xl bg-purple-600 text-white text-[11px] font-black whitespace-nowrap' : 'px-3 py-2 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-400 hover:text-white text-[11px] font-bold whitespace-nowrap'}>
                {board.label}
              </button>
            ))}
          </div>
          {leaderboardLoading && !leaderboardLoaded && <div role="status" className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/80 p-4" aria-busy="true"><span className="sr-only">Loading player rankings…</span>{[0, 1, 2, 3, 4].map(item => <div key={item} className="h-12 animate-pulse rounded-xl bg-slate-800/70" />)}</div>}
          {!leaderboardLoading && leaderboardLoaded && !leaderboardLoadError && displayedLeaderboard.length === 0 && <div role="status" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 text-center text-xs text-slate-500">No entries for {leaderboardMeta.find(item => item.id === activeLeaderboard)?.label ?? 'this leaderboard'} yet. Eligible players appear after sharing an Orb post.</div>}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800/60">
            {displayedLeaderboard.map((entry, idx) => (
              <div key={entry.username} aria-label={`Rank ${idx+1}: ${entry.username}, ${leaderboardMetric(entry)}`} className="flex items-center justify-between p-3 sm:px-4 text-xs hover:bg-slate-800/40 transition-colors">
                <div className="flex items-center gap-3">
                  <span className={`w-6 text-center font-black text-sm ${idx===0?'text-amber-400':idx===1?'text-slate-300':idx===2?'text-amber-600':'text-slate-500'}`}>#{idx+1}</span>
                  <div>
                    <div className="flex items-center gap-1.5"><span className="font-bold text-white text-sm">{entry.username}</span>{entry.legacyOnly && <span className="text-[8px] uppercase tracking-wide text-slate-400 border border-slate-700 rounded px-1">Legacy</span>}{entry.title && <span className="text-[10px] text-slate-400 font-medium">• {entry.title}</span>}</div>
                    <span className="text-slate-400 text-[11px]">{formatNumber(entry.totalRolls)} rolls • Best: 1/{formatRarity(entry.highestRarity)}</span>
                  </div>
                </div>
                <div className="text-right"><span className="text-amber-400 font-mono font-bold text-sm block">{leaderboardMetric(entry)}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. COMMUNITY EVENT TAB */}
      {activeTab === 'event' && worldEvent && (
        <div className="bg-gradient-to-b from-slate-900 via-indigo-950/20 to-slate-900 border border-indigo-500/30 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
                <Globe className="w-8 h-8" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-black text-white">{worldEvent.title}</h2>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Tier {worldEvent.tier ?? 1}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Dynamic community milestone: Every roll contributes to the rolling total.
                </p>
              </div>
            </div>

            <div className="bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-2 rounded-2xl text-emerald-300 text-xs font-bold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>{worldEvent.buffDescription}</span>
            </div>
          </div>

          {/* Rolling Counter Showcase Card */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Rolling Global Progress
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-black text-cyan-300 font-mono tracking-tight">
                    <RollingCounter value={worldEvent.currentProgress} />
                  </span>
                  <span className="text-sm font-bold text-slate-500">
                    / <RollingCounter value={worldEvent.goal} /> Rolls
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span className="text-xs font-bold text-purple-400 font-mono">
                  {((worldEvent.currentProgress / worldEvent.goal) * 100).toFixed(1)}% Completed
                </span>
              </div>
            </div>

            {/* Dynamic Progress Bar */}
            <div className="w-full h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-800 p-0.5">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500 rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (worldEvent.currentProgress / worldEvent.goal) * 100)}%`,
                }}
              />
            </div>

            <p className="text-xs text-slate-400">
              When the dynamic goal of {fmt(worldEvent.goal)} rolls is reached, the event automatically completes the tier and scales to the next milestone goal with enhanced global luck bonuses!
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
