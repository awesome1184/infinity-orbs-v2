import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RIFT_CHALLENGES,
  RIFT_CHALLENGE_UPGRADES,
  getRiftMutationDefinition,
  RIFT_PERKS,
  normalizeRiftTemporalDragMultiplier,
  riftChallengeUpgradeCost,
  riftPerkCost,
  riftObjectiveProgress,
  riftTemporalArbitrageMultiplier,
  riftTemporalCooldownMultiplier,
  type RiftChallengeId,
  type RiftChallengeSnapshot,
  type RiftChallengeUpgradeId,
  type RiftPerkId,
} from '../../shared/rift-challenges.js';
import { formatNumber, formatRarity } from '../../shared/game.js';
import { RIFT_RELICS, RIFT_RELIC_EQUIP_SLOTS, RIFT_RELIC_FORKED_EQUIP_SLOTS, riftRelicCost, type RiftRelicId } from '../../shared/rift-relics.js';
import { Activity, ArrowUpRight, Zap, Hammer } from 'lucide-react';

async function challengeRequest<T>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Rift request failed.');
  }
  return payload as T;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  if (minutes > 0) return minutes + 'm ' + seconds + 's';
  return seconds + 's';
}

export const RiftChallengesSection: React.FC<{
  onEnterGame?: () => void;
  onExit?: () => void;
  onRefreshPlayer?: () => void;
}> = ({ onEnterGame, onExit, onRefreshPlayer }) => {
  const [snapshot, setSnapshot] = useState<RiftChallengeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrapBalance, setScrapBalance] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [temporalDragDraft, setTemporalDragDraft] = useState(1);
  const [blueprintDraft, setBlueprintDraft] = useState<RiftChallengeUpgradeId>('fortune');

  const refresh = useCallback(async () => {
    const result = await challengeRequest<RiftChallengeSnapshot & { scrapBalance: number }>('/api/rift-challenges/relics/status');
    setSnapshot(result);
    setScrapBalance(result.scrapBalance);
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void challengeRequest<RiftChallengeSnapshot & { scrapBalance: number }>('/api/rift-challenges/relics/status')
      .then(result => { if (!cancelled) { setSnapshot(result); setScrapBalance(result.scrapBalance); } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load Rift progression.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const archive = snapshot?.archive;
  const run = archive?.activeRun ?? null;
  const challenge = run ? RIFT_CHALLENGES.find(item => item.id === run.challengeId) : null;
  const activeMutationDefinition = run?.activeMutation
    ? getRiftMutationDefinition(run.activeMutation.id)
    : undefined;
  const emergencyCharges = run
    ? Math.max(0, (archive?.riftPerkLevels.emergencyProtocol ?? 0) +
        (archive?.riftPerkLevels.advancedDeployment ?? 0) - (run.emergencyProtocolsUsed ?? 0))
    : 0;

  useEffect(() => {
    if (run?.status === 'active') setTemporalDragDraft(run.temporalDragMultiplier ?? 1);
  }, [run?.runId, run?.temporalDragMultiplier, run?.status]);
  const riftProjection = useMemo(() => {
    if (!archive) return { points: 0, progress: 0, rate: 1, nextPointMs: 3_600_000 };
    const elapsed = Math.max(0, now - archive.riftLastAccruedAt);
    const accumulated = archive.riftProgress + elapsed / 3_600_000 * archive.riftRatePerHour;
    const whole = Math.floor(accumulated);
    return {
      points: Math.min(Number.MAX_SAFE_INTEGER, archive.riftPoints + whole),
      progress: accumulated - whole,
      rate: archive.riftRatePerHour,
      nextPointMs: Math.max(0, (1 - (accumulated - whole)) / archive.riftRatePerHour * 3_600_000),
    };
  }, [archive?.riftPoints, archive?.riftProgress, archive?.riftRatePerHour, archive?.riftLastAccruedAt, now]);

  const progressPercent = useMemo(() => {
    if (!run || !challenge) return 0;
    const best = Math.max(2, run.bestRarity);
    const actualProgress = riftObjectiveProgress(best, challenge.targetRarity) * 100;
    const calibrationProgress = archive?.riftPerkLevels.initialCalibration ?? 0;
    return actualProgress >= 100
      ? 100
      : Math.max(0, Math.min(99, actualProgress + calibrationProgress));
  }, [run?.bestRarity, challenge?.targetRarity, archive?.riftPerkLevels.initialCalibration]);

  const retryLoad = async () => {
    setLoading(true);
    setError(null);
    try { await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load Rift progression.'); }
    finally { setLoading(false); }
  };

  const performAction = async (action: string, path: string, body?: Record<string, unknown>) => {
    setBusyAction(action);
    setError(null);
    try {
      const result = await challengeRequest<RiftChallengeSnapshot>(path, body ? 'POST' : 'GET', body);
      setSnapshot(result);
      if (action.startsWith('forge-relic-')) {
        const forgeStatus = await challengeRequest<RiftChallengeSnapshot & { scrapBalance: number }>('/api/rift-challenges/relics/status');
        setScrapBalance(forgeStatus.scrapBalance);
        setSnapshot(forgeStatus);
      }
      setConfirmAbandon(false);
      if (action.startsWith('start-')) onEnterGame?.();
      else if (action === 'abandon') onExit?.();
      else onRefreshPlayer?.();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The Rift action failed.';
      if (message.includes('challenge run changed in another tab')) {
        try {
          await refresh();
          setError('The challenge changed in another tab. Your view has been refreshed.');
        } catch { setError(message); }
      } else {
        setError(message);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const startChallenge = (id: RiftChallengeId) => void performAction(
    'start-' + id,
    '/api/rift-challenges/start',
    { challengeId: id, blueprintId: blueprintDraft },
  );
  const buyUpgrade = (id: RiftChallengeUpgradeId) => void performAction(
    id, '/api/rift-challenges/upgrade', { upgradeId: id, runId: run?.runId },
  );
  const buyPerk = (id: RiftPerkId) => void performAction(id, '/api/rift-challenges/perk', { perkId: id });
  const saveTemporalDrag = () => void performAction(
    'temporal-drag',
    '/api/rift-challenges/temporal-drag',
    { runId: run?.runId, multiplier: normalizeRiftTemporalDragMultiplier(temporalDragDraft) },
  );
  const chooseMutation = (mutationId: string) => void performAction(
    'mutation-' + mutationId,
    '/api/rift-challenges/mutation',
    { runId: run?.runId, mutationId },
  );
  const activateEmergencyProtocol = () => void performAction(
    'emergency-protocol',
    '/api/rift-challenges/emergency',
    { runId: run?.runId },
  );
  const forgeRelic = (id: RiftRelicId) => void performAction(
    'forge-relic-' + id, '/api/rift-challenges/relic/forge', { relicId: id },
  );
  const equipRelic = (id: RiftRelicId, equipped: boolean) => void performAction(
    'equip-relic-' + id, '/api/rift-challenges/relic/equip', { relicId: id, equipped },
  );

  if (loading) {
    return <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-8 text-center text-sm text-slate-400">Loading Rift records…</section>;
  }
  if (!snapshot || !archive) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-center">
        <h2 className="text-xl font-black text-white">Rift progression unavailable</h2>
        <p className="mt-2 text-sm text-slate-400">{error ?? 'The Rift archive could not be loaded.'}</p>
        <button type="button" onClick={() => void retryLoad()} disabled={loading} className="mt-4 rounded-xl bg-indigo-500 px-4 py-2.5 text-xs font-black text-white hover:bg-indigo-400 disabled:opacity-40">
          {loading ? 'Retrying…' : 'Retry'}
        </button>
      </section>
    );
  }

  const mainLevel = snapshot.mainProgress.level;
  const isActive = run?.status === 'active';
  const isCompleted = run?.status === 'completed';

  return (
    <section className="io-rift-page space-y-5 text-slate-100">
      <header className="overflow-hidden rounded-3xl border border-cyan-400/20 bg-gradient-to-br from-[#102b48] via-[#09182b] to-[#171a3b] p-5 shadow-2xl shadow-slate-950/40 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.24em] text-cyan-300">
              <Activity className="h-3.5 w-3.5" /> Persistent progression
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">The Rift</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
              Rift energy accumulates while you play and while you are away. Clear challenges to accelerate the bar, then spend Rift Points on permanent perks. While a challenge is active, every normal game menu uses its isolated Rift save.
            </p>
          </div>
          <div className="min-w-36 rounded-2xl border border-cyan-300/20 bg-black/20 px-4 py-3">
            <div className="text-[9px] font-black uppercase tracking-[.18em] text-cyan-200">Available Rift Points</div>
            <div className="mt-1 text-3xl font-black tabular-nums text-white">{formatNumber(riftProjection.points)}</div>
            <div className="mt-1 text-[10px] text-slate-400">Lifetime earned: {formatNumber(archive.totalRiftPointsEarned)}</div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-cyan-300/20 bg-slate-950/55 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Rift Bar</div>
              <div className="mt-1 text-2xl font-black text-white">
                {riftProjection.rate.toFixed(2)} <span className="text-sm font-bold text-cyan-200">RP / hour</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs font-bold text-slate-200">{Math.floor(riftProjection.progress * 100)}% to next point</div>
              <div className="mt-1 text-[10px] text-slate-400">Next Rift Point in {formatDuration(riftProjection.nextPointMs)}</div>
            </div>
          </div>
          <div className="mt-4 h-4 overflow-hidden rounded-full border border-cyan-300/15 bg-black/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-300 to-violet-400 shadow-[0_0_18px_rgba(69,213,255,.38)] transition-[width] duration-500"
              style={{ width: Math.max(0, Math.min(100, riftProjection.progress * 100)) + '%' }}
              role="progressbar"
              aria-label="Rift Point progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.floor(riftProjection.progress * 100)}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>Base generation: 1.00 RP / hour</span>
            <span>Challenge clears permanently increase your hourly rate.</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Challenge clears</div>
            <div className="mt-1 text-lg font-black text-white">{archive.completedChallengeIds.length}/{RIFT_CHALLENGES.length}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Completed runs</div>
            <div className="mt-1 text-lg font-black text-white">{formatNumber(archive.totalCompletedRuns)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Rift level</div>
            <div className="mt-1 text-lg font-black text-white">Lv {formatNumber(mainLevel)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Rift points spent</div>
            <div className="mt-1 text-lg font-black text-white">{formatNumber(Math.max(0, archive.totalRiftPointsEarned - archive.riftPoints))}</div>
          </div>
          <div className="rounded-xl border border-fuchsia-400/20 bg-fuchsia-500/[0.06] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-fuchsia-200/75">Kudos · Last 24h</div>
            <div className="mt-1 text-lg font-black text-fuchsia-100">{formatNumber(snapshot.kudosStats.last24Hours)}</div>
          </div>
          <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-3 py-2.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-violet-200/75">Since Last Open</div>
            <div className="mt-1 text-lg font-black text-violet-100">{formatNumber(snapshot.kudosStats.sinceLastOpen)}</div>
          </div>
        </div>
      </header>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" role="alert">{error}</div>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">01 · Rift trials</div>
            <h2 className="mt-1 text-xl font-black text-white">Challenges</h2>
            <p className="mt-1 text-xs text-slate-400">First clears improve your permanent generation rate. Replays award additional Rift Points.</p>
          </div>
          <div className="text-[10px] text-slate-500">Your main save is preserved and restored when the Rift run ends.</div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/[.05] p-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-200">Preloaded Blueprint</div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
              Select the challenge upgrade that starts pre-installed. Requires Preloaded Blueprint in the Rift shop.
            </p>
          </div>
          <select
            value={blueprintDraft}
            onChange={event => setBlueprintDraft(event.target.value as RiftChallengeUpgradeId)}
            disabled={(archive.riftPerkLevels.preloadedBlueprint ?? 0) <= 0 || busyAction !== null || run?.status === 'active'}
            className="min-w-44 rounded-lg border border-violet-300/25 bg-slate-950 px-3 py-2 text-xs font-bold text-violet-100 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Preloaded challenge upgrade"
          >
            <option value="fortune">Fortune Lens</option>
            <option value="speed">Quickstep Coil</option>
            <option value="prosperity">Coin Converter</option>
            <option value="critical">Critical Echo</option>
          </select>
          <span className="text-[9px] font-bold text-violet-200/70">
            Lv {archive.riftPerkLevels.preloadedBlueprint ?? 0}/4
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {RIFT_CHALLENGES.map((item, index) => {
            const cleared = archive.completedChallengeIds.includes(item.id);
            const prerequisiteCleared = !item.prerequisiteId || archive.completedChallengeIds.includes(item.prerequisiteId);
            const levelReady = mainLevel >= item.requiredMainLevel;
            const unlocked = prerequisiteCleared && levelReady;
            const isCurrent = run?.challengeId === item.id;
            const best = archive.bestRarityByChallenge[item.id] ?? 2;
            const lockedReason = !levelReady
              ? 'Reach Level ' + item.requiredMainLevel
              : item.prerequisiteId && !prerequisiteCleared
                ? 'Complete ' + (RIFT_CHALLENGES.find(value => value.id === item.prerequisiteId)?.name ?? 'the prior challenge')
                : '';
            const statusText = cleared ? 'CLEARED' : unlocked ? 'AVAILABLE' : 'LOCKED';
            return (
              <article key={item.id} className={'flex min-w-0 flex-col rounded-2xl border p-4 ' + (isCurrent ? 'border-cyan-300/45 bg-cyan-400/[.07]' : cleared ? 'border-emerald-400/20 bg-slate-900/70' : 'border-slate-800 bg-slate-900/60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[9px] font-black uppercase tracking-[.18em] text-cyan-300">Challenge {String(item.number).padStart(3, '0')}</div>
                  <span className={'rounded-full px-2 py-1 text-[9px] font-black tracking-wider ' + (cleared ? 'bg-emerald-400/10 text-emerald-300' : unlocked ? 'bg-cyan-400/10 text-cyan-200' : 'bg-slate-800 text-slate-500')}>{statusText}</span>
                </div>
                <h3 className="mt-3 text-lg font-black text-white">{item.name}</h3>
                <p className="mt-0.5 text-xs text-slate-400">{item.subtitle}</p>
                <p className="mt-3 min-h-[58px] text-xs leading-relaxed text-slate-300">{item.description}</p>
                <div className="mt-4 rounded-xl border border-slate-700/70 bg-black/20 px-3 py-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-slate-500">Objective</div>
                  <div className="mt-1 text-lg font-black text-white">1 / {formatRarity(item.targetRarity)}</div>
                  <div className="mt-1 text-[10px] text-slate-500">Best: 1 / {formatRarity(best)}</div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {item.debuffs.map(debuff => (
                    <div key={debuff.name} className="flex items-start gap-2 text-[10px] leading-relaxed text-slate-500">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80" />
                      <span><strong className="font-bold text-slate-300">{debuff.name}:</strong> {debuff.description}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-black/20 px-2.5 py-2">
                    <div className="text-[8px] font-bold uppercase tracking-wider text-slate-500">First clear</div>
                    <div className="mt-0.5 text-xs font-black text-cyan-200">+{item.firstClearPoints} RP</div>
                  </div>
                  <div className="rounded-lg bg-black/20 px-2.5 py-2">
                    <div className="text-[8px] font-bold uppercase tracking-wider text-slate-500">Rate bonus</div>
                    <div className="mt-0.5 text-xs font-black text-emerald-200">+{item.rateBonusPerHour.toFixed(2)} RP/h</div>
                  </div>
                </div>
                {isCurrent ? (
                  <div className="mt-auto pt-4 text-center text-[10px] font-black text-cyan-200">
                    {run?.status === 'active' ? 'CURRENT RUN BELOW' : 'LAST COMPLETED RUN'}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => startChallenge(item.id)}
                    disabled={!unlocked || (run?.status === 'active') || busyAction !== null}
                    className="mt-auto w-full rounded-xl bg-cyan-500 px-3 py-3 text-xs font-black text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {busyAction === 'start-' + item.id ? 'Preparing…' : run?.status === 'active' ? 'Finish current run first' : !unlocked ? lockedReason : cleared ? 'Replay · +' + item.repeatClearPoints + ' RP' : 'Begin challenge'}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-violet-400/20 bg-slate-900/70 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-violet-300">02 · Permanent upgrades</div>
            <h2 className="mt-1 text-xl font-black text-white">Rift Point shop</h2>
            <p className="mt-1 text-xs text-slate-400">These perks persist across challenges and sessions. Main-game perks affect ordinary rolls outside challenge runs.</p>
          </div>
          <div className="rounded-xl border border-violet-300/20 bg-violet-400/5 px-3 py-2 text-right">
            <div className="text-[9px] font-black uppercase tracking-widest text-violet-200">Available</div>
            <div className="text-xl font-black tabular-nums text-white">{formatNumber(riftProjection.points)} RP</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {(['main-game', 'rift'] as const).map(category => (
            <div key={category}>
              <div className="mb-3 flex items-center gap-2 border-b border-slate-700/70 pb-2">
                {category === 'main-game' ? <ArrowUpRight className="h-4 w-4 text-cyan-300" /> : <Zap className="h-4 w-4 text-violet-300" />}
                <h3 className="text-xs font-black uppercase tracking-[.16em] text-slate-200">
                  {category === 'main-game' ? 'Main-game perks' : 'Rift-only perks'}
                </h3>
              </div>
              <div className="space-y-2">
                {(Object.values(RIFT_PERKS).filter(perk => perk.category === category)).map(perk => {
                  const level = archive.riftPerkLevels[perk.id] ?? 0;
                  const maxed = level >= perk.maxLevel;
                  const cost = riftPerkCost(perk.id, level);
                  const canBuy = !maxed && riftProjection.points >= cost && busyAction === null;
                  return (
                    <article key={perk.id} className="rounded-xl border border-slate-800 bg-slate-950/55 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-black text-white">{perk.name}</h4>
                            <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[9px] font-black text-slate-400">Lv {level}/{perk.maxLevel}</span>
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{perk.description}</p>
                          <p className="mt-1 text-[10px] font-bold text-cyan-200">{perk.effect}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => buyPerk(perk.id)}
                          disabled={!canBuy}
                          className="min-w-24 rounded-lg border border-violet-300/25 bg-violet-500/10 px-3 py-2 text-[10px] font-black text-violet-100 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          {busyAction === perk.id ? 'Buying…' : maxed ? 'MAXED' : cost + ' RP'}
                        </button>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400" style={{ width: (level / perk.maxLevel * 100) + '%' }} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-amber-300/20 bg-slate-900/75 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-amber-300">03 · Salvaged artifacts</div>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-black text-white"><Hammer className="h-5 w-5 text-amber-300" /> The Relic Forge</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Forge permanent Rift Relics with Combat Scrap and Rift Points. Equip a loadout before a run; it remains locked until that run ends.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-xl border border-amber-300/20 bg-amber-400/5 px-3 py-2 text-right">
              <div className="text-[9px] font-black uppercase tracking-widest text-amber-200">Combat Scrap</div>
              <div className="text-lg font-black tabular-nums text-white">{formatNumber(scrapBalance)}</div>
            </div>
            <div className="rounded-xl border border-violet-300/20 bg-violet-400/5 px-3 py-2 text-right">
              <div className="text-[9px] font-black uppercase tracking-widest text-violet-200">Relic slots</div>
              <div className="text-lg font-black tabular-nums text-white">{archive.equippedRiftRelics.length}/{archive.riftPerkLevels.timelineFork > 0 ? RIFT_RELIC_FORKED_EQUIP_SLOTS : RIFT_RELIC_EQUIP_SLOTS}</div>
            </div>
          </div>
        </div>

        {archive.completedChallengeIds.length === 0 && (
          <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/5 px-4 py-3 text-xs text-amber-100">
            Complete your first Rift Challenge to unlock relic crafting and equipment.
          </div>
        )}
        {run?.status === 'active' && (
          <div className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-400/5 px-4 py-3 text-xs text-cyan-100">
            Your current run is using its saved relic loadout. Forge and equipment changes are available again after the run ends.
          </div>
        )}
        {archive.riftPerkLevels.timelineFork <= 0 && archive.completedChallengeIds.length > 0 && (
          <div className="mt-4 rounded-xl border border-violet-300/20 bg-violet-500/5 px-4 py-3 text-xs text-violet-100">
            Timeline Fork is available in the Rift Point shop. Purchase it to unlock a third relic slot.
          </div>
        )}
        {archive.equippedRiftRelics.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/15 bg-black/20 px-3 py-3">
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Equipped loadout</span>
            {archive.equippedRiftRelics.map(id => (
              <span key={id} className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-black text-amber-100">{RIFT_RELICS[id].name}</span>
            ))}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.values(RIFT_RELICS).map(relic => {
            const level = archive.riftRelicLevels[relic.id] ?? 0;
            const maxed = level >= relic.maxLevel;
            const equipped = archive.equippedRiftRelics.includes(relic.id);
            const slots = archive.riftPerkLevels.timelineFork > 0 ? RIFT_RELIC_FORKED_EQUIP_SLOTS : RIFT_RELIC_EQUIP_SLOTS;
            const cost = riftRelicCost(relic.id, level);
            const unlocked = archive.completedChallengeIds.length > 0;
            const canForge = unlocked && !maxed && run?.status !== 'active' && busyAction === null &&
              scrapBalance >= cost.scrap && riftProjection.points >= cost.riftPoints;
            const canEquip = unlocked && level > 0 && run?.status !== 'active' && busyAction === null &&
              (equipped || archive.equippedRiftRelics.length < slots);
            return (
              <article key={relic.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-800 bg-slate-950/65 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-black text-white">{relic.name}</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{relic.description}</p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-[9px] font-black text-slate-300">Lv {level}/3</span>
                </div>
                <div className="mt-3 rounded-lg border border-amber-300/10 bg-amber-300/[.04] px-3 py-2 text-[10px] font-bold leading-relaxed text-amber-100">{relic.effect}</div>
                <div className="mt-auto pt-4">
                  <div className="mb-2 flex items-center justify-between gap-2 text-[9px] font-bold text-slate-500">
                    <span>{maxed ? 'Maximum rank' : 'Next rank cost'}</span>
                    {!maxed && <span>{formatNumber(cost.scrap)} Scrap · {formatNumber(cost.riftPoints)} RP</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => forgeRelic(relic.id)}
                      disabled={!canForge}
                      className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-2 py-2.5 text-[9px] font-black text-amber-100 hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {busyAction === 'forge-relic-' + relic.id ? 'Forging…' : maxed ? 'MAX RANK' : 'FORGE'}
                    </button>
                    <button
                      type="button"
                      onClick={() => equipRelic(relic.id, !equipped)}
                      disabled={!canEquip}
                      className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-2 py-2.5 text-[9px] font-black text-cyan-100 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {busyAction === 'equip-relic-' + relic.id ? 'Updating…' : equipped ? 'UNEQUIP' : 'EQUIP'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {run && challenge && (
        <section className="rounded-3xl border border-indigo-400/25 bg-slate-900/80 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[.2em] text-indigo-300">
                {isCompleted ? 'Challenge completed' : 'Active challenge save'}
              </div>
              <h2 className="mt-1 text-2xl font-black text-white">{challenge.name}</h2>
              <p className="mt-1 text-xs text-slate-500">Started {new Date(run.startedAt).toLocaleString()} · Isolated Rift player save</p>
            </div>
            {isActive && (
              <button
                type="button"
                onClick={() => setConfirmAbandon(true)}
                disabled={busyAction !== null}
                className="rounded-lg border border-rose-500/25 px-3 py-2 text-[11px] font-bold text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
              >
                Abandon run
              </button>
            )}
          </div>

          {confirmAbandon && (
            <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-500/5 p-4" role="alertdialog" aria-label="Confirm abandoning this challenge">
              <div className="text-sm font-black text-white">Abandon this Rift run?</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">The isolated Rift player save will be discarded. Your original main save, Rift Points, permanent perks, and completed challenge records will be restored unchanged.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => void performAction('abandon', '/api/rift-challenges/abandon', { runId: run.runId })} disabled={busyAction !== null} className="rounded-lg bg-rose-500 px-3 py-2 text-[10px] font-black text-white hover:bg-rose-400 disabled:opacity-40">
                  {busyAction === 'abandon' ? 'Abandoning…' : 'Confirm abandon'}
                </button>
                <button type="button" onClick={() => setConfirmAbandon(false)} disabled={busyAction !== null} className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-40">Keep playing</button>
              </div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Challenge Coins</div>
              <div className="mt-1 text-xl font-black tabular-nums text-amber-200">{formatNumber(run.coins)}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Rolls</div>
              <div className="mt-1 text-xl font-black tabular-nums text-white">{formatNumber(run.totalRolls)}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Best rarity</div>
              <div className="mt-1 text-xl font-black tabular-nums text-cyan-200">{formatRarity(run.bestRarity)}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Objective</div>
              <div className="mt-1 text-xl font-black tabular-nums text-white">1/{formatRarity(challenge.targetRarity)}</div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <span>Challenge rarity progress</span><span>{Math.floor(progressPercent)}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-950">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-400 transition-all" style={{ width: progressPercent + '%' }} />
            </div>
          </div>

          {run.lastRoll && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-widest text-cyan-300">Latest result</div>
                <div className="mt-1 text-lg font-black text-white">1 / {formatRarity(run.lastRoll.rarity)} {run.lastRoll.isCritical ? '· CRITICAL' : ''}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-amber-200">+{formatNumber(run.lastRoll.coinsGained)} Coins</div>
                <div className="text-[10px] text-slate-500">Challenge wallet only</div>
              </div>
            </div>
          )}

          {isActive && (
            <>
              {Array.isArray(run.pendingMutationChoices) && run.pendingMutationChoices.length > 0 && (
                <div className="mt-5 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/[.07] p-4">
                  <div className="text-[10px] font-black uppercase tracking-widest text-fuchsia-200">Rift Mutation detected</div>
                  <h3 className="mt-1 text-lg font-black text-white">Choose an anomaly</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    A mutation is available after your run's progress milestone. It lasts for a limited number of Rift rolls and grants a reward when it expires.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {run.pendingMutationChoices.map(mutationId => {
                      const mutation = getRiftMutationDefinition(mutationId);
                      if (!mutation) return null;
                      return (
                        <button
                          key={mutationId}
                          type="button"
                          onClick={() => chooseMutation(mutationId)}
                          disabled={busyAction !== null}
                          className="rounded-xl border border-fuchsia-300/25 bg-slate-950/75 p-3 text-left transition hover:border-fuchsia-200/60 hover:bg-fuchsia-500/10 disabled:opacity-40"
                        >
                          <span className="block text-xs font-black text-fuchsia-100">{mutation.name}</span>
                          <span className="mt-1 block text-[10px] leading-relaxed text-slate-400">{mutation.description}</span>
                          <span className="mt-2 block text-[9px] font-bold text-fuchsia-200/80">{mutation.effect}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeMutationDefinition && run.activeMutation && (
                <div className="mt-5 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/[.06] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-widest text-fuchsia-200">Active Rift Mutation</div>
                      <h3 className="mt-1 text-lg font-black text-white">{activeMutationDefinition.name}</h3>
                    </div>
                    <div className="rounded-lg border border-fuchsia-300/20 bg-slate-950/70 px-3 py-2 text-right">
                      <div className="text-[8px] font-bold uppercase tracking-widest text-slate-500">Remaining</div>
                      <div className="text-sm font-black text-fuchsia-100">{formatNumber(Math.max(0, run.activeMutation.endsAtRoll - run.totalRolls))} rolls</div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{activeMutationDefinition.description}</p>
                  <p className="mt-1 text-[10px] font-bold text-fuchsia-200">{activeMutationDefinition.effect}</p>
                </div>
              )}

              {(archive.riftPerkLevels.emergencyProtocol ?? 0) > 0 && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/[.06] p-4">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-200">Emergency Protocol</div>
                    <p className="mt-1 text-xs text-slate-400">Clear your current roll cooldown and gain ×1.5 Luck for the next five rolls.</p>
                    <p className="mt-1 text-[10px] font-bold text-amber-100">{emergencyCharges} charge{emergencyCharges === 1 ? '' : 's'} remaining this run</p>
                  </div>
                  <button
                    type="button"
                    onClick={activateEmergencyProtocol}
                    disabled={busyAction !== null || emergencyCharges <= 0}
                    className="rounded-xl border border-amber-300/30 bg-amber-400/15 px-4 py-3 text-xs font-black text-amber-100 transition hover:bg-amber-400/25 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {busyAction === 'emergency-protocol' ? 'Activating…' : 'ACTIVATE'}
                  </button>
                </div>
              )}

              <div className="mt-5 rounded-2xl border border-violet-400/25 bg-violet-500/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-violet-300">Temporal Drag</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">Choose how much slower Rift rolls become. Temporal Arbitrage converts the added time into Luck; Temporal Compression reduces the cooldown cost without removing that Luck.</p>
                  </div>
                  <div className="rounded-lg border border-violet-300/20 bg-slate-950/60 px-3 py-2 text-right">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-violet-300">Selected</div>
                    <div className="text-lg font-black tabular-nums text-white">×{normalizeRiftTemporalDragMultiplier(temporalDragDraft).toFixed(1)}</div>
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={20}
                  step={0.5}
                  value={normalizeRiftTemporalDragMultiplier(temporalDragDraft)}
                  onChange={event => setTemporalDragDraft(Number(event.target.value))}
                  disabled={busyAction !== null}
                  className="mt-4 h-2 w-full cursor-pointer accent-violet-400 disabled:cursor-not-allowed"
                  aria-label="Temporal Drag multiplier"
                />
                <div className="mt-2 flex justify-between text-[9px] font-bold text-slate-500"><span>×1 · Normal time</span><span>×20 · Extreme drag</span></div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-950/60 p-3">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Arbitrage Luck</div>
                    <div className="mt-1 text-lg font-black text-cyan-200">×{riftTemporalArbitrageMultiplier(temporalDragDraft, archive.riftPerkLevels.temporalArbitrage).toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/60 p-3">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Cooldown cost</div>
                    <div className="mt-1 text-lg font-black text-amber-200">×{riftTemporalCooldownMultiplier(temporalDragDraft, archive.riftPerkLevels.temporalCompression).toFixed(2)}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={saveTemporalDrag}
                  disabled={busyAction !== null || normalizeRiftTemporalDragMultiplier(temporalDragDraft) === normalizeRiftTemporalDragMultiplier(run.temporalDragMultiplier ?? 1)}
                  className="mt-3 w-full rounded-lg border border-violet-300/25 bg-violet-500/15 px-3 py-2.5 text-[10px] font-black text-violet-100 transition hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {busyAction === 'temporal-drag' ? 'Applying…' : 'Apply Temporal Drag'}
                </button>
              </div>

              <div className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Rift game active</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  Your normal Roll, Upgrades, Collection, Quests, Prestige, and other player menus now read and write this Rift save. The original main save is isolated.
                </p>
                <button
                  type="button"
                  onClick={() => onEnterGame?.()}
                  disabled={busyAction !== null || !onEnterGame}
                  className="mt-3 min-h-12 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ENTER RIFT GAME
                </button>
              </div>

              <div className="mt-6">
                <div className="text-[10px] font-black uppercase tracking-[.2em] text-purple-300">Challenge upgrades</div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {(['fortune', 'speed', 'prosperity', 'critical'] as RiftChallengeUpgradeId[]).map(id => {
                    const definition = RIFT_CHALLENGE_UPGRADES[id];
                    const unlocked = snapshot.mechanicUnlocks[id] === true;
                    const level = run.upgradeLevels[id] ?? 0;
                    const maxed = level >= definition.maxLevel;
                    const cost = riftChallengeUpgradeCost(id, level, run.totalRolls);
                    return (
                      <article key={id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-black text-white">{definition.name}</h4>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{definition.description}</p>
                          </div>
                          <span className="shrink-0 rounded-lg bg-slate-800 px-2 py-1 text-[10px] font-black text-slate-300">Lv {level}/{definition.maxLevel}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-500">
                            {!unlocked ? definition.mainRequirement : maxed ? 'Maximum level' : formatNumber(cost) + ' Coins'}
                          </span>
                          <button type="button" onClick={() => buyUpgrade(id)} disabled={!unlocked || maxed || run.coins < cost || busyAction !== null} className="rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-3 py-2 text-[10px] font-black text-indigo-200 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-30">
                            {busyAction === id ? 'Buying…' : maxed ? 'MAXED' : 'UPGRADE'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-slate-600">Challenge upgrade prices rise by 5% every 10 rolls, up to 50%. Permanent Rift perks are separate from this temporary wallet.</p>
              </div>
            </>
          )}

          {isCompleted && (
            <div className="mt-5 rounded-2xl border border-emerald-400/25 bg-emerald-400/5 p-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-emerald-300">Objective achieved</div>
              <h3 className="mt-1 text-xl font-black text-white">{challenge.name} cleared.</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                The clear reward was credited to your Rift wallet. First clears permanently increase your hourly generation rate; replays award smaller repeatable point payouts.
              </p>
              <button
                type="button"
                onClick={() => startChallenge(challenge.id)}
                disabled={busyAction !== null}
                className="mt-4 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                Replay challenge
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
};
