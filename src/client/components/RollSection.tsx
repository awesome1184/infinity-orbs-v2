import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  Share2,
  Zap,
  Flame,
  Layers,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Coins,
  Crown,
  BellRing,
  FastForward,
  Radio,
  Filter,
  Compass,
  Globe,
  Award,
} from 'lucide-react';
import type { PlayerState, Orb } from '../../shared/game.js';
import type { WorldEvent } from '../../shared/social.js';
import {
  cooldownMs,
  rollsPerActivation,
  luckMultiplier,
  getOrbInfo,
  formatRarity,
  visibleContinuumTiers,
  formatNumber,
  frenzyCooldownRemaining,
} from '../../shared/game.js';

import { sound } from '../sound.js';
import { OrbOrbit } from './OrbOrbit.js';

interface RollSectionProps {
  state: PlayerState;
  lastOrb: Orb | null;
  lastBatch: Orb[];
  batchSummary: { totalVal: number; coins: number; shards: number; xp: number; frenzyCount?: number } | null;
  readyAt: number;
  busy: boolean;
  autoRoll: boolean;
  worldEvent?: WorldEvent | null;
  onToggleAutoRoll: () => void;
  onRoll: () => Promise<void>;
  onOrbFrenzy: () => Promise<void>;
  frenzyArmed: boolean;
  onOpenShareModal: (rarity: number) => void;
  onNewBest?: (orb: Orb, prevBest: number) => void;
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'Resetting soon';
  const totalSecs = Math.floor(ms / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${mins}m`;
}

function formatFrenzyCooldown(ms: number): string {
  if (ms <= 0) return 'READY';
  const totalSecs = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const RollSection: React.FC<RollSectionProps> = ({
  state,
  lastOrb,
  lastBatch,
  batchSummary,
  readyAt,
  busy,
  autoRoll,
  worldEvent,
  onToggleAutoRoll,
  onRoll,
  onOrbFrenzy,
  frenzyArmed,
  onOpenShareModal,
  onNewBest,
}) => {
  const [showBatchDetails, setShowBatchDetails] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(media.matches);
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);
  const [isRevealing, setIsRevealing] = useState(false);
  const [cooldownNotice, setCooldownNotice] = useState<string | null>(null);
  const [sonarActive, setSonarActive] = useState(() => sound.sonarMode);
  const [sonarThreshold, setSonarThresholdState] = useState(() => sound.sonarThreshold);
  const [sonarPinging, setSonarPinging] = useState(false);
  const [instantRevealActive, setInstantRevealActive] = useState(() => {
    try {
      return localStorage.getItem('orbs_instant_reveal') === 'true';
    } catch {
      return false;
    }
  });

  const prevOrbRef = useRef<Orb | null>(null);
  const lastFanfareTimeRef = useRef<number>(0);

  const hasSonarUpgrade = (state.prestigeUpgrades?.sonarPing ?? 0) > 0;
  const hasInstantUpgrade = (state.prestigeUpgrades?.instantReveal ?? 0) > 0;
  const hasFilterUpgrade = (state.prestigeUpgrades?.autoFilter ?? 0) > 0;
  const hasResonanceUpgrade = (state.prestigeUpgrades?.resonanceMeter ?? 0) > 0;

  const [filterActive, setFilterActive] = useState(() => {
    try {
      return localStorage.getItem('orbs_auto_filter') !== 'false';
    } catch {
      return true;
    }
  });

  const [isShaking, setIsShaking] = useState(false);
  const [rewardBurstActive, setRewardBurstActive] = useState(false);
  const rewardBurstKeyRef = useRef(0);
  const previousBatchSummaryRef = useRef<typeof batchSummary>(null);

  // Show the exact reward totals returned by the roll response. Manual rolls get
  // the full burst; Auto Roll keeps the persistent reward readout without turning
  // the screen into a constant fireworks machine.
  useEffect(() => {
    if (!batchSummary || previousBatchSummaryRef.current === batchSummary) return;
    previousBatchSummaryRef.current = batchSummary;

    const shouldAnimate =
      !autoRoll ||
      Boolean(lastOrb?.isCrit) ||
      (lastOrb?.rarity ?? 0) >= 1_000;

    if (!shouldAnimate) return;

    rewardBurstKeyRef.current += 1;
    setRewardBurstActive(true);
    const timer = window.setTimeout(() => setRewardBurstActive(false), 1100);
    return () => window.clearTimeout(timer);
  }, [batchSummary, autoRoll, lastOrb]);

  // The main Roll button always uses the manual-roll cooldown; Auto Roll timing is tracked by the server response.
  const cd = cooldownMs(state, false);
  const remain = Math.max(0, readyAt - now);
  const freeRolls = Math.max(0, state.freeRolls ?? 0);
  const canRoll = (remain <= 0 || freeRolls > 0) && !busy;
  const frenzyCooldownRemain = frenzyCooldownRemaining(state.lastFrenzyAt, now);
  const frenzyUsedToday = frenzyCooldownRemain > 0;
  const multi = rollsPerActivation(state);
  const luck = luckMultiplier(state);
  const isAutoUnlocked = (state.upgrades.auto ?? 0) > 0;
  const isTurbo = Boolean(state.turboRollUntil && state.turboRollUntil > now);
  const visibleTiers = visibleContinuumTiers(state.highestRarity || 0);
  const tiersReached = visibleTiers.filter(tier => (state.highestRarity || 0) >= tier.minRarity).length;
  const nextTier = visibleTiers.find(tier => (state.highestRarity || 0) < tier.minRarity);

  // Smooth or instant reveal on new roll
  useEffect(() => {
    if (!lastOrb) return;
    if (prevOrbRef.current === lastOrb) {
      // A preference change reruns this effect for the same Orb. Cleanup may
      // cancel an in-flight reveal timer, so clear its visual state explicitly.
      if (reducedMotion) {
        setIsRevealing(false);
        setIsShaking(false);
        setSonarPinging(false);
      }
      return;
    }
    prevOrbRef.current = lastOrb;

    let revealTimer: number | null = null;
    let shakeTimer: number | null = null;
    if (!reducedMotion && (!hasInstantUpgrade || !instantRevealActive)) {
      setIsRevealing(true);
      revealTimer = window.setTimeout(() => {
        setIsRevealing(false);
      }, 400);
    } else {
      setIsRevealing(false);
    }

    // Respect the OS motion preference for JS-driven effects too. CSS-only
    // reduced-motion rules cannot suppress canvas-confetti or state-driven shake.
    if (lastOrb.rarity >= 1000 && !reducedMotion) {
      setIsShaking(true);
      shakeTimer = window.setTimeout(() => setIsShaking(false), 450);
    } else {
      setIsShaking(false);
    }

    // Audio & celebratory fanfare (throttled to avoid stutter at high speeds)
    const nowTs = Date.now();
    const isSilentSonar = hasSonarUpgrade && sound.sonarMode;
    let sonarTimer: number | null = null;

    if (isSilentSonar) {
      // In Celestial Sonar Silent Mode: only ping on rare orbs!
      if (lastOrb.rarity >= sound.sonarThreshold) {
        sound.playSonarPing(lastOrb.rarity);
        setSonarPinging(true);
        sonarTimer = window.setTimeout(() => setSonarPinging(false), 900);
      }
    } else {
      if (lastOrb.rarity >= 100_000 && nowTs - lastFanfareTimeRef.current > 1200) {
        lastFanfareTimeRef.current = nowTs;
        sound.playMythicFanfare();
        if (!reducedMotion) {
          confetti({
            particleCount: 120,
            spread: 80,
            origin: { y: 0.6 },
            colors: ['#a855f7', '#ec4899', '#38bdf8', '#fbbf24'],
          });
        }
      } else if (lastOrb.rarity >= 1_000 && nowTs - lastFanfareTimeRef.current > 800) {
        lastFanfareTimeRef.current = nowTs;
        sound.playEpicFanfare();
        if (!reducedMotion) {
          confetti({
            particleCount: 50,
            spread: 50,
            origin: { y: 0.6 },
            colors: ['#fb923c', '#4ade80', '#38bdf8'],
          });
        }
      } else {
        sound.playRollNormal();
      }
    }

    return () => {
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      if (shakeTimer !== null) window.clearTimeout(shakeTimer);
      if (sonarTimer !== null) window.clearTimeout(sonarTimer);
    };
  }, [lastOrb, hasSonarUpgrade, instantRevealActive, hasInstantUpgrade, reducedMotion]);

  const displayOrb = lastOrb;
  const orbInfo = displayOrb ? getOrbInfo(displayOrb.rarity) : null;

  const cosmeticEffectClass =
    state.activeCosmetic === 'galaxy'
      ? 'ring-4 ring-purple-500/50 shadow-[0_0_50px_rgba(168,85,247,0.35)]'
      : state.activeCosmetic === 'solar'
      ? 'ring-4 ring-amber-500/50 shadow-[0_0_50px_rgba(245,158,11,0.4)]'
      : state.activeCosmetic === 'cyber'
      ? 'ring-4 ring-cyan-500/60 shadow-[0_0_50px_rgba(6,182,212,0.35)]'
      : state.activeCosmetic === 'emerald'
      ? 'ring-4 ring-emerald-500/50 shadow-[0_0_50px_rgba(16,185,129,0.35)]'
      : state.activeCosmetic === 'divine'
      ? 'ring-4 ring-yellow-300/70 shadow-[0_0_60px_rgba(253,224,71,0.45)]'
      : 'shadow-[0_0_35px_rgba(99,102,241,0.2)]';

  // Handle click on roll button or center orb
  const handleRollClick = () => {
    if (canRoll) {
      sound.playClick();
      setCooldownNotice(null);
      void onRoll();
    } else if (remain > 0) {
      sound.playClick();
      setCooldownNotice(`Cooldown active (${(remain / 1000).toFixed(1)}s remaining)`);
      setTimeout(() => setCooldownNotice(null), 1500);
    }
  };

  const hasMultipleOrbs = lastBatch.length > 1;
  const orbitRadius = typeof window !== 'undefined' && window.innerWidth < 400 ? 118 : 152;

  return (
    <div className="roll-layout">
      <section className="roll-main flex flex-col items-center justify-center max-w-2xl mx-auto space-y-4">
      {/* Weekly Cosmos Milestone Goal Banner */}
      {worldEvent && (
        <div className="w-full bg-gradient-to-r from-purple-950/70 via-slate-900 to-indigo-950/70 border border-purple-500/30 rounded-2xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs shadow-lg">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/20 border border-purple-400/30 flex items-center justify-center text-purple-300 shrink-0">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">Weekly Goal (Tier {worldEvent.tier})</span>
                <span className="text-[10px] bg-purple-500/20 text-purple-300 font-bold px-2 py-0.5 rounded-full border border-purple-500/30">
                  {worldEvent.buffDescription}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                {formatNumber(worldEvent.currentProgress)} / {formatNumber(worldEvent.goal)} rolls contributed
              </div>
            </div>
          </div>
          <div className="text-right text-[11px] font-mono text-amber-300/90 whitespace-nowrap bg-slate-950/60 border border-slate-800 px-2.5 py-1 rounded-lg">
            ⏳ Resets in {formatTimeLeft(worldEvent.endsAt - now)}
          </div>
        </div>
      )}

      {/* Turbo Roll Active Banner */}
      {isTurbo && (
        <div className="w-full bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 border border-amber-500/40 rounded-xl px-3 py-1.5 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-1.5 font-bold">
            <Flame className="w-4 h-4 text-amber-400" />
            <span>TURBO ACTIVE (-20% Cooldown)</span>
          </div>
          <span className="font-mono font-medium">
            {Math.ceil((state.turboRollUntil - now) / 60000)}m left
          </span>
        </div>
      )}

      {/* Main Celestial Orb Stage (Orbits & Main Orb are concentric and centered together) */}
      <div className={`roll-stage relative w-full flex items-center justify-center select-none ${isShaking ? 'animate-screen-shake' : ''}`}>
        {/* Ambient Glow Background centered on orb */}
        <div
          className="absolute w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none transition-colors duration-700"
          style={{
            backgroundColor: orbInfo ? orbInfo.color : '#6366f1',
          }}
        />

        {/* Orbiting Satellite Orbs Container (Concentric with central orb) */}
        {hasMultipleOrbs && <OrbOrbit orbs={lastBatch} radius={orbitRadius} />}

        {/* Celestial Sonar Radar Pulse Wave on Rare Drops */}
        {sonarPinging && (
          <div className="absolute z-0 w-48 h-48 rounded-full border-4 border-cyan-400/90 animate-ping pointer-events-none" />
        )}

        {/* One restrained ring keeps the stage alive without turning the center into a screensaver. */}
        <div className="absolute w-60 h-60 rounded-full border border-white/10 pointer-events-none" />
        {/* The Central Main Orb */}
        <div
          onClick={handleRollClick}
          className={`relative z-10 w-44 h-44 sm:w-48 sm:h-48 rounded-full flex flex-col items-center justify-center transition-all duration-500 transform cursor-pointer active:scale-95 ${cosmeticEffectClass} ${
            isRevealing ? 'scale-105 ring-4 ring-white/60' : 'hover:scale-102'
          }`}
          style={{
            background: orbInfo
              ? orbInfo.bgGradient
              : 'radial-gradient(circle at 35% 30%, #6366f1, #312e81 65%, #0f172a)',
          }}
        >
          {/* Exact reward burst. These values come from the authoritative roll response. */}
          {batchSummary && rewardBurstActive && (
            <div
              key={rewardBurstKeyRef.current}
              className="reward-burst"
              aria-live="polite"
              aria-label="Roll rewards"
            >
              <div className="reward-burst-ring" />
              <div className="reward-burst-title">REWARD</div>
              <div className="reward-burst-row">
                <div className="reward-chip reward-chip-coins">
                  <Coins className="w-4 h-4" />
                  <strong>+{formatNumber(batchSummary.coins)}</strong>
                  <span>Coins</span>
                </div>
                <div className="reward-chip reward-chip-xp">
                  <Sparkles className="w-4 h-4" />
                  <strong>+{formatNumber(batchSummary.xp)}</strong>
                  <span>XP</span>
                </div>
                <div className="reward-chip reward-chip-shards">
                  <Zap className="w-4 h-4" />
                  <strong>+{formatNumber(batchSummary.shards)}</strong>
                  <span>Shards</span>
                </div>
                <div className="reward-chip reward-chip-value">
                  <Award className="w-4 h-4" />
                  <strong>+{formatNumber(batchSummary.totalVal)}</strong>
                  <span>Value</span>
                </div>
              </div>
              {lastOrb?.isCrit && <div className="reward-burst-crit">⚡ CRITICAL</div>}
            </div>
          )}

          {/* Subtle Inner Glass Ring */}
          <div className="absolute inset-2 rounded-full border border-white/20 pointer-events-none" />

          {/* Rarity & Name Presentation */}
          <div className="relative z-10 text-center px-4">
            <span
              className="text-[11px] font-black uppercase tracking-widest block mb-1 drop-shadow"
              style={{ color: orbInfo ? orbInfo.color : '#cbd5e1' }}
            >
              {orbInfo ? orbInfo.tier : 'READY'}
            </span>

            <div className="text-2xl sm:text-3xl font-black text-white tracking-tight drop-shadow-md font-mono">
              {displayOrb
                ? `1 / ${formatRarity(displayOrb.rarity)}`
                : '1 / ∞'}
            </div>

            <div className="text-xs font-semibold text-white/90 mt-1 drop-shadow">
              {orbInfo ? orbInfo.name : 'Tap to Roll'}
            </div>
          </div>

          {/* Critical Roll Badge */}
          {displayOrb?.isCrit && (
            <div className="absolute -top-6 bg-gradient-to-r from-rose-500 to-amber-500 text-white text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full shadow-lg border border-amber-300">
              ⚡ 2× CRITICAL ROLL
            </div>
          )}

          {/* New Discovery Badge */}
          {displayOrb?.isNew && (
            <div className="absolute -top-2 bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-950 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full shadow-lg">
              ★ NEW ORB
            </div>
          )}
        </div>
      </div>

      {/* Orbit & Roll Status Callouts (sitting comfortably below the orb and satellites) */}
      <div className="w-full flex flex-col items-center space-y-2">
        {/* Multi-Roll Orbit Callout Badge */}
        {hasMultipleOrbs && (
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-slate-900/80 border border-slate-800 px-3 py-1 rounded-full shadow-sm">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>Showing best of {lastBatch.length} circling orbs</span>
          </div>
        )}

        {/* Persistent exact reward readout, including all bonuses. */}
        {batchSummary && (
          <div className="roll-reward-summary" aria-live="polite">
            <div className="roll-reward-label">Last Roll Reward</div>
            <div className="roll-reward-values">
              <span className="roll-reward-value coins"><Coins className="w-3.5 h-3.5" /> +{formatNumber(batchSummary.coins)} Coins</span>
              <span className="roll-reward-value xp"><Sparkles className="w-3.5 h-3.5" /> +{formatNumber(batchSummary.xp)} XP</span>
              <span className="roll-reward-value shards"><Zap className="w-3.5 h-3.5" /> +{formatNumber(batchSummary.shards)} Shards</span>
              <span className="roll-reward-value value"><Award className="w-3.5 h-3.5" /> +{formatNumber(batchSummary.totalVal)} Value</span>
            </div>
          </div>
        )}

        {/* Cooldown Timer */}
        <div className="text-center pt-1">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
            {canRoll ? 'READY TO ROLL' : `COOLDOWN: ${(remain / 1000).toFixed(1)}s`}
          </div>
          {/* Progress Bar */}
          <div className="w-48 h-1.5 bg-slate-800 rounded-full mx-auto mt-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-200"
              style={{
                width: canRoll ? '100%' : `${Math.min(100, ((cd - remain) / cd) * 100)}%`,
              }}
            />
          </div>
          {cooldownNotice && (
            <div className="text-[11px] text-amber-400 mt-1 font-medium animate-in fade-in duration-200">
              {cooldownNotice}
            </div>
          )}
        </div>
      </div>

      {/* Primary Action Button */}
      <div className="roll-controls flex flex-col items-center gap-3 w-full max-w-sm">
        {freeRolls > 0 && (
          <div className="text-[10px] font-black uppercase tracking-wider text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded-full px-3 py-1">
            FREE ROLL READY · {freeRolls} LEFT
          </div>
        )}

        <button
          onClick={handleRollClick}
          className={'roll-button ' + (frenzyArmed ? 'frenzy-supercharged' : canRoll ? 'is-ready' : 'is-waiting') + ' w-full py-4 px-6 rounded-2xl font-black text-base sm:text-lg tracking-wide shadow-xl transition-all transform duration-150 active:scale-95 flex items-center justify-center gap-2 cursor-pointer ' +
            (frenzyArmed
              ? 'bg-fuchsia-700 hover:bg-fuchsia-600 text-white border border-fuchsia-300/40 shadow-[0_0_36px_rgba(217,70,239,0.38)]'
              : canRoll
              ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-950/30'
              : busy
              ? 'bg-slate-800 text-slate-400 cursor-wait'
              : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700')}
          aria-label={frenzyArmed ? 'Release Frenzy roll' : 'Roll'}
        >
          {frenzyArmed && (
            <>
              <Zap className='frenzy-lightning frenzy-lightning-left w-5 h-5' />
              <Zap className='frenzy-lightning frenzy-lightning-right w-5 h-5' />
            </>
          )}
          <Sparkles className={'w-5 h-5 ' + (frenzyArmed ? 'text-yellow-200 frenzy-spark' : 'text-cyan-300')} />
          <span>
            {busy
              ? 'ROLLING...'
              : frenzyArmed
              ? remain > 0
                ? 'WAIT ' + (remain / 1000).toFixed(1) + 's'
                : 'RELEASE FRENZY'
              : remain > 0 && freeRolls <= 0
              ? 'WAIT ' + (remain / 1000).toFixed(1) + 's'
              : 'ROLL ' + (multi > 1 ? '×' + multi : '')}
          </span>
        </button>

        <button
          onClick={() => void onOrbFrenzy()}
          disabled={busy || frenzyArmed || frenzyUsedToday}
          className={
            busy || frenzyArmed || frenzyUsedToday
              ? 'w-full px-4 py-2.5 rounded-xl text-xs font-black bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed'
              : 'w-full px-4 py-2.5 rounded-xl text-xs font-black bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-200 hover:bg-fuchsia-500/20 active:scale-95'
          }
          title={frenzyUsedToday ? 'Orb Frenzy returns after the 23-hour cooldown.' : 'Arm Orb Frenzy, then use your next manual Roll to submit it.'}
        >
          <span className='inline-flex items-center justify-center gap-2 w-full'>
            <Sparkles className='w-4 h-4 text-fuchsia-300' />
            <span>
              {frenzyArmed
                ? 'Frenzy Armed · Roll Now'
                : frenzyUsedToday
                ? 'Frenzy Cooldown · ' + formatFrenzyCooldown(frenzyCooldownRemain)
                : 'Orb Frenzy · Charge Next Roll'}
            </span>
          </span>
        </button>

        <details className='w-full rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left'>
          <summary className='flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-semibold text-slate-300'>
            <span className='inline-flex items-center gap-2'>
              <Sparkles className='w-3.5 h-3.5 text-fuchsia-300' />
              Orb Frenzy
            </span>
            <span className='text-[10px] font-medium text-slate-500'>How it works</span>
          </summary>
          <div className='mt-2 text-[11px] leading-relaxed text-slate-400'>
            Once per day, charge a Frenzy, then use your next manual Roll to submit it. The displayed rarity sets the base size,
            then your Multi Roll multiplies the claim. You can claim one public Frenzy each day.
          </div>
        </details>

        {/* Control Toggles: Auto Roll, Sonar Mode, Instant Chrono-Skip */}
        <div className="flex flex-wrap items-center justify-center gap-2 w-full">
          {/* Auto Roll Toggle */}
          {isAutoUnlocked ? (
            <button
              onClick={() => {
                sound.playClick();
                onToggleAutoRoll();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                autoRoll
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Zap className={`w-3.5 h-3.5 ${autoRoll ? 'text-emerald-400' : ''}`} />
              <span>Auto Roll: {autoRoll ? 'ON' : 'OFF'}</span>
            </button>
          ) : (
            <div className="text-[11px] text-slate-500 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              <span>Auto Roll unlocks after 3 manual rolls ({state.manualRolls ?? 0}/3)</span>
            </div>
          )}

          {/* Celestial Sonar Silent Mode Toggle (Unlocked via Prestige) */}
          {hasSonarUpgrade && (
            <button
              onClick={() => {
                const next = !sonarActive;
                setSonarActive(next);
                sound.setSonarMode(next);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                sonarActive
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25 ring-1 ring-cyan-500/30'
                  : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Silent Mode: Mutes standard rolls and alerts with a crystal chime on rare drops"
            >
              <BellRing className={`w-3.5 h-3.5 ${sonarActive ? 'text-cyan-400 animate-pulse' : ''}`} />
              <span>Sonar Ping: {sonarActive ? 'SILENT' : 'OFF'}</span>
            </button>
          )}

          {/* Chrono-Skip Instant Multi-Roll (Unlocked via Prestige) */}
          {hasInstantUpgrade && (
            <button
              onClick={() => {
                const next = !instantRevealActive;
                setInstantRevealActive(next);
                try {
                  localStorage.setItem('orbs_instant_reveal', String(next));
                } catch {}
                sound.playClick();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                instantRevealActive
                  ? 'bg-purple-500/15 border-purple-500/40 text-purple-300 hover:bg-purple-500/25 ring-1 ring-purple-500/30'
                  : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Skip roll animations for instant reveals"
            >
              <FastForward className={`w-3.5 h-3.5 ${instantRevealActive ? 'text-purple-400' : ''}`} />
              <span>Chrono-Skip: {instantRevealActive ? 'INSTANT' : 'OFF'}</span>
            </button>
          )}

          {/* Singularity Filter Toggle (Unlocked via Prestige) */}
          {hasFilterUpgrade && (
            <button
              onClick={() => {
                const next = !filterActive;
                setFilterActive(next);
                try {
                  localStorage.setItem('orbs_auto_filter', String(next));
                } catch {}
                sound.playClick();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                filterActive
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 ring-1 ring-emerald-500/30'
                  : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Salvages Common & Uncommon rolls directly into +25% bonus gold"
            >
              <Filter className={`w-3.5 h-3.5 ${filterActive ? 'text-emerald-400' : ''}`} />
              <span>Filter: {filterActive ? 'SALVAGE' : 'OFF'}</span>
            </button>
          )}
        </div>

        {/* Pity Meter Gauge (Unlocked via Prestige) */}
        {hasResonanceUpgrade && (
          <div className="w-full bg-slate-900/80 border border-indigo-900/50 rounded-2xl p-3 shadow-md space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-indigo-300">
                <Compass className="w-4 h-4 text-indigo-400" />
                <span>Pity Luck</span>
              </div>
              <span className="font-mono text-cyan-300 font-bold">
                +{((state.prestigeUpgrades?.resonanceMeter ?? 1) * Math.floor((state.rollsSinceBest ?? 0) / Math.max(6, 18 - (state.masterySkills?.pityAccelerant ?? 0) * 2)))}% Pity Luck
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300"
                style={{
                  width: `${Math.min(100, (((state.rollsSinceBest ?? 0) % 20) / 20) * 100)}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 font-medium">
              <span>{((state.rollsSinceBest ?? 0) % 20)} / 20 rolls to next tier</span>
              <span>Dry streak: {state.rollsSinceBest ?? 0} rolls</span>
            </div>
          </div>
        )}

        {/* Sonar Ping Threshold Config Selector when active */}
        {hasSonarUpgrade && sonarActive && (
          <div className="flex items-center gap-2 bg-slate-950/80 border border-cyan-900/40 rounded-xl px-3 py-1.5 text-[11px]">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span className="text-slate-400 font-semibold">Ping On:</span>
            <div className="flex items-center gap-1">
              {[
                { label: 'Rare (1/100)', val: 100 },
                { label: 'Epic (1/1k)', val: 1_000 },
                { label: 'Legendary (1/10k)', val: 10_000 },
              ].map(opt => (
                <button
                  key={opt.val}
                  onClick={() => {
                    setSonarThresholdState(opt.val);
                    sound.setSonarThreshold(opt.val);
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                    sonarThreshold === opt.val
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Orb Frenzy Result */}
      {batchSummary?.frenzyCount ? (
        <div className="w-full rounded-2xl border border-fuchsia-500/30 bg-gradient-to-r from-fuchsia-950/40 via-slate-900 to-purple-950/40 p-4 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">Orb Frenzy</div>
              <div className="mt-1 text-lg font-black text-white">
                {formatNumber(batchSummary.frenzyCount)} Orbs rolled
              </div>
            </div>
            <Zap className="w-7 h-7 text-fuchsia-300" />
          </div>
          <div className="mt-2 text-xs text-slate-400">
            The full Frenzy reward was applied server-side. The orbit above shows the best result from the volley.
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="rounded-xl bg-slate-950/50 border border-slate-800 px-2 py-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">Value</div>
              <div className="text-sm font-black text-cyan-300">+{formatNumber(batchSummary.totalVal)}</div>
            </div>
            <div className="rounded-xl bg-slate-950/50 border border-slate-800 px-2 py-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">Coins</div>
              <div className="text-sm font-black text-amber-300">+{formatNumber(batchSummary.coins)}</div>
            </div>
            <div className="rounded-xl bg-slate-950/50 border border-slate-800 px-2 py-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">XP</div>
              <div className="text-sm font-black text-purple-300">+{formatNumber(batchSummary.xp)}</div>
            </div>
            <div className="rounded-xl bg-slate-950/50 border border-slate-800 px-2 py-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">Shards</div>
              <div className="text-sm font-black text-cyan-300">+{formatNumber(batchSummary.shards)}</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Multi Roll Batch Results Summary */}
      {batchSummary && multi > 1 && (
        <div className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-bold text-white">
                {lastBatch.length} Orbs Rolled
              </span>
              <span className="text-xs text-slate-400">
                (Best: 1/{lastOrb ? formatRarity(lastOrb.rarity) : '—'})
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-amber-400">
                +{formatNumber(batchSummary.coins)} Coins
              </span>
              {batchSummary.shards > 0 && (
                <span className="text-xs font-semibold text-cyan-400">
                  +{batchSummary.shards} Shards
                </span>
              )}
              <button
                onClick={() => {
                  sound.playClick();
                  setShowBatchDetails(!showBatchDetails);
                }}
                className="text-slate-400 hover:text-white p-1 cursor-pointer transition-colors"
                title="Toggle batch breakdown"
              >
                {showBatchDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Batch Breakdown Grid */}
          {showBatchDetails && (
            <div className="mt-3 pt-3 border-t border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto pr-1">
              {lastBatch.map((orb, i) => {
                const info = getOrbInfo(orb.rarity);
                const isBest = displayOrb && orb.rarity === displayOrb.rarity;
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                      isBest
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-200'
                        : 'bg-slate-950/60 border border-slate-800/80 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-mono">
                      {isBest && <Crown className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                      <span>1/{formatRarity(orb.rarity)}</span>
                    </div>
                    <span className="font-bold text-[10px]" style={{ color: info.color }}>
                      {info.tier}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Share to Reddit Action */}
      {lastOrb && lastOrb.rarity >= 100 && (
        <button
          onClick={() => {
            sound.playClick();
            onOpenShareModal(lastOrb.rarity);
          }}
          className="flex items-center gap-2 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/40 text-orange-300 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg cursor-pointer"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Share 1/{formatRarity(lastOrb.rarity)} to Reddit</span>
        </button>
      )}

      {/* Quick Specs Footer */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full text-center text-xs">
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5">
          <span className="text-slate-500 block text-[10px] font-semibold uppercase">Cooldown</span>
          <span className="font-bold text-slate-200">{(cd / 1000).toFixed(1)}s</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5">
          <span className="text-slate-500 block text-[10px] font-semibold uppercase">Multi Roll</span>
          <span className="font-bold text-slate-200">×{multi}</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5">
          <span className="text-slate-500 block text-[10px] font-semibold uppercase">Luck Bonus</span>
          <span className="font-bold text-cyan-300">+{Math.round((luck - 1) * 100)}%</span>
        </div>
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-2.5">
          <span className="text-slate-500 block text-[10px] font-semibold uppercase">Level Bonus</span>
          <span className="font-bold text-purple-300">+{Math.max(0, state.level - 1)}% Luck</span>
        </div>
      </div>
        </section>

      <aside className="roll-sidebar" aria-label="Run summary">
        <section className="field-card">
          <div className="field-card-header">
            <span className="field-label">Latest discovery</span>
            {displayOrb?.isNew && <span className="text-[9px] font-extrabold uppercase tracking-wider text-amber-300">New</span>}
          </div>
          {displayOrb ? (
            <div className="latest-orb">
              <div className="latest-orb-mark"><Award className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="latest-orb-name">{displayOrb.name}</div>
                <div className="latest-orb-rarity">1 / {formatRarity(displayOrb.rarity)}</div>
              </div>
            </div>
          ) : (
            <p className="field-empty">The first signal is waiting. Roll to record your opening discovery.</p>
          )}
          {displayOrb && orbInfo && <div className="field-stat-row mt-3 !border-t-0 !pt-0"><span>Continuum class</span><strong style={{ color: orbInfo.color }}>{orbInfo.tier}</strong></div>}
        </section>

        <section className="field-card">
          <div className="field-card-header">
            <span className="field-label">Next horizon</span>
            <span className="text-[10px] font-bold text-teal-200">{tiersReached} / {visibleTiers.length}</span>
          </div>
          {nextTier ? (
            <>
              <div className="field-level"><strong className="!text-[21px]">{nextTier.tier}</strong><span>tier</span></div>
              <div className="field-stat-row mt-2"><span>Threshold</span><strong>1 / {formatRarity(nextTier.minRarity)}</strong></div>
            </>
          ) : (
            <p className="field-empty">Every listed horizon is behind you. The continuum keeps going.</p>
          )}
        </section>
      </aside>
    </div>
  );
};
