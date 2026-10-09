import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getWebViewMode, requestExpandedMode } from '@devvit/web/client';
import {
  Sparkles,
  Zap,
  BookOpen,
  Calendar,
  Users,
  Award,
  Dices,
  RefreshCw,
  Flame,
  Shield,
  Lock,
  Megaphone,
  X,
} from 'lucide-react';
import type {
  PlayerState,
  UpgradeId,
  PrestigeUpgradeId,
  MasterySkillId,
  AutomationId,
  GlobalBoosterId,
  GlobalBoosterSnapshot,

  FeatureId,
  PremiumBoosterId,
  Orb,
  RollResponse,
} from '../shared/game.js';
import type {
  Guild,
  LeaderboardEntry,
  LeaderboardBoards,
  WorldEvent,
  GuildPerkId,
  GuildMessage,
} from '../shared/social.js';
import {
  formatRarity,
  formatNumber,
  cooldownMs,
  calculateCosmicDust,
  calculateLevelFromXp,
  applyLevelProgress,
  createInitialState,
  grantFreeShards,
  todayKey,
  canShowDailyFrenzyPrompt,
  frenzyCooldownRemaining,
  FRENZY_PROMPT_DELAY_MS,
  FRENZY_OWNER_SHARD_REWARD,
  rollsPerActivation,
  upgradeCost,
  prestigeUpgradeCost,
  masterySkillCost,
  PREMIUM_BOOSTERS,
  AUTOMATIONS,
  COSMETICS_LIST,
  FEATURE_UNLOCK_LEVELS,
} from '../shared/game.js';
import { sound } from './sound.js';
import { Header } from './components/Header.js';
import { RollSection } from './components/RollSection.js';
import { UpgradesSection } from './components/UpgradesSection.js';
import { AltarSection } from './components/AltarSection.js';
import { MasterySection } from './components/MasterySection.js';
import { CollectionSection } from './components/CollectionSection.js';
import { QuestsAndStreaks } from './components/QuestsAndStreaks.js';
import { GuildsAndSocial } from './components/GuildsAndSocial.js';
import { ProfileAndPrestige } from './components/ProfileAndPrestige.js';
import { RedditShareModal } from './components/RedditShareModal.js';
import { RarityTableModal } from './components/RarityTableModal.js';
import { NewBestModal } from './components/NewBestModal.js';
import { BoostersAndAutomation } from './components/BoostersAndAutomation.js';
import { GlobalChatWindow } from './components/GlobalChatWindow.js';
import { DevDebugModal } from './components/DevDebugModal.js';
import { FeedbackModal } from './components/FeedbackModal.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { SplashScreen } from './components/SplashScreen.js';
import { APP_VERSION } from '../shared/version.js';
import './styles.css';

type ActiveTab =
  | 'roll'
  | 'upgrades'
  | 'boosters'
  | 'altar'
  | 'mastery'
  | 'collection'
  | 'quests'
  | 'social'
  | 'profile';

async function getJson<T>(url: string, options?: RequestInit): Promise<T> {
  const method = String(options?.method ?? 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const maxAttempts = isRead ? 3 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const message =
          typeof errorData.error === 'string'
            ? errorData.error
            : typeof errorData.message === 'string'
              ? errorData.message
              : `HTTP ${res.status}: ${res.statusText}`;

        // An admin wipe intentionally invalidates old in-flight requests. Those
        // requests must never resurrect old data, but they also should not strand
        // the player on a stale error screen. Reload once so the fresh generation
        // is loaded from Redis.
        if (String(message).includes('invalidated by an admin wipe')) {
          try {
            const recoveryKey = 'io-wipe-recovery';
            if (window.sessionStorage.getItem(recoveryKey) !== '1') {
              window.sessionStorage.setItem(recoveryKey, '1');
              window.location.reload();
              return await new Promise<T>(() => undefined);
            }
            window.sessionStorage.removeItem(recoveryKey);
          } catch {
            window.location.reload();
            return await new Promise<T>(() => undefined);
          }
        }

        const retryableRead =
          isRead &&
          (res.status === 408 ||
            res.status === 429 ||
            res.status >= 500 ||
            String(message).includes('Player state changed while saving'));

        if (retryableRead && attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)));
          continue;
        }

        throw new Error(message);
      }

      return await res.json();
    } catch (error: any) {
      const retryableNetworkRead =
        isRead &&
        attempt < maxAttempts - 1 &&
        error?.name !== 'AbortError';

      if (retryableNetworkRead) {
        await new Promise(resolve => setTimeout(resolve, 80 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Request failed.');
}

async function getJsonWithTimeout<T>(url: string, timeoutMs = 10_000, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await getJson<T>(url, { ...options, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('The Infinity Orbs server did not respond within 10 seconds.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function App() {
  const [state, setState] = useState<PlayerState | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [splashEntered, setSplashEntered] = useState(false);
  const [lastOrb, setLastOrb] = useState<Orb | null>(null);
  const [lastBatch, setLastBatch] = useState<Orb[]>([]);
  const [batchSummary, setBatchSummary] = useState<{
    totalVal: number;
    coins: number;
    shards: number;
    xp: number;
    frenzyCount?: number;
  } | null>(null);

  const [readyAt, setReadyAt] = useState<number>(0);
  const [tab, setTab] = useState<ActiveTab>('roll');
  const [autoRoll, setAutoRoll] = useState<boolean>(false);
  const [isBeta, setIsBeta] = useState(false);
  const [changelogUnread, setChangelogUnread] = useState(() => {
    try { return window.localStorage.getItem('io-changelog-viewed-version') !== APP_VERSION; } catch { return true; }
  });

  // Auto Roll is stored in the player save so it survives new sessions,
  // different browsers, and Reddit's embedded webview storage boundaries.
  useEffect(() => {
    setAutoRoll(Boolean(
      state &&
      (state.upgrades.auto ?? 0) > 0 &&
      state.autoRollEnabled === true,
    ));
  }, [state?.autoRollEnabled, state?.upgrades.auto]);

  const [isRolling, setIsRolling] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [toast, setToast] = useState<{ msg: string; type?: 'info' | 'success' | 'warn' } | null>(null);

  useEffect(() => {
    const pollAnnouncement = async () => {
      try {
        const announcement = await getJson<{
          id: GlobalBoosterId;
          name: string;
          username: string;
          activatedAt: number;
        } | null>('/api/global-booster-announcement');
        if (!announcement || announcement.activatedAt <= lastBoosterAnnouncementAtRef.current) return;

        lastBoosterAnnouncementAtRef.current = announcement.activatedAt;
        setBoosterAnnouncement(announcement);
        if (boosterAnnouncementTimerRef.current !== null) {
          window.clearTimeout(boosterAnnouncementTimerRef.current);
        }
        boosterAnnouncementTimerRef.current = window.setTimeout(() => {
          setBoosterAnnouncement(null);
          boosterAnnouncementTimerRef.current = null;
        }, 5000);
      } catch {
        // Announcement polling is best-effort and never blocks gameplay.
      }
    };

    void pollAnnouncement();
    const interval = window.setInterval(() => void pollAnnouncement(), 5000);
    return () => {
      window.clearInterval(interval);
      if (boosterAnnouncementTimerRef.current !== null) {
        window.clearTimeout(boosterAnnouncementTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void getJson<{ isBeta: boolean }>('/api/app-info').then(info => setIsBeta(info.isBeta === true)).catch(() => setIsBeta(false));
  }, []);

  useEffect(() => {
    if (!state) return;
    const heartbeat = () => {
      if (document.visibilityState === 'hidden') return;
      void getJson('/api/activity/heartbeat', { method: 'POST' }).catch(() => null);
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(interval);
  }, [Boolean(state)]);

  // Social & Community state
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardEntry[]>([]);
  const [leaderboards, setLeaderboards] = useState<LeaderboardBoards | null>(null);
  const [guildData, setGuildData] = useState<{ guilds: Guild[]; mine: Guild | null }>({
    guilds: [],
    mine: null,
  });
  const [worldEvent, setWorldEvent] = useState<WorldEvent | null>(null);
  const [developerAnnouncement, setDeveloperAnnouncement] = useState<{ message: string; updatedAt: number; updatedBy: string } | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // TODO(post-verification): restore the subreddit follow prompt and +200-roll reward
  // once the Devvit app has completed Reddit verification/approval.
  // Modals
  const [shareRarity, setShareRarity] = useState<number | null>(null);
  const [showOddsModal, setShowOddsModal] = useState<boolean>(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState<boolean>(false);
  const [showChangelogModal, setShowChangelogModal] = useState<boolean>(false);
  const [showDevModal, setShowDevModal] = useState<boolean>(false);
  const [boosterAnnouncement, setBoosterAnnouncement] = useState<{
    id: GlobalBoosterId;
    name: string;
    username: string;
    activatedAt: number;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(sound.enabled);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [notificationPromptShown, setNotificationPromptShown] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('io-notification-prompt-shown') === '1';
    } catch {
      return false;
    }
  });
  const [newBestModalData, setNewBestModalData] = useState<{ orb: Orb; prevBest: number } | null>(null);
  const [frenzyRunTriggered, setFrenzyRunTriggered] = useState(false);
  const [frenzyArmed, setFrenzyArmed] = useState(false);
  const [showFrenzyPrompt, setShowFrenzyPrompt] = useState(false);
  const frenzyPromptShownRef = useRef(false);
  const frenzyClaimActiveRef = useRef(false);
  const componentMountedRef = useRef(true);
  const stateRevisionRef = useRef(0);

  useEffect(() => {
    return () => {
      componentMountedRef.current = false;
    };
  }, []);
  const appliedServerRevisionRef = useRef(-1);
  const stateRef = useRef<PlayerState | null>(null);
  const rollTicketRef = useRef<{
    ticketId: string;
    nextIndex: number;
    rollsRemaining: number;
    expiresAt: number;
  } | null>(null);
  const rollTicketRequestRef = useRef<Promise<{
    ticketId: string;
    nextIndex: number;
    rollsRemaining: number;
    expiresAt: number;
  }> | null>(null);
  const rollActionLockRef = useRef(false);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationCountRef = useRef(0);
  const mutationResyncNeededRef = useRef(false);
  const lastBoosterAnnouncementAtRef = useRef(0);
  const boosterAnnouncementTimerRef = useRef<number | null>(null);

  const applyPlayerState = useCallback((nextState: PlayerState) => {
    const nextServerRevision = Number(nextState.stateRevision);
    if (Number.isFinite(nextServerRevision)) {
      if (nextServerRevision < appliedServerRevisionRef.current) return;
      appliedServerRevisionRef.current = nextServerRevision;
    }

    // Online presence is polled independently and is not authoritative player
    // save data. Preserve the freshest UI-only count when applying a server save.
    const onlinePlayers = stateRef.current?.onlinePlayers;
    const appliedState = Number.isFinite(onlinePlayers)
      ? { ...nextState, onlinePlayers }
      : nextState;
    stateRef.current = appliedState;
    stateRevisionRef.current += 1;
    setState(appliedState);
  }, []);
  // Mutations are optimistic on the client: update the visible state immediately,
  // then let the server verify/save it. Rejections restore the exact prior state.
  // The authoritative server response always replaces the speculative state.
  const beginOptimisticState = useCallback(
    (patch: (current: PlayerState) => PlayerState): (() => void) | null => {
      const previousState = stateRef.current;
      if (!previousState) return null;
      const nextState = patch(previousState);
      const optimisticRevision = stateRevisionRef.current + 1;
      stateRef.current = nextState;
      stateRevisionRef.current = optimisticRevision;
      setState(nextState);
      return () => {
        // Never let a late failure restore an older snapshot over a newer
        // optimistic action or an already-applied server response.
        if (stateRevisionRef.current !== optimisticRevision) return;
        stateRevisionRef.current += 1;
        setState(previousState);
      };
    },
    [state],
  );

  const enqueueMutation = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = mutationQueueRef.current.then(task, task);
    mutationQueueRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const ensureRollTicket = useCallback(async () => {
    const current = rollTicketRef.current;
    if (current && current.nextIndex < 30 && current.expiresAt > Date.now()) {
      return current;
    }

    if (!rollTicketRequestRef.current) {
      rollTicketRequestRef.current = getJson<{
        ticketId: string;
        nextIndex: number;
        rollsRemaining: number;
        expiresAt: number;
      }>('/api/roll-ticket').finally(() => {
        rollTicketRequestRef.current = null;
      });
    }

    const ticket = await rollTicketRequestRef.current;
    rollTicketRef.current = ticket;
    return ticket;
  }, []);

  const dismissedDeveloperAnnouncementRef = useRef<number>(
    (() => {
      try {
        return Number(window.localStorage.getItem('io-developer-announcement-dismissed-at') ?? 0) || 0;
      } catch {
        return 0;
      }
    })(),
  );

  const featureForTab = (nextTab: ActiveTab): FeatureId | null => {
    if (nextTab === 'upgrades') return 'upgrades';
    if (nextTab === 'quests') return 'quests';
    if (nextTab === 'collection') return 'collection';
    if (nextTab === 'boosters') return 'boosters';
    if (nextTab === 'social') return 'social';
    if (nextTab === 'altar') return 'altar';
    if (nextTab === 'mastery') return 'mastery';
    if (nextTab === 'profile') return 'prestige';
    return null;
  };

  const changeTab = (nextTab: ActiveTab) => {
    const feature = featureForTab(nextTab);
    if (feature && (state?.level ?? 1) < FEATURE_UNLOCK_LEVELS[feature]) {
      showToast(
        `Reach Level ${FEATURE_UNLOCK_LEVELS[feature]} to unlock ${nextTab === 'profile' ? 'Prestige' : nextTab.charAt(0).toUpperCase() + nextTab.slice(1)}.`,
        'info',
      );
      return;
    }
    sound.playClick();
    setTab(nextTab);
  };

  const showToast = (msg: string, type: 'info' | 'success' | 'warn' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => {
      setToast(prev => (prev?.msg === msg ? null : prev));
    }, 4000);
  };

  const handleToggleAutoRoll = useCallback(async () => {
    const next = !autoRoll;
    const rollback = beginOptimisticState(current => ({
      ...current,
      autoRollEnabled: next,
    }));
    setAutoRoll(next);
    try {
      const res = await enqueueMutation(() =>
        getJson<{ state: PlayerState }>('/api/auto-roll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next }),
        }),
      );
      applyPlayerState(res.state);
      setAutoRoll(res.state.autoRollEnabled === true);
    } catch {
      rollback?.();
      setAutoRoll(!next);
      showToast('Could not save Auto Roll preference.', 'warn');
    }
  }, [applyPlayerState, autoRoll, beginOptimisticState, enqueueMutation, showToast]);

  const refreshLeaderboards = useCallback(async () => {
    const [lb, lbs] = await Promise.all([
      getJson<LeaderboardEntry[]>('/api/leaderboard'),
      getJson<LeaderboardBoards>('/api/leaderboards'),
    ]);
    setLeaderboardData(lb);
    setLeaderboards(lbs);
  }, []);

  const refreshAll = useCallback(async () => {
    const revisionAtStart = stateRevisionRef.current;
    try {
      // Load the player's state first. Admin/debug status is auxiliary and must
      // never block the entire game from rendering if that endpoint is slow.
      const me = await getJsonWithTimeout<PlayerState>('/api/me');
      try {
        window.sessionStorage.removeItem('io-wipe-recovery');
      } catch {
        // sessionStorage can be unavailable in some embedded webviews.
      }
      if (revisionAtStart !== stateRevisionRef.current) return;
      applyPlayerState(me);
      setAuthRequired(false);
      setStartupError(null);

      // Admin status is intentionally independent from game-state loading.
      const adminStatus = await getJson<{ isAdmin: boolean }>('/api/dev/status').catch(() => ({ isAdmin: false }));
      setIsAdmin(adminStatus.isAdmin === true);

      // A banned non-admin only needs their own state so the ban screen can load.
      // The admin may continue to use the normal game endpoints while testing a ban.
      if (me.gameBan?.active) return;

      const [lb, lbs, gd, we, announcement, notificationState] = await Promise.all([
        getJson<LeaderboardEntry[]>('/api/leaderboard').catch(() => []),
        getJson<LeaderboardBoards>('/api/leaderboards').catch(() => null),
        getJson<{ guilds: Guild[]; mine: Guild | null }>('/api/guilds').catch(() => ({ guilds: [], mine: null })),
        getJson<WorldEvent>('/api/world-event').catch(() => null),
        getJson<{ message: string; updatedAt: number; updatedBy: string }>('/api/developer-announcement').catch(() => null),
        getJson<{ enabled: boolean }>('/api/notifications').catch(() => ({ enabled: false })),
      ]);

      setLeaderboardData(lb);
      setLeaderboards(lbs);
      setGuildData(gd);
      if (we) setWorldEvent(we);
      if (announcement) setDeveloperAnnouncement(announcement);
      setNotificationsEnabled(notificationState.enabled === true);
    } catch (e: any) {
      if (e?.message === 'REDDIT_LOGIN_REQUIRED') {
        setAuthRequired(true);
        setState(null);
        setIsAdmin(false);
        setStartupError(null);
        return;
      }
      const message = e?.message || 'Could not connect to the Infinity Orbs server.';
      setStartupError(message);
      console.error('Refresh error:', e);
    }
  }, []);

  useEffect(() => {
    if (!stateRef.current) return;
    void ensureRollTicket().catch(() => null);
  }, [state?.stateRevision, ensureRollTicket]);

  // Initial load. Timer updates stay local to the screens that display them.
  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Live developer announcement feed. All open clients poll the same Redis-backed
  // announcement so edits appear automatically without requiring a page refresh.
  useEffect(() => {
    let cancelled = false;

    const pollDeveloperAnnouncement = async () => {
      try {
        const announcement = await getJson<{ message: string; updatedAt: number; updatedBy: string }>('/api/developer-announcement');
        if (cancelled) return;

        if (!announcement.message) {
          setDeveloperAnnouncement(null);
          return;
        }

        if (announcement.updatedAt > dismissedDeveloperAnnouncementRef.current) {
          setDeveloperAnnouncement(announcement);
        } else {
          setDeveloperAnnouncement(null);
        }
      } catch {
        // Announcement polling is best-effort and must never block gameplay.
      }
    };

    void pollDeveloperAnnouncement();
    const interval = window.setInterval(() => void pollDeveloperAnnouncement(), 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // Detect when the installed game has a newer client bundle. The endpoint is
  // deliberately uncached so stale Reddit/CDN responses do not hide updates.
  useEffect(() => {
    const checkForUpdate = async () => {
      try {
        const res = await fetch('/api/version?check=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return;
        const data = await res.json() as { version?: string };
        if (data.version && data.version !== APP_VERSION) {
          setUpdateAvailable(true);
        }
      } catch {
        // Update detection is best-effort and must never block gameplay.
      }
    };

    void checkForUpdate();
    const interval = window.setInterval(() => void checkForUpdate(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // Periodic background refresh for social & community event rolling counter
  useEffect(() => {
    const pollInterval = tab === 'social' ? 3000 : 8000;
    const interval = setInterval(() => {
      void getJson<WorldEvent>('/api/world-event').then(we => {
        if (we) setWorldEvent(we);
      }).catch(() => null);

      if (tab === 'social') {
        void getJson<{ guilds: Guild[]; mine: Guild | null }>('/api/guilds').then(gd => {
          if (gd) setGuildData(gd);
        }).catch(() => null);
      }
    }, pollInterval);
    return () => clearInterval(interval);
  }, [tab]);


  // Global Boosters are shared state, so refresh them independently of player-state polling.
  useEffect(() => {
    if (tab !== 'boosters') return;

    const refreshGlobalBoosters = () => {
      void getJson<GlobalBoosterSnapshot>('/api/global-boosters')
        .then(snapshot => {
          if (snapshot) {
            setState(prev => prev ? { ...prev, globalBoosters: snapshot } : prev);
          }
        })
        .catch(() => null);
    };

    refreshGlobalBoosters();
    const interval = setInterval(refreshGlobalBoosters, 1500);
    return () => clearInterval(interval);
  }, [tab]);

  // Presence is independent from player-state persistence. Do not poll /api/me
  // here because game-state reads must never be responsible for saving the player.
  useEffect(() => {
    const presenceInterval = setInterval(() => {
      void getJson<{ onlinePlayers: number }>('/api/online')
        .then(({ onlinePlayers }) => {
          const current = stateRef.current;
          if (current) stateRef.current = { ...current, onlinePlayers };
          setState(prev => prev ? { ...prev, onlinePlayers } : prev);
        })
        .catch(() => null);
    }, 10_000);
    return () => clearInterval(presenceInterval);
  }, []);

  useEffect(() => {
    if (!state || !splashEntered || frenzyRunTriggered || frenzyClaimActiveRef.current) return;

    const resolveFrenzy = async () => {
      let readyToClaim = false;
      let lastPreflightError: unknown = null;

      // Retry only the read-only handoff/info checks. Retrying the claim POST
      // after a network error is unsafe because the server may have committed
      // the reward even when the response did not reach this webview.
      for (let attempt = 0; attempt < 12; attempt++) {
        try {
          const handoff = await getJson<{ armed: boolean }>('/api/frenzy/handoff');
          if (!handoff.armed) {
            // Expansion is requested in the trusted click turn while the public
            // page arms the handoff concurrently. A successful early read can
            // legitimately race that POST, so retry this read-only check.
            if (attempt < 11) await new Promise(resolve => window.setTimeout(resolve, 150));
            continue;
          }

          const info = await getJson<{
            rarity: number;
            ownerUsername: string;
            createdAt: number;
            claimedToday: boolean;
            isOwner: boolean;
            canClaim: boolean;
            selfClaimTest: boolean;
            postId: string;
            inGame?: boolean;
          }>('/api/frenzy/info');

          // Only a Frenzy claim explicitly armed from the public Frenzy post
          // may auto-claim here. Simply opening the game must never consume a Frenzy.
          if (!info.inGame || !info.canClaim) return;
          readyToClaim = true;
          break;
        } catch (error) {
          lastPreflightError = error;
          if (attempt < 11) await new Promise(resolve => window.setTimeout(resolve, 150));
        }
      }

      if (!readyToClaim) {
        if (lastPreflightError) throw lastPreflightError;
        return;
      }

      frenzyClaimActiveRef.current = true;
      setFrenzyRunTriggered(true);
      setBusy(true);
      setIsRolling(true);

      // Claim exactly once per attempt. A retry requires a fresh user action
      // because a failed HTTP response cannot prove the server did not commit.
      const res = await enqueueMutation(() =>
        getJson<RollResponse>('/api/frenzy/claim', { method: 'POST' }),
      );

      if (!componentMountedRef.current) return;

      const revealBatch = res.batch?.length ? res.batch : [res.orb];

      // Apply the authoritative state without cancelling the visual reveal.
      applyPlayerState(res.state);
      setLastBatch(revealBatch);
      setBatchSummary({
        totalVal: res.totalRollValue,
        coins: res.coinsGained,
        shards: res.shardsGained,
        xp: res.xpGained,
        frenzyCount: res.frenzyCount ?? 0,
      });
      setReadyAt(Date.now() + res.rollsRemainingUntilNext);

      // This is the actual Frenzy volley returned by the server. Animate the
      // resolved Orbs in sequence only when the user has not requested reduced
      // motion. The authoritative state/rewards are identical in either mode.
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion) {
        setLastOrb(res.orb);
      } else {
        for (const revealedOrb of revealBatch) {
          if (!componentMountedRef.current) return;
          setLastOrb(revealedOrb);
          await new Promise(resolve => window.setTimeout(resolve, 240));
        }
        if (!componentMountedRef.current) return;
        setLastOrb(res.orb);
      }
      sound.playMythicFanfare();
      showToast(
        `⚡ Orb Frenzy claimed! ${formatNumber(res.frenzyCount ?? 0)} Orbs rolled.`,
        'success',
      );
    };

    void resolveFrenzy()
      .catch(error => {
        showToast(error?.message || 'Could not claim Orb Frenzy.', 'warn');
      })
      .finally(() => {
        setIsRolling(false);
        setBusy(false);
      });
  }, [state, splashEntered, frenzyRunTriggered, applyPlayerState, enqueueMutation]);

  useEffect(() => {
    const startedAt = Date.now();

    const checkPrompt = () => {
      const now = Date.now();
      const current = stateRef.current;
      if (!current || now - startedAt < FRENZY_PROMPT_DELAY_MS) return;
      if (!canShowDailyFrenzyPrompt(current.lastFrenzyAt ?? current.lastFrenzyDate, now)) return;
      if (frenzyPromptShownRef.current) return;

      const storageKey = `io-frenzy-prompt-shown-${todayKey(now)}`;
      try {
        if (window.localStorage.getItem(storageKey) === '1') return;
        window.localStorage.setItem(storageKey, '1');
      } catch {
        // Storage can be unavailable in embedded webviews. The in-memory
        // state still prevents repeated prompts during this session.
      }

      frenzyPromptShownRef.current = true;
      setShowFrenzyPrompt(true);
    };

    const interval = window.setInterval(checkPrompt, 15_000);
    checkPrompt();
    return () => window.clearInterval(interval);
  }, []);

  // Social quests count only when the player actually opens the social area.
  // Background leaderboard/guild refreshes must not award the visit quest.
  useEffect(() => {
    if (tab !== 'social') return;

    // Mark the visit locally before the server records it. The server response
    // remains authoritative for quest progress and cross-device state.
    const rollback = beginOptimisticState(current => {
      const today = todayKey();
      if (current.socialActivityDate === today) return current;
      return {
        ...current,
        socialActivityDate: today,
        dailyQuests: current.dailyQuests.map(q =>
          q.id === 'daily-social' && !q.claimed
            ? { ...q, progress: Math.min(q.target, q.progress + 1) }
            : q
        ),
      };
    });

    void getJson<{ ok: boolean; state: PlayerState }>('/api/social/visit', { method: 'POST' })
      .then(result => applyPlayerState(result.state))
      .catch(() => {
        rollback?.();
      });
  }, [applyPlayerState, beginOptimisticState, tab]);

  // Roll action
  const handleRoll = useCallback(async (isAutoRoll = false) => {
    if (rollActionLockRef.current) return;
    const currentState = stateRef.current;
    if (!currentState) return;

    rollActionLockRef.current = true;
    let frenzySubmissionInFlight = false;

    void (async () => {
      try {
        if (!isAutoRoll && frenzyArmed) {
          frenzySubmissionInFlight = true;
          // Consume the armed state immediately so a failed request cannot
          // leave the UI stuck in a dead "RELEASE FRENZY" state.
          setFrenzyArmed(false);
          setIsRolling(true);
          const res = await enqueueMutation(() => getJson<{
            state: PlayerState;
            postId: string;
            url: string;
            rarity: number;
            orb: Orb;
            batch: Orb[];
            totalValueGained: number;
            totalRollValue: number;
            coinsGained: number;
            shardsGained: number;
            xpGained: number;
            rollsRemainingUntilNext: number;
            rollsProcessed: number;
            dramaticReveal: boolean;
          }>('/api/frenzy/start', { method: 'POST' }));

          applyPlayerState(res.state);
          setFrenzyArmed(false);
          setLastOrb(res.orb);
          setLastBatch(res.batch ?? [res.orb]);
          setBatchSummary({
            totalVal: res.totalRollValue,
            coins: res.coinsGained,
            shards: res.shardsGained,
            xp: res.xpGained,
            frenzyCount: undefined,
          });
          setReadyAt(Date.now() + res.rollsRemainingUntilNext);
          sound.playEpicFanfare();
          showToast(
            `🔥 Frenzy submitted! Your ${formatRarity(res.rarity)} roll is now posted.`,
            'success',
          );
          setIsRolling(false);
          return;
        }

        const ticket = await ensureRollTicket();
        const ticketIndex = ticket.nextIndex;
        rollTicketRef.current = { ...ticket, nextIndex: ticketIndex + 1, rollsRemaining: Math.max(0, 30 - (ticketIndex + 1)) };
        sound.playRollNormal();
        setIsRolling(true);
        // Display no reward until the server confirms that the roll committed.
        setLastOrb(null);
        setLastBatch([]);
        setBatchSummary(null);
        pendingMutationCountRef.current += 1;
        await enqueueMutation(async () => {
          try {
            const res = await getJson<RollResponse>('/api/roll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ auto: isAutoRoll, ticketId: ticket.ticketId, ticketIndex }),
            });
            pendingMutationCountRef.current -= 1;
            if (pendingMutationCountRef.current === 0) {
              applyPlayerState(res.state);
              setLastOrb(res.orb);
              setLastBatch(res.batch ?? [res.orb]);
              setBatchSummary({ totalVal: res.totalRollValue, coins: res.coinsGained, shards: res.shardsGained, xp: res.xpGained });
              setReadyAt(Date.now() + res.rollsRemainingUntilNext);
              mutationResyncNeededRef.current = false;
              setIsRolling(false);
            }
            maybePromptForNotifications(currentState.totalRolls, res.state.totalRolls);
          } catch (error: any) {
            pendingMutationCountRef.current -= 1;
            mutationResyncNeededRef.current = true;
            rollTicketRef.current = null;
            if (pendingMutationCountRef.current === 0) {
              await refreshAll().catch(() => null);
              mutationResyncNeededRef.current = false;
              setIsRolling(false);
            }
            showToast(error?.message || 'Roll verification failed. State refreshed.', 'warn');
          }
        });
      } catch (error: any) {
        rollTicketRef.current = null;
        setFrenzyArmed(false);
        if (frenzySubmissionInFlight) {
          // Re-read authoritative state before allowing another Frenzy attempt.
          await refreshAll().catch(() => null);
        }
        showToast(error?.message || 'Could not prepare the next roll.', 'warn');
        setIsRolling(false);
      } finally {
        rollActionLockRef.current = false;
      }
    })();
  }, [
    applyPlayerState,
    enqueueMutation,
    ensureRollTicket,
    enqueueMutation,
    refreshAll,
    worldEvent?.buffMultiplier,
    frenzyArmed,
  ]);

  // Auto roll watcher (paced steadily)
  useEffect(() => {
    if (!autoRoll || !state || state.upgrades.auto === 0) return;
    const interval = setInterval(() => {
      if (Date.now() >= readyAt && !isRolling) {
        void handleRoll(true);
      }
    }, 300);
    return () => clearInterval(interval);
  }, [autoRoll, state, readyAt, isRolling, handleRoll]);

  // Buy Standard Upgrade
  const handleBuyUpgrade = async (id: UpgradeId) => {
    const currentState = stateRef.current;
    if (!currentState) return;

    const level = currentState.upgrades[id] ?? 0;
    const cost = upgradeCost(id, level);
    const canBuy = id === 'auto'
      ? (currentState.manualRolls ?? 0) >= 3
      : Number.isFinite(cost) && currentState.coins >= cost;

    if (!canBuy) {
      showToast(
        id === 'auto'
          ? `Auto Roll unlocks after 3 manual rolls (${currentState.manualRolls ?? 0}/3).`
          : Number.isFinite(cost)
            ? `Need ${formatNumber(cost)} Coins.`
            : 'Upgrade is already at its maximum level.',
        'warn',
      );
      return;
    }

    const nextState: PlayerState = id === 'auto'
      ? {
          ...currentState,
          upgrades: { ...currentState.upgrades, auto: 1 },
        }
      : {
          ...currentState,
          coins: currentState.coins - cost,
          upgrades: { ...currentState.upgrades, [id]: level + 1 },
        };

    // Upgrade instantly on the client. The queued server command is the
    // authority and will either confirm it or trigger a state resync.
    stateRef.current = nextState;
    stateRevisionRef.current += 1;
    setState(nextState);
    sound.playChime(659.25, 'sine', 0.2);

    pendingMutationCountRef.current += 1;
    void enqueueMutation(async () => {
      try {
        const res = await getJson<{ state: PlayerState }>('/api/upgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });

        pendingMutationCountRef.current -= 1;
        if (pendingMutationCountRef.current === 0) {
          applyPlayerState(res.state);
          mutationResyncNeededRef.current = false;
          showToast(`Upgraded ${id.toUpperCase()} successfully!`, 'success');
        }
      } catch (error: any) {
        pendingMutationCountRef.current -= 1;
        mutationResyncNeededRef.current = true;
        if (pendingMutationCountRef.current === 0) {
          await refreshAll().catch(() => null);
          mutationResyncNeededRef.current = false;
        }
        showToast(error?.message || 'Upgrade verification failed. State refreshed.', 'warn');
      }
    });
  };

  // Upgrade All Standard Upgrades
  const handleBuyAllUpgrades = async () => {
    const currentState = stateRef.current;
    if (!currentState) return;

    const next: PlayerState = {
      ...currentState,
      upgrades: { ...currentState.upgrades },
    };
    const ids: UpgradeId[] = [
      'speed', 'multi', 'clusterRoll', 'auto', 'luck', 'coinBonus',
      'shardChance', 'xpBonus', 'critChance', 'critPower', 'offlineRate', 'valueBonus',
    ];
    let purchases = 0;

    let changed = true;
    while (changed && purchases < 5_000) {
      changed = false;
      for (const id of ids) {
        if (id === 'auto' || purchases >= 5_000) continue;
        const level = next.upgrades[id] ?? 0;
        const cost = upgradeCost(id, level);
        if (!Number.isFinite(cost) || cost > next.coins) continue;
        next.coins -= cost;
        next.upgrades[id] = level + 1;
        purchases++;
        changed = true;
      }
    }

    if (purchases <= 0) {
      showToast('No upgrades are currently affordable.', 'info');
      return;
    }

    stateRef.current = next;
    stateRevisionRef.current += 1;
    setState(next);
    sound.playChime(523.25, 'triangle', 0.3);

    pendingMutationCountRef.current += 1;
    void enqueueMutation(async () => {
      try {
        const res = await getJson<{ state: PlayerState; totalSpent: number; upgradedCount: number }>('/api/upgrade/all', {
          method: 'POST',
        });

        pendingMutationCountRef.current -= 1;
        if (pendingMutationCountRef.current === 0) {
          applyPlayerState(res.state);
          mutationResyncNeededRef.current = false;
          showToast(
            res.upgradedCount > 0
              ? `Bought ${res.upgradedCount} upgrade level${res.upgradedCount === 1 ? '' : 's'} for ${formatNumber(res.totalSpent)} Coins.`
              : 'No upgrades are currently affordable.',
            res.upgradedCount > 0 ? 'success' : 'info',
          );
        }
      } catch (error: any) {
        pendingMutationCountRef.current -= 1;
        mutationResyncNeededRef.current = true;
        if (pendingMutationCountRef.current === 0) {
          await refreshAll().catch(() => null);
          mutationResyncNeededRef.current = false;
        }
        showToast(error?.message || 'Upgrade verification failed. State refreshed.', 'warn');
      }
    });
  };

  // Turbo Roll Booster
  const handleActivateTurbo = async () => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      if ((current.shards ?? 0) < 5) return current;
      const now = Date.now();
      const durationMs = (current.prestigeUpgrades?.chronoOverdrive ?? 0) > 0
        ? 60 * 60 * 1000
        : 30 * 60 * 1000;
      const purchased = current.purchasedShards ?? 0;
      return {
        ...current,
        shards: current.shards - 5,
        purchasedShards: Math.max(0, purchased - Math.min(5, purchased)),
        turboRollUntil: Math.max(now, current.turboRollUntil ?? 0) + durationMs,
      };
    });
    try {
      const res = await getJson<{ state: PlayerState }>('/api/turbo/activate', { method: 'POST' });
      applyPlayerState(res.state);
      sound.playChime(880, 'sawtooth', 0.3);
      showToast('Turbo Roll Activated! Cooldowns reduced by 20% for 30m.', 'success');
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Could not activate turbo roll', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Daily Orb Frenzy
  const handleStartOrbFrenzy = async () => {
    if (frenzyArmed) return;

    const current = stateRef.current;
    if (!current) return;
    const remaining = frenzyCooldownRemaining(current.lastFrenzyAt);
    if (remaining > 0) {
      const total = Math.ceil(remaining / 1000);
      const hours = Math.floor(total / 3600);
      const mins = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      showToast('Orb Frenzy is on cooldown for ' + hours + ':' + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + '.', 'warn');
      return;
    }

    setBusy(true);

    try {
      // Stop Auto Roll before arming. The next click must be a genuine manual
      // roll so the player deliberately chooses the starter result.
      if (autoRoll) {
        const rollback = beginOptimisticState(state => ({
          ...state,
          autoRollEnabled: false,
        }));
        setAutoRoll(false);

        try {
          const res = await enqueueMutation(() =>
            getJson<{ state: PlayerState }>('/api/auto-roll', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: false }),
            }),
          );
          applyPlayerState(res.state);
        } catch (error) {
          rollback?.();
          setAutoRoll(true);
          throw error;
        }
      }

      setFrenzyArmed(true);
      sound.playChime(1040, 'sawtooth', 0.22);
      showToast('⚡ Frenzy armed. Your next manual Roll will submit it.', 'success');
    } catch (e: any) {
      showToast(e.message || 'Could not arm Orb Frenzy', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const handleActivateGlobalBooster = async (id: GlobalBoosterId, useCredit: boolean) => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      if (useCredit) {
        if ((current.globalBoosterCredits ?? 0) <= 0) return current;
        return {
          ...current,
          globalBoosterCredits: Math.max(0, (current.globalBoosterCredits ?? 0) - 1),
        };
      }
      if ((current.shards ?? 0) < 25) return current;
      const purchased = current.purchasedShards ?? 0;
      return {
        ...current,
        shards: current.shards - 25,
        purchasedShards: Math.max(0, purchased - Math.min(25, purchased)),
      };
    });
    try {
      const res = await getJson<{
        state: PlayerState;
        snapshot: GlobalBoosterSnapshot;
        usedCredit: boolean;
        announcement: {
          id: GlobalBoosterId;
          name: string;
          username: string;
          activatedAt: number;
        };
      }>('/api/global-boosters/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, useCredit }),
      });
      applyPlayerState(res.state);
      lastBoosterAnnouncementAtRef.current = res.announcement.activatedAt;
      setBoosterAnnouncement(res.announcement);
      if (boosterAnnouncementTimerRef.current !== null) window.clearTimeout(boosterAnnouncementTimerRef.current);
      boosterAnnouncementTimerRef.current = window.setTimeout(() => {
        setBoosterAnnouncement(null);
        boosterAnnouncementTimerRef.current = null;
      }, 5000);
      sound.playChime(960, 'sawtooth', 0.3);
      showToast(
        res.usedCredit ? 'Global Booster activated with a free credit.' : 'Global Booster activated.',
        'success',
      );
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Could not activate Global Booster', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const handleActivatePremiumBooster = async (id: PremiumBoosterId) => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      const info = PREMIUM_BOOSTERS[id];
      if (!info || (current.shards ?? 0) < info.costShards) return current;
      const purchased = current.purchasedShards ?? 0;
      return {
        ...current,
        shards: current.shards - info.costShards,
        purchasedShards: Math.max(0, purchased - Math.min(info.costShards, purchased)),
        activeBoosters: {
          ...(current.activeBoosters ?? {}),
          [id]: Math.max(Date.now(), current.activeBoosters?.[id] ?? 0) + info.durationMs,
        },
      };
    });
    try {
      const res = await getJson<{ state: PlayerState }>('/api/boosters/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      applyPlayerState(res.state);
      sound.playChime(1046, 'sawtooth', 0.3);
      showToast('Premium booster activated.', 'success');
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Could not activate booster', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Permanent automation
  const handleBuyAutomation = async (id: AutomationId) => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      const info = AUTOMATIONS[id];
      if (!info || current.automations?.[id] || (current.shards ?? 0) < info.costShards) return current;
      const purchased = current.purchasedShards ?? 0;
      return {
        ...current,
        shards: current.shards - info.costShards,
        purchasedShards: Math.max(0, purchased - Math.min(info.costShards, purchased)),
        automations: { ...(current.automations ?? {}), [id]: true },
      };
    });
    try {
      const res = await getJson<{ state: PlayerState }>('/api/automation/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      applyPlayerState(res.state);
      sound.playLevelUpFanfare();
      showToast('Automation unlocked.', 'success');
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Could not unlock automation', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Community cache
  const handleClaimCommunityReward = async () => {
    setBusy(true);
    try {
      const res = await getJson<{
        state: PlayerState;
        rewardCoins: number;
        rewardXp: number;
        nextClaimAt: number;
        tier: number;
      }>('/api/community/reward/claim', { method: 'POST' });
      applyPlayerState(res.state);
      if (res.rewardCoins > 0) {
        sound.playChime(880, 'triangle', 0.3);
        showToast(
          `Community cache claimed! +${formatNumber(res.rewardCoins)} Coins, +${formatNumber(res.rewardXp)} XP.`,
          'success',
        );
      }
    } catch (e: any) {
      showToast(e.message || 'Could not claim community reward', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Claim Offline Rolls
  const handleClaimOffline = async () => {
    setBusy(true);
    const rollback = beginOptimisticState(current => ({
      ...current,
      offlineRolls: 0,
      lastSeenAt: Date.now(),
    }));
    try {
      const res = await getJson<RollResponse>('/api/offline/claim', { method: 'POST' });
      applyPlayerState(res.state);
      setLastOrb(res.orb);
      setLastBatch(res.batch ?? [res.orb]);
      setBatchSummary({
        totalVal: res.totalRollValue,
        coins: res.coinsGained,
        shards: res.shardsGained,
        xp: res.xpGained,
      });
      setReadyAt(Date.now() + res.rollsRemainingUntilNext);
      sound.playEpicFanfare();
      showToast(
        `Claimed ${formatNumber(res.rollsProcessed ?? res.batch?.length ?? 0)} offline rolls! Highest: 1/${formatRarity(res.orb.rarity)}`,
        'success'
      );
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Could not claim offline rolls', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Altar Sacrifice
  const handleSacrifice = async (coins: number, shards: number): Promise<PlayerState> => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      if (current.coins < coins || (current.shards ?? 0) < shards) return current;
      const sacrifices = current.sacrifices ?? {
        coinsSacrificed: 0,
        shardsSacrificed: 0,
        altarLevel: 0,
        luckSurgeUntil: 0,
        altarPity: 0,
      };
      return {
        ...current,
        coins: current.coins - coins,
        shards: (current.shards ?? 0) - shards,
        sacrifices: {
          ...sacrifices,
          coinsSacrificed: (sacrifices.coinsSacrificed ?? 0) + coins,
          shardsSacrificed: (sacrifices.shardsSacrificed ?? 0) + shards,
        },
      };
    });
    try {
      const res = await getJson<{
        state: PlayerState;
        altarLeveledUp: boolean;
        luckSurgeExtended: boolean;
        altarBreakthroughChance: number;
        altarPity: number;
      }>('/api/altar/sacrifice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coins, shards }),
      });
      applyPlayerState(res.state);
      if (res.altarLeveledUp) {
        sound.playLevelUpFanfare();
        showToast(
          `Devotion breakthrough! Altar reached Lvl ${res.state.sacrifices?.altarLevel} at ${res.altarBreakthroughChance}% chance. +1 Mastery Point.`,
          'success',
        );
      } else if (res.altarBreakthroughChance > 0) {
        showToast(
          `The altar resisted the offering (${res.altarBreakthroughChance}% chance). Pity is now ${res.altarPity}.`,
          'info',
        );
      } else if (res.luckSurgeExtended) {
        showToast('Shard sacrifice accepted! Luck Surge extended by 15 minutes per Shard.', 'success');
      } else {
        showToast('Offerings consumed by the Altar.', 'info');
      }
      return res.state;
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Sacrifice failed', 'warn');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  // Upgrade Mastery Skill
  const handleUpgradeMastery = async (skillId: MasterySkillId) => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      const currentLevel = current.masterySkills?.[skillId] ?? 0;
      const cost = masterySkillCost(skillId, currentLevel);
      if ((current.masteryPoints ?? 0) < cost) return current;
      return {
        ...current,
        masteryPoints: (current.masteryPoints ?? 0) - cost,
        masterySkills: {
          continuumLuck: current.masterySkills?.continuumLuck ?? 0,
          prosperity: current.masterySkills?.prosperity ?? 0,
          shardAttunement: current.masterySkills?.shardAttunement ?? 0,
          critMastery: current.masterySkills?.critMastery ?? 0,
          chronoFlow: current.masterySkills?.chronoFlow ?? 0,
          infiniteVault: current.masterySkills?.infiniteVault ?? 0,
          cosmicAttunement: current.masterySkills?.cosmicAttunement ?? 0,
          celestialSurge: current.masterySkills?.celestialSurge ?? 0,
          pityAccelerant: current.masterySkills?.pityAccelerant ?? 0,
          apexFortune: current.masterySkills?.apexFortune ?? 0,
          celestialVolley: current.masterySkills?.celestialVolley ?? 0,
          [skillId]: currentLevel + 1,
        },
      };
    });
    try {
      const res = await getJson<{ state: PlayerState }>('/api/mastery/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId }),
      });
      applyPlayerState(res.state);
      showToast('Mastery Skill enhanced!', 'success');
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Mastery upgrade failed', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Daily Streak
  const handleClaimDailyStreak = async () => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      const today = todayKey();
      if (current.streak.lastClaimDate === today) return current;
      const yesterday = todayKey(Date.now() - 86_400_000);
      const count =
        current.streak.lastClaimDate === yesterday
          ? current.streak.count + 1
          : 1;
      const day = ((count - 1) % 7) + 1;
      const next = {
        ...current,
        coins: current.coins + day * 100,
        lifetimeCoins: (current.lifetimeCoins ?? 0) + day * 100,
        streak: {
          ...current.streak,
          count,
          longestStreak: Math.max(current.streak.longestStreak, count),
          lastClaimDate: today,
        },
      };
      grantFreeShards(next, day === 7 ? 5 : day === 3 ? 1 : 0);
      return next;
    });
    try {
      const res = await getJson<{ state: PlayerState; rewardCoins: number; rewardShards: number }>(
        '/api/streak/claim',
        { method: 'POST' }
      );
      applyPlayerState(res.state);
      sound.playChime(784, 'triangle', 0.3);
      showToast(
        `Streak claimed! +${res.rewardCoins} Coins ${res.rewardShards > 0 ? `+${res.rewardShards} Shards` : ''}`,
        'success'
      );
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Could not claim streak', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Claim Quest
  const handleClaimQuest = async (type: 'daily' | 'weekly', id: string) => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      const list = type === 'daily' ? current.dailyQuests : current.weeklyQuests;
      const quest = list.find(item => item.id === id);
      if (!quest || quest.claimed || quest.unlocked === false || quest.progress < quest.target) {
        return current;
      }

      const next: PlayerState = {
        ...current,
        coins: current.coins + quest.rewardCoins,
        lifetimeCoins: (current.lifetimeCoins ?? 0) + quest.rewardCoins,
        questsCompleted: (current.questsCompleted ?? 0) + 1,
        xp: current.xp + (quest.rewardXp ?? 0),
      };
      grantFreeShards(next, quest.rewardShards ?? 0);
      applyLevelProgress(next);

      const updatedQuest = { ...quest, claimed: true };
      if (type === 'daily') {
        next.dailyQuests = next.dailyQuests.map(item => item.id === id ? updatedQuest : item);
      } else {
        next.weeklyQuests = next.weeklyQuests.map(item => item.id === id ? updatedQuest : item);
      }
      return next;
    });
    try {
      const res = await getJson<{ state: PlayerState; rewardCoins: number; rewardShards?: number }>(
        '/api/quests/claim',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, id }),
        }
      );
      applyPlayerState(res.state);
      sound.playChime(700, 'sine', 0.25);
      showToast(`Quest completed! +${res.rewardCoins.toLocaleString()} Coins`, 'success');
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Could not claim quest', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Prestige Reset
  const handlePrestige = async () => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      const dustEarned = calculateCosmicDust(current);
      if (dustEarned <= 0 || (current.collectionValue ?? 0) < 1_000_000) return current;

      const inheritanceLevel = current.prestigeUpgrades?.cosmicInheritance ?? 0;
      const keepPct = Math.min(0.50, inheritanceLevel * 0.10);
      const keptCoins = Math.max(50, Math.floor(current.coins * keepPct));
      const keptShards = current.shards ?? 0; // Shards persist through Prestige.

      return {
        ...current,
        cosmicDust: (current.cosmicDust ?? 0) + dustEarned,
        prestigeCount: (current.prestigeCount ?? 0) + 1,
        masteryPoints: (current.masteryPoints ?? 0) + 3,
        collectionValue: 0,
        coins: keptCoins,
        shards: keptShards,
        upgrades: createInitialState().upgrades,
        offlineRolls: 0,
        rollsSinceBest: 0,
        currentRunRolls: 0,
        lastRollAt: null,
      };
    });
    try {
      const res = await getJson<{ state: PlayerState; dustGained?: number; cosmicDustEarned?: number }>('/api/prestige', {
        method: 'POST',
      });
      applyPlayerState(res.state);
      sound.playMythicFanfare();
      const dust = res.dustGained ?? res.cosmicDustEarned ?? 0;
      showToast(`Prestige Complete! You earned +${dust} Cosmic Dust.`, 'success');
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Prestige failed', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Buy Permanent Prestige Upgrade
  const handleBuyPrestigeUpgrade = async (id: PrestigeUpgradeId) => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      const currentLevel = current.prestigeUpgrades?.[id] ?? 0;
      const cost = prestigeUpgradeCost(id, currentLevel);
      if ((current.cosmicDust ?? 0) < cost) return current;
      return {
        ...current,
        cosmicDust: current.cosmicDust - cost,
        prestigeUpgrades: {
          ...(current.prestigeUpgrades ?? createInitialState().prestigeUpgrades),
          [id]: currentLevel + 1,
        },
      };
    });
    try {
      const res = await getJson<{ state: PlayerState }>('/api/prestige/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      applyPlayerState(res.state);
      sound.playChime(659.25, 'sine', 0.25);
      showToast('Permanent cosmic upgrade obtained!', 'success');
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Prestige upgrade failed', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Astral Forge Dust Synthesis
  const handleSynthesizeDust = async () => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      if ((current.shards ?? 0) < 10) return current;
      const purchased = current.purchasedShards ?? 0;
      return {
        ...current,
        shards: current.shards - 10,
        purchasedShards: Math.max(0, purchased - Math.min(10, purchased)),
        cosmicDust: (current.cosmicDust ?? 0) + 1,
      };
    });
    try {
      const res = await getJson<{ state: PlayerState; dustEarned: number }>('/api/prestige/synthesize', {
        method: 'POST',
      });
      applyPlayerState(res.state);
      sound.playChime(1046.5, 'triangle', 0.4);
      showToast(`+${res.dustEarned} Cosmic Dust forged in the Astral Forge!`, 'success');
      void refreshAll();
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Synthesis failed', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Buy Guild Perk
  const handleBuyGuildPerk = async (perk: GuildPerkId) => {
    setBusy(true);
    try {
      await getJson('/api/guilds/perk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perk }),
      });
      sound.playChime(784, 'triangle', 0.3);
      showToast('Guild Perk leveled up for all members!', 'success');
      void refreshAll();
    } catch (e: any) {
      showToast(e.message || 'Could not upgrade perk', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Cosmetics
  const handleBuyCosmetic = async (id: string) => {
    setBusy(true);
    const rollback = beginOptimisticState(current => {
      const cosmetic = COSMETICS_LIST.find(item => item.id === id);
      if (!cosmetic) return current;
      if (current.unlockedCosmetics.includes(id)) return { ...current, activeCosmetic: id };
      if (current.coins < cosmetic.costCoins || (current.shards ?? 0) < cosmetic.costShards) return current;
      const purchased = current.purchasedShards ?? 0;
      return {
        ...current,
        coins: current.coins - cosmetic.costCoins,
        shards: current.shards - cosmetic.costShards,
        purchasedShards: Math.max(0, purchased - Math.min(cosmetic.costShards, purchased)),
        unlockedCosmetics: [...current.unlockedCosmetics, id],
        activeCosmetic: id,
      };
    });
    try {
      const res = await getJson<{ state: PlayerState }>('/api/cosmetics/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      applyPlayerState(res.state);
      sound.playChime(523.25, 'sine', 0.2);
      showToast('Cosmetic equipped!', 'success');
    } catch (e: any) {
      rollback?.();
      showToast(e.message || 'Cosmetic purchase failed', 'warn');
    } finally {
      setBusy(false);
    }
  };

  // Guilds
  const handleCreateGuild = async (name: string, tag: string): Promise<boolean> => {
    setBusy(true);
    try {
      await getJson('/api/guilds/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tag }),
      });
      showToast(`Guild [${tag}] ${name} founded!`, 'success');
      void refreshAll();
      return true;
    } catch (e: any) {
      showToast(e.message || 'Could not create guild', 'warn');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleJoinGuild = async (id: string) => {
    setBusy(true);
    try {
      await getJson('/api/guilds/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      showToast('Joined guild successfully!', 'success');
      void refreshAll();
    } catch (e: any) {
      showToast(e.message || 'Could not join guild', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const handleLeaveGuild = async () => {
    setBusy(true);
    try {
      await getJson('/api/guilds/leave', { method: 'POST' });
      showToast('You left the guild.', 'info');
      void refreshAll();
    } catch (e: any) {
      showToast(e.message || 'Could not leave guild', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleGuildTrust = async (username: string, trusted: boolean) => {
    setBusy(true);
    try {
      await getJson('/api/guilds/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, trusted }),
      });
      showToast(trusted ? `${username} is now trusted.` : `${username} is no longer trusted.`, 'success');
      void refreshAll();
    } catch (e: any) {
      showToast(e.message || 'Could not change Trust status', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const handleKickGuildMember = async (username: string) => {
    setBusy(true);
    try {
      await getJson('/api/guilds/kick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      showToast(username + ' was kicked from the guild.', 'success');
      void refreshAll();
    } catch (e: any) {
      showToast(e.message || 'Could not kick guild member', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const handleSetGuildTax = async (rate: number) => {
    setBusy(true);
    try {
      await getJson('/api/guilds/tax', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate }),
      });
      showToast(`Guild Tax set to ${rate}%.`, 'success');
      void refreshAll();
    } catch (e: any) {
      showToast(e.message || 'Could not change Guild Tax', 'warn');
    } finally {
      setBusy(false);
    }
  };


  const handleSendGuildChat = async (text: string): Promise<GuildMessage> => {
    if (busy) throw new Error('Another action is already in progress.');
    setBusy(true);
    try {
      const res = await getJson<{ message: GuildMessage }>('/api/guilds/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      void refreshAll();
      return res.message;
    } catch (e: any) {
      showToast(e.message || 'Could not send message', 'warn');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const handleSendFeedback = async (type: 'bug' | 'suggestion', message: string) => {
    await getJson<{ success: boolean }>('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, message }),
    });
    setShowFeedbackModal(false);
    showToast(type === 'bug' ? 'Bug report sent to the moderators.' : 'Suggestion sent to the moderators.', 'success');
  };

  const handleToggleNotifications = async (): Promise<boolean> => {
    try {
      const enabled = !notificationsEnabled;
      const res = await getJson<{ enabled: boolean }>('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const nextEnabled = res.enabled === true;
      setNotificationsEnabled(nextEnabled);
      showToast(
        nextEnabled ? 'Reddit notifications enabled.' : 'Reddit notifications disabled.',
        'success',
      );
      return true;
    } catch (e: any) {
      showToast(e.message || 'Could not update Reddit notification settings.', 'warn');
      return false;
    }
  };

  const handleEnableNotificationsFromPrompt = async () => {
    const enabled = await handleToggleNotifications();
    if (enabled) {
      setShowNotificationPrompt(false);
    }
  };

  const maybePromptForNotifications = (previousRolls: number, nextRolls: number) => {
    if (notificationsEnabled || notificationPromptShown || previousRolls >= 5 || nextRolls < 5) return;
    setNotificationPromptShown(true);
    setShowNotificationPrompt(true);
    try {
      window.localStorage.setItem('io-notification-prompt-shown', '1');
    } catch {
      // Local storage is optional in embedded webviews.
    }
  };

  const dismissDeveloperAnnouncement = () => {
    const updatedAt = developerAnnouncement?.updatedAt ?? 0;
    dismissedDeveloperAnnouncementRef.current = updatedAt;
    setDeveloperAnnouncement(null);
    try {
      window.localStorage.setItem('io-developer-announcement-dismissed-at', String(updatedAt));
    } catch {
      // Local storage is optional.
    }
  };

  // Share to Reddit
  const handleShareToReddit = async (rarity: number) => {
    const res = await getJson<{ success: boolean; id?: string }>('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rarity }),
    });
    void refreshAll();
    return res;
  };

  if (authRequired) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <div className="bg-slate-900 border border-amber-500/30 rounded-3xl p-8 shadow-2xl text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Shield className="w-8 h-8 text-amber-300" />
            </div>
            <h1 className="mt-5 text-2xl font-black text-white">Reddit Login Required</h1>
            <p className="mt-2 text-sm text-slate-400">
              You must be logged into a Reddit account to play Infinity Orbs.
            </p>
            <p className="mt-4 text-xs text-slate-500">
              Your save is tied to your Reddit account, so anonymous sessions are not given a shared save.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (!state) {
    if (startupError) {
      return (
        <main className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 p-6">
          <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/10">
              <Shield className="w-7 h-7 text-rose-400" />
            </div>
            <h1 className="mt-5 text-xl font-black text-white">Unable to connect</h1>
            <p className="mt-2 text-sm text-slate-400">{startupError}</p>
            <button
              type="button"
              onClick={() => { setStartupError(null); void refreshAll(); }}
              className="mt-6 rounded-xl bg-purple-600 px-5 py-3 text-sm font-black text-white hover:bg-purple-500"
            >
              Retry
            </button>
          </div>
        </main>
      );
    }

    return (
      <SplashScreen
        ready={false}
        hasProgress={false}
        onEnter={() => undefined}
      />
    );
  }

  if (state.gameBan?.active) {
    const banEnds = state.gameBan.bannedUntil;
    const permanent = banEnds === null;
    const banDate = banEnds ? new Date(banEnds).toLocaleString() : '';

    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <div className="bg-slate-900 border border-rose-500/40 rounded-3xl p-8 shadow-2xl text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
              <Shield className="w-8 h-8 text-rose-400" />
            </div>
            <h1 className="mt-5 text-2xl font-black text-white">Infinity Orbs Account Banned</h1>
            <p className="mt-2 text-sm text-slate-400">
              Access to the game has been disabled for this account.
            </p>

            <div className="mt-6 text-left space-y-3 rounded-2xl bg-slate-950/70 border border-slate-800 p-4">
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500">Reason</div>
                <div className="text-sm text-slate-200">{state.gameBan.reason}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500">Duration</div>
                <div className="text-sm text-rose-300">
                  {permanent ? 'Permanent' : `Until ${banDate}`}
                </div>
              </div>
            </div>

            {isAdmin ? (
              <div className="mt-6">
                <div className="mb-3 text-xs text-emerald-400 font-semibold">
                  Admin access remains available while this account is game-banned.
                </div>
                <button
                  onClick={() => setShowDevModal(true)}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm"
                >
                  Open Admin Console
                </button>
              </div>
            ) : (
              <div className="mt-6 text-xs text-slate-500">
                Contact an Infinity Orbs administrator if you believe this was a mistake.
              </div>
            )}
          </div>
        </div>

        {showDevModal && isAdmin && (
          <DevDebugModal
            onClose={() => setShowDevModal(false)}
            onRefresh={refreshAll}
          />
        )}
      </main>
    );
  }

  // Calculate notification counters
  const today = new Date().toISOString().slice(0, 10);
  const streakReady = state.streak.lastClaimDate !== today;
  const questsReady =
    state.dailyQuests.some(q => !q.claimed && q.progress >= q.target) ||
    state.weeklyQuests.some(q => !q.claimed && q.progress >= q.target);
  const prestigeReady = calculateCosmicDust(state) > 0;

  if (!splashEntered) {
    return (
      <SplashScreen
        ready={true}
        hasProgress={(state.totalRolls ?? 0) > 0}
        highestRarity={state.highestRarity ?? 2}
        totalRolls={state.totalRolls ?? 0}
        onEnter={() => setSplashEntered(true)}
      />
    );
  }

  return (
    <div className="app-shell io-ui min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-purple-600 selection:text-white">
      {/* Sticky Top Header */}
      <Header
        state={state}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(sound.toggle())}
        onOpenOdds={() => setShowOddsModal(true)}
        onOpenFeedback={() => setShowFeedbackModal(true)}
        onOpenChangelog={() => {
          try { window.localStorage.setItem('io-changelog-viewed-version', APP_VERSION); } catch {}
          setChangelogUnread(false);
          setShowChangelogModal(true);
        }}
        changelogUnread={isBeta && changelogUnread}
        onClaimOffline={handleClaimOffline}
        onOpenDevDebug={isAdmin ? () => setShowDevModal(true) : undefined}
        onOpenProfile={() => changeTab('profile')}
        notificationsEnabled={notificationsEnabled}
        onToggleNotifications={() => void handleToggleNotifications()}
      />

      {/* Global Booster Activation Announcement */}
      {boosterAnnouncement && (
        <div className="fixed top-[68px] left-1/2 -translate-x-1/2 z-50 pointer-events-none px-4 w-full flex justify-center animate-in slide-in-from-top-3 fade-in duration-200">
          <div className="max-w-xl rounded-2xl border border-fuchsia-400/40 bg-slate-950/95 px-4 py-3 shadow-2xl shadow-fuchsia-950/30 backdrop-blur-md text-center">
            <div className="text-sm font-black text-fuchsia-200">
              u/{boosterAnnouncement.username} activated {boosterAnnouncement.name} booster for 2 hours!
            </div>
          </div>
        </div>
      )}

      {/* Ephemeral Toast Banner */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div
            className={`px-4 py-3 rounded-2xl text-xs font-bold shadow-2xl border flex items-center gap-2 ${
              toast.type === 'success'
                ? 'bg-slate-900 border-emerald-500/50 text-emerald-300 shadow-emerald-950/50'
                : toast.type === 'warn'
                ? 'bg-slate-900 border-rose-500/50 text-rose-300 shadow-rose-950/50'
                : 'bg-slate-900 border-slate-700 text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span>{toast.msg}</span>
          </div>
        </div>
      )}

      {updateAvailable && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-200">
              <RefreshCw className="w-4 h-4 shrink-0" />
              <span>New update, please refresh!</span>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {developerAnnouncement?.message && (
        <div className="border-b border-cyan-500/20 bg-cyan-500/5 px-4 py-3">
          <div className="max-w-6xl mx-auto flex items-start gap-3">
            <Megaphone className="w-4 h-4 mt-0.5 text-cyan-300 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider font-black text-cyan-300">Developer Announcement</div>
              <div className="mt-1 text-sm text-slate-200 whitespace-pre-wrap break-words">{developerAnnouncement.message}</div>
            </div>
            <button
              onClick={dismissDeveloperAnnouncement}
              className="shrink-0 p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
              title="Dismiss this developer announcement"
              aria-label="Dismiss developer announcement"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showNotificationPrompt && !notificationsEnabled && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-3xl border border-fuchsia-500/30 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider font-black text-fuchsia-300">Notification Setup</div>
                <h2 className="mt-1 text-xl font-black text-white">Keep your Orb alerts coming</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Enable Reddit notifications to get alerts when your offline Orb storage fills up.
                </p>
              </div>
              <button
                onClick={() => setShowNotificationPrompt(false)}
                className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800"
                aria-label="Close notification prompt"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => void handleEnableNotificationsFromPrompt()}
                className="flex-1 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 px-4 py-2.5 text-xs font-black text-white"
              >
                Enable Notifications
              </button>
              <button
                onClick={() => setShowNotificationPrompt(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300"
              >
                Not Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Navigation Bar */}
      <div className="io-nav app-nav bg-slate-900/55 border-b border-slate-800/80 px-4 py-2 sticky top-[57px] z-20 backdrop-blur-md">
        <div className="nav-shell max-w-6xl mx-auto flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">

          <button
            onClick={() => {
              sound.playClick();
              changeTab('roll');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              tab === 'roll'
                ? 'is-active bg-gradient-to-r from-cyan-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
            <span>Roll</span>
          </button>

          <button
            onClick={() => {
              sound.playClick();
              changeTab('upgrades');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap relative ${
              tab === 'upgrades'
                ? 'is-active bg-gradient-to-r from-amber-600 to-yellow-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span>Upgrades</span>
            {featureForTab('upgrades' as ActiveTab) && (state.level ?? 1) < FEATURE_UNLOCK_LEVELS[featureForTab('upgrades' as ActiveTab)!] && <Lock className="w-3 h-3 text-slate-600" />}
          </button>
<button
            onClick={() => {
              sound.playClick();
              changeTab('boosters');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap relative ${
              tab === 'boosters'
                ? 'is-active bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Dices className="w-3.5 h-3.5 text-fuchsia-300" />
            <span>Boosters</span>
            {featureForTab('boosters' as ActiveTab) && (state.level ?? 1) < FEATURE_UNLOCK_LEVELS[featureForTab('boosters' as ActiveTab)!] && (
              <Lock className="w-3 h-3 text-slate-600" />
            )}
          </button>

          <button
            onClick={() => {
              sound.playClick();
              changeTab('altar');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap relative ${
              tab === 'altar'
                ? 'is-active bg-gradient-to-r from-orange-600 to-amber-500 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-orange-400 animate-flame" />
            <span>Altar</span>
            {featureForTab('altar' as ActiveTab) && (state.level ?? 1) < FEATURE_UNLOCK_LEVELS[featureForTab('altar' as ActiveTab)!] && <Lock className="w-3 h-3 text-slate-600" />}
          </button>

          <button
            onClick={() => {
              sound.playClick();
              changeTab('mastery');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap relative ${
              tab === 'mastery'
                ? 'is-active bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Mastery</span>
            {featureForTab('mastery' as ActiveTab) && (state.level ?? 1) < FEATURE_UNLOCK_LEVELS[featureForTab('mastery' as ActiveTab)!] && <Lock className="w-3 h-3 text-slate-600" />}
            {(state.masteryPoints ?? 0) > 0 && (
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>

          <button
            onClick={() => {
              sound.playClick();
              changeTab('collection');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              tab === 'collection'
                ? 'is-active bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Codex</span>
            {featureForTab('collection' as ActiveTab) && (state.level ?? 1) < FEATURE_UNLOCK_LEVELS[featureForTab('collection' as ActiveTab)!] && <Lock className="w-3 h-3 text-slate-600" />}
          </button>

          <button
            onClick={() => {
              sound.playClick();
              changeTab('quests');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap relative ${
              tab === 'quests'
                ? 'is-active bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 text-emerald-400" />
            <span>Quests</span>
            {featureForTab('quests' as ActiveTab) && (state.level ?? 1) < FEATURE_UNLOCK_LEVELS[featureForTab('quests' as ActiveTab)!] && <Lock className="w-3 h-3 text-slate-600" />}
            {(streakReady || questsReady) && (
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>

          <button
            onClick={() => {
              sound.playClick();
              changeTab('social');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              tab === 'social'
                ? 'is-active bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-indigo-400" />
            <span>Guilds & Social</span>
            {featureForTab('social' as ActiveTab) && (state.level ?? 1) < FEATURE_UNLOCK_LEVELS[featureForTab('social' as ActiveTab)!] && <Lock className="w-3 h-3 text-slate-600" />}
          </button>

          <button
            onClick={() => {
              sound.playClick();
              changeTab('profile');
            }}
            className={`nav-tab flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap relative ${
              tab === 'profile'
                ? 'is-active bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
            <span>Prestige</span>
            {featureForTab('profile' as ActiveTab) && (state.level ?? 1) < FEATURE_UNLOCK_LEVELS[featureForTab('profile' as ActiveTab)!] && <Lock className="w-3 h-3 text-slate-600" />}
            {prestigeReady && (
              <span className="w-2 h-2 rounded-full bg-fuchsia-400" />
            )}
          </button>
        </div>
      </div>

      {/* Main Container Content */}
      <main className="app-main flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {tab === 'roll' && (
          <RollSection
            state={state}
            lastOrb={lastOrb}
            lastBatch={lastBatch}
            batchSummary={batchSummary}
            readyAt={readyAt}
            busy={isRolling}
            autoRoll={autoRoll}
            worldEvent={worldEvent}
            onToggleAutoRoll={handleToggleAutoRoll}
            onRoll={handleRoll}
            onOrbFrenzy={handleStartOrbFrenzy}
            frenzyArmed={frenzyArmed}
            onOpenShareModal={r => setShareRarity(r)}
            onNewBest={(orb, prevBest) => setNewBestModalData({ orb, prevBest })}
          />
        )}

        {tab === 'upgrades' && (
          <UpgradesSection
            state={state}
            onBuyUpgrade={handleBuyUpgrade}
            onBuyAllUpgrades={handleBuyAllUpgrades}
            onActivateTurbo={handleActivateTurbo}
            busy={busy}
          />
        )}

        {tab === 'boosters' && (
          <BoostersAndAutomation
            state={state}
            busy={busy}
            globalBoosters={state.globalBoosters ?? {
              luck: { tier: 0, activationProgress: 0, endsAt: 0 },
              speed: { tier: 0, activationProgress: 0, endsAt: 0 },
              crit: { tier: 0, activationProgress: 0, endsAt: 0 },
            }}
            worldEvent={worldEvent}
            onActivateBooster={handleActivatePremiumBooster}
            onActivateGlobalBooster={handleActivateGlobalBooster}
            onBuyAutomation={handleBuyAutomation}
            onClaimCommunityReward={handleClaimCommunityReward}
          />
        )}


        {tab === 'altar' && (
          <AltarSection
            state={state}
            onSacrifice={handleSacrifice}
            busy={busy}
          />
        )}

        {tab === 'mastery' && (
          <MasterySection
            state={state}
            onUpgradeMastery={handleUpgradeMastery}
            busy={busy}
          />
        )}

        {tab === 'collection' && (
          <CollectionSection
            state={state}
            onOpenShareModal={r => setShareRarity(r)}
          />
        )}

        {tab === 'quests' && (
          <QuestsAndStreaks
            state={state}
            onClaimDailyStreak={handleClaimDailyStreak}
            onClaimQuest={handleClaimQuest}
            busy={busy}
          />
        )}

        {tab === 'social' && (
          <GuildsAndSocial
            guilds={guildData.guilds}
            myGuild={guildData.mine}
            leaderboard={leaderboardData}
            leaderboards={leaderboards ?? undefined}
            onRefreshLeaderboards={refreshLeaderboards}
            worldEvent={worldEvent}
            onCreateGuild={handleCreateGuild}
            onJoinGuild={handleJoinGuild}
            onLeaveGuild={handleLeaveGuild}
            onSendMessage={handleSendGuildChat}
            onBuyGuildPerk={handleBuyGuildPerk}
            onToggleGuildTrust={handleToggleGuildTrust}
            onKickGuildMember={handleKickGuildMember}
            onSetGuildTax={handleSetGuildTax}
            playerUsername={state.username ?? ''}
            playerHasShared={Boolean(state.lastShareAt && state.lastShareAt > 0)}
            busy={busy}
          />
        )}

        {tab === 'profile' && (
          <ProfileAndPrestige
            state={state}
            onPrestige={handlePrestige}
            onBuyPrestigeUpgrade={handleBuyPrestigeUpgrade}
            onSynthesizeDust={handleSynthesizeDust}
            onBuyCosmetic={handleBuyCosmetic}
            busy={busy}
          />
        )}
      </main>

      {showFrenzyPrompt && (
        <div className="fixed inset-0 z-[70] io-modal-backdrop flex items-center justify-center p-4">
          <section className="io-modal-card io-frenzy-prompt w-full max-w-md bg-slate-950/95">
            <div className="io-frenzy-prompt-kicker">
              <Flame className="w-4 h-4" />
              Daily Frenzy
            </div>
            <h2 className="mt-2 text-2xl font-black text-white">Post today’s Frenzy</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Charge a public Frenzy from today’s best roll. Your next manual Roll creates the post
              and lets someone else claim it. Every player can claim one Frenzy a day.
            </p>
            <div className="io-frenzy-prompt-reward">
              <div className="text-3xl font-black text-fuchsia-200">+{FRENZY_OWNER_SHARD_REWARD} Shards</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-400">
                When someone claims your Frenzy, you receive these Shards. The reward
                <strong className="text-slate-200"> bypasses the 50 Shard daily cap</strong>.
              </div>
            </div>
            <div className="io-modal-actions">
              <button
                onClick={() => {
                  setShowFrenzyPrompt(false);
                  void handleStartOrbFrenzy();
                }}
                disabled={busy}
                className="io-public-button io-public-button-primary"
              >
                <Flame className="w-4 h-4" />
                {busy ? 'Charging…' : 'Charge My Frenzy'}
              </button>
              <button
                onClick={() => setShowFrenzyPrompt(false)}
                className="io-public-button io-public-button-secondary"
              >
                Not now
              </button>
            </div>
            <div className="mt-3 text-[10px] text-slate-600">
              You can post another Frenzy tomorrow.
            </div>
          </section>
        </div>
      )}

      {/* New Best Ball Celebration Modal */}
      {newBestModalData && (
        <NewBestModal
          orb={newBestModalData.orb}
          prevBest={newBestModalData.prevBest}
          onClose={() => setNewBestModalData(null)}
          onOpenShareModal={r => setShareRarity(r)}
        />
      )}

      {/* Reddit Share Modal (GDD Section 17 & 18) */}
      {shareRarity !== null && (
        <RedditShareModal
          rarity={shareRarity}
          state={state}
          onClose={() => setShareRarity(null)}
          onShare={handleShareToReddit}
        />
      )}

      {/* Global Chat */}
      <GlobalChatWindow username={state.username ?? ''} />

      {/* Changelog */}
      {showChangelogModal && (
        <ChangelogModal onClose={() => setShowChangelogModal(false)} />
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && (
        <FeedbackModal
          onClose={() => setShowFeedbackModal(false)}
          onSubmit={handleSendFeedback}
        />
      )}

      {/* Fair RNG Odds Table Modal (Design Pillar 2.5) */}
      {showOddsModal && (
        <RarityTableModal highestRarity={state.highestRarity || 0} onClose={() => setShowOddsModal(false)} />
      )}

      {/* Admin Console */}
      {showDevModal && isAdmin && (
        <DevDebugModal
          onClose={() => setShowDevModal(false)}
          onRefresh={refreshAll}
          onForceFrenzyPopup={() => {
            setShowFrenzyPrompt(true);
          }}
          onForceRollResult={res => {
            changeTab('roll');
            applyPlayerState(res.state);
            setLastOrb(res.orb);
            setLastBatch(res.batch ?? [res.orb]);
            setBatchSummary({
              totalVal: res.totalRollValue,
              coins: res.coinsGained,
              shards: res.shardsGained,
              xp: res.xpGained,
            });
            setReadyAt(Date.now() + res.rollsRemainingUntilNext);
          }}
        />
      )}
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
