import React, { useState, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  Share2,
  Zap,
  Flame,
  Layers,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Coins,
  Crown,
  BellRing,
  FastForward,
  Compass,
  Award,
} from 'lucide-react';
import type { PlayerState, Orb, UpgradeId } from '../../shared/game.js';
import type { LiveBalanceConfig } from '../../shared/live-balance.js';
import {
  cooldownMs,
  timeEnergyActivationsAvailable,
  normalizeCelestialAlignmentInstances,
  celestialAlignmentStackCount,
  rollsPerActivation,
  luckMultiplier,
  upgradeCost,
  getOrbInfo,
  formatRarity,
  visibleContinuumTiers,
  formatNumber,
  formatShardAmount,
  frenzyCooldownRemaining,
  luckRarityFactor,
} from '../../shared/game.js';
import { combatBossLuckBonus, combatRuneBonuses, combatRuneLuckMultiplier, combatTotalBossesBeaten, type CombatState } from '../../shared/combat.js';

import { sound } from '../sound.js';
import { OrbOrbit } from './OrbOrbit.js';

interface RollSectionProps {
  state: PlayerState;
  liveBalance: LiveBalanceConfig;
  lastOrb: Orb | null;
  lastBatch: Orb[];
  batchSummary: { totalVal: number; coins: number; shards: number; xp: number; frenzyCount?: number } | null;
  readyAt: number;
  busy: boolean;
  autoRoll: boolean;
  onBuyUpgrade: (id: UpgradeId) => Promise<boolean>;
  onBuyAllUpgrades: () => Promise<boolean>;
  onOpenUpgrades: () => void;
  onToggleAutoRoll: () => void;
  onRoll: () => Promise<void>;
  onUseTimeEnergy: () => Promise<void>;
  onOrbFrenzy: () => Promise<void>;
  frenzyArmed: boolean;
  onOpenShareModal: (rarity: number, isInfinity?: boolean) => void;
  onNewBest?: (orb: Orb, prevBest: number) => void;
  riftCompletionReveal?: { id: string; orb: Orb } | null;
  onRiftCompletionRevealComplete?: () => void;
}

interface FloatingRewardText {
  id: number;
  text: string;
  tone: 'coins' | 'xp' | 'shards' | 'value';
  left: number;
  top: number;
  dx: number;
  dy: number;
  delay: number;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function formatFrenzyCooldown(ms: number): string {
  if (ms <= 0) return 'READY';
  const totalSecs = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatAlignmentRemaining(ms: number): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return hours > 0
    ? `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

export const RollSection: React.FC<RollSectionProps> = ({
  state,
  liveBalance,
  lastOrb,
  lastBatch,
  batchSummary,
  readyAt,
  busy,
  autoRoll,
  onBuyUpgrade,
  onBuyAllUpgrades,
  onOpenUpgrades,
  onToggleAutoRoll,
  onRoll,
  onUseTimeEnergy,
  onOrbFrenzy,
  frenzyArmed,
  onOpenShareModal,
  onNewBest,
  riftCompletionReveal = null,
  onRiftCompletionRevealComplete,
}) => {
  const isRiftSave = Boolean(state.riftSession || state.riftSaveContext?.startsWith('rift:'));
  const frenzyArmedForRoll = frenzyArmed && !isRiftSave;
  const [showBatchDetails, setShowBatchDetails] = useState(false);
  const [floatingRewards, setFloatingRewards] = useState<FloatingRewardText[]>([]);
  const [shakeIntensity, setShakeIntensity] = useState(0);
  const rollStageRef = useRef<HTMLDivElement | null>(null);
  const pendingRollOriginRef = useRef<{ x: number; y: number } | null>(null);
  const floatingRewardIdRef = useRef(0);
  const floatingRewardTimersRef = useRef<number[]>([]);
  const lastBatchSummaryRef = useRef(batchSummary);
  const [quickUpgradePendingCounts, setQuickUpgradePendingCounts] = useState<Partial<Record<UpgradeId, number>>>({});
  const [quickBuyAllBusy, setQuickBuyAllBusy] = useState(false);
  const quickUpgradePendingCountRef = useRef(0);
  const quickBuyAllBusyRef = useRef(false);
  const quickUpgradePendingCount = Object.values(quickUpgradePendingCounts)
    .reduce((total, count) => total + (count ?? 0), 0);
  const [now, setNow] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion());
  const [riftCompletionPhase, setRiftCompletionPhase] = useState<'charge' | 'rush' | null>(null);
  const [riftCompletionOrb, setRiftCompletionOrb] = useState<Orb | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(media.matches);
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    const reveal = riftCompletionReveal;
    if (!reveal) {
      setRiftCompletionPhase(null);
      setRiftCompletionOrb(null);
      return;
    }

    setRiftCompletionPhase('charge');
    setRiftCompletionOrb(null);
    const chargeDuration = reducedMotion ? 0 : 2_250;
    const rushDuration = reducedMotion ? 90 : 760;
    const rushTimer = window.setTimeout(() => {
      setRiftCompletionOrb(reveal.orb);
      setRiftCompletionPhase('rush');
    }, chargeDuration);
    const finishTimer = window.setTimeout(() => {
      setRiftCompletionPhase(null);
      setRiftCompletionOrb(null);
      onRiftCompletionRevealComplete?.();
    }, chargeDuration + rushDuration);

    return () => {
      window.clearTimeout(rushTimer);
      window.clearTimeout(finishTimer);
    };
  }, [riftCompletionReveal?.id, reducedMotion, onRiftCompletionRevealComplete]);

  useEffect(() => () => {
    floatingRewardTimersRef.current.forEach(timer => window.clearTimeout(timer));
    floatingRewardTimersRef.current = [];
  }, []);

  useEffect(() => {
    if (batchSummary === lastBatchSummaryRef.current) return;
    lastBatchSummaryRef.current = batchSummary;
    if (!batchSummary) {
      pendingRollOriginRef.current = null;
      return;
    }

    const stage = rollStageRef.current;
    if (!stage || reducedMotion) {
      pendingRollOriginRef.current = null;
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const orbRect = stage.querySelector<HTMLElement>('.io-main-orb')?.getBoundingClientRect();
    const orbCenter = orbRect
      ? {
          x: orbRect.left - stageRect.left + orbRect.width / 2,
          y: orbRect.top - stageRect.top + orbRect.height / 2,
        }
      : { x: stageRect.width / 2, y: stageRect.height / 2 };

    const clickedOrigin = pendingRollOriginRef.current;
    pendingRollOriginRef.current = null;
    let origin = !autoRoll && clickedOrigin ? clickedOrigin : null;
    if (!origin) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 76 + Math.random() * 20;
      origin = {
        x: orbCenter.x + Math.cos(angle) * radius,
        y: orbCenter.y + Math.sin(angle) * radius,
      };
    }

    const rewardValues: Array<{ amount: number; text: string; tone: FloatingRewardText['tone'] }> = [
      { amount: Number(batchSummary.coins), text: '+' + formatNumber(batchSummary.coins) + ' Coins', tone: 'coins' as const },
      { amount: Number(batchSummary.xp), text: '+' + formatNumber(batchSummary.xp) + ' XP', tone: 'xp' as const },
      { amount: Number(batchSummary.shards), text: '+' + formatShardAmount(batchSummary.shards) + ' Shards', tone: 'shards' as const },
      { amount: Number(batchSummary.totalVal), text: '+' + formatNumber(batchSummary.totalVal) + ' Value', tone: 'value' as const },
    ].filter(reward => Number.isFinite(reward.amount) && reward.amount > 0);

    if (rewardValues.length === 0) return;

    const nextRewards = rewardValues.map((reward, index): FloatingRewardText => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 64 + Math.random() * 48;
      return {
        id: ++floatingRewardIdRef.current,
        text: reward.text,
        tone: reward.tone,
        left: origin!.x,
        top: origin!.y,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        delay: index * 38,
      };
    });

    const ids = new Set(nextRewards.map(reward => reward.id));
    setFloatingRewards(current => [...current, ...nextRewards].slice(-48));
    const expiryTimer = window.setTimeout(() => {
      setFloatingRewards(current => current.filter(reward => !ids.has(reward.id)));
      floatingRewardTimersRef.current = floatingRewardTimersRef.current.filter(timer => timer !== expiryTimer);
    }, 1150);
    floatingRewardTimersRef.current.push(expiryTimer);
  }, [batchSummary, autoRoll, reducedMotion]);

  useEffect(() => {
    let timer: number | null = null;
    const scheduleTick = () => {
      const current = Date.now();
      const rollRemaining = readyAt - current;
      const frenzyRemaining = frenzyCooldownRemaining(state.lastFrenzyAt, current);
      const turboRemaining = (state.turboRollUntil ?? 0) - current;
      const activeAlignmentInstances = normalizeCelestialAlignmentInstances(state.alignmentActiveInstances, state.alignmentActiveChoice, state.alignmentActiveUntil, current);
      const alignmentRemaining = activeAlignmentInstances.reduce((latest, item) => Math.max(latest, item.expiresAt - current), 0);
      const hasActiveCountdown = rollRemaining > 0 || frenzyRemaining > 0 || turboRemaining > 0 || alignmentRemaining > 0;
      setNow(current);
      if (!hasActiveCountdown) {
        timer = null;
        return;
      }
      // Update quickly during the last three seconds of the roll cooldown;
      // otherwise retain ticking only while some visible countdown is active.
      timer = window.setTimeout(scheduleTick, rollRemaining > 0 && rollRemaining <= 3000 ? 250 : 1000);
    };
    const syncOnVisibility = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      scheduleTick();
    };
    scheduleTick();
    document.addEventListener('visibilitychange', syncOnVisibility);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', syncOnVisibility);
    };
  }, [readyAt, state.lastFrenzyAt, state.turboRollUntil, state.alignmentActiveUntil, state.alignmentActiveInstances, state.alignmentActiveChoice]);
  const [isRevealing, setIsRevealing] = useState(false);
  const [cooldownNotice, setCooldownNotice] = useState<string | null>(null);
  const cooldownNoticeTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (cooldownNoticeTimerRef.current !== null) window.clearTimeout(cooldownNoticeTimerRef.current);
  }, []);
  const [sonarActive, setSonarActive] = useState(() => sound.sonarMode);
  useEffect(() => sound.subscribeSonarMode(setSonarActive), []);
  const [sonarPinging, setSonarPinging] = useState(false);
  const [sonarAlertMode, setSonarAlertModeState] = useState(() => sound.sonarAlertMode);
  const [sonarAlignmentSoundsAllowed, setSonarAlignmentSoundsAllowedState] = useState(() => sound.sonarAlignmentSoundsAllowed);
  const [instantRevealActive, setInstantRevealActive] = useState(() => {
    try {
      return localStorage.getItem('orbs_instant_reveal') === 'true';
    } catch {
      return false;
    }
  });

  const prevOrbRef = useRef<Orb | null>(null);
  const lastFanfareTimeRef = useRef<number>(0);
  const bestRarityForSoundRef = useRef<number>(Math.max(2, Number(state.highestRarity) || 2));
  const bestWasInfinityRef = useRef(state.highestRarityIsInfinity === true);
  const [alignmentSoundEnabled, setAlignmentSoundEnabled] = useState(() => sound.alignmentSoundEnabled);

  const hasSonarUpgrade = (state.prestigeUpgrades?.sonarPing ?? 0) > 0;
  const hasAlignmentUpgrade = (state.masterySkills?.celestialAlignment ?? 0) > 0;
  const hasCooldownReclaimer = (state.masterySkills?.cooldownReclaimer ?? 0) > 0;
  const timeEnergy = Math.max(0, Math.floor(Number(state.timeEnergy ?? 0) || 0));
  const hasInstantUpgrade = (state.prestigeUpgrades?.instantReveal ?? 0) > 0;
  const hasResonanceUpgrade = (state.prestigeUpgrades?.resonanceMeter ?? 0) > 0;
  const pityCalibration = Math.max(0, Math.min(5, Math.floor(Number(state.masterySkills?.pityAccelerant) || 0)));
  const pityInterval = Math.max(6, 18 - pityCalibration * 2);
  const rawPityDryRolls = Number(state.rollsSinceBest ?? 0);
  const pityDryRolls = Number.isSafeInteger(rawPityDryRolls) && rawPityDryRolls >= 0 ? rawPityDryRolls : 0;
  const pityTier = Math.floor(pityDryRolls / pityInterval);
  const pityRollsIntoTier = pityDryRolls % pityInterval;
  const pityProgressPct = (pityRollsIntoTier / pityInterval) * 100;

  const [isShaking, setIsShaking] = useState(false);
  // The main Roll button always uses the manual-roll cooldown; Auto Roll timing is tracked by the server response.
  const cd = cooldownMs(state, false, liveBalance);
  const timeEnergyRollsAvailable = timeEnergyActivationsAvailable(timeEnergy, cd);
  const timeEnergySpendMs = timeEnergyRollsAvailable * cd;
  const timeEnergyProgressPct = cd > 0 ? Math.max(0, Math.min(100, (timeEnergy / cd) * 100)) : 0;
  const remain = Math.max(0, readyAt - now);
  const freeRolls = Math.max(0, state.freeRolls ?? 0);
  // Free rolls bypass the normal cooldown, but never skip the deliberate Frenzy release wait.
  const rawChainPatcherTarget = Number(state.chainPatcherNextRarity ?? 0);
  const chainPatcherPending = rawChainPatcherTarget !== 0;
  const chainPatcherCharged = Number.isSafeInteger(rawChainPatcherTarget) && rawChainPatcherTarget >= 2;
  const adminGuaranteedRollQueued = state.adminGuaranteedRollQueued === true;
  const canRoll = !busy && (chainPatcherPending
    ? chainPatcherCharged && remain <= 0
    : remain <= 0 || (freeRolls > 0 && !frenzyArmedForRoll));
  const frenzyReady = frenzyArmedForRoll && canRoll;
  const cooldownProgress = busy || canRoll;
  const frenzyCooldownRemain = frenzyCooldownRemaining(state.lastFrenzyAt, now);
  const frenzyUsedToday = frenzyCooldownRemain > 0;
  const cooldownProgressPct = cooldownProgress ? 100 : cd > 0 ? Math.max(0, Math.min(100, ((cd - remain) / cd) * 100)) : 0;
  const multi = rollsPerActivation(state);
  const luck = luckMultiplier(state);
  const [runeLuckPct, setRuneLuckPct] = useState(0);
  const [bossLuckBonus, setBossLuckBonus] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void fetch('/api/combat/state', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<{ state?: Pick<CombatState, 'runes' | 'equippedRunes' | 'dungeonId' | 'depth' | 'bestDepth' | 'depthCapCleared' | 'dungeonBestDepths' | 'dungeonBossesBeaten'> }> : null)
      .then(payload => {
        if (!active || !payload?.state) return;
        const combatState = payload.state;
        setRuneLuckPct(combatRuneBonuses(combatState.runes, combatState.equippedRunes).luckPct);
        setBossLuckBonus(combatBossLuckBonus(combatTotalBossesBeaten(combatState)));
      })
      .catch(() => {
        if (!active) return;
        setRuneLuckPct(0);
        setBossLuckBonus(0);
      });
    return () => { active = false; controller.abort(); };
  }, []);
  // Starseeker raises ordinary Luck only. Rune Luck stays a separate multiplier.
  const alignmentInstances = normalizeCelestialAlignmentInstances(
    state.alignmentActiveInstances, state.alignmentActiveChoice, state.alignmentActiveUntil, now,
  );
  const starseekerStacks = celestialAlignmentStackCount(alignmentInstances, 'starseeker', now);
  const starseekerBaseLuck = luck + bossLuckBonus;
  const alignedBaseLuck = starseekerStacks > 0
    ? Math.pow(starseekerBaseLuck, Math.pow(1.05, starseekerStacks))
    : starseekerBaseLuck;
  const totalLuckMultiplier = alignedBaseLuck * combatRuneLuckMultiplier(runeLuckPct);
  const isAutoUnlocked = (state.upgrades.auto ?? 0) > 0;
  const isTurbo = Boolean(state.turboRollUntil && state.turboRollUntil > now);
  const turboReductionPercent = (state.prestigeUpgrades?.chronoOverdrive ?? 0) > 0 ? 35 : 25;
  const visibleTiers = visibleContinuumTiers(state.highestRarity || 0);
  const tiersReached = visibleTiers.filter(tier => (state.highestRarity || 0) >= tier.minRarity).length;
  const nextTier = visibleTiers.find(tier => (state.highestRarity || 0) < tier.minRarity);

  // Smooth or instant reveal on new roll, respecting the live OS motion preference.
  useEffect(() => {
    if (!lastOrb) return;
    if (prevOrbRef.current === lastOrb) {
      if (reducedMotion) {
        setIsRevealing(false);
        setIsShaking(false);
        setShakeIntensity(0);
        setSonarPinging(false);
      }
      return;
    }
    prevOrbRef.current = lastOrb;

    let revealTimer: number | null = null;
    let shakeTimer: number | null = null;
    if (!reducedMotion && (!hasInstantUpgrade || !instantRevealActive)) {
      setIsRevealing(true);
      revealTimer = window.setTimeout(() => setIsRevealing(false), 400);
    } else {
      setIsRevealing(false);
    }

    const nowTs = Date.now();
    const isSilentSonar = hasSonarUpgrade && sound.sonarMode;
    const bestBefore = bestRarityForSoundRef.current;
    const isNewBest = lastOrb.isInfinity === true
      ? !bestWasInfinityRef.current
      : !bestWasInfinityRef.current && lastOrb.rarity > bestBefore;
    const rarityProgress = !bestWasInfinityRef.current && bestBefore > 0 && Number.isFinite(lastOrb.rarity)
      ? lastOrb.rarity / bestBefore
      : 0;
    const isWithinTenfold = !isNewBest && rarityProgress >= 0.1 && rarityProgress < 1;
    const isWithinHundredfold = !isNewBest && rarityProgress >= 0.01 && rarityProgress < 1;

    // Rift records are acknowledged with particles only. They never shake the
    // roll surface or delay input, even when the player is already chaining rolls.
    if ((isNewBest || isWithinHundredfold) && !reducedMotion && !(isRiftSave && isNewBest)) {
      setIsShaking(true);
      setShakeIntensity(isNewBest ? 1 : Math.sqrt(rarityProgress));
      shakeTimer = window.setTimeout(() => {
        setIsShaking(false);
        setShakeIntensity(0);
      }, 450);
    } else {
      setIsShaking(false);
      setShakeIntensity(0);
    }

    if ((isNewBest || isWithinTenfold) && !reducedMotion) {
      confetti({
        particleCount: isNewBest ? (isRiftSave ? 52 : 110) : 48,
        spread: isNewBest ? (isRiftSave ? 62 : 82) : 58,
        startVelocity: isRiftSave ? 19 : 45,
        gravity: isRiftSave ? 0.88 : 1,
        scalar: isRiftSave ? 0.72 : 1,
        ticks: isRiftSave ? 185 : 320,
        origin: { y: 0.6 },
        colors: isRiftSave
          ? ['#f3e8ff', '#d8b4fe', '#c4a1ff', '#a78bfa', '#8b5cf6', '#6d28d9']
          : ['#a855f7', '#ec4899', '#38bdf8', '#fbbf24'],
      });
    }

    const nearBestRarity = Math.ceil(Math.max(2, bestBefore) * 0.9);
    const sonarOrb = !isNewBest && sound.sonarAlertMode === 'near-best' && isSilentSonar &&
      !bestWasInfinityRef.current && Number.isFinite(lastOrb.rarity) &&
      lastOrb.rarity >= nearBestRarity && lastOrb.rarity < bestBefore
      ? lastOrb
      : undefined;
    let sonarTimer: number | null = null;

    // The long record fanfare takes precedence over the short near-best ping.
    // Both special alerts intentionally bypass Silent Sonar mode.
    if (isRiftSave && isNewBest) {
      // The ordinary roll cue already played. Rift records get no additional fanfare.
    } else if (hasSonarUpgrade && isNewBest) {
      lastFanfareTimeRef.current = nowTs;
      sound.playNewBestFanfare();
    } else if (sonarOrb) {
      sound.playSonarPing(sonarOrb.rarity);
      setSonarPinging(true);
      sonarTimer = window.setTimeout(() => setSonarPinging(false), 900);
    } else if (!isSilentSonar) {
      if (lastOrb.rarity >= 100_000 && nowTs - lastFanfareTimeRef.current > 1200) {
        lastFanfareTimeRef.current = nowTs;
        sound.playMythicFanfare();
      } else if (lastOrb.rarity >= 1_000 && nowTs - lastFanfareTimeRef.current > 800) {
        lastFanfareTimeRef.current = nowTs;
        sound.playEpicFanfare();
      } else {
        sound.playRollNormal();
      }
    }
    bestRarityForSoundRef.current = Math.max(
      bestBefore,
      Number(state.highestRarity ?? 0) || 0,
      lastOrb.rarity,
    );
    if (lastOrb.isInfinity === true) bestWasInfinityRef.current = true;

    return () => {
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      if (shakeTimer !== null) window.clearTimeout(shakeTimer);
      if (sonarTimer !== null) window.clearTimeout(sonarTimer);
    };
  }, [lastOrb, lastBatch, state.highestRarity, state.highestRarityIsInfinity, hasSonarUpgrade, instantRevealActive, hasInstantUpgrade, reducedMotion]);

  useEffect(() => {
    bestRarityForSoundRef.current = Math.max(
      bestRarityForSoundRef.current,
      Number(state.highestRarity ?? 0) || 0,
    );
    bestWasInfinityRef.current = state.highestRarityIsInfinity === true;
  }, [state.highestRarity, state.highestRarityIsInfinity]);

  const displayOrb = riftCompletionOrb ?? lastOrb;
  const orbInfo = displayOrb ? getOrbInfo(displayOrb.rarity, displayOrb.isInfinity) : null;

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
  const handleRollClick = (event?: React.MouseEvent<HTMLElement>) => {
    if (busy) return;
    if (canRoll) {
      pendingRollOriginRef.current = null;
      if (!autoRoll && event && rollStageRef.current) {
        const rect = rollStageRef.current.getBoundingClientRect();
        const insideStage = event.clientX >= rect.left && event.clientX <= rect.right &&
          event.clientY >= rect.top && event.clientY <= rect.bottom;
        if (insideStage) {
          pendingRollOriginRef.current = {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          };
        }
      }
      if (cooldownNoticeTimerRef.current !== null) {
        window.clearTimeout(cooldownNoticeTimerRef.current);
        cooldownNoticeTimerRef.current = null;
      }
      sound.playClick();
      setCooldownNotice(null);
      void onRoll();
    } else if (chainPatcherPending && !chainPatcherCharged) {
      pendingRollOriginRef.current = null;
      sound.playClick();
      setCooldownNotice('Chain Patcher target is invalid. Refresh your save before rolling.');
      if (cooldownNoticeTimerRef.current !== null) window.clearTimeout(cooldownNoticeTimerRef.current);
      cooldownNoticeTimerRef.current = window.setTimeout(() => {
        setCooldownNotice(null);
        cooldownNoticeTimerRef.current = null;
      }, 2500);
    } else if (remain > 0) {
      if (cooldownNoticeTimerRef.current !== null) window.clearTimeout(cooldownNoticeTimerRef.current);
      pendingRollOriginRef.current = null;
      sound.playClick();
      setCooldownNotice(`Cooldown active (${(remain / 1000).toFixed(1)}s remaining)`);
      cooldownNoticeTimerRef.current = window.setTimeout(() => {
        setCooldownNotice(null);
        cooldownNoticeTimerRef.current = null;
      }, 1500);
    }
  };

  const totalRollCount = Math.max(0, Number(state.totalRolls ?? 0));
  const isFirstSession = totalRollCount < 12 && (state.prestigeCount ?? 0) === 0;
  const isFirstRoll = isFirstSession && totalRollCount === 0 && (state.manualRolls ?? 0) === 0;
  const primaryActionLabel = busy
    ? 'Rolling…'
    : frenzyArmedForRoll
      ? frenzyReady ? 'Release Frenzy' : `Ready in ${(remain / 1000).toFixed(1)}s`
      : chainPatcherPending
        ? chainPatcherCharged
          ? adminGuaranteedRollQueued ? 'Use Guaranteed Roll' : 'Use Chain Patcher'
          : 'Repair Chain Patcher'
        : freeRolls > 0
          ? `Roll ${freeRolls} free ${freeRolls === 1 ? 'Orb' : 'Orbs'}`
          : remain > 0
            ? `Ready in ${(remain / 1000).toFixed(1)}s`
            : isFirstRoll
              ? 'Roll your first Orb'
              : multi > 1 ? `Roll ${formatNumber(multi)} Orbs` : 'Roll';
  const actionHint = busy
    ? 'Resolving your roll. The result appears after the server confirms it.'
    : frenzyArmedForRoll
      ? frenzyReady ? 'Frenzy is armed and ready to release.' : 'Frenzy is armed; wait for the cooldown before releasing it.'
      : chainPatcherPending
        ? chainPatcherCharged
          ? adminGuaranteedRollQueued
            ? canRoll
              ? `An admin-guaranteed 1/${formatRarity(rawChainPatcherTarget)} roll is queued. This manual roll will process normal rewards and challenge completion.`
              : `An admin-guaranteed 1/${formatRarity(rawChainPatcherTarget)} roll is queued. Wait ${(remain / 1000).toFixed(1)}s; stored Free Rolls will remain untouched.`
            : canRoll
              ? `Chain Patcher is charged for 1/${formatRarity(rawChainPatcherTarget)}. One manual roll consumes it and preserves ${freeRolls} stored Free Rolls.`
              : `Chain Patcher is charged; wait ${(remain / 1000).toFixed(1)}s. Stored Free Rolls will remain untouched.`
          : 'The saved Chain Patcher target is invalid. Refresh your save before rolling; stored Free Rolls will remain untouched.'
        : freeRolls > 0
          ? `One press uses all ${freeRolls} Free Rolls.`
          : canRoll
            ? isFirstRoll
              ? 'Tap the Orb or the button below. Either one starts a roll.'
              : 'Your next roll is ready.'
            : `Your next roll is ready in ${(remain / 1000).toFixed(1)} seconds.`;
  const hasMultipleOrbs = lastBatch.length > 1;
  const orbitRadius = typeof window !== 'undefined' && window.innerWidth < 400 ? 118 : 152;
  const speedLevel = state.upgrades.speed ?? 0;
  const luckLevel = state.upgrades.luck ?? 0;
  const multiLevel = state.upgrades.multi ?? 0;
  const coinBonusLevel = state.upgrades.coinBonus ?? 0;
  const nextSpeedState: PlayerState = { ...state, upgrades: { ...state.upgrades, speed: speedLevel + 1 } };
  const nextLuckState: PlayerState = { ...state, upgrades: { ...state.upgrades, luck: luckLevel + 1 } };
  const nextMultiState: PlayerState = { ...state, upgrades: { ...state.upgrades, multi: multiLevel + 1 } };
  const quickUpgradeItems = [
    { id: 'speed' as const, title: 'Roll speed', level: speedLevel, current: `${(cooldownMs(state, false) / 1000).toFixed(2)}s`, next: `${(cooldownMs(nextSpeedState, false) / 1000).toFixed(2)}s`, cost: upgradeCost('speed', speedLevel) },
    { id: 'multi' as const, title: 'Multi roll', level: multiLevel, current: `${rollsPerActivation(state)} orbs`, next: `${rollsPerActivation(nextMultiState)} orbs`, cost: upgradeCost('multi', multiLevel) },
    { id: 'luck' as const, title: 'Luck', level: luckLevel, current: `${luckMultiplier(state).toFixed(2)}×`, next: `${luckMultiplier(nextLuckState).toFixed(2)}×`, cost: upgradeCost('luck', luckLevel) },
    { id: 'coinBonus' as const, title: 'Coin bonus', level: coinBonusLevel, current: `+${coinBonusLevel * 15}%`, next: `+${(coinBonusLevel + 1) * 15}%`, cost: upgradeCost('coinBonus', coinBonusLevel) },
  ];
  const quickAffordableCount = quickUpgradeItems.filter(item =>
    Number.isFinite(item.cost) &&
    state.coins >= item.cost &&
    !(item.id === 'speed' && item.level >= 20)
  ).length;
  const buyQuickUpgrade = async (id: UpgradeId) => {
    if (busy || quickBuyAllBusyRef.current) return;
    quickUpgradePendingCountRef.current += 1;
    setQuickUpgradePendingCounts(current => ({
      ...current,
      [id]: (current[id] ?? 0) + 1,
    }));
    try {
      await onBuyUpgrade(id);
    } finally {
      quickUpgradePendingCountRef.current = Math.max(0, quickUpgradePendingCountRef.current - 1);
      setQuickUpgradePendingCounts(current => {
        const next = { ...current };
        const remaining = (next[id] ?? 1) - 1;
        if (remaining > 0) next[id] = remaining;
        else delete next[id];
        return next;
      });
    }
  };
  const buyAllQuickUpgrades = async () => {
    if (
      busy ||
      quickUpgradePendingCountRef.current > 0 ||
      quickBuyAllBusyRef.current ||
      quickAffordableCount === 0
    ) return;
    quickBuyAllBusyRef.current = true;
    setQuickBuyAllBusy(true);
    try {
      await onBuyAllUpgrades();
    } finally {
      quickBuyAllBusyRef.current = false;
      setQuickBuyAllBusy(false);
    }
  };

  return (
    <div className="roll-layout">
      <section className="roll-main flex flex-col items-center justify-center max-w-2xl mx-auto space-y-4">
      <header className="io-page-intro roll-page-intro">
        <div>
          <h1>Roll</h1>
          <p>Tap the Orb to see what turns up. Rarer finds earn more Coins.</p>
        </div>
      </header>
      {/* Turbo Roll Active Banner */}
      {isTurbo && (
        <div className="w-full bg-gradient-to-r from-amber-500/20 via-orange-500/20 to-amber-500/20 border border-amber-500/40 rounded-xl px-3 py-1.5 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-1.5 font-bold">
            <Flame className="w-4 h-4 text-amber-400" />
            <span>TURBO ACTIVE (-{turboReductionPercent}% Cooldown)</span>
          </div>
          <span className="font-mono font-medium">
            {Math.ceil((state.turboRollUntil - now) / 60000)}m left
          </span>
        </div>
      )}

      {/* Main Celestial Orb Stage (Orbits & Main Orb are concentric and centered together) */}
      <div ref={rollStageRef} className={`roll-stage relative w-full flex items-center justify-center select-none ${isFirstSession ? 'is-first-session' : ''} ${busy ? 'is-rolling' : ''} ${riftCompletionPhase ? 'io-rift-completion-' + riftCompletionPhase : ''}`}>
        {/* Ambient Glow Background centered on orb */}
        <div
          className={`absolute w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none transition-colors duration-700 ${orbInfo?.animated ? 'io-rarity-color-cycle' : ''}`}
          style={{
            backgroundColor: orbInfo ? orbInfo.color : '#6366f1',
          }}
        />

        {isFirstRoll && (
          <div className="io-first-roll-label" aria-hidden="true">
            <span className="io-first-roll-dot" />
            First roll
          </div>
        )}

        {/* Orbiting Satellite Orbs Container (Concentric with central orb) */}
        {hasMultipleOrbs && !riftCompletionPhase && <OrbOrbit orbs={lastBatch} radius={orbitRadius} primaryOrb={displayOrb} />}

        {riftCompletionPhase === 'charge' && (
          <div className="io-rift-completion-emissions" aria-hidden="true">
            {Array.from({ length: 20 }, (_, index) => (
              <span
                key={index}
                style={{
                  '--io-rift-light-angle': `${index * 18}deg`,
                  '--io-rift-light-delay': `${(index % 5) * 85}ms`,
                } as React.CSSProperties}
              />
            ))}
          </div>
        )}
        {riftCompletionPhase === 'rush' && (
          <div className="io-rift-completion-rush" aria-hidden="true" />
        )}

        {/* Celestial Sonar Radar Pulse Wave on Rare Drops */}
        {sonarPinging && (
          <div className="absolute z-0 w-48 h-48 rounded-full border-4 border-cyan-400/90 animate-ping pointer-events-none" />
        )}

        {/* One restrained ring keeps the stage alive without turning the center into a screensaver. */}
        <div className="absolute w-60 h-60 rounded-full border border-white/10 pointer-events-none" />
        {/* The Central Main Orb */}
        <div
          role="button"
          tabIndex={0}
          aria-label={primaryActionLabel.toLowerCase()}
          aria-busy={busy}
          aria-disabled={busy}
          onClick={handleRollClick}
          onKeyDown={event => {
            if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              handleRollClick();
            }
          }}
          className={`io-main-orb relative z-10 w-44 h-44 sm:w-48 sm:h-48 rounded-full flex flex-col items-center justify-center transition-all duration-500 transform cursor-pointer active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 ${cosmeticEffectClass} ${orbInfo?.animated ? 'io-rarity-color-cycle' : ''} ${
            isRevealing ? 'is-revealing' : 'hover:scale-102'
          } ${isShaking ? 'is-shaking' : ''} ${riftCompletionPhase === 'charge' ? 'io-rift-completion-orb-charge' : ''} ${riftCompletionPhase === 'rush' ? 'io-rift-completion-orb-reveal' : ''}`}
          style={{
            background: riftCompletionPhase === 'charge'
              ? 'radial-gradient(circle at 50% 42%, #211333 0%, #10091b 62%, #07040d 100%)'
              : orbInfo
                ? orbInfo.bgGradient
                : 'radial-gradient(circle at 35% 30%, #6366f1, #312e81 65%, #0f172a)',
            borderColor: orbInfo?.color ?? '#6366f1',
            borderWidth: 2,
            ...(isShaking ? {
              '--shake-x-a': (-3 * shakeIntensity) + 'px',
              '--shake-y-a': (1 * shakeIntensity) + 'px',
              '--shake-x-b': (3 * shakeIntensity) + 'px',
              '--shake-y-b': (-1 * shakeIntensity) + 'px',
              '--shake-x-c': (-2 * shakeIntensity) + 'px',
              '--shake-y-c': (-1 * shakeIntensity) + 'px',
              '--shake-x-d': (2 * shakeIntensity) + 'px',
              '--shake-y-d': (1 * shakeIntensity) + 'px',
              '--shake-x-e': (-1 * shakeIntensity) + 'px',
            } as React.CSSProperties : {}),
          }}
        >
          {/* Reward totals remain in the persistent summary below the Orb. */}

          {/* Layered glass details keep the Orb tactile without adding noisy decoration. */}
          <span className="io-orb-glint" aria-hidden="true" />
          <span className="io-orb-core" aria-hidden="true" />
          <span className="io-orb-contour" aria-hidden="true" />
          {/* Subtle Inner Glass Ring */}
          <div className="io-orb-inner-ring absolute inset-2 rounded-full border border-white/20 pointer-events-none" />

          {/* Rarity & Name Presentation */}
          <div className="relative z-10 text-center px-4">
            <span
              className={`text-[11px] font-black uppercase tracking-widest block mb-1 drop-shadow ${orbInfo?.animated ? 'io-rarity-color-cycle' : ''}`}
              style={{ color: orbInfo ? orbInfo.color : '#cbd5e1' }}
            >
              {orbInfo ? orbInfo.tier : 'Ready'}
            </span>

            <div className="text-2xl sm:text-3xl font-black text-white tracking-tight drop-shadow-md font-mono">
              {displayOrb
                ? `1 / ${formatRarity(displayOrb.rarity, displayOrb.isInfinity)}`
                : 'Ready'}
            </div>

            <div className="text-xs font-semibold text-white/90 mt-1 drop-shadow">
              {orbInfo ? orbInfo.name : 'Tap to roll'}
            </div>
            {totalRollCount > 0 && (
              <div className="mt-2 text-[10px] text-slate-300/80" aria-label={`Personal best rarity 1 in ${formatRarity(state.highestRarity, state.highestRarityIsInfinity)}`}>
                Personal best · 1 / {formatRarity(state.highestRarity, state.highestRarityIsInfinity)}
              </div>
            )}
          </div>

          {/* Critical Roll Badge */}
          {!busy && displayOrb?.isCrit && (
            <div className="absolute -top-6 bg-gradient-to-r from-rose-500 to-amber-500 text-white text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full shadow-lg border border-amber-300">
              ⚡ Critical · 2×
            </div>
          )}

          {/* New Discovery Badge */}
          {!busy && displayOrb?.isNew && (
            <div className="absolute -top-2 bg-gradient-to-r from-amber-400 to-yellow-300 text-slate-950 text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full shadow-lg">
              ★ New find
            </div>
          )}
        </div>
        <div className="roll-floating-rewards" aria-hidden="true">
          {floatingRewards.map(reward => (
            <span
              key={reward.id}
              className={`roll-floating-stat roll-floating-stat-${reward.tone}`}
              style={{
                left: reward.left + 'px',
                top: reward.top + 'px',
                '--roll-float-x': reward.dx + 'px',
                '--roll-float-y': reward.dy + 'px',
                animationDelay: reward.delay + 'ms',
              } as React.CSSProperties}
            >
              {reward.text}
            </span>
          ))}
        </div>
      </div>

      {/* Orbit & Roll Status Callouts (sitting comfortably below the orb and satellites) */}
      <div className="w-full flex flex-col items-center space-y-2">
        {/* Multi-Roll Orbit Callout Badge */}
        {hasMultipleOrbs && (
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-slate-900/80 border border-slate-800 px-3 py-1 rounded-full shadow-sm">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span>Best of {lastBatch.length} Orbs this roll</span>
          </div>
        )}

        {/* Persistent exact reward readout, including all bonuses. */}
        {batchSummary && !riftCompletionPhase && (
          <div className="roll-reward-summary" aria-live="polite">
            <div className="roll-reward-label">Last roll</div>
            <div className="roll-reward-values">
              <span className="roll-reward-value coins"><Coins className="w-3.5 h-3.5" /> +{formatNumber(batchSummary.coins)} Coins</span>
              <span className="roll-reward-value xp"><Sparkles className="w-3.5 h-3.5" /> +{formatNumber(batchSummary.xp)} XP</span>
              <span className="roll-reward-value shards"><Zap className="w-3.5 h-3.5" /> +{formatShardAmount(batchSummary.shards)} Shards</span>
              <span className="roll-reward-value value"><Award className="w-3.5 h-3.5" /> +{formatNumber(batchSummary.totalVal)} Value</span>
            </div>
          </div>
        )}

        {/* Cooldown Timer */}
        <div className="text-center pt-1">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
            {busy ? 'Rolling…' : canRoll ? 'Ready to roll' : `Next roll in ${(remain / 1000).toFixed(1)}s`}
          </div>
          {/* Progress Bar */}
          <div role="progressbar" aria-label="Roll cooldown progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cooldownProgressPct)} aria-valuetext={busy ? "Roll in progress" : canRoll ? "Ready to roll" : `${(remain / 1000).toFixed(1)} seconds remaining`} className="w-48 h-1.5 bg-slate-800 rounded-full mx-auto mt-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-200"
              style={{
                width: `${cooldownProgressPct}%`,
              }}
            />
          </div>
          {hasResonanceUpgrade && (
            <div className="pity-meter mt-3 w-48">
              <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                
                <span>{pityRollsIntoTier} / {pityInterval} rolls to next stack</span>
              </div>
              <div role="progressbar" aria-label="Pity Luck progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pityProgressPct} className="h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                <div className="h-full bg-gradient-to-r from-fuchsia-500 to-cyan-400" style={{ width: `${pityProgressPct}%` }} />
              </div>
            </div>
          )}
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
            {freeRolls} free {freeRolls === 1 ? 'roll' : 'rolls'} ready
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={handleRollClick}
          className={'roll-button ' + (isFirstSession ? 'is-first-session-cta ' : '') + (busy ? 'is-waiting' : frenzyReady ? 'frenzy-supercharged' : canRoll ? 'is-ready' : 'is-waiting') + ' w-full py-4 px-6 rounded-2xl font-black text-base sm:text-lg tracking-wide shadow-xl transition-all transform duration-150 active:scale-95 flex items-center justify-center gap-2 cursor-pointer ' +
            (frenzyArmedForRoll
              ? 'bg-amber-600 hover:bg-amber-500 text-white border border-amber-300/40'
              : canRoll
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/20'
              : busy
              ? 'bg-slate-800 text-slate-400 cursor-wait'
              : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700')}
          aria-label={busy ? 'Rolling orbs' : frenzyArmedForRoll ? 'Release Frenzy roll' : freeRolls > 0 ? `Roll all ${freeRolls} Free Rolls` : 'Roll'}
          aria-describedby="roll-action-hint"
        >
          {frenzyArmedForRoll && (
            <>
              <Zap className='frenzy-lightning frenzy-lightning-left w-5 h-5' />
              <Zap className='frenzy-lightning frenzy-lightning-right w-5 h-5' />
            </>
          )}
          {busy
            ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            : <Sparkles className={'w-5 h-5 ' + (frenzyArmedForRoll ? 'text-amber-100 frenzy-spark' : 'text-white')} />}
          <span>{primaryActionLabel}</span>
        </button>
        <div id="roll-action-hint" className="roll-action-hint" aria-live="polite">{actionHint}</div>

        {hasCooldownReclaimer && (
          <div className="w-full rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-3 flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="text-center sm:text-left">
                <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Time Energy</div>
                <div className="text-lg font-mono font-bold text-white">{(timeEnergy / 1000).toFixed(2)}s banked</div>
                <div className="text-[10px] text-slate-400">
                  {timeEnergyRollsAvailable > 0
                    ? `${formatNumber(timeEnergyRollsAvailable)} instant roll${timeEnergyRollsAvailable === 1 ? '' : 's'} ready · ${formatFrenzyCooldown(cd)} per roll`
                    : `${formatFrenzyCooldown(Math.max(0, cd - timeEnergy))} until the next instant roll`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onUseTimeEnergy()}
                disabled={busy || frenzyArmedForRoll || timeEnergyRollsAvailable < 1}
                className="w-full sm:w-auto rounded-xl border border-cyan-400/35 bg-cyan-500/15 px-4 py-2.5 text-xs font-black text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Spend Time Energy · {formatNumber(timeEnergyRollsAvailable)} roll{timeEnergyRollsAvailable === 1 ? '' : 's'}
              </button>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-900 overflow-hidden border border-slate-800" role="progressbar" aria-label="Progress toward another Time Energy roll" aria-valuemin={0} aria-valuemax={100} aria-valuenow={timeEnergyProgressPct}>
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-300 transition-[width] duration-200" style={{ width: `${timeEnergyProgressPct}%` }} />
            </div>
            <div className="text-[10px] text-slate-500 text-center">
              Spending uses {formatNumber(timeEnergySpendMs)}ms at your current cooldown. Any unspent energy stays banked.
            </div>
          </div>
        )}

        {!isRiftSave && (
          <>
        <button
          type="button"
          aria-busy={busy}
          onClick={() => void onOrbFrenzy()}
          disabled={busy || frenzyArmedForRoll || frenzyUsedToday}
          className={
            busy || frenzyArmedForRoll || frenzyUsedToday
              ? 'w-full px-4 py-2.5 rounded-xl text-xs font-black bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed'
              : 'w-full px-4 py-2.5 rounded-xl text-xs font-black bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-200 hover:bg-fuchsia-500/20 active:scale-95'
          }
          title={frenzyUsedToday ? 'Orb Frenzy returns after the 23-hour cooldown.' : 'Arm Orb Frenzy, then use your next manual Roll to submit it.'}
        >
          <span className='inline-flex items-center justify-center gap-2 w-full'>
            <Sparkles className='w-4 h-4 text-fuchsia-300' />
            <span>
              {frenzyArmedForRoll
                ? 'Frenzy Armed · Roll Now'
                : frenzyUsedToday
                ? 'Frenzy Cooldown · ' + formatFrenzyCooldown(frenzyCooldownRemain)
                : 'Charge a Frenzy for your next roll'}
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
          </>
        )}

        {/* Control Toggles: Auto Roll, Sonar Mode, Instant Chrono-Skip */}
        <div className="flex flex-wrap items-center justify-center gap-2 w-full">
          {/* Auto Roll Toggle */}
          {isAutoUnlocked ? (
            <button
              type="button"
              aria-pressed={autoRoll}
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
              type="button"
              data-testid="sonar-mode-toggle"
              aria-pressed={sonarActive}
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
              title="Mute ordinary roll sounds and use configured rarity pings instead"
            >
              <BellRing className={`w-3.5 h-3.5 ${sonarActive ? 'text-cyan-400 motion-safe:animate-pulse' : ''}`} />
              <span>Sonar Ping: {sonarActive ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {hasSonarUpgrade && hasAlignmentUpgrade && (
            <button
              type="button"
              data-testid="alignment-alert-sound-toggle"
              aria-label="Celestial Alignment prompt sound"
              aria-pressed={alignmentSoundEnabled}
              onClick={() => {
                const next = !alignmentSoundEnabled;
                setAlignmentSoundEnabled(next);
                sound.setAlignmentSoundEnabled(next);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer active:scale-95 ${
                alignmentSoundEnabled
                  ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25'
                  : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              title="Play or mute Celestial Alignment prompt sounds"
            >
              <span>Alignment sound: {alignmentSoundEnabled ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {/* Chrono-Skip Instant Multi-Roll (Unlocked via Prestige) */}
          {hasInstantUpgrade && (
            <button
              type="button"
              aria-pressed={instantRevealActive}
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


        </div>

        {hasSonarUpgrade && sonarActive && (
          <section className="w-full rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-2.5 sm:p-3 space-y-2" data-testid="sonar-ping-options" aria-label="Sonar Ping options">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="min-w-0 flex-1">
                <label htmlFor="sonar-alert-mode" className="block text-[10px] font-black uppercase tracking-wider text-cyan-200">Sonar alert trigger</label>
                <p className="mt-1 text-[10px] leading-snug text-slate-400">Choose when the Sonar Ping alerts on a rare Orb. New records always play the longer celebration.</p>
              </div>
              <select
                id="sonar-alert-mode"
                aria-label="Sonar Ping alert trigger"
                data-testid="sonar-alert-mode"
                value={sonarAlertMode}
                onChange={event => {
                  const next = event.currentTarget.value === 'new-best' ? 'new-best' : 'near-best';
                  setSonarAlertModeState(next);
                  sound.setSonarAlertMode(next);
                }}
                className="w-full sm:w-auto rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-2 text-xs font-bold text-cyan-100"
              >
                <option value="near-best">At least 1/10th below a new best</option>
                <option value="new-best">New best</option>
              </select>
            </div>
            {hasAlignmentUpgrade && (
              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 cursor-pointer">
                <span className="min-w-0">
                  <strong className="block text-xs text-white">Celestial Alignment sounds</strong>
                  <span className="block mt-0.5 text-[10px] leading-snug text-slate-400">Let Alignment prompt sounds play through Sonar Ping’s all-sounds blocker.</span>
                </span>
                <input
                  type="checkbox"
                  aria-label="Allow Celestial Alignment sounds through Sonar Ping"
                  data-testid="sonar-alignment-sounds-toggle"
                  checked={sonarAlignmentSoundsAllowed}
                  onChange={event => {
                    const next = event.currentTarget.checked;
                    setSonarAlignmentSoundsAllowedState(next);
                    sound.setSonarAlignmentSoundsAllowed(next);
                  }}
                  className="h-4 w-4 shrink-0 accent-cyan-400"
                />
              </label>
            )}
          </section>
        )}

        {/* Pity Meter Gauge (Unlocked via Prestige) */}
        {hasResonanceUpgrade && (
          <div className="w-full bg-slate-900/80 border border-indigo-900/50 rounded-2xl p-3 shadow-md space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-indigo-300">
                <Compass className="w-4 h-4 text-indigo-400" />
                <span>Pity Luck</span>
              </div>
              <span className="font-mono text-cyan-300 font-bold">
                +{((state.prestigeUpgrades?.resonanceMeter ?? 1) * pityTier)}% Pity Luck
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300"
                role="progressbar" aria-label="Pity Luck progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pityProgressPct}
                style={{ width: `${pityProgressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 font-medium">
              <span>{pityRollsIntoTier} / {pityInterval} rolls to next tier</span>
              <span>Dry streak: {pityDryRolls} rolls</span>
            </div>
          </div>
        )}


        {alignmentInstances.length > 0 && (
          <div className="w-full space-y-1.5" data-testid="active-celestial-alignments">
            {alignmentInstances.map((instance, index) => (
              <div key={instance.id} className="flex items-center justify-between gap-3 rounded-xl border border-indigo-400/25 bg-indigo-500/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-indigo-200">
                <span className="min-w-0 truncate">
                  {instance.choice === 'starseeker' ? 'Starseeker · Total Luck' : instance.choice === 'goldenOrbit' ? 'Golden Orbit · Coins' : 'Clockwork · Auto Roll'} · Stack {index + 1}
                </span>
                <strong className="shrink-0 font-mono tabular-nums">{formatAlignmentRemaining(instance.expiresAt - now)} left</strong>
              </div>
            ))}
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
              <div className="text-sm font-black text-cyan-300">+{formatShardAmount(batchSummary.shards)}</div>
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
                (Best: 1/{lastOrb ? formatRarity(lastOrb.rarity, lastOrb.isInfinity) : '—'})
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-amber-400">
                +{formatNumber(batchSummary.coins)} Coins
              </span>
              {batchSummary.shards > 0 && (
                <span className="text-xs font-semibold text-cyan-400">
                  +{formatShardAmount(batchSummary.shards)} Shards
                </span>
              )}
              <button
                type="button"
                aria-expanded={showBatchDetails}
                aria-label={showBatchDetails ? 'Hide batch breakdown' : 'Show batch breakdown'}
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
                const info = getOrbInfo(orb.rarity, orb.isInfinity);
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
                      <span>1/{formatRarity(orb.rarity, orb.isInfinity)}</span>
                    </div>
                    <span className={`font-bold text-[10px] ${info.animated ? 'io-rarity-color-cycle' : ''}`} style={{ color: info.color }}>
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
          type="button"
          aria-label={`Share orb rarity 1/${formatRarity(lastOrb.rarity, lastOrb.isInfinity)} to Reddit`}
          onClick={() => {
            sound.playClick();
            onOpenShareModal(lastOrb.rarity, lastOrb.isInfinity);
          }}
          className="flex items-center gap-2 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-500/40 text-orange-300 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg cursor-pointer"
        >
          <Share2 className="w-3.5 h-3.5" />
          <span>Share 1/{formatRarity(lastOrb.rarity, lastOrb.isInfinity)} to Reddit</span>
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
          <span className="text-slate-500 block text-[10px] font-semibold uppercase">Total Luck</span>
          <span className="font-bold text-cyan-300">{formatNumber(totalLuckMultiplier)}x</span>
        </div>
        <div className="level-scaling-card rounded-xl border border-violet-300/25 bg-gradient-to-br from-violet-950/80 via-slate-900/80 to-cyan-950/60 p-2.5 shadow-[0_0_22px_rgba(139,92,246,.13)]">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-violet-200/80">Rarity Scaling</span>
          <span className="font-black text-cyan-100">×{formatNumber(luckRarityFactor(totalLuckMultiplier))}</span>
          <span className="mt-1 block text-[10px] text-violet-200/75">Luck curve × Level {Math.max(1, Math.floor(Number(state.level) || 1))} = ×{formatNumber(luckRarityFactor(totalLuckMultiplier) * Math.max(1, Math.floor(Number(state.level) || 1)))}</span>
        </div>
      </div>
        </section>

      <aside className="roll-sidebar" aria-label="Run summary">
        <section className="field-card roll-quick-upgrades" aria-label="Quick upgrades">
          <div className="roll-quick-upgrades-head">
            <div>
              <span className="field-label">Quick upgrades</span>
              <span className="roll-quick-wallet">{formatNumber(state.coins)} Coins</span>
            </div>
            <button type="button" className="roll-quick-all-link" onClick={onOpenUpgrades}>All</button>
          </div>
          <div className="roll-quick-upgrade-list">
            {quickUpgradeItems.map(item => {
              const maxed = !Number.isFinite(item.cost) || (item.id === 'speed' && item.level >= 20);
              const canAfford = !maxed && state.coins >= item.cost;
              const pendingCount = quickUpgradePendingCounts[item.id] ?? 0;
              const isPending = pendingCount > 0;
              return (
                <div className="roll-quick-upgrade" key={item.id}>
                  <div className="roll-quick-upgrade-copy">
                    <div className="roll-quick-upgrade-title">
                      <strong>{item.title}</strong>
                      <span>Lv {item.level}</span>
                    </div>
                    <div className="roll-quick-upgrade-value">
                      <span>{item.current}</span>
                      <span aria-hidden="true">→</span>
                      <strong>{item.next}</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="roll-quick-upgrade-buy"
                    disabled={!canAfford || busy || quickBuyAllBusy}
                    aria-busy={isPending}
                    aria-label={maxed ? item.title + ' fully upgraded' : 'Buy ' + item.title + ' for ' + formatNumber(item.cost) + ' Coins'}
                    title={maxed ? 'Fully upgraded' : canAfford ? 'Buy one level for ' + formatNumber(item.cost) + ' Coins' : 'Need ' + formatNumber(Math.max(0, item.cost - state.coins)) + ' more Coins'}
                    onClick={() => { void buyQuickUpgrade(item.id).catch(() => undefined); }}
                  >
                    {isPending ? `×${pendingCount}` : maxed ? 'MAX' : formatNumber(item.cost)}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="roll-quick-upgrade-footer">
            <button
              type="button"
              className="roll-quick-buy-all"
              disabled={quickAffordableCount === 0 || busy || quickUpgradePendingCount > 0 || quickBuyAllBusy}
              aria-busy={quickBuyAllBusy}
              onClick={() => { void buyAllQuickUpgrades().catch(() => undefined); }}
            >
              {quickBuyAllBusy ? 'Buying…' : quickAffordableCount > 0 ? 'Buy all available' : 'No affordable upgrades'}
            </button>
          </div>
        </section>
        <section className="field-card">
          <div className="field-card-header">
            <span className="field-label">Latest discovery</span>
            {!busy && displayOrb?.isNew && <span className="text-[9px] font-extrabold uppercase tracking-wider text-amber-300">New</span>}
          </div>
          {displayOrb ? (
            <div className="latest-orb">
              <div key={`${displayOrb.rarity}:${displayOrb.isInfinity ? 1 : 0}`} className={`latest-orb-mark ${!busy && displayOrb?.isNew ? 'is-new-discovery' : ''}`}><Award className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="latest-orb-name">{displayOrb.name}</div>
                <div className="latest-orb-rarity">1 / {formatRarity(displayOrb.rarity, displayOrb.isInfinity)}</div>
              </div>
            </div>
          ) : (
            <p className="field-empty">Your first Orb will appear here after you roll.</p>
          )}
          {displayOrb && orbInfo && <div className="field-stat-row mt-3 !border-t-0 !pt-0"><span>Continuum class</span><strong className={orbInfo.animated ? 'io-rarity-color-cycle' : ''} style={{ color: orbInfo.color }}>{orbInfo.tier}</strong></div>}
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
