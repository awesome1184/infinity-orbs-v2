import React, { useEffect, useRef, useState } from 'react';
import {
  X, Wrench, Coins, Gem, Sparkles, Zap, RotateCcw, Play, Shield, Megaphone,
  Users, BellRing, Crown, UserCheck,
  Ban, UserX, CheckCircle2, RefreshCw, Flame,
  Database, Wand2, Trash2, Gauge, ListRestart, Save, Power, Copy, ClipboardCheck, Gift, Eye,
} from 'lucide-react';
import { PRESTIGE_UPGRADES, CONTINUUM_TIERS, getOrbInfo, visibleContinuumTiers, formatRarity, formatNumber, frenzyOrbCountForRarity } from '../../shared/game.js';
import type { RollResponse } from '../../shared/game.js';
import { APP_VERSION } from '../../shared/version.js';
import { sound } from '../sound.js';
import { CombatAdminTools } from './CombatAdminTools.js';

let clientOperationSequence = 0;
function createClientOperationId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return prefix + '-' + cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint32Array(4));
    return prefix + '-' + Array.from(bytes, value => value.toString(36)).join('-');
  }
  // This is only a client retry/idempotency key, not an authentication secret.
  // The monotonic fallback still avoids same-millisecond collisions without Math.random.
  clientOperationSequence = (clientOperationSequence + 1) % Number.MAX_SAFE_INTEGER;
  return prefix + '-' + Date.now().toString(36) + '-' + clientOperationSequence.toString(36);
}

function formatPlaytime(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(Number(ms) / 60_000));
  if (totalMinutes < 60) return totalMinutes + 'm';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? hours + 'h ' + minutes + 'm' : hours + 'h';
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? days + 'd ' + remainingHours + 'h' : days + 'd';
}

interface DevDebugModalProps {
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onForceRollResult?: (res: RollResponse) => void;
  onForceFrenzyPopup?: () => void;
}

type GlobalBoosterGrantOperation = {
  operationId: string;
  scope: 'user' | 'online' | 'all';
  amount: number;
  targetUser: string;
};

const GLOBAL_BOOSTER_GRANT_PENDING_STORAGE_KEY = 'infinity-orbs:pending-global-booster-grant:v1';

type AdminContext = {
  username: string | null;
  userId: string | null;
  subredditName: string | null;
  postId: string | null;
  gameModerationVersion?: string;
  gameBan?: {
    active: true;
    bannedAt: number;
    bannedUntil: number | null;
    reason: string;
  } | null;
};

type ImpressionPostType = 'main-game' | 'orb-share' | 'frenzy';
type ImpressionDeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';
type ImpressionTimePoint = {
  bucket: string;
  total: number;
  byType: Record<ImpressionPostType, number>;
};
type ImpressionDashboardData = {
  generatedAt: number;
  total: number;
  trackedPostCount: number;
  byType: Record<ImpressionPostType, number>;
  byDevice: Record<ImpressionDeviceType, number>;
  byTypeAndDevice: Record<ImpressionPostType, Record<ImpressionDeviceType, number>>;
  posts: Array<{ postType: ImpressionPostType; postId: string; impressions: number }>;
  last24Hours: ImpressionTimePoint[];
  last30Days: ImpressionTimePoint[];
};

type StatSpySource = {
  label: string;
  level?: number;
  value: number;
  unit: 'pct' | 'mult' | 'ms' | 'count' | 'chance' | 'capacity' | 'rarity';
  kind: 'base' | 'add' | 'multiply' | 'reduction' | 'special';
  active?: boolean;
  detail?: string;
};

type StatSpyStat = {
  id: string;
  label: string;
  total: number;
  unit: 'pct' | 'mult' | 'ms' | 'count' | 'chance' | 'capacity' | 'rarity';
  detail?: string;
  sources: StatSpySource[];
};

type StatSpyData = {
  username: string;
  userId: string;
  generatedAt: number;
  summary: {
    level: number;
    xp: number;
    totalRolls: number;
    highestRarity: number;
    coins: number;
    shards: number;
    cosmicDust: number;
    prestigeCount: number;
    currentCcu: number;
    fakeCcuBonus: number;
    effectiveCcu: number;
  };
  stats: StatSpyStat[];
  allocations: {
    upgrades: Record<string, number>;
    prestigeUpgrades: Record<string, number>;
    masterySkills: Record<string, number>;
    guildPerks: Record<string, number>;
    globalBoosters: Record<string, { tier?: number; endsAt?: number; activationProgress?: number }>;
    activeBoosters: Record<string, number>;
  };
};

const buttonBase =
  'rounded-xl border text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed';
const panelBase = 'bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3';

const SHORT_PLAYER_LOG_MAX_CHARS = 12_000;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function shortNumber(value: unknown, maxDecimals = 3): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?';
  return Number(n.toFixed(maxDecimals)).toLocaleString('en-US', {
    useGrouping: false,
    maximumFractionDigits: maxDecimals,
  });
}

function shortRarity(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? formatRarity(n) : '?';
}

function formatStatSpyValue(value: number, unit: StatSpySource['unit']): string {
  if (!Number.isFinite(value)) return '?';
  switch (unit) {
    case 'pct':
    case 'chance':
      return (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
    case 'mult':
      return value.toFixed(3) + '×';
    case 'ms':
      return formatNumber(Math.round(value)) + ' ms';
    case 'count':
    case 'capacity':
      return formatNumber(Math.round(value));
    case 'rarity':
      return formatRarity(Math.round(value));
  }
}

function formatStatSpyTotal(value: number, unit: StatSpyStat['unit']): string {
  switch (unit) {
    case 'pct':
    case 'chance':
      return (value * 100).toFixed(2) + '%';
    case 'mult':
      return value.toFixed(3) + '×';
    case 'ms':
      return formatNumber(Math.round(value)) + ' ms';
    case 'count':
    case 'capacity':
      return formatNumber(Math.round(value));
    case 'rarity':
      return formatRarity(Math.round(value));
  }
}

function compactTimestamp(timestamp: unknown, baseTimestamp: number): string {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !Number.isFinite(baseTimestamp)) return '+?s';
  const seconds = Math.max(0, Math.round((ts - baseTimestamp) / 1000));
  return '+' + seconds.toLocaleString('en-US') + 's';
}

function shortenPlayerSpyLogs(
  username: string,
  userId: string,
  logs: Array<Record<string, unknown>>,
): string {
  const baseTimestamp = Number(logs[0]?.timestamp ?? 0);
  const meaningfulLogs = logs.filter(log => log.event !== 'roll-activation');

  const rollStats = {
    count: 0,
    totalCoins: 0,
    totalShards: 0,
    totalXp: 0,
    totalCrits: 0,
    totalUnique: 0,
    best: 0,
    min: Infinity,
    max: 0,
  };

  const standardLines = meaningfulLogs.map((log) => {
    const event = String(log.event ?? 'event');
    const details = recordValue(log.details);
    const stamp = compactTimestamp(log.timestamp, baseTimestamp);

    if (event === 'roll') {
      rollStats.count += Number(details.processedRollCount ?? 0) || 0;
      rollStats.totalCoins += Number(details.coinsGained ?? 0) || 0;
      rollStats.totalShards += Number(details.shardsGained ?? 0) || 0;
      rollStats.totalXp += Number(details.xpGained ?? 0) || 0;
      rollStats.totalCrits += Number(details.criticalRolls ?? 0) || 0;
      rollStats.totalUnique += Number(details.uniqueGained ?? 0) || 0;

      const best = Number(details.bestRarity ?? 0) || 0;
      rollStats.best = Math.max(rollStats.best, best);
      if (best > 0) {
        rollStats.min = Math.min(rollStats.min, best);
        rollStats.max = Math.max(rollStats.max, best);
      }

      const samples = Array.isArray(details.sampleRarities)
        ? details.sampleRarities.map(value => shortNumber(value, 0)).join(',')
        : '';

      return [
        stamp,
        'ROLLx' + String(details.processedRollCount ?? details.requestedRollCount ?? '?'),
        samples ? 'R[' + samples + ']' : '',
        'B' + shortRarity(details.bestRarity),
        'C+' + shortNumber(details.coinsGained, 0),
        'X+' + shortNumber(details.xpGained, 0),
        'S+' + shortNumber(details.shardsGained, 1),
        'K+' + shortNumber(details.criticalRolls, 0),
        'U+' + shortNumber(details.uniqueGained, 0),
        'L' + shortNumber(details.luckMultiplier),
        'Lv' + shortNumber(details.level, 0),
      ].filter(Boolean).join(' | ');
    }

    if (event === 'upgrade-purchase') {
      return [
        stamp,
        'UP',
        String(details.upgrade ?? '?'),
        String(details.levelBefore ?? '?') + '>' + String(details.levelAfter ?? '?'),
        'C-' + shortNumber(details.cost, 0),
      ].join(' | ');
    }

    if (event === 'altar-sacrifice') {
      return [
        stamp,
        'ALTAR',
        'C-' + shortNumber(details.coinsSacrificed, 0),
        'S-' + shortNumber(details.shardsSacrificed, 0),
        details.luckSurgeExtended ? 'SURGE+' : '',
        details.altarLeveledUp ? 'LEVEL UP' : '',
        details.snapshot ? 'Lv' + shortNumber(recordValue(details.snapshot).level, 0) : '',
      ].filter(Boolean).join(' | ');
    }

    if (event === 'quest-claim') {
      return [
        stamp,
        'QUEST',
        String(details.questId ?? details.type ?? '?'),
        'C+' + shortNumber(details.rewardCoins, 0),
        'S+' + shortNumber(details.rewardShards, 0),
        'T+' + shortNumber(details.rewardTokens, 0),
      ].join(' | ');
    }

    return [
      stamp,
      event.replace(/-/g, '_').toUpperCase(),
      ...Object.entries(details)
        .filter(([key]) => !['snapshot', 'globalBoosters', 'before', 'after', 'userId'].includes(key))
        .slice(0, 5)
        .map(([key, value]) => {
          if (value === null || value === undefined) return '';
          if (typeof value === 'object') return key + '=' + JSON.stringify(value);
          return key + '=' + String(value);
        })
        .filter(Boolean),
    ].join(' | ');
  });

  const header = [
    'Infinity Orbs Player Spy (shortened)',
    'u/' + (username.replace(/^u\//i, '') || '?') + (userId ? ' · ID ' + userId.slice(-10) : ''),
    'Events ' + logs.length + ' · Duplicate roll-activation entries and repeated state snapshots removed.',
    'ROLL: t=elapsed seconds, R=sample rarities, B=best, C=coins, X=XP, S=shards, K=crits, U=uniques, L=luck multiplier, Lv=level.',
    '',
  ].join('\n');

  const standard = header + standardLines.join('\n');
  if (standard.length <= SHORT_PLAYER_LOG_MAX_CHARS) return standard;

  const ultraLines = meaningfulLogs.map((log) => {
    const event = String(log.event ?? 'event');
    const details = recordValue(log.details);
    const stamp = compactTimestamp(log.timestamp, baseTimestamp);

    if (event === 'roll') {
      const parts = [
        stamp,
        'R' + shortRarity(details.bestRarity),
        'C' + shortNumber(details.coinsGained, 0),
        'X' + shortNumber(details.xpGained, 0),
      ];
      if (Number(details.shardsGained ?? 0)) parts.push('S' + shortNumber(details.shardsGained, 0));
      if (Number(details.criticalRolls ?? 0)) parts.push('K' + shortNumber(details.criticalRolls, 0));
      if (Number(details.uniqueGained ?? 0)) parts.push('U' + shortNumber(details.uniqueGained, 0));
      return parts.join(' ');
    }

    if (event === 'upgrade-purchase') {
      return stamp + ' UP ' + String(details.upgrade ?? '?') + ' ' + String(details.levelBefore ?? '?') + '>' + String(details.levelAfter ?? '?') + ' C-' + shortNumber(details.cost, 0);
    }

    if (event === 'altar-sacrifice') {
      return stamp + ' ALTAR C-' + shortNumber(details.coinsSacrificed, 0) + ' S-' + shortNumber(details.shardsSacrificed, 0) + (details.luckSurgeExtended ? ' SURGE+' : '');
    }

    if (event === 'quest-claim') {
      return stamp + ' QUEST ' + String(details.questId ?? details.type ?? '?') + ' C+' + shortNumber(details.rewardCoins, 0) + ' S+' + shortNumber(details.rewardShards, 0) + ' T+' + shortNumber(details.rewardTokens, 0);
    }

    return stamp + ' ' + event;
  });

  const ultraHeader = [
    'Infinity Orbs Player Spy (ultra-short)',
    'u/' + (username.replace(/^u\//i, '') || '?') + ' · ' + logs.length + ' events · activation duplicates/snapshots removed.',
    'ROLL: t R=best rarity C=coins X=XP; S=shards K=crits U=uniques only when nonzero.',
    '',
  ].join('\n');

  const ultra = ultraHeader + ultraLines.join('\n');
  if (ultra.length <= SHORT_PLAYER_LOG_MAX_CHARS) return ultra;

  const ultraText = ultraLines.join('\n');
  const keepChars = Math.max(1000, Math.floor((SHORT_PLAYER_LOG_MAX_CHARS - ultraHeader.length - 260) / 2));
  const first = ultraText.slice(0, keepChars);
  const last = ultraText.slice(-keepChars);
  const middleStart = first.split('\n').length;
  const middleEnd = Math.max(middleStart, ultraLines.length - last.split('\n').length);
  const omittedCount = Math.max(0, middleEnd - middleStart);
  const summary = [
    '',
    '... middle omitted to stay under ' + SHORT_PLAYER_LOG_MAX_CHARS.toLocaleString() + ' characters ...',
    'Rolls: ' + rollStats.count + ' · best: ' + (rollStats.best || '?') + ' · min: ' + (rollStats.min === Infinity ? '?' : rollStats.min) + ' · max: ' + (rollStats.max || '?'),
    'Rewards in loaded logs: C+' + rollStats.totalCoins.toLocaleString() + ' X+' + rollStats.totalXp.toLocaleString() + ' S+' + rollStats.totalShards.toLocaleString() + ' K+' + rollStats.totalCrits.toLocaleString() + ' U+' + rollStats.totalUnique.toLocaleString(),
    '',
  ].join('\n');

  return (ultraHeader + first + '\n...[' + omittedCount.toLocaleString() + ' compact events omitted]...\n' + last + summary).slice(0, SHORT_PLAYER_LOG_MAX_CHARS);
}


export const DevDebugModal: React.FC<DevDebugModalProps> = ({
  onClose,
  onRefresh,
  onForceRollResult,
  onForceFrenzyPopup,
}) => {
  const [customRarity, setCustomRarity] = useState('100000');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [contextInfo, setContextInfo] = useState<AdminContext | null>(null);

  const [targetUser, setTargetUser] = useState('');
  const [pendingWipe, setPendingWipe] = useState<{ action: 'wipe-game' | 'wipe-and-ban' | 'wipe-and-unban'; username: string } | null>(null);
  const [banDuration, setBanDuration] = useState('permanent');
  const [banReason, setBanReason] = useState('Infinity Orbs admin action');
  const [announcementText, setAnnouncementText] = useState('');
  const [announcementLoaded, setAnnouncementLoaded] = useState(false);
  const [paymentLogs, setPaymentLogs] = useState<Array<Record<string, unknown>>>([]);
  const [paymentLogsLoading, setPaymentLogsLoading] = useState(false);
  const [saveLogs, setSaveLogs] = useState<Array<Record<string, unknown>>>([]);
  const [saveLogsLoading, setSaveLogsLoading] = useState(false);
  const [globalBooster, setGlobalBooster] = useState('luck');
  const [globalTier, setGlobalTier] = useState('1');
  const [globalMinutes, setGlobalMinutes] = useState('30');
  const [globalBoosterCreditAmount, setGlobalBoosterCreditAmount] = useState('1');
  const [globalBoosterTargetUser, setGlobalBoosterTargetUser] = useState('');
  const [globalBoosterGrantLoading, setGlobalBoosterGrantLoading] = useState(false);
  const globalBoosterGrantOperationRef = useRef<GlobalBoosterGrantOperation | null>(null);
  const [globalBoosterLogs, setGlobalBoosterLogs] = useState<Array<Record<string, unknown>>>([]);
  const [globalBoosterLogsLoading, setGlobalBoosterLogsLoading] = useState(false);
  const [globalBoosterActivationLog, setGlobalBoosterActivationLog] = useState<Array<{
    timestamp: number;
    userId: string;
    username: string;
    boosterId: 'luck' | 'speed' | 'crit';
    boosterName: string;
    usedCredit: boolean;
    tier: number;
    endsAt: number;
  }>>([]);
  const [globalBoosterActivationLogLoading, setGlobalBoosterActivationLogLoading] = useState(false);
  const [ccuStats, setCcuStats] = useState<{
    current: number;
    last24Hours: number;
    last7Days: number;
    last30Days: number;
    allTime: number;
    fakeCcuBonus: number;
    effectiveLuckCcu: number;
  } | null>(null);
  const [ccuLoading, setCcuLoading] = useState(false);
  const [impressionStats, setImpressionStats] = useState<ImpressionDashboardData | null>(null);
  const [impressionsLoading, setImpressionsLoading] = useState(false);
  const [impressionsError, setImpressionsError] = useState('');
  const impressionsLoadLockRef = useRef(false);
  const [fakeCcuInput, setFakeCcuInput] = useState('0');
  const [pushTestLoading, setPushTestLoading] = useState(false);

  const [fullTestRunning, setFullTestRunning] = useState(false);
  const [fullTestCurrentAction, setFullTestCurrentAction] = useState('');
  const [fullTestLogs, setFullTestLogs] = useState<Array<{
    action: string;
    status: 'PASS' | 'FAIL' | 'SKIP';
    durationMs: number;
    detail: string;
  }>>([]);

  const [guildChatSpy, setGuildChatSpy] = useState<Array<{
    id: string;
    name: string;
    tag: string;
    memberCount: number;
    messages: Array<{
      id: string;
      username: string;
      userId?: string;
      text: string;
      timestamp: number;
      isSystem?: boolean;
    }>;
  }>>([]);
  const [guildChatMutes, setGuildChatMutes] = useState<Array<{
    userId: string;
    username: string;
    mutedAt: number;
    mutedBy: string;
  }>>([]);
  const [guildChatSpyLoading, setGuildChatSpyLoading] = useState(false);
  const [guildChatSpyLoaded, setGuildChatSpyLoaded] = useState(false);
  const [guildChatMuteUser, setGuildChatMuteUser] = useState('');
  const [guildAuthorityGuildId, setGuildAuthorityGuildId] = useState('');

  type ChatReport = {
    reportId: string;
    scope: 'Global Chat' | 'Guild Chat';
    messageId: string;
    author: string;
    authorUserId: string;
    reporter: string;
    reporterUserId: string;
    text: string;
    reportedAt: number;
    readAt?: number;
    status?: 'pending' | 'sent';
  };
  const [chatReports, setChatReports] = useState<ChatReport[]>([]);
  const [chatReportsUnread, setChatReportsUnread] = useState(0);
  const [chatReportsLoading, setChatReportsLoading] = useState(false);

  const [frenzyRarity, setFrenzyRarity] = useState('');
  const [frenzyPostId, setFrenzyPostId] = useState('');
  const [frenzyPostUrl, setFrenzyPostUrl] = useState('');

  const [stateInputs, setStateInputs] = useState({
    coins: '',
    shards: '',
    dust: '',
    xp: '',
    totalRolls: '',
    highestRarity: '',
    collectionValue: '',
    offlineRolls: '',
    currentRunRolls: '',
    rollsSinceBest: '',
  });



  const sendAdminAction = async (endpoint: string, body: any = {}, refresh = true, successMessage = 'Success.') => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Admin request failed');
      sound.playClick();
      setMessage(successMessage);
      if (refresh) await onRefresh();
      return data;
    } catch (e: any) {
      setMessage(`Error: ${e?.message || 'Admin request failed'}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const getBannedUsers = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/dev/moderation/banned');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load banned users.');
      setBannedUsers(data.users ?? []);
      setMessage(`Loaded ${(data.users ?? []).length} banned users.`);
    } catch (e: any) {
      setMessage(`Error: ${e?.message || 'Could not load banned users.'}`);
    } finally {
      setLoading(false);
    }
  };

  const [playerList, setPlayerList] = useState<Array<{
    userId: string;
    username: string;
    firstSeenAt: number;
    lastSeenAt: number;
    active: boolean;
    level: number;
    xp: number;
    totalRolls: number;
    highestRarity: number;
    coins: number;
    shards: number;
    playtimeMs: number;
    currentSessionMs: number;
    clientVersion: string | null;
    isLatestVersion: boolean;
  }>>([]);
  const [playerActivity, setPlayerActivity] = useState({
    dailyActiveUsers: 0,
    weeklyActiveUsers: 0,
    monthlyActiveUsers: 0,
  });
  const [bannedUsers, setBannedUsers] = useState<Array<{
    username: string;
    userId?: string;
    bannedAt: number;
    bannedUntil: number | null;
    reason: string;
  }>>([]);
  const [statSpy, setStatSpy] = useState<StatSpyData | null>(null);
  const [statSpyUsername, setStatSpyUsername] = useState('');
  const [statSpyLoading, setStatSpyLoading] = useState(false);

  const [playerSpyLogs, setPlayerSpyLogs] = useState<Array<Record<string, unknown>>>([]);
  const [playerSpyUsername, setPlayerSpyUsername] = useState('');
  const [playerSpyUserId, setPlayerSpyUserId] = useState('');
  const [playerSpyLoading, setPlayerSpyLoading] = useState(false);
  const [playerSpyShortened, setPlayerSpyShortened] = useState(false);

  const loadCcuStats = async () => {
    setCcuLoading(true);
    try {
      const res = await fetch('/api/dev/ccu', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load CCU statistics.');
      setCcuStats(data);
      setMessage('CCU statistics refreshed.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not load CCU statistics.'));
    } finally {
      setCcuLoading(false);
    }
  };

  const loadImpressions = async () => {
    if (impressionsLoadLockRef.current) return;
    impressionsLoadLockRef.current = true;
    setImpressionsLoading(true);
    setImpressionsError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch('/api/dev/impressions', { cache: 'no-store', signal: controller.signal });
      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
          ? raw.error
          : 'Could not load impression analytics.';
        throw new Error(message);
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Impression analytics returned invalid data.');
      const data = raw as Partial<ImpressionDashboardData>;
      if (!Number.isSafeInteger(data.total) || Number(data.total) < 0 ||
          !Array.isArray(data.posts) || !Array.isArray(data.last24Hours) || !Array.isArray(data.last30Days) ||
          !data.byType || !data.byDevice || !data.byTypeAndDevice) {
        throw new Error('Impression analytics returned an incomplete dashboard. Refresh and retry.');
      }
      setImpressionStats(data as ImpressionDashboardData);
    } catch (error) {
      setImpressionsError(error instanceof Error && error.name === 'AbortError'
        ? 'Impression analytics timed out. Refresh to retry.'
        : error instanceof Error ? error.message : 'Could not load impression analytics.');
    } finally {
      window.clearTimeout(timeout);
      impressionsLoadLockRef.current = false;
      setImpressionsLoading(false);
    }
  };

  useEffect(() => {
    void loadCcuStats();
  }, []);

  useEffect(() => {
    void loadImpressions();
  }, []);

  const setFakeCcu = async (bonus: number) => {
    setCcuLoading(true);
    try {
      const res = await fetch('/api/dev/ccu/fake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bonus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not set fake CCU.');
      setMessage(`Fake CCU set to +${formatNumber(Number(data.fakeCcuBonus ?? bonus))}.`);
      await loadCcuStats();
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not set fake CCU.'));
    } finally {
      setCcuLoading(false);
    }
  };

  const sendPushTest = async () => {
    setPushTestLoading(true);
    try {
      const res = await fetch('/api/dev/push-test', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to send push test notification.');
      setMessage('Push test notification sent. Check your Reddit notifications.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Failed to send push test notification.'));
    } finally {
      setPushTestLoading(false);
    }
  };

  const loadSaveLogs = async () => {
    setSaveLogsLoading(true);
    try {
      const username = playerSpyUsername.trim().replace(/^u\//i, '');
      const suffix = username ? '&username=' + encodeURIComponent(username) : '';
      const res = await fetch('/api/dev/save-logs?limit=500' + suffix, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load save diagnostics.');
      setSaveLogs(Array.isArray(data.logs) ? data.logs : []);
      setMessage('Loaded ' + (Array.isArray(data.logs) ? data.logs.length : 0) + ' save diagnostic entries' + (username ? ' for u/' + username : '') + '.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not load save diagnostics.'));
    } finally {
      setSaveLogsLoading(false);
    }
  };

  const copySaveLogs = async () => {
    const serialized = JSON.stringify(saveLogs, null, 2);
    try {
      await navigator.clipboard.writeText(serialized);
      setMessage('Save diagnostics copied to clipboard.');
    } catch {
      const textarea = document.getElementById('save-debug-log-copy') as HTMLTextAreaElement | null;
      if (!textarea) {
        setMessage('Could not access the clipboard.');
        return;
      }
      textarea.focus();
      textarea.select();
      setMessage('Clipboard access was blocked. The save diagnostics are selected; copy them manually.');
    }
  };

  const clearSaveLogs = async () => {
    setSaveLogsLoading(true);
    try {
      const res = await fetch('/api/dev/save-logs/clear', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not clear save diagnostics.');
      setSaveLogs([]);
      setMessage('Save diagnostics cleared.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not clear save diagnostics.'));
    } finally {
      setSaveLogsLoading(false);
    }
  };

  const loadPaymentLogs = async () => {
    setPaymentLogsLoading(true);
    try {
      const res = await fetch('/api/dev/payment-logs?limit=200');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load payment logs.');
      setPaymentLogs(Array.isArray(data.logs) ? data.logs : []);
      setMessage('Loaded ' + (Array.isArray(data.logs) ? data.logs.length : 0) + ' payment log entries.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not load payment logs.'));
    } finally {
      setPaymentLogsLoading(false);
    }
  };

  const copyPaymentLogs = async () => {
    const text = JSON.stringify(paymentLogs, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Payment logs copied to clipboard.');
    } catch {
      const textarea = document.getElementById('payment-debug-log-copy') as HTMLTextAreaElement | null;
      if (!textarea) {
        setMessage('Could not access the clipboard.');
        return;
      }
      textarea.focus();
      textarea.select();
      setMessage('Clipboard access was blocked. The logs are selected; copy them manually.');
    }
  };

  const loadStatSpy = async () => {
    const username = statSpyUsername.trim().replace(/^u\//i, '');
    if (!username) {
      setMessage('Enter a Reddit username first.');
      return;
    }

    setStatSpyLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/dev/stat-spy?username=' + encodeURIComponent(username), {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load Stat Spy data.');
      setStatSpy(data as StatSpyData);
      setStatSpyUsername(data.username ?? username);
      setMessage('Loaded full calculated stat breakdown for u/' + (data.username ?? username) + '.');
    } catch (e: any) {
      setStatSpy(null);
      setMessage('Error: ' + (e?.message || 'Could not load Stat Spy data.'));
    } finally {
      setStatSpyLoading(false);
    }
  };

  const loadPlayerSpy = async () => {
    const username = playerSpyUsername.trim().replace(/^u\//i, '');
    if (!username) {
      setMessage('Enter a Reddit username first.');
      return;
    }

    setPlayerSpyLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/dev/player-spy?username=' + encodeURIComponent(username) + '&limit=500', {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load Player Spy logs.');
      setPlayerSpyUsername(data.username ?? username);
      setPlayerSpyUserId(data.userId ?? '');
      setPlayerSpyLogs(Array.isArray(data.logs) ? data.logs : []);
      setPlayerSpyShortened(false);
      setMessage('Loaded ' + (Array.isArray(data.logs) ? data.logs.length : 0) + ' Player Spy events for u/' + (data.username ?? username) + '.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not load Player Spy logs.'));
      setPlayerSpyLogs([]);
      setPlayerSpyUserId('');
    } finally {
      setPlayerSpyLoading(false);
    }
  };

  const fullPlayerSpyLog = () => JSON.stringify({
    username: playerSpyUsername.trim().replace(/^u\//i, ''),
    userId: playerSpyUserId || null,
    exportedAt: new Date().toISOString(),
    logCount: playerSpyLogs.length,
    logs: playerSpyLogs,
  }, null, 2);

  const shortenedPlayerSpyLog = () => shortenPlayerSpyLogs(
    playerSpyUsername.trim().replace(/^u\//i, ''),
    playerSpyUserId,
    playerSpyLogs,
  );

  const copyPlayerSpy = async () => {
    const serialized = playerSpyShortened ? shortenedPlayerSpyLog() : fullPlayerSpyLog();
    try {
      await navigator.clipboard.writeText(serialized);
      setMessage(
        playerSpyShortened
          ? 'Shortened Player Spy log copied. It is capped for chat-friendly size.'
          : 'Player Spy logs copied to clipboard. You may paste the JSON into chat for analysis.',
      );
    } catch {
      const textarea = document.getElementById('player-spy-log-copy') as HTMLTextAreaElement | null;
      if (!textarea) {
        setMessage('Could not access the clipboard.');
        return;
      }
      textarea.focus();
      textarea.select();
      setMessage('Clipboard access was blocked. The Player Spy log is selected; copy it manually.');
    }
  };

  const clearPlayerSpy = async () => {
    const username = playerSpyUsername.trim().replace(/^u\//i, '');
    if (!username) {
      setMessage('Enter a Reddit username first.');
      return;
    }
    if (!window.confirm(`Clear all stored Player Spy logs for u/${username}?`)) return;

    setPlayerSpyLoading(true);
    try {
      const res = await fetch('/api/dev/player-spy/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not clear Player Spy logs.');
      setPlayerSpyLogs([]);
      setMessage('Player Spy logs cleared.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not clear Player Spy logs.'));
    } finally {
      setPlayerSpyLoading(false);
    }
  };

  const loadChatReports = async (quiet = false) => {
    if (!quiet) setChatReportsLoading(true);
    try {
      const res = await fetch('/api/dev/chat-reports', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load chat reports.');
      const reports = Array.isArray(data.reports) ? data.reports as ChatReport[] : [];
      setChatReports(reports);
      setChatReportsUnread(Number(data.unreadCount) || 0);
    } catch (e: any) {
      if (!quiet) setMessage('Error: ' + (e?.message || 'Could not load chat reports.'));
    } finally {
      if (!quiet) setChatReportsLoading(false);
    }
  };

  const markChatReportRead = async (reportId: string) => {
    try {
      const res = await fetch('/api/dev/chat-reports/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not mark chat report as read.');
      setChatReports(prev => prev.map(report =>
        report.reportId === reportId ? { ...report, readAt: Date.now() } : report,
      ));
      setChatReportsUnread(prev => Math.max(0, prev - 1));
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not mark chat report as read.'));
    }
  };

  useEffect(() => {
    void loadChatReports();
    const interval = window.setInterval(() => void loadChatReports(true), 5000);
    return () => window.clearInterval(interval);
  }, []);

  const loadGuildChatSpy = async (quiet = false) => {
    if (!quiet) setGuildChatSpyLoading(true);
    try {
      const res = await fetch('/api/dev/guild-chat-spy');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load Guild Chat spy data.');
      setGuildChatSpy(Array.isArray(data.guilds) ? data.guilds : []);
      setGuildChatMutes(Array.isArray(data.mutes) ? data.mutes : []);
      setGuildChatSpyLoaded(true);
      if (!quiet) {
        const guilds = Array.isArray(data.guilds) ? data.guilds : [];
        const messageCount = guilds.reduce(
          (total: number, guild: { messages?: unknown[] }) =>
            total + (Array.isArray(guild.messages) ? guild.messages.length : 0),
          0,
        );
        setMessage('Loaded ' + guilds.length + ' guilds and ' + messageCount + ' stored chat messages.');
      }
    } catch (e: any) {
      if (!quiet) setMessage('Error: ' + (e?.message || 'Could not load Guild Chat spy data.'));
    } finally {
      if (!quiet) setGuildChatSpyLoading(false);
    }
  };

  useEffect(() => {
    if (!guildChatSpyLoaded) return;
    const interval = window.setInterval(() => {
      void loadGuildChatSpy(true);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [guildChatSpyLoaded]);

  const toggleGuildChatMute = async (username: string, currentlyMuted: boolean) => {
    const cleanName = username.trim().replace(/^u\//i, '');
    const data = await sendAdminAction(
      currentlyMuted ? '/api/dev/guild-chat/unmute' : '/api/dev/guild-chat/mute',
      { username: cleanName },
      false,
      currentlyMuted
        ? 'Unmuted u/' + cleanName + ' from Guild Chat.'
        : 'Muted u/' + cleanName + ' in Guild Chat.',
    );
    if (data) await loadGuildChatSpy(true);
  };

  const grantFreeGlobalBoosters = async (scope: 'user' | 'online' | 'all') => {
    const amount = Math.max(1, Math.min(1_000_000, Math.floor(Number(globalBoosterCreditAmount) || 1)));
    const cleanTargetUser = globalBoosterTargetUser.trim().replace(/^u\//i, '');
    if (scope === 'user' && !cleanTargetUser) {
      setMessage('Enter a Reddit username first.');
      return;
    }

    if (globalBoosterGrantLoading) return;
    let storedOperation: GlobalBoosterGrantOperation | null = null;
    if (!globalBoosterGrantOperationRef.current) {
      try {
        const rawPending = typeof sessionStorage !== 'undefined'
          ? sessionStorage.getItem(GLOBAL_BOOSTER_GRANT_PENDING_STORAGE_KEY)
          : null;
        const parsedPending = rawPending ? JSON.parse(rawPending) : null;
        if (
          parsedPending &&
          typeof parsedPending.operationId === 'string' &&
          ['user', 'online', 'all'].includes(parsedPending.scope) &&
          Number.isSafeInteger(parsedPending.amount) &&
          parsedPending.amount >= 1 &&
          parsedPending.amount <= 1_000_000 &&
          typeof parsedPending.targetUser === 'string'
        ) {
          storedOperation = parsedPending as GlobalBoosterGrantOperation;
        }
      } catch {
        // Browser storage may be disabled; the in-memory receipt still prevents
        // duplicate retries while the modal remains mounted.
      }
    }
    const previousOperation = globalBoosterGrantOperationRef.current ?? storedOperation;
    const sameOperation =
      previousOperation?.scope === scope &&
      previousOperation.amount === amount &&
      previousOperation.targetUser.toLowerCase() === (scope === 'user' ? cleanTargetUser.toLowerCase() : '');
    const operation = sameOperation && previousOperation
      ? previousOperation
      : {
          operationId: createClientOperationId('gb'),
          scope,
          amount,
          targetUser: scope === 'user' ? cleanTargetUser : '',
        };
    // Keep the same id after network or partial-batch failures. The server stores
    // per-player receipts, so retrying can resume without double-granting successes.
    globalBoosterGrantOperationRef.current = operation;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(GLOBAL_BOOSTER_GRANT_PENDING_STORAGE_KEY, JSON.stringify(operation));
      }
    } catch {
      // The durable server receipt remains authoritative even if browser storage is unavailable.
    }

    setGlobalBoosterGrantLoading(true);
    setMessage('');
    try {
      const body: Record<string, unknown> = { scope, amount, operationId: operation.operationId };
      if (scope === 'user') body.username = cleanTargetUser;
      const res = await fetch('/api/dev/global-booster-credits/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.partial) {
        await onRefresh().catch(() => {});
        const failed = Array.isArray(data.failures) ? data.failures.length : 0;
        setMessage(
          'Partial batch: ' + Number(data.affectedUsers ?? 0).toLocaleString() +
          ' of ' + Number(data.attemptedUsers ?? 0).toLocaleString() +
          ' players processed; ' + failed.toLocaleString() +
          ' failed. Click the same scope/amount again to retry safely. Completed grants will not be duplicated.',
        );
        return;
      }
      if (!res.ok || data?.ok !== true) {
        throw new Error(data?.error || 'Failed to grant free Global Booster credits.');
      }

      globalBoosterGrantOperationRef.current = null;
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(GLOBAL_BOOSTER_GRANT_PENDING_STORAGE_KEY);
        }
      } catch {
        // Storage cleanup must not turn a committed grant into a reported failure.
      }
      sound.playClick();
      const affectedUsers = Number(data?.affectedUsers ?? (scope === 'user' ? 1 : 0));
      setMessage(
        scope === 'user'
          ? (data?.results?.[0]?.alreadyApplied
            ? 'This grant operation was already completed for u/' + cleanTargetUser + '.'
            : 'Granted ' + amount.toLocaleString() + ' free Global Booster activation' + (amount === 1 ? '' : 's') + ' to u/' + cleanTargetUser + '.')
          : scope === 'online'
            ? 'Granted ' + amount.toLocaleString() + ' free Global Booster activation' + (amount === 1 ? '' : 's') + ' to ' + affectedUsers.toLocaleString() + ' online player' + (affectedUsers === 1 ? '' : 's') + '.'
            : 'Granted ' + amount.toLocaleString() + ' free Global Booster activation' + (amount === 1 ? '' : 's') + ' to ' + affectedUsers.toLocaleString() + ' registered player' + (affectedUsers === 1 ? '' : 's') + '.',
      );
      await onRefresh().catch(() => {});
      if (scope === 'user') setGlobalBoosterTargetUser('');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Failed to grant free Global Booster credits.') + ' Retrying this same operation is safe.');
    } finally {
      setGlobalBoosterGrantLoading(false);
    }
  };
  const loadGlobalBoosterActivationLog = async (quiet = false) => {
    if (!quiet) setGlobalBoosterActivationLogLoading(true);
    try {
      const res = await fetch('/api/dev/global-boosters-log?limit=100', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load Global Boosters Log.');
      setGlobalBoosterActivationLog(Array.isArray(data.logs) ? data.logs : []);
    } catch (e: any) {
      if (!quiet) setMessage('Error: ' + (e?.message || 'Could not load Global Boosters Log.'));
    } finally {
      if (!quiet) setGlobalBoosterActivationLogLoading(false);
    }
  };

  const clearGlobalBoosterActivationLog = async () => {
    setGlobalBoosterActivationLogLoading(true);
    try {
      const res = await fetch('/api/dev/global-boosters-log/clear', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not clear Global Boosters Log.');
      setGlobalBoosterActivationLog([]);
      setMessage('Global Boosters Log cleared.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not clear Global Boosters Log.'));
    } finally {
      setGlobalBoosterActivationLogLoading(false);
    }
  };

  const loadGlobalBoosterLogs = async () => {
    setGlobalBoosterLogsLoading(true);
    try {
      const res = await fetch('/api/dev/global-booster-logs?limit=300');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load Global Booster logs.');
      setGlobalBoosterLogs(Array.isArray(data.logs) ? data.logs : []);
      setMessage('Loaded ' + (Array.isArray(data.logs) ? data.logs.length : 0) + ' Global Booster log entries.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not load Global Booster logs.'));
    } finally {
      setGlobalBoosterLogsLoading(false);
    }
  };

  const copyGlobalBoosterLogs = async () => {
    const text = JSON.stringify(globalBoosterLogs, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Global Booster logs copied to clipboard.');
    } catch {
      const textarea = document.getElementById('global-booster-debug-log-copy') as HTMLTextAreaElement | null;
      if (!textarea) {
        setMessage('Could not access the clipboard.');
        return;
      }
      textarea.focus();
      textarea.select();
      setMessage('Clipboard access was blocked. The logs are selected; copy them manually.');
    }
  };

  const clearGlobalBoosterLogs = async () => {
    setGlobalBoosterLogsLoading(true);
    try {
      const res = await fetch('/api/dev/global-booster-logs/clear', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not clear Global Booster logs.');
      setGlobalBoosterLogs([]);
      setMessage('Global Booster logs cleared.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not clear Global Booster logs.'));
    } finally {
      setGlobalBoosterLogsLoading(false);
    }
  };

  useEffect(() => {
    void loadGlobalBoosterActivationLog(true);
    const interval = window.setInterval(() => {
      void loadGlobalBoosterActivationLog(true);
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const clearPaymentLogs = async () => {
    setPaymentLogsLoading(true);
    try {
      const res = await fetch('/api/dev/payment-logs/clear', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not clear payment logs.');
      setPaymentLogs([]);
      setMessage('Payment debug logs cleared.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not clear payment logs.'));
    } finally {
      setPaymentLogsLoading(false);
    }
  };

  const getPlayerList = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/dev/players');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load player list.');
      const players = Array.isArray(data.players) ? data.players : [];
      setPlayerList(players);
      const activity = data.activity && typeof data.activity === 'object' ? data.activity : {};
      setPlayerActivity({
        dailyActiveUsers: Math.max(0, Number(activity.dailyActiveUsers ?? 0) || 0),
        weeklyActiveUsers: Math.max(0, Number(activity.weeklyActiveUsers ?? 0) || 0),
        monthlyActiveUsers: Math.max(0, Number(activity.monthlyActiveUsers ?? 0) || 0),
      });
      const activeCount = players.filter((player: { active?: boolean }) => player.active).length;
      setMessage('Loaded ' + players.length + ' player accounts (' + activeCount + ' active now).');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not load player list.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetch('/api/dev/status')
      .then(r => r.json())
      .then(setContextInfo)
      .catch(() => null);

    void fetch('/api/dev/announcement')
      .then(async r => {
        if (!r.ok) throw new Error('Could not load the developer announcement.');
        return r.json();
      })
      .then(data => setAnnouncementText(String(data.message ?? '')))
      .catch(() => null)
      .finally(() => setAnnouncementLoaded(true));
  }, []);

  const handleForceRoll = async (rarityNum: number) => {
    const data = await sendAdminAction('/api/dev/force-roll', { rarity: rarityNum });
    if (data && onForceRollResult) {
      onForceRollResult(data as RollResponse);
      onClose();
    }
  };

  const updateState = async () => {
    const body: Record<string, number> = {};
    for (const [key, value] of Object.entries(stateInputs)) {
      if (!value.trim()) continue;
      const num = Number(value);
      if (!Number.isFinite(num)) {
        setMessage(`${key} must be a number.`);
        return;
      }
      const mapped = key === 'dust' ? 'cosmicDust' : key;
      body[mapped] = Math.floor(num);
    }
    if (Object.keys(body).length === 0) {
      setMessage('Enter at least one state value.');
      return;
    }
    await sendAdminAction('/api/dev/state', body);
  };

  const setPreset = async (preset: string) => {
    await sendAdminAction('/api/dev/preset', { preset });
  };

  const runFullComprehensiveTest = async () => {
    if (fullTestRunning) return;

    setFullTestRunning(true);
    setFullTestCurrentAction('Starting comprehensive test…');
    setFullTestLogs([]);
    setMessage('');

    const startedAt = performance.now();
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    const appendTestLog = (
      action: string,
      status: 'PASS' | 'FAIL' | 'SKIP',
      durationMs: number,
      detail: string,
    ) => {
      setFullTestLogs(previous => [
        ...previous,
        {
          action,
          status,
          durationMs: Math.max(0, Math.round(durationMs)),
          detail,
        },
      ].slice(-200));
    };

    const request = async <T,>(url: string, body?: unknown): Promise<T> => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(url, {
            method: body === undefined ? 'GET' : 'POST',
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        } catch (error) {
          // Network failures can be transient, but an HTTP 4xx must never be
          // swallowed by this catch: tests rely on expected authorization,
          // unlock, cooldown, and duplicate-report rejections happening once.
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === 2) throw lastError;
          await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }

        const data = await response.json().catch(() => ({}));
        if (response.ok) return data as T;

        const message = typeof data?.error === 'string'
          ? data.error
          : response.status + ' ' + response.statusText;
        lastError = new Error(message);

        // Retrying a 4xx can consume cooldowns/rate limits and mutate later test
        // expectations. Retry only transient 5xx responses.
        if (response.status < 500 || attempt === 2) throw lastError;
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      }

      throw lastError ?? new Error('Request failed.');
    };

    const step = async <T,>(
      action: string,
      fn: () => Promise<T>,
      detail: (result: T) => string = () => '',
    ): Promise<T | null> => {
      const stepStarted = performance.now();
      setFullTestCurrentAction(action);
      try {
        const result = await fn();
        passed += 1;
        appendTestLog(action, 'PASS', performance.now() - stepStarted, detail(result));
        return result;
      } catch (error) {
        failed += 1;
        appendTestLog(
          action,
          'FAIL',
          performance.now() - stepStarted,
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
    };

    const skip = (action: string, reason: string) => {
      skipped += 1;
      appendTestLog(action, 'SKIP', 0, reason);
    };

    const stateSummary = (result: unknown): string => {
      const state = recordValue(recordValue(result).state);
      const fields = [
        `coins=${shortNumber(state.coins, 0)}`,
        `shards=${shortNumber(state.shards, 0)}`,
        `xp=${shortNumber(state.xp, 0)}`,
        `level=${shortNumber(state.level, 0)}`,
      ];
      return fields.join(' · ');
    };

    const rollOnce = async (auto = false): Promise<RollResponse> => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          // Resetting cooldown deliberately clears the old prediction ticket.
          // Acquire the fresh ticket only after this state mutation commits.
          // The reset endpoint now commits the cooldown reset and returns
          // the fresh ticket together. Do not split these into separate HTTP
          // requests: an intervening UI roll/reset could invalidate the ticket.
          const ticket = await request<{
            ticketId: string;
            nextIndex: number;
            rollsRemaining: number;
            expiresAt: number;
          }>('/api/dev/reset-cooldown', {});
          return await request<RollResponse>('/api/roll', {
            auto,
            ticketId: ticket.ticketId,
            ticketIndex: ticket.nextIndex,
          });
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const message = lastError.message;
          const retryable =
            message.includes('Cooldown:') ||
            message.includes('Roll prediction ticket is') ||
            message.includes('Could not create a roll prediction ticket') ||
            message.includes('Player state changed while saving') ||
            message.includes('Could not safely save player data') ||
            message.includes('Guild data changed before the roll saved');
          if (!retryable || attempt === 3) throw lastError;
          await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
      throw lastError ?? new Error('Roll test failed.');
    };

    const rollDetail = (result: RollResponse): string =>
      `1/${formatRarity(result.orb?.rarity ?? 0, result.orb?.isInfinity)} · processed=${shortNumber(result.rollsProcessed, 0)} · coins +${shortNumber(result.coinsGained, 0)} · XP +${shortNumber(result.xpGained, 0)}`;

    try {
      // The test runs inside the live game UI. Disable any pre-existing Auto Roll
      // first, then refresh the App so its watcher cannot race the test.
      try {
        await request('/api/auto-roll', { enabled: false });
      } catch {
        // Auto Roll may not be unlocked yet. That is already a safe disabled state.
      }
      await onRefresh();

      await step(
        '1. Wipe save',
        () => request('/api/dev/reset-all', {}),
        result => `fresh save written · ${stateSummary(result)}`,
      );

      await step(
        '2. Seed test state',
        () => request('/api/dev/state', {
          coins: 1_000,
          shards: 50,
          xp: 100_000,
          totalRolls: 0,
          totalCrits: 0,
          highestRarity: 0,
          collectionValue: 0,
          lifetimeCollectionValue: 0,
          offlineRolls: 0,
          currentRunRolls: 0,
          rollsSinceBest: 0,
          lastRollAt: 0,
          lastSeenAt: Date.now(),
          onlinePlayers: 1,
          autoRollEnabled: false,
          level: 34,
          levelXpFloor: 0,
          lastShareAt: 0,
          automations: {
            autoQuestClaim: false,
            autoStreakClaim: false,
            autoCommunityClaim: false,
            autoOfflineClaim: false,
            autoUpgrade: false,
          },
        }),
        result => `coins=1,000 · shards=50 · XP=100,000`,
      );

      const upgradeIds = ['speed', 'luck', 'multi', 'coinBonus', 'xpBonus', 'critChance'] as const;
      for (const id of upgradeIds) {
        if (['coinBonus', 'xpBonus', 'critChance'].includes(id)) {
          await step(
            `Set 1,000 Coins before ${id}`,
            () => request('/api/dev/state', { coins: 1_000 }),
            () => 'admin state mutation',
          );
        }
        await step(
          `Buy ${id}`,
          () => request<{ state: any }>('/api/upgrade', { id }),
          (result: any) => `${id}=${shortNumber(result.state?.upgrades?.[id], 0)} · ${stateSummary(result)}`,
        );
      }

      await step(
        'Test manual roll + ticket',
        () => rollOnce(false),
        rollDetail,
      );

      await step(
        'Luck test · normal CCU sample',
        async () => {
          await request('/api/dev/ccu/fake', { bonus: 0 });
          const rarities: number[] = [];
          for (let i = 0; i < 5; i++) {
            try {
              const result = await rollOnce(false);
              rarities.push(result.orb.rarity);
            } catch (error) {
              throw new Error(
                `Baseline luck roll ${i + 1}/5 failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          return rarities;
        },
        rarities => {
          const values = (rarities as number[]);
          const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
          return `n=${values.length} · avg rarity=${shortRarity(average)} · best=${shortRarity(Math.max(0, ...values))}`;
        },
      );

      await step(
        'Luck test · high CCU sample',
        async () => {
          await request('/api/dev/ccu/fake', { bonus: 1_000 });
          const rarities: number[] = [];
          for (let i = 0; i < 5; i++) {
            try {
              const result = await rollOnce(false);
              rarities.push(result.orb.rarity);
            } catch (error) {
              throw new Error(
                `High-CCU luck roll ${i + 1}/5 failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          return rarities;
        },
        rarities => {
          const values = rarities as number[];
          const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
          return `n=${values.length} · avg rarity=${shortRarity(average)} · best=${shortRarity(Math.max(0, ...values))}`;
        },
      );

      await step(
        'Clear fake CCU',
        () => request('/api/dev/ccu/fake', { bonus: 0 }),
        () => 'luck calculation returned to real CCU',
      );

      await step(
        'Set 100,000 Coins',
        () => request('/api/dev/state', { coins: 100_000 }),
        () => 'admin currency mutation',
      );

      await step(
        'Upgrade All',
        () => request<{ state: any }>('/api/upgrade/all', {}),
        result => `all standard upgrades exercised · ${stateSummary(result)}`,
      );

      await step(
        'Manual roll for Auto Roll unlock · 1/3',
        () => rollOnce(false),
        rollDetail,
      );
      await step(
        'Manual roll for Auto Roll unlock · 2/3',
        () => rollOnce(false),
        rollDetail,
      );
      await step(
        'Manual roll for Auto Roll unlock · 3/3',
        () => rollOnce(false),
        rollDetail,
      );

      const autoEnabled = await step(
        'Enable Auto Roll',
        async () => {
          const result = await request<{ state: any }>('/api/auto-roll', { enabled: true });
          const state = recordValue(result.state);
          const upgrades = recordValue(state.upgrades);
          if (Number(upgrades.auto ?? 0) < 1 || Number(state.manualRolls ?? 0) < 3) {
            throw new Error(
              `Auto Roll did not unlock at 3 manual rolls (manualRolls=${state.manualRolls ?? 0}, auto=${upgrades.auto ?? 0}).`,
            );
          }
          return result;
        },
        stateSummary,
      );
      if (autoEnabled) {
        await step(
          'Auto Roll execution',
          () => rollOnce(true),
          rollDetail,
        );

        await step(
          'Disable Auto Roll after test',
          async () => {
            const result = await request<{ state: any }>('/api/auto-roll', { enabled: false });
            await onRefresh();
            return result;
          },
          stateSummary,
        );
      }

      await step(
        'Seed Offline Rolls',
        () => request('/api/dev/state', {
          offlineRolls: 2,
          lastSeenAt: Date.now(),
        }),
        () => 'offlineRolls=2',
      );
      await step(
        'Claim Offline Rolls',
        () => request<RollResponse>('/api/offline/claim', {}),
        result => `processed=${shortNumber(result.rollsProcessed, 0)} · ${stateSummary(result)}`,
      );

      await step(
        'Claim Daily Streak',
        () => request<{ state: any }>('/api/streak/claim', {}),
        (result: any) => `streak=${shortNumber(result.state?.streak?.count, 0)}`,
      );

      await step(
        'Prepare Daily + Weekly Quests',
        async () => request('/api/dev/state', {
            questState: 'ready',
            automations: {
              autoQuestClaim: false,
              autoStreakClaim: false,
              autoCommunityClaim: false,
              autoOfflineClaim: false,
              autoUpgrade: false,
            },
            offlineRolls: 0,
            lastSeenAt: Date.now(),
          }),
        () => 'all quests marked complete and unclaimed',
      );

      const meForQuest = await step(
        'Load quest state',
        () => request<any>('/api/me'),
        result => `daily=${Array.isArray(result.dailyQuests) ? result.dailyQuests.length : 0} · weekly=${Array.isArray(result.weeklyQuests) ? result.weeklyQuests.length : 0}`,
      );
      const firstQuestId = meForQuest && Array.isArray(meForQuest.dailyQuests) ? meForQuest.dailyQuests[0]?.id : null;
      if (firstQuestId) {
        await step(
          'Claim Daily Quest',
          () => request('/api/quests/claim', { type: 'daily', id: firstQuestId }),
          () => `claimed ${firstQuestId}`,
        );
      } else {
        skip('Claim Daily Quest', 'no daily quest id returned');
      }

      await step(
        'Altar shard sacrifice',
        async () => {
          await request('/api/dev/state', { coins: 2_000, shards: 1 });
          return request('/api/altar/sacrifice', { coins: 0, shards: 1 });
        },
        (result: any) => `luck surge extended=${String(result.luckSurgeExtended)} · ${stateSummary(result)}`,
      );

      await step(
        'Seed premium Booster currency',
        () => request('/api/dev/state', { shards: 100 }),
        () => 'shards=100',
      );
      await step(
        'Activate Prosperity booster',
        () => request<{ state: any }>('/api/boosters/activate', { id: 'prosperity' }),
        result => `prosperity active · ${stateSummary(result)}`,
      );

      await step(
        'Set 100 Shards',
        () => request('/api/dev/state', { shards: 100, lastSeenAt: Date.now() }),
        () => 'shards=100',
      );
      await step(
        'Activate Global Luck',
        () => request<{ state: any }>('/api/global-boosters/activate', { id: 'luck' }),
        (result: any) => `global luck tier=${shortNumber(result.state?.globalBoosters?.luck?.tier, 0)} · ${stateSummary(result)}`,
      );
      await step(
        'Set 100 Shards',
        () => request('/api/dev/state', { shards: 100, lastSeenAt: Date.now() }),
        () => 'shards=25',
      );
      await step(
        'Activate Global Speed',
        () => request<{ state: any }>('/api/global-boosters/activate', { id: 'speed' }),
        (result: any) => `global speed tier=${shortNumber(result.state?.globalBoosters?.speed?.tier, 0)} · ${stateSummary(result)}`,
      );
      await step(
        'Set 100 Shards',
        () => request('/api/dev/state', { shards: 100, lastSeenAt: Date.now() }),
        () => 'shards=25',
      );
      await step(
        'Activate Global Crit',
        () => request<{ state: any }>('/api/global-boosters/activate', { id: 'crit' }),
        (result: any) => `global crit tier=${shortNumber(result.state?.globalBoosters?.crit?.tier, 0)} · ${stateSummary(result)}`,
      );

      await step(
        'Prepare Prestige',
        () => request('/api/dev/state', {
          coins: 10_000,
          shards: 123,
          collectionValue: 100_000_000,
          lifetimeCollectionValue: 100_000_000,
          xp: 100_000,
          level: 20,
          levelXpFloor: 0,
          lastRollAt: 0,
        }),
        () => 'collectionValue=100,000,000 · expected dust=10',
      );

      const prestigeResult = await step(
        'Prestige',
        () => request<{ state: any; dustGained: number }>('/api/prestige', {}),
        result => {
          const state = recordValue(result.state);
          if (Number(state.shards) !== 123) {
            throw new Error('Prestige should preserve all 123 Shards, got ' + state.shards + '.');
          }
          return `dust +${shortNumber(result.dustGained, 0)} · shards preserved=${shortNumber(state.shards, 0)} · prestigeCount=${shortNumber(state.prestigeCount, 0)}`;
        },
      );


      if (prestigeResult) {
        await step(
          'Seed Prestige Dust',
          () => request('/api/dev/state', {
            cosmicDust: 1_000,
            coins: 100_000,
            shards: 50,
          }),
          () => 'cosmicDust=1,000 · mechanic tests use isolated prestige states',
        );

        const zeroPrestige = Object.fromEntries(
          Object.keys(PRESTIGE_UPGRADES).map(id => [id, 0]),
        );

        const zeroUpgrades = {
          speed: 0, multi: 0, clusterRoll: 0, auto: 0, luck: 0, coinBonus: 0,
          shardChance: 0, xpBonus: 0, critChance: 0, critPower: 0,
          offlineRate: 0, valueBonus: 0,
        };

        const zeroMastery = {
          continuumLuck: 0, prosperity: 0, shardAttunement: 0, critMastery: 0,
          chronoFlow: 0, infiniteVault: 0, cosmicAttunement: 0, celestialSurge: 0,
          pityAccelerant: 0, apexFortune: 0, celestialVolley: 0,
        };

        const setMechanicState = async (
          prestigeOverrides: Record<string, number> = {},
          extra: Record<string, unknown> = {},
        ) => {
          const result = await request<any>('/api/dev/state', {
            coins: 100_000,
            shards: 50,
            cosmicDust: 0,
            // Pin Level 4 and its XP floor so account history cannot add milestone orbs.
            level: 4,
            levelXpFloor: 533,
            xp: 600,
            freeShardsEarnedToday: 0,
            totalRolls: 0,
            totalCrits: 0,
            highestRarity: 0,
            collectionValue: 0,
            lifetimeCollectionValue: 0,
            offlineRolls: 0,
            currentRunRolls: 0,
            rollsSinceBest: 0,
            lastRollAt: 0,
            lastSeenAt: Date.now(),
            // Reset the rolling Shard budget for independent mechanic cases.
            lastFreeShardReset: '2020-01-01',
            onlinePlayers: 1,
            turboRollUntil: 0,
            autoRollEnabled: false,
            upgrades: zeroUpgrades,
            prestigeUpgrades: { ...zeroPrestige, ...prestigeOverrides },
            masterySkills: zeroMastery,
            activeBoosters: {},
            sacrifices: {
              coinsSacrificed: 0,
              shardsSacrificed: 0,
              altarLevel: 0,
              luckSurgeUntil: 0,
            },
            ...extra,
          });
          const state = recordValue(result.state);
          if (Number(state.level) < 2 || Number(state.xp) < 1) {
            throw new Error('Mechanic fixture failed to persist an unlocked player state (level=' + state.level + ', xp=' + state.xp + ').');
          }
          return result;
        };

        const readMechanics = async (): Promise<any> => {
          const result = await request<any>('/api/dev/mechanics');
          return recordValue(result.mechanics);
        };

        const clearWorldBoosters = async () => {
          for (const id of ['luck', 'speed', 'crit'] as const) {
            await request('/api/dev/global-booster', { id, tier: 0, minutes: 1 });
          }
        };

        await step(
          'Clear Global Boosters for mechanic tests',
          async () => {
            await clearWorldBoosters();
            return readMechanics();
          },
          (result: any) => 'luck=' + shortNumber(result.luckMultiplier) + ' · cooldown=' + shortNumber(result.cooldownMs, 0) + 'ms',
        );

        await step(
          'Mechanic · Permanent Luck',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({ permLuck: 1 });
            const after = await readMechanics();
            if (!(Number(after.luckMultiplier) > Number(before.luckMultiplier))) {
              throw new Error('Luck did not increase: ' + before.luckMultiplier + ' → ' + after.luckMultiplier + '.');
            }
            return { before, after };
          },
          result => 'Luck ' + shortNumber(result.before.luckMultiplier) + ' → ' + shortNumber(result.after.luckMultiplier),
        );

        await step(
          'Mechanic · Permanent Speed',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({ permSpeed: 1 });
            const after = await readMechanics();
            if (!(Number(after.cooldownMs) < Number(before.cooldownMs))) {
              throw new Error('Cooldown did not decrease: ' + before.cooldownMs + ' → ' + after.cooldownMs + '.');
            }
            return { before, after };
          },
          result => 'Cooldown ' + shortNumber(result.before.cooldownMs, 0) + 'ms → ' + shortNumber(result.after.cooldownMs, 0) + 'ms',
        );

        await step(
          'Mechanic · Vault Expansion',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({ vaultCap: 1 });
            const after = await readMechanics();
            const delta = Number(after.offlineRollCap) - Number(before.offlineRollCap);
            if (delta !== 250) throw new Error('Offline cap delta was ' + delta + ', expected 250.');
            return { before, after };
          },
          result => 'Offline cap ' + shortNumber(result.before.offlineRollCap, 0) + ' → ' + shortNumber(result.after.offlineRollCap, 0),
        );

        await step(
          'Mechanic · Cosmic Dust Bounty',
          async () => {
            await setMechanicState({ dustBounty: 0 }, { collectionValue: 100_000_000 });
            const before = await readMechanics();
            await setMechanicState({ dustBounty: 1 }, { collectionValue: 100_000_000 });
            const after = await readMechanics();
            const baseDust = Math.max(0, Math.floor(Number(before.prestigeDust) || 0));
            const expectedWithBounty = Math.floor(baseDust * 1.15);
            if (baseDust <= 0 || Number(after.prestigeDust) !== expectedWithBounty) {
              throw new Error('Cosmic Dust Bounty expected ' + baseDust + ' → ' + expectedWithBounty + ', got ' + before.prestigeDust + ' → ' + after.prestigeDust + '.');
            }
            return { before, after };
          },
          result => 'Prestige Dust ' + shortNumber(result.before.prestigeDust, 0) + ' → ' + shortNumber(result.after.prestigeDust, 0),
        );

        await step(
          'Mechanic · Silent Alert Mode',
          async () => {
            await setMechanicState({ sonarPing: 1 });
            sound.setSonarMode(false);
            sound.setSonarThreshold(100);
            await onRefresh();

            // Force a RollSection remount so its local Sonar toggle state follows
            // the sound singleton reset even when the test began on the Roll tab.
            const navButtons = () => Array.from(document.querySelectorAll('button.nav-tab'));
            const socialNav = navButtons().find(el => el.textContent?.includes('Guilds & Social')) as HTMLButtonElement | undefined;
            if (!socialNav) throw new Error('Guilds & Social navigation control was not found.');
            socialNav.click();
            await new Promise(resolve => setTimeout(resolve, 100));

            // React may replace nav nodes during the tab transition. Always find
            // the current Roll button after switching, never click a stale node.
            const rollNav = navButtons().find(el => el.textContent?.trim() === 'Roll') as HTMLButtonElement | undefined;
            if (!rollNav) throw new Error('Roll navigation control was not found after the tab transition.');
            rollNav.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            await onRefresh();

            const deadline = Date.now() + 2_000;
            let button: HTMLButtonElement | undefined;
            while (Date.now() < deadline) {
              button = Array.from(document.querySelectorAll('button'))
                .find(el => (el as HTMLButtonElement).title === 'Silent Mode: Mutes standard rolls and alerts with a crystal chime on rare drops') as HTMLButtonElement | undefined;
              if (button) break;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!button) throw new Error('Sonar control did not unlock after prestige state was applied (prestige=' + JSON.stringify((await request<any>('/api/me')).prestigeUpgrades?.sonarPing) + ').');
            button.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            let activeButton = Array.from(document.querySelectorAll('button'))
              .find(el => (el as HTMLButtonElement).title === 'Silent Mode: Mutes standard rolls and alerts with a crystal chime on rare drops') as HTMLButtonElement | undefined;
            if (!sound.sonarMode || !activeButton?.textContent?.includes('SILENT')) throw new Error('Sonar control did not enable Silent Mode.');
            activeButton.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            const resetButton = Array.from(document.querySelectorAll('button'))
              .find(el => (el as HTMLButtonElement).title === 'Silent Mode: Mutes standard rolls and alerts with a crystal chime on rare drops') as HTMLButtonElement | undefined;
            if (sound.sonarMode || !resetButton?.textContent?.includes('OFF')) throw new Error('Sonar control did not return to OFF after the toggle check.');
            return { text: 'SILENT → OFF' };
          },
          result => 'Client control unlocked · ' + result.text,
        );

        await step(
          'Mechanic · Sonar Ping Rare Trigger',
          async () => {
            sound.setSonarThreshold(100);
            sound.setSonarMode(true);
            const forced = await request<any>('/api/dev/force-roll', { rarity: 100, randomValue: 0.999999 });
            onForceRollResult?.(forced);
            const deadline = Date.now() + 1_000;
            let pulse: Element | null = null;
            while (Date.now() < deadline) {
              pulse = document.querySelector('[class*="border-cyan-400/90"]');
              if (pulse) break;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            if (!pulse) throw new Error('Rare roll did not trigger Sonar pulse (mode=' + sound.sonarMode + ', threshold=' + sound.sonarThreshold + ', rarity=' + String(forced.orb?.rarity) + ').');
            sound.setSonarMode(false);
            return forced;
          },
          result => 'Forced 1/' + shortRarity(result.orb?.rarity) + ' · Sonar pulse triggered',
        );

        await step(
          'Mechanic · Skip Animations',
          async () => {
            await setMechanicState({ instantReveal: 1 });
            try { localStorage.setItem('orbs_instant_reveal', 'false'); } catch {}
            await onRefresh();

            // Reset local React state as well as localStorage. The component
            // only reads this preference on mount, so a storage write alone
            // does not reset a control already mounted in the Roll tab.
            const navButtons = () => Array.from(document.querySelectorAll('button.nav-tab'));
            const socialNav = navButtons().find(el => el.textContent?.includes('Guilds & Social')) as HTMLButtonElement | undefined;
            if (!socialNav) throw new Error('Guilds & Social navigation control was not found.');
            socialNav.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            const rollNav = navButtons().find(el => el.textContent?.trim() === 'Roll') as HTMLButtonElement | undefined;
            if (!rollNav) throw new Error('Roll navigation control was not found after the tab transition.');
            rollNav.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            await onRefresh();

            const findInstantButton = () => Array.from(document.querySelectorAll('button'))
              .find(el => (el as HTMLButtonElement).title === 'Skip roll animations for instant reveals') as HTMLButtonElement | undefined;
            let button = findInstantButton();
            if (!button) throw new Error('Instant Reveal control did not unlock after prestige state was applied.');
            if (button.textContent?.includes('INSTANT')) {
              button.click();
              await new Promise(resolve => setTimeout(resolve, 100));
              button = findInstantButton();
            }
            if (!button?.textContent?.includes('OFF')) throw new Error('Instant Reveal control did not reset to OFF before the toggle check.');
            button.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            let updatedButton = findInstantButton();
            if (!updatedButton?.textContent?.includes('INSTANT')) throw new Error('Instant Reveal control did not toggle to INSTANT.');
            updatedButton.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            updatedButton = findInstantButton();
            if (!updatedButton?.textContent?.includes('OFF')) throw new Error('Instant Reveal control did not return to OFF after the toggle check.');
            try { localStorage.setItem('orbs_instant_reveal', 'false'); } catch {}
            return { text: 'OFF → INSTANT → OFF' };
          },
          result => 'Client control unlocked · ' + result.text,
        );

        await step(
          'Mechanic · Auto-Roll Speed',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({ autoOverclock: 1 });
            const after = await readMechanics();
            if (!(Number(after.autoCooldownMs) < Number(before.autoCooldownMs))) {
              throw new Error('Auto cooldown did not decrease: ' + before.autoCooldownMs + ' → ' + after.autoCooldownMs + '.');
            }
            return { before, after };
          },
          result => 'Auto cooldown ' + shortNumber(result.before.autoCooldownMs, 0) + 'ms → ' + shortNumber(result.after.autoCooldownMs, 0) + 'ms',
        );

        await step(
          'Mechanic · Common Salvage',
          async () => {
            await setMechanicState({ autoFilter: 0 });
            const base = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0.999999 });
            await setMechanicState({ autoFilter: 1 });
            const boosted = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0.999999 });
            if (!(Number(boosted.coinsGained) > Number(base.coinsGained))) {
              throw new Error('Common Salvage did not increase coins: ' + base.coinsGained + ' → ' + boosted.coinsGained + '.');
            }
            return { base, boosted };
          },
          result => 'Coins ' + shortNumber(result.base.coinsGained, 0) + ' → ' + shortNumber(result.boosted.coinsGained, 0) + ' on 1/9',
        );

        await step(
          'Mechanic · Dry Streak Luck',
          async () => {
            await setMechanicState(
              { resonanceMeter: 1 },
              { highestRarity: 1_000_000_000_000, rollsSinceBest: 17 },
            );
            const beforeState = await request<any>('/api/me');
            const before = await readMechanics();
            if (Number(beforeState.rollsSinceBest) !== 17) {
              throw new Error('Failed to seed pity at 17: got ' + beforeState.rollsSinceBest + '.');
            }
            await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            const afterState = await request<any>('/api/me');
            const after = await readMechanics();
            if (Number(afterState.rollsSinceBest) !== 18 || !(Number(after.luckMultiplier) > Number(before.luckMultiplier))) {
              throw new Error('Pity did not activate at 18: rollsSinceBest=' + afterState.rollsSinceBest + ', Luck ' + before.luckMultiplier + ' → ' + after.luckMultiplier + '.');
            }

            // Contract: pity has no finite stack ceiling. Compare 50 vs 51
            // stacks directly so a future UI refactor cannot silently re-cap it.
            await setMechanicState(
              { resonanceMeter: 1 },
              { highestRarity: 1_000_000_000_000, rollsSinceBest: 900 },
            );
            const fiftyStacks = await readMechanics();
            await setMechanicState(
              { resonanceMeter: 1 },
              { highestRarity: 1_000_000_000_000, rollsSinceBest: 918 },
            );
            const fiftyOneStacks = await readMechanics();
            if (!(Number(fiftyOneStacks.luckMultiplier) > Number(fiftyStacks.luckMultiplier))) {
              throw new Error('Pity is still capped: 50-stack Luck=' + fiftyStacks.luckMultiplier + ', 51-stack Luck=' + fiftyOneStacks.luckMultiplier + '.');
            }

            return {
              beforeLuck: before.luckMultiplier,
              afterLuck: after.luckMultiplier,
              beforeRolls: beforeState.rollsSinceBest,
              afterRolls: afterState.rollsSinceBest,
              fiftyStacksLuck: fiftyStacks.luckMultiplier,
              fiftyOneStacksLuck: fiftyOneStacks.luckMultiplier,
            };
          },
          result => 'Pity rolls ' + result.beforeRolls + ' → ' + result.afterRolls + ' · Luck ' + shortNumber(result.beforeLuck) + ' → ' + shortNumber(result.afterLuck),
        );

        await step(
          'Mechanic · Multi-Roll Extra',
          async () => {
            await setMechanicState({ stellarMagnet: 5 }, { upgrades: { ...zeroUpgrades, multi: 1 } });
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0 });
            if (Number(result.rollsProcessed) !== 4) {
              throw new Error('Stellar Magnet expected 4 processed orbs, got ' + result.rollsProcessed + '.');
            }
            return result;
          },
          result => 'Processed ' + shortNumber(result.rollsProcessed, 0) + ' (base multi=2 + magnet=2)',
        );

        await step(
          'Mechanic · Turbo Duration',
          async () => {
            await setMechanicState({ chronoOverdrive: 0 }, { shards: 10 });
            const beforeNormal = recordValue(await request<any>('/api/me'));
            if (Number(beforeNormal.level) < 2) {
              throw new Error('Turbo test fixture was not unlocked before activation (level=' + beforeNormal.level + ', xp=' + beforeNormal.xp + ').');
            }
            const normal = await request<any>('/api/turbo/activate', {});
            await setMechanicState({ chronoOverdrive: 1 }, { shards: 10 });
            const beforeUpgraded = recordValue(await request<any>('/api/me'));
            if (Number(beforeUpgraded.level) < 2) {
              throw new Error('Upgraded Turbo fixture was not unlocked before activation (level=' + beforeUpgraded.level + ', xp=' + beforeUpgraded.xp + ').');
            }
            const upgraded = await request<any>('/api/turbo/activate', {});
            const remainingNormal = Number(normal.state?.turboRollUntil) - Date.now();
            const remainingUpgraded = Number(upgraded.state?.turboRollUntil) - Date.now();
            if (remainingNormal < 29 * 60_000 || remainingUpgraded < 59 * 60_000) {
              throw new Error('Turbo durations were too short: ' + Math.round(remainingNormal / 60000) + 'm → ' + Math.round(remainingUpgraded / 60000) + 'm.');
            }
            return { remainingNormal, remainingUpgraded };
          },
          result => 'Turbo remaining ≈ ' + Math.round(result.remainingNormal / 60000) + 'm → ' + Math.round(result.remainingUpgraded / 60000) + 'm',
        );

        await step(
          'Mechanic · Transmutation',
          async () => {
            await setMechanicState({ transmutation: 0 });
            const base = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0.999999 });
            await setMechanicState({ transmutation: 1 });
            const upgraded = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0.999999 });
            if (!(Number(upgraded.coinsGained) > Number(base.coinsGained))) {
              throw new Error('Transmutation did not increase low-rarity coins: ' + base.coinsGained + ' → ' + upgraded.coinsGained + '.');
            }
            return { base, upgraded };
          },
          result => 'Coins ' + shortNumber(result.base.coinsGained, 0) + ' → ' + shortNumber(result.upgraded.coinsGained, 0) + ' on 1/9',
        );

        await step(
          'Mechanic · Dust Synthesis',
          async () => {
            await setMechanicState({ shardSynthesis: 1 }, { shards: 100, xp: 32_000, level: 20, levelXpFloor: 0 });
            const before = await request<any>('/api/me');
            if (Number(before.level) < 20) {
              throw new Error('Could not seed Level 20 for synthesis; got Level ' + before.level + '.');
            }
            const result = await request<any>('/api/prestige/synthesize', {});
            if (Number(result.dustEarned) !== 1 || Number(result.state?.shards) !== 0) {
              throw new Error('Synthesis result was Dust=' + result.dustEarned + ', Shards=' + result.state?.shards + '.');
            }
            return result;
          },
          result => '10 Shards → +' + shortNumber(result.dustEarned, 0) + ' Cosmic Dust',
        );

        await step(
          'Mechanic · Astral Barrage',
          async () => {
            await setMechanicState({ astralBarrage: 1 });
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            if (Number(result.rollsProcessed) !== 2) {
              throw new Error('Astral Barrage expected 2 processed orbs, got ' + result.rollsProcessed + '.');
            }
            return result;
          },
          result => 'Processed ' + shortNumber(result.rollsProcessed, 0) + ' (base=1 + barrage=1)',
        );

        await step(
          'Mechanic · Cosmic Inheritance',
          async () => {
            await setMechanicState(
              { cosmicInheritance: 1 },
              { coins: 1_000, shards: 100, xp: 32_000, collectionValue: 1_000_000, lifetimeCollectionValue: 1_000_000 },
            );
            const result = await request<any>('/api/prestige', {});
            if (Number(result.state?.coins) !== 100 || Number(result.state?.shards) !== 100) {
              throw new Error('Inheritance expected 10% Coin retention and full Shard preservation: Coins=' + result.state?.coins + ', Shards=' + result.state?.shards + '.');
            }
            return result;
          },
          result => 'Prestige retained Coins=' + shortNumber(result.state?.coins, 0) + ' · Shards=' + shortNumber(result.state?.shards, 0),
        );

        await step(
          'Mechanic · Celestial Auto-Buyer',
          async () => {
            await setMechanicState({ autoBuyer: 1 }, { coins: 100 });
            const before = await request<any>('/api/me');
            const result = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0.999999 });
            const beforeSpeed = Number(before.upgrades?.speed ?? 0);
            const afterSpeed = Number(result.state?.upgrades?.speed ?? 0);
            if (afterSpeed !== beforeSpeed + 1) {
              throw new Error('Auto-Buyer did not buy the cheapest upgrade: speed ' + beforeSpeed + ' → ' + afterSpeed + '.');
            }
            return { beforeSpeed, afterSpeed, result };
          },
          result => 'Cheapest upgrade bought automatically · speed ' + result.beforeSpeed + ' → ' + result.afterSpeed,
        );

        await step(
          'Mechanic · Supernova Burst',
          async () => {
            await setMechanicState(
              { supernova: 5 },
              { totalRolls: 10, upgrades: { ...zeroUpgrades, critChance: 20 } },
            );
            const result = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0 });
            if (Number(result.orb?.rarity) !== 45 || !result.orb?.isCrit) {
              throw new Error('Supernova expected 1/45 with deterministic crit, got 1/' + result.orb?.rarity + ', crit=' + result.orb?.isCrit + '.');
            }
            return result;
          },
          result => 'Forced crit supernova produced 1/' + shortRarity(result.orb?.rarity),
        );

        await step(
          'Mechanic · Altar Resonator',
          async () => {
            const sacrifices = { coinsSacrificed: 0, shardsSacrificed: 5, altarLevel: 5, luckSurgeUntil: 0 };
            await setMechanicState({ altarResonator: 0 }, { sacrifices });
            const before = await readMechanics();
            await setMechanicState({ altarResonator: 1 }, { sacrifices });
            const after = await readMechanics();
            if (!(Number(after.altar?.totalAltarMultiplier) > Number(before.altar?.totalAltarMultiplier))) {
              throw new Error('Altar multiplier did not increase: ' + before.altar?.totalAltarMultiplier + ' → ' + after.altar?.totalAltarMultiplier + '.');
            }
            return { before, after };
          },
          result => 'Altar multiplier ' + shortNumber(result.before.altar?.totalAltarMultiplier) + ' → ' + shortNumber(result.after.altar?.totalAltarMultiplier),
        );

        await step(
          'Mechanic · Offline Overdrive',
          async () => {
            await setMechanicState({ offlineOverdrive: 0 });
            const base = await readMechanics();
            await setMechanicState({ offlineOverdrive: 1 });
            const boosted = await readMechanics();
            if (!(Number(boosted.effectiveOfflineTickMs) < Number(base.effectiveOfflineTickMs))) {
              throw new Error('Offline tick did not improve: ' + base.effectiveOfflineTickMs + ' → ' + boosted.effectiveOfflineTickMs + '.');
            }
            return { base, boosted };
          },
          result => 'Offline tick ' + shortNumber(result.base.effectiveOfflineTickMs, 0) + 'ms → ' + shortNumber(result.boosted.effectiveOfflineTickMs, 0) + 'ms',
        );

        await step(
          'Mechanic · Singularity Tithe',
          async () => {
            await setMechanicState(
              { singularityTithe: 1 },
              { totalRolls: 17, singularityTitheSingleRolls: 199, highestRarity: 1_000_000_000, rollsSinceBest: 17, cosmicDust: 0 },
            );
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            const state = recordValue(result.state);
            if (Number(state.singularityTitheSingleRolls) !== 200 || Number(state.cosmicDust) < 1) {
              throw new Error('Tithe failed at 200 processed rolls: counter=' + state.singularityTitheSingleRolls + ', dust=' + state.cosmicDust + '.');
            }

            await setMechanicState(
              { singularityTithe: 1 },
              { totalRolls: 18, singularityTitheSingleRolls: 198, cosmicDust: 0, upgrades: { ...zeroUpgrades, multi: 1 } },
            );
            const multi = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            const multiState = recordValue(multi.state);
            if (Number(multiState.singularityTitheSingleRolls) !== 200 || Number(multiState.cosmicDust) < 1) {
              throw new Error('Multi-roll did not advance Tithe to 200: counter=' + multiState.singularityTitheSingleRolls + ', dust=' + multiState.cosmicDust + '.');
            }
            return { result, multi };
          },
          result => '200-roll boundary passed · multi-roll counted (counter=' + shortNumber(result.multi.state?.singularityTitheSingleRolls, 0) + ')',
        );

        await step(
          'Mechanic · Lucky Floor',
          async () => {
            await setMechanicState({ luckyFloor: 5 });
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            if (Number(result.orb?.rarity) < 7) {
              throw new Error('Lucky Floor produced 1/' + result.orb?.rarity + '; expected at least 1/7.');
            }
            return result;
          },
          result => 'Forced 1/2 floor raised minimum to 1/' + shortRarity(result.orb?.rarity),
        );

        await step(
          'Mechanic · Astral Arsenal',
          async () => {
            await setMechanicState({ astralArsenal: 1 });
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            if (Number(result.rollsProcessed) !== 2) {
              throw new Error('Astral Arsenal expected 2 processed orbs, got ' + result.rollsProcessed + '.');
            }
            return result;
          },
          result => 'Processed ' + shortNumber(result.rollsProcessed, 0) + ' (base=1 + arsenal=1)',
        );

        await step(
          'Mechanic · Deep Vault',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({ deepVault: 1 });
            const after = await readMechanics();
            const delta = Number(after.offlineRollCap) - Number(before.offlineRollCap);
            if (delta !== 250) throw new Error('Deep Vault delta was ' + delta + ', expected 250.');
            return { before, after };
          },
          result => 'Offline cap ' + shortNumber(result.before.offlineRollCap, 0) + ' → ' + shortNumber(result.after.offlineRollCap, 0),
        );

        await step(
          'Mechanic · Aftershock',
          async () => {
            await setMechanicState({}, { aftershockRecord: 80_000 });
            const result = await readMechanics();
            const multiplier = Number(result.critMultiplier);
            if (Math.abs(multiplier - 2.02) > 1e-8) {
              throw new Error('Aftershock expected a 2.02× critical multiplier for an 80,000-roll record, got ' + multiplier + '.');
            }
            return result;
          },
          result => '80,000-roll record · critical multiplier=' + shortNumber(result.critMultiplier, 3) + '×',
        );

        await step(
          'Mechanic · Unbroken Momentum',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({}, { longestRollingSessionMs: 30 * 60_000 });
            const after = await readMechanics();
            if (!(Number(after.cooldownMs) < Number(before.cooldownMs))) {
              throw new Error('A 30-minute Momentum record should reduce cooldown: ' + before.cooldownMs + ' → ' + after.cooldownMs + '.');
            }
            return { before, after };
          },
          result => 'Cooldown ' + shortNumber(result.before.cooldownMs, 0) + 'ms → ' + shortNumber(result.after.cooldownMs, 0) + 'ms at +6% Speed',
        );

        await step(
          'Mechanic · Steady Hands',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({ steadyHands: 1 });
            const after = await readMechanics();
            if (!(Number(after.cooldownMs) < Number(before.cooldownMs))) {
              throw new Error('Cooldown did not decrease: ' + before.cooldownMs + ' → ' + after.cooldownMs + '.');
            }
            return { before, after };
          },
          result => 'Cooldown ' + shortNumber(result.before.cooldownMs, 0) + 'ms → ' + shortNumber(result.after.cooldownMs, 0) + 'ms',
        );

        await step(
          'Mechanic · Offline Fortune',
          async () => {
            await setMechanicState({ offlineFortune: 0 });
            const base = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0.999999, source: 'offline' });
            await setMechanicState({ offlineFortune: 1 });
            const upgraded = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0.999999, source: 'offline' });
            if (!(Number(upgraded.coinsGained) > Number(base.coinsGained))) {
              throw new Error('Offline Fortune did not increase offline Coins: ' + base.coinsGained + ' → ' + upgraded.coinsGained + '.');
            }
            return { base, upgraded };
          },
          result => 'Offline Coins ' + shortNumber(result.base.coinsGained, 0) + ' → ' + shortNumber(result.upgraded.coinsGained, 0),
        );

        await step(
          'Mechanic · Frenzy Volley',
          async () => {
            // Claim the baseline before creating the upgraded Frenzy. Both admin
            // tests use the current post ID, so the first post must not be overwritten.
            await request('/api/dev/frenzy/reset', {});
            await setMechanicState({ frenzyVolley: 0 }, { upgrades: { ...zeroUpgrades, multi: 1 } });
            const normalStart = await request<any>('/api/dev/frenzy/start', { rarity: 100 });
            const normalBeforeClaim = Number(normalStart.state?.totalRolls ?? 0);
            const normalClaim = await request<any>('/api/dev/frenzy/claim', { postId: normalStart.postId });
            const normalCount = Number(normalClaim.state?.totalRolls ?? 0) - normalBeforeClaim;

            await request('/api/dev/frenzy/reset', {});
            await setMechanicState({ frenzyVolley: 1 }, { upgrades: { ...zeroUpgrades, multi: 1 } });
            const volleyStart = await request<any>('/api/dev/frenzy/start', { rarity: 100 });
            const volleyBeforeClaim = Number(volleyStart.state?.totalRolls ?? 0);
            const volleyClaim = await request<any>('/api/dev/frenzy/claim', { postId: volleyStart.postId });
            const volleyCount = Number(volleyClaim.state?.totalRolls ?? 0) - volleyBeforeClaim;

            // A forced starting rarity can still be raised by a crit. Count from
            // each created Frenzy's actual recorded rarity, not the requested seed.
            const normalRarity = Number(normalStart.rarity ?? normalStart.orb?.rarity ?? 0);
            const volleyRarity = Number(volleyStart.rarity ?? volleyStart.orb?.rarity ?? 0);
            if (!(normalRarity >= 100) || !(volleyRarity >= 100)) {
              throw new Error('Frenzy start returned an invalid rarity: normal=' + normalRarity + ', volley=' + volleyRarity + '.');
            }
            const expectedNormal = frenzyOrbCountForRarity(normalRarity) * 2;
            const expectedVolley = Math.floor(frenzyOrbCountForRarity(volleyRarity) * 1.20);
            const normalVisible = Array.isArray(normalClaim.batch) ? normalClaim.batch.length : 0;
            const volleyVisible = Array.isArray(volleyClaim.batch) ? volleyClaim.batch.length : 0;
            if (normalCount !== expectedNormal || volleyCount !== expectedVolley) {
              throw new Error(
                'Frenzy Volley expected ' + expectedNormal + ' → ' + expectedVolley +
                ' rolls, got ' + normalCount + ' → ' + volleyCount + '.'
              );
            }
            if (normalVisible !== Math.min(normalCount, 8) || volleyVisible !== Math.min(volleyCount, 8)) {
              throw new Error(
                'Frenzy claim did not return the visible Orb volley: ' +
                normalVisible + ' → ' + volleyVisible + ' displayed Orbs.'
              );
            }
            return { normalCount, volleyCount, normalVisible, volleyVisible };
          },
          result => 'Frenzy claim Orbs ' + result.normalCount + ' → ' + result.volleyCount + ' · visible ' + result.normalVisible + ' → ' + result.volleyVisible,
        );

        await step(
          'Mechanic · Astral Reserve',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({ astralReserve: 1 });
            const after = await readMechanics();
            if (!(Number(after.luckMultiplier) > Number(before.luckMultiplier))) {
              throw new Error('Astral Reserve did not increase Luck: ' + before.luckMultiplier + ' → ' + after.luckMultiplier + '.');
            }
            return { before, after };
          },
          result => 'Luck ' + shortNumber(result.before.luckMultiplier) + ' → ' + shortNumber(result.after.luckMultiplier),
        );

        await step(
          'Mechanic · Temporal Compression',
          async () => {
            await setMechanicState();
            const before = await readMechanics();
            await setMechanicState({ temporalCompression: 1 });
            const after = await readMechanics();
            if (!(Number(after.cooldownMs) < Number(before.cooldownMs))) {
              throw new Error('Cooldown did not decrease: ' + before.cooldownMs + ' → ' + after.cooldownMs + '.');
            }
            return { before, after };
          },
          result => 'Cooldown ' + shortNumber(result.before.cooldownMs, 0) + 'ms → ' + shortNumber(result.after.cooldownMs, 0) + 'ms',
        );

        await step(
          'Mechanic · Shard Resonator',
          async () => {
            await setMechanicState({ shardResonator: 0 }, { shards: 0 });
            const base = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0 });
            await setMechanicState({ shardResonator: 1 }, { shards: 0 });
            const upgraded = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0 });
            if (Number(upgraded.shardsGained) <= Number(base.shardsGained)) {
              throw new Error('Shard Resonator did not increase shard proc: ' + base.shardsGained + ' → ' + upgraded.shardsGained + '.');
            }
            return { base, upgraded };
          },
          result => 'Shards ' + shortNumber(result.base.shardsGained, 0) + ' → ' + shortNumber(result.upgraded.shardsGained, 0) + ' with deterministic proc',
        );

        await step(
          'Mechanic · Cosmic Valuation',
          async () => {
            await setMechanicState({ cosmicValuation: 0 });
            const base = await request<any>('/api/dev/force-roll', { rarity: 100, randomValue: 0.999999 });
            await setMechanicState({ cosmicValuation: 1 });
            const upgraded = await request<any>('/api/dev/force-roll', { rarity: 100, randomValue: 0.999999 });
            if (Number(upgraded.totalValueGained) !== 105) {
              throw new Error('Cosmic Valuation expected 100 → 105 value, got ' + base.totalValueGained + ' → ' + upgraded.totalValueGained + '.');
            }
            return { base, upgraded };
          },
          result => 'Collection Value ' + shortNumber(result.base.totalValueGained, 0) + ' → ' + shortNumber(result.upgraded.totalValueGained, 0),
        );

        await step(
          'Restore Prestige Test State',
          () => request('/api/dev/state', {
            prestigeUpgrades: Object.fromEntries(
              Object.keys(PRESTIGE_UPGRADES).map(id => [id, 1]),
            ),
          }),
          () => 'all prestige upgrades set to level 1 after functional testing',
        );
      } else {
        skip('Full Prestige Mechanic Sweep', 'prestige failed');
        skip('Restore Prestige Test State', 'prestige failed');
      }

      await step(
        'Contract · Rarity ladder has 18 tiers',
        async () => {
          if (CONTINUUM_TIERS.length !== 18) {
            throw new Error('Expected 18 rarity tiers, found ' + CONTINUUM_TIERS.length + '.');
          }
          for (let i = 1; i < CONTINUUM_TIERS.length; i++) {
            if (!(CONTINUUM_TIERS[i].minRarity > CONTINUUM_TIERS[i - 1].minRarity)) {
              throw new Error('Rarity thresholds are not strictly increasing at ' + CONTINUUM_TIERS[i].tier + '.');
            }
          }
          return CONTINUUM_TIERS;
        },
        tiers => tiers.slice(-3).map(tier => tier.tier).join(' → '),
      );

      await step(
        'Contract · Hidden rarity gate',
        async () => {
          const hidden = visibleContinuumTiers(8);
          const revealed = visibleContinuumTiers(9);
          if (hidden.length !== 9) throw new Error('Rarity gate exposed ' + hidden.length + ' tiers before 1/9.');
          if (revealed.length !== 18) throw new Error('Rarity gate revealed ' + revealed.length + ' tiers at 1/9.');
          return { hidden, revealed };
        },
        result => '8 highest → ' + result.hidden.length + ' visible · 9 highest → ' + result.revealed.length + ' visible',
      );

      await step(
        'Contract · New rarity metadata',
        async () => {
          const expected: Array<[number, string]> = [
            [1_000_000_000_000_000, 'Paradox'],
            [10_000_000_000_000_000, 'Beyond'],
            [100_000_000_000_000_000, 'Endless'],
          ];
          for (const [rarity, tier] of expected) {
            const info = getOrbInfo(rarity);
            if (info.tier !== tier) throw new Error('1/' + formatRarity(rarity) + ' mapped to ' + info.tier + ', expected ' + tier + '.');
          }
          return expected;
        },
        expected => expected.map(item => item[1]).join(', '),
      );

      await step(
        'Contract · Rarity formatter handles e8 threshold',
        async () => {
          const expected: Array<[number, string]> = [
            [9, '9'],
            [99_999_999, '99,999,999'],
            [100_000_000, '1.00e8'],
            [999_000_000, '9.99e8'],
            [1_000_000_000_000_000, '1.00e15'],
            [100_000_000_000_000_000, '1.00e17'],
          ];
          for (const [rarity, expectedValue] of expected) {
            const formatted = formatRarity(rarity);
            if (formatted !== expectedValue) {
              throw new Error('Unexpected formatting for ' + rarity + ': ' + formatted + ', expected ' + expectedValue + '.');
            }
          }
          return expected;
        },
        samples => samples.map(([rarity, formatted]) => formatRarity(rarity) + ' (' + formatted + ')').join(' · '),
      );

      await step(
        'API · Force-roll 1/1e15 Paradox',
        async () => {
          await request('/api/dev/state', { xp: 32_000, highestRarity: 9 });
          const result = await request<any>('/api/dev/force-roll', { rarity: 1_000_000_000_000_000, randomValue: 0.999999 });
          if (result.orb?.tier !== 'Paradox') throw new Error('Expected Paradox, got ' + result.orb?.tier + '.');
          return result;
        },
        result => '1/' + formatRarity(result.orb.rarity, result.orb.isInfinity) + ' · ' + result.orb.tier,
      );

      await step(
        'API · Force-roll 1/1e16 Beyond',
        async () => {
          const result = await request<any>('/api/dev/force-roll', { rarity: 10_000_000_000_000_000, randomValue: 0.999999 });
          if (result.orb?.tier !== 'Beyond') throw new Error('Expected Beyond, got ' + result.orb?.tier + '.');
          return result;
        },
        result => '1/' + formatRarity(result.orb.rarity, result.orb.isInfinity) + ' · ' + result.orb.tier,
      );

      await step(
        'API · Force-roll 1/1e17 Endless',
        async () => {
          const result = await request<any>('/api/dev/force-roll', { rarity: 100_000_000_000_000_000, randomValue: 0.999999 });
          if (result.orb?.tier !== 'Endless') throw new Error('Expected Endless, got ' + result.orb?.tier + '.');
          return result;
        },
        result => '1/' + formatRarity(result.orb.rarity, result.orb.isInfinity) + ' · ' + result.orb.tier,
      );

      await step(
        'API · High-rarity collection persistence',
        async () => {
          const me = await request<any>('/api/me');
          if (Number(me.highestRarity) < 100_000_000_000_000_000) {
            throw new Error('Highest rarity did not persist: ' + me.highestRarity + '.');
          }
          const collection = await request<any>('/api/collection?offset=0&limit=100&tier=all&sort=rarity_desc');
          const found = Array.isArray(collection.items) && collection.items.some((item: any) => Number(item.rarity) === 100_000_000_000_000_000);
          if (!found) throw new Error('1/1e17 orb was not returned by the collection endpoint.');
          return { me, collection };
        },
        result => 'highest=' + formatRarity(result.me.highestRarity) + ' · collection=' + result.collection.total + ' entries',
      );

      await step(
        'API · Chat report creates admin notification',
        async () => {
          // This comprehensive suite runs in the main Game launcher. Explicitly
          // perform its registration handshake so report tests never depend on
          // the floating widget's startup timing.
          const chatStatus = await request<any>('/api/chat/status?launcher=main');
          if (chatStatus.enabled !== true) {
            throw new Error(chatStatus.reason || 'Main launcher did not register Global Chat.');
          }
          // The query string is intentionally untrusted. A caller cannot change
          // launcher identity by appending ?launcher=frenzy to a main-post request.
          const spoofedLauncherStatus = await request<any>('/api/chat/status?launcher=frenzy');
          if (spoofedLauncherStatus.enabled !== chatStatus.enabled) {
            throw new Error('Global Chat status changed in response to a client-controlled launcher flag.');
          }
          const message = await request<any>('/api/chat', { text: '[ADMIN TEST] chat-report notification check' });
          await request('/api/chat/report', { messageId: message.id });
          const reports = await request<any>('/api/dev/chat-reports');
          const match = Array.isArray(reports.reports)
            ? reports.reports.find((report: any) => report.messageId === message.id)
            : null;
          if (!match) throw new Error('Admin chat report record was not created.');
          if (Number(reports.unreadCount) < 1) throw new Error('Admin chat report notification count did not increase.');
          return { message, reports, match };
        },
        result => 'report=' + result.match.reportId + ' · unread=' + result.reports.unreadCount,
      );

      await step(
        'API · Duplicate chat report rejected',
        async () => {
          // The previous report consumes both the chat and report cooldowns.
          // Wait them out so this test reaches duplicate-report handling itself.
          await new Promise(resolve => setTimeout(resolve, 5_200));
          const message = await request<any>('/api/chat', { text: '[ADMIN TEST] duplicate-report check' });
          await request('/api/chat/report', { messageId: message.id });
          let duplicateError = '';
          try {
            await request('/api/chat/report', { messageId: message.id });
          } catch (error) {
            duplicateError = error instanceof Error ? error.message : String(error);
          }
          if (!duplicateError) throw new Error('Duplicate chat report was accepted.');
          if (!/already reported|already submitted/i.test(duplicateError)) {
            throw new Error('Duplicate report check failed for the wrong reason: ' + duplicateError);
          }
          const reports = await request<any>('/api/dev/chat-reports');
          const matches = Array.isArray(reports.reports)
            ? reports.reports.filter((report: any) => report.messageId === message.id)
            : [];
          if (matches.length !== 1) throw new Error('Duplicate report created ' + matches.length + ' records.');
          return message;
        },
        result => 'message=' + result.id + ' · duplicate rejected',
      );

      await step(
        'API · Chat report can be marked read',
        async () => {
          const reports = await request<any>('/api/dev/chat-reports');
          const unread = Array.isArray(reports.reports) ? reports.reports.find((report: any) => !report.readAt) : null;
          if (!unread) throw new Error('No unread chat report was available for the read-state check.');
          await request('/api/dev/chat-reports/read', { reportId: unread.reportId });
          const after = await request<any>('/api/dev/chat-reports');
          const refreshed = after.reports?.find((report: any) => report.reportId === unread.reportId);
          if (!refreshed?.readAt) throw new Error('Chat report was not marked read.');
          return after;
        },
        result => 'unread after read=' + result.unreadCount,
      );

      await step(
        'API · Invalid chat report rejected',
        async () => {
          let rejected = false;
          try {
            await request('/api/chat/report', { messageId: 'does-not-exist' });
          } catch {
            rejected = true;
          }
          if (!rejected) throw new Error('Invalid chat message ID was accepted for reporting.');
          return true;
        },
        () => 'invalid report rejected',
      );

      await step(
        'API · Negative admin state clamps safely',
        async () => {
          const result = await request<any>('/api/dev/state', { coins: -999_999_999, shards: -999_999_999, xp: -999_999_999, offlineRolls: -5 });
          const state = result.state;
          if (state.coins < 0 || state.shards < 0 || state.xp < 0 || state.offlineRolls < 0) {
            throw new Error('Negative values survived admin state mutation.');
          }
          return state;
        },
        state => 'coins=' + state.coins + ' · shards=' + state.shards + ' · xp=' + state.xp + ' · offline=' + state.offlineRolls,
      );

      await step(
        'API · Unknown admin state fields ignored',
        async () => {
          await request<any>('/api/dev/state', { definitelyNotARealField: 123456 });
          const result = await request<any>('/api/me');
          if ('definitelyNotARealField' in result) throw new Error('Unknown field leaked into player state.');
          return result;
        },
        () => 'allowlist preserved',
      );

      await step(
        'API · Roll ticket reuse is stable',
        async () => {
          const a = await request<any>('/api/roll-ticket');
          const b = await request<any>('/api/roll-ticket');
          if (!a.ticketId || a.ticketId !== b.ticketId) throw new Error('Active roll ticket was not reused.');
          if (Number(b.nextIndex) !== Number(a.nextIndex)) throw new Error('Repeated ticket reads changed nextIndex.');
          if (!(Number(a.expiresAt) > Date.now())) throw new Error('Active roll ticket is already expired.');
          return { a, b };
        },
        result => 'ticket=' + result.a.ticketId + ' · index=' + result.a.nextIndex + ' · active',
      );

      await step(
        'API · Player state refresh preserves high-rarity best',
        async () => {
          await request<any>('/api/dev/state', {
            highestRarity: 100_000_000_000_000_000,
            collection: { '100000000000000000': 1 },
            lastShareAt: 0,
            lastSeenAt: Date.now(),
          });
          const result = await request<any>('/api/me');
          if (Number(result.highestRarity) < 100_000_000_000_000_000) throw new Error('High-rarity best regressed during refresh.');
          return result;
        },
        result => 'highest=' + formatRarity(result.highestRarity),
      );


      await step(
        "API · Final fixture baseline",
        async () => {
          const result = await request<any>('/api/dev/reset-all', {});
          const state = recordValue(result.state);
          if (Number(state.coins) !== 50 || Number(state.shards) !== 5 || Number(state.xp) !== 0 || Number(state.level) !== 1) {
            throw new Error('Reset baseline was not restored: coins=' + state.coins + ', shards=' + state.shards + ', xp=' + state.xp + ', level=' + state.level + '.');
          }
          return state;
        },
        state => 'coins=' + state.coins + ' · shards=' + state.shards + ' · xp=' + state.xp + ' · level=' + state.level,
      );

      await step(
        'API · Seed level-gated feature fixture',
        async () => {
          const result = await request<any>('/api/dev/state', {
            coins: 100_000,
            shards: 100,
            xp: 100_000,
            level: 32,
            lastRollAt: 0,
          });
          const written = recordValue(result.state);
          if (Number(written.level) < 20) {
            throw new Error('Level-gated API fixture write returned Level ' + written.level + ' instead of Level 20+.');
          }
          // Verify through the normal player-read path used by the feature gate,
          // not just the admin mutation response. This catches saves that look
          // correct in the admin response but were not available to game routes.
          const state = recordValue(await request<any>('/api/me'));
          if (Number(state.level) < 20 || Number(state.xp) < 100_000) {
            throw new Error('Feature gate could not read the seeded state (level=' + state.level + ', xp=' + state.xp + ').');
          }
          return state;
        },
        state => 'coins=' + state.coins + ' · shards=' + state.shards + ' · xp=' + state.xp + ' · level=' + state.level,
      );

      await step(
        "API · Nested upgrade state mutation",
        async () => {
          const result = await request<any>('/api/dev/state', { coins: 1_000, upgrades: { luck: 7 } });
          if (Number(result.state?.upgrades?.luck) !== 7) throw new Error('Luck upgrade mutation did not persist.');
          return result.state;
        },
        state => 'luck=' + state.upgrades.luck,
      );

      await step(
        "API · Nested prestige state mutation",
        async () => {
          const result = await request<any>('/api/dev/state', { prestigeUpgrades: { permLuck: 3 } });
          if (Number(result.state?.prestigeUpgrades?.permLuck) !== 3) throw new Error('Prestige mutation did not persist.');
          return result.state;
        },
        state => 'permLuck=' + state.prestigeUpgrades.permLuck,
      );

      await step(
        "API · Nested mastery state mutation",
        async () => {
          const result = await request<any>('/api/dev/state', { masterySkills: { continuumLuck: 4 } });
          if (Number(result.state?.masterySkills?.continuumLuck) !== 4) throw new Error('Mastery mutation did not persist.');
          return result.state;
        },
        state => 'continuumLuck=' + state.masterySkills.continuumLuck,
      );

      await step(
        "API · Automation state mutation",
        async () => {
          const result = await request<any>('/api/dev/state', { automations: { autoQuestClaim: true } });
          if (result.state?.automations?.autoQuestClaim !== true) throw new Error('Automation state mutation did not persist.');
          return result.state;
        },
        state => 'autoQuestClaim=' + state.automations.autoQuestClaim,
      );

      await step(
        "API · Active booster state mutation",
        async () => {
          const result = await request<any>('/api/dev/state', { activeBoosters: { fortune: Date.now() + 60_000 } });
          if (!(Number(result.state?.activeBoosters?.fortune) > Date.now())) throw new Error('Active booster timestamp did not persist.');
          return result.state;
        },
        state => 'fortune expiry=' + state.activeBoosters.fortune,
      );

      await step(
        "API · Altar sacrifice state mutation",
        async () => {
          const result = await request<any>('/api/dev/state', {
            sacrifices: { coinsSacrificed: 50_000, shardsSacrificed: 5, altarLevel: 3, luckSurgeUntil: 0 },
          });
          const sacrifices = result.state?.sacrifices;
          if (Number(sacrifices?.altarLevel) !== 3 || Number(sacrifices?.shardsSacrificed) !== 5) {
            throw new Error('Altar state mutation did not persist.');
          }
          return sacrifices;
        },
        value => 'altar=' + value.altarLevel + ' · infused shards=' + value.shardsSacrificed,
      );

      await step(
        "API · Collection state sanitizes zero and negative counts",
        async () => {
          // Player-state API responses intentionally strip the full collection payload;
          // verify the persisted result through the paginated collection endpoint.
          await request<any>('/api/dev/state', {
            xp: 100_000,
            collection: { '2': 3, '3': 0, '4': -5, '5': 2 },
          });
          const result = await request<any>('/api/collection?offset=0&limit=100&tier=all&sort=rarity_desc');
          const items = Array.isArray(result.items) ? result.items as Array<{ rarity: number; count: number }> : [];
          const count = (rarity: number) => Number(items.find(item => Number(item.rarity) === rarity)?.count ?? 0);
          if (count(2) !== 3 || count(5) !== 2) {
            throw new Error('Valid collection counts were not preserved by persisted collection endpoint (2=' + count(2) + ', 5=' + count(5) + ').');
          }
          if (count(3) !== 0 || count(4) !== 0) {
            throw new Error('Zero/negative collection counts were retained (3=' + count(3) + ', 4=' + count(4) + ').');
          }
          return { two: count(2), five: count(5) };
        },
        value => 'kept 2=' + value.two + ', 5=' + value.five + ' · zero/negative entries omitted',
      );

      await step(
        "API · Currency mutation adds exact integer amounts",
        async () => {
          await request<any>('/api/dev/state', { coins: 100, shards: 10, cosmicDust: 2 });
          const result = await request<any>('/api/dev/currency', { coins: 25, shards: 3, dust: 4 });
          if (Number(result.state?.coins) !== 125 || Number(result.state?.shards) !== 13 || Number(result.state?.cosmicDust) !== 6) {
            throw new Error('Currency mutation produced the wrong totals.');
          }
          return result.state;
        },
        state => 'coins=' + state.coins + ' · shards=' + state.shards + ' · dust=' + state.cosmicDust,
      );

      await step(
        "API · Currency mutation clamps negative totals",
        async () => {
          await request<any>('/api/dev/state', { coins: 10, shards: 5, cosmicDust: 2 });
          const result = await request<any>('/api/dev/currency', { coins: -100, shards: -100, dust: -100 });
          if (Number(result.state?.coins) !== 0 || Number(result.state?.shards) !== 0 || Number(result.state?.cosmicDust) !== 0) {
            throw new Error('Negative currency total survived.');
          }
          return result.state;
        },
        state => 'coins=' + state.coins + ' · shards=' + state.shards + ' · dust=' + state.cosmicDust,
      );

      await step(
        "API · Reset cooldown clears roll lock",
        async () => {
          await request<any>('/api/dev/state', { lastRollAt: Date.now() });
          const result = await request<any>('/api/dev/reset-cooldown', {});
          if (Number(result.state?.lastRollAt ?? 0) !== 0) throw new Error('Roll cooldown was not cleared.');
          return result.state;
        },
        state => 'lastRollAt=' + state.lastRollAt,
      );

      await step(
        "API · Force-roll honors deterministic rarity",
        async () => {
          const result = await request<any>('/api/dev/force-roll', { rarity: 12345, randomValue: 0.999999 });
          if (Number(result.orb?.rarity) !== 12345) throw new Error('Force-roll returned 1/' + result.orb?.rarity + ' instead of 1/12345.');
          return result;
        },
        result => 'forced 1/' + formatRarity(result.orb.rarity, result.orb.isInfinity),
      );

      await step(
        "API · Force-roll increments processed roll count",
        async () => {
          await request<any>('/api/dev/state', {
            totalRolls: 100,
            currentRunRolls: 0,
            xp: 600,
            level: 4,
            levelXpFloor: 533,
            upgrades: { multi: 0, clusterRoll: 0 },
            prestigeUpgrades: { astralBarrage: 0, astralArsenal: 0 },
            masterySkills: { celestialVolley: 0 },
            activeBoosters: { fortune: 0, hyperdrive: 0, barrage: 0, prosperity: 0, ascension: 0 },
          });
          const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
          if (Number(result.state?.totalRolls) !== 101 || Number(result.state?.currentRunRolls) !== 1) {
            throw new Error('Force-roll counters were not incremented.');
          }
          return result.state;
        },
        state => 'totalRolls=' + state.totalRolls + ' · currentRun=' + state.currentRunRolls,
      );

      await step(
        "API · Force-roll persists collection entry",
        async () => {
          await request<any>('/api/dev/state', { xp: 600, level: 4, levelXpFloor: 533, collection: {}, highestRarity: 0, collectionValue: 0 });
          await request<any>('/api/dev/force-roll', { rarity: 777, randomValue: 0.999999 });
          const collection = await request<any>('/api/collection?offset=0&limit=100&tier=all&sort=rarity_desc');
          const item = Array.isArray(collection.items)
            ? collection.items.find((entry: any) => Number(entry.rarity) === 777)
            : null;
          if (!item || Number(item.count) < 1) throw new Error('Forced 1/777 orb was not persisted in the collection endpoint.');
          return item;
        },
        item => '1/777 count=' + item.count,
      );

      await step(
        "API · Offline exact setter",
        async () => {
          const result = await request<any>('/api/dev/offline-set', { amount: 17 });
          if (Number(result.state?.offlineRolls) !== 17) throw new Error('Offline exact setter returned ' + result.state?.offlineRolls + '.');
          return result.state;
        },
        state => 'offlineRolls=' + state.offlineRolls,
      );

      await step(
        "API · Offline add increments stored rolls",
        async () => {
          await request<any>('/api/dev/offline-set', { amount: 17 });
          const result = await request<any>('/api/dev/add-offline', { amount: 8 });
          if (Number(result.state?.offlineRolls) !== 25) throw new Error('Offline add produced ' + result.state?.offlineRolls + ', expected 25.');
          return result.state;
        },
        state => 'offlineRolls=' + state.offlineRolls,
      );

      await step(
        "API · Offline claim consumes seeded rolls",
        async () => {
          await request<any>('/api/dev/offline-set', { amount: 3 });
          await request<any>('/api/dev/state', {
            lastSeenAt: Date.now(),
            xp: 600,
            level: 4,
            levelXpFloor: 533,
            upgrades: { multi: 0, clusterRoll: 0 },
            prestigeUpgrades: { astralBarrage: 0, astralArsenal: 0 },
            masterySkills: { celestialVolley: 0 },
            activeBoosters: { fortune: 0, hyperdrive: 0, barrage: 0, prosperity: 0, ascension: 0 },
          });
          const result = await request<any>('/api/offline/claim', {});
          if (Number(result.rollsProcessed) !== 3) throw new Error('Offline claim processed ' + result.rollsProcessed + ', expected 3.');
          if (Number(result.state?.offlineRolls) !== 0) throw new Error('Offline rolls were not consumed.');
          return result;
        },
        result => 'processed=' + result.rollsProcessed + ' · remaining=' + result.state.offlineRolls,
      );

      await step(
        "API · Daily reset clears daily Frenzy and streak fields",
        async () => {
          await request<any>('/api/dev/state', {
            lastFrenzyDate: '2020-01-01',
            lastFrenzyClaimDate: '2020-01-01',
            lastDailyReset: '2020-01-01',
          });
          const result = await request<any>('/api/dev/reset-daily', {});
          const state = recordValue(result.state);
          if (state.lastFrenzyDate === '2020-01-01' || state.lastFrenzyClaimDate === '2020-01-01') {
            throw new Error('Daily reset did not clear daily Frenzy dates.');
          }
          return state;
        },
        () => 'daily reset applied',
      );

      await step(
        "API · Online endpoint returns a nonnegative population",
        async () => {
          await request<any>('/api/dev/state', { xp: 10_000 });
          const unlocked = await request<any>('/api/me');
          if (Number(unlocked.level) < 7) throw new Error('Could not prepare the Level 7 social fixture; level=' + unlocked.level + '.');
          const result = await request<any>('/api/online');
          if (!Number.isFinite(Number(result.onlinePlayers)) || Number(result.onlinePlayers) < 0) throw new Error('Invalid online population.');
          return result;
        },
        result => 'onlinePlayers=' + result.onlinePlayers + ' · social fixture unlocked',
      );

      await step(
        "API · Global Booster snapshot exposes all three boosters",
        async () => {
          const result = await request<any>('/api/global-boosters');
          for (const id of ['luck', 'speed', 'crit']) {
            if (!result?.[id]) throw new Error('Missing Global Booster ' + id + '.');
          }
          return result;
        },
        snapshot => 'luck=' + snapshot.luck.tier + ' · speed=' + snapshot.speed.tier + ' · crit=' + snapshot.crit.tier,
      );

      await step(
        "API · Global Booster announcement is initially readable",
        async () => {
          const result = await request<any>('/api/global-booster-announcement');
          if (result !== null && typeof result !== 'object') throw new Error('Global Booster announcement response was neither null nor an object.');
          if (result && (!result.id || !result.name || !result.username || !Number.isFinite(Number(result.activatedAt)))) {
            throw new Error('Active Global Booster announcement was missing required fields.');
          }
          return result;
        },
        result => result?.username ? 'last activated by u/' + result.username : 'no active announcement',
      );

      await step(
        "API · World event returns a structured community goal",
        async () => {
          const result = await request<any>('/api/world-event');
          if (!result || typeof result !== 'object') throw new Error('World event response was invalid.');
          if (!Number.isFinite(Number(result.goal)) || !Number.isFinite(Number(result.currentProgress))) throw new Error('World event goal/progress was invalid.');
          return result;
        },
        result => 'progress=' + result.currentProgress + '/' + result.goal,
      );

      await step(
        "API · Community event admin reset is reversible",
        async () => {
          const before = await request<any>('/api/world-event');
          const changed = await request<any>('/api/dev/event', { goal: 1234, progress: 7, tier: 2, buffMultiplier: 1.25 });
          if (Number(changed.event?.goal) !== 1234 || Number(changed.event?.currentProgress) !== 7 || Number(changed.event?.tier) !== 2) {
            throw new Error('Community event admin mutation did not apply.');
          }
          await request<any>('/api/dev/event', {
            goal: before.goal,
            progress: before.currentProgress,
            tier: before.tier,
            buffMultiplier: before.buffMultiplier,
          });
          return changed.event;
        },
        event => 'temporary event=' + event.currentProgress + '/' + event.goal + ' · restored',
      );

      await step(
        "API · Developer announcement round-trip",
        async () => {
          const message = '[ADMIN TEST] announcement round-trip ' + Date.now();
          await request<any>('/api/dev/announcement', { message });
          const result = await request<any>('/api/developer-announcement');
          if (result.message !== message) throw new Error('Developer announcement did not round-trip.');
          return result;
        },
        result => 'announcement=' + result.message,
      );

      await step(
        "API · Dev context identifies the current session",
        async () => {
          const result = await request<any>('/api/dev/context');
          if (!result.username || !result.userId) throw new Error('Admin context is missing username or userId.');
          return result;
        },
        result => 'u/' + result.username + ' · id=' + result.userId,
      );

      await step(
        "API · Dev status reports a healthy admin session",
        async () => {
          const result = await request<any>('/api/dev/status');
          if (result.ok === false) throw new Error('Admin status reported failure.');
          return result;
        },
        () => 'status readable',
      );

      await step(
        "API · Mechanics inspector exposes every authoritative field",
        async () => {
          const result = await request<any>('/api/dev/mechanics');
          const mechanics = recordValue(result.mechanics);
          for (const key of ['luckMultiplier', 'cooldownMs', 'autoCooldownMs', 'rollsPerActivation', 'offlineRollCap', 'effectiveOfflineTickMs', 'critMultiplier', 'altar', 'basePrestigeDust', 'prestigeDust', 'autoUnlocked', 'synthesisUnlocked']) {
            if (!(key in mechanics)) throw new Error('Mechanics field missing: ' + key + '.');
          }
          return mechanics;
        },
        mechanics => 'fields=' + Object.keys(mechanics).length,
      );

      await step(
        "API · Stat Spy exposes allocations and source breakdowns",
        async () => {
          const context = await request<any>('/api/dev/context');
          const result = await request<any>('/api/dev/stat-spy?username=' + encodeURIComponent(context.username));
          if (!Array.isArray(result.stats) || result.stats.length === 0) throw new Error('Stat Spy returned no stats.');
          if (!result.allocations || !result.summary) throw new Error('Stat Spy omitted summary or allocations.');
          for (const stat of result.stats) {
            if (!Array.isArray(stat.sources)) throw new Error('Stat Spy stat lacked source breakdown: ' + stat.label);
          }
          return result;
        },
        result => 'stats=' + result.stats.length + ' · sources broken down',
      );

      await step(
        "API · Player Spy returns activity data",
        async () => {
          const context = await request<any>('/api/dev/context');
          const result = await request<any>('/api/dev/player-spy?username=' + encodeURIComponent(context.username) + '&limit=20');
          if (!Array.isArray(result.logs)) throw new Error('Player Spy did not return an array of logs.');
          if (Number(result.logCount) !== result.logs.length) throw new Error('Player Spy logCount does not match returned logs.');
          return result;
        },
        result => 'logs=' + result.logCount,
      );

      await step(
        "API · Player Spy limit is honored",
        async () => {
          const context = await request<any>('/api/dev/context');
          const result = await request<any>('/api/dev/player-spy?username=' + encodeURIComponent(context.username) + '&limit=1');
          if (result.logs.length > 1) throw new Error('Player Spy returned more than the requested limit.');
          return result;
        },
        result => 'returned=' + result.logs.length + ' · limit=1',
      );

      await step(
        "API · Moderation save inspector sees the current save",
        async () => {
          const context = await request<any>('/api/dev/context');
          const result = await request<any>('/api/dev/moderation/save?username=' + encodeURIComponent(context.username));
          if (result.exists !== true || !result.save) throw new Error('Moderation save inspector could not read the current save.');
          if (String(result.username).toLowerCase() !== String(context.username).toLowerCase()) throw new Error('Moderation save inspector resolved the wrong username.');
          return result;
        },
        result => 'save exists · generation=' + result.generation,
      );

      await step(
        "API · Player registry contains the admin account",
        async () => {
          const context = await request<any>('/api/dev/context');
          const result = await request<any>('/api/dev/players');
          const players = Array.isArray(result) ? result : result.players;
          if (!Array.isArray(players)) throw new Error('Player list response was invalid.');
          const match = players.find((player: any) => String(player.username).toLowerCase() === String(context.username).toLowerCase());
          if (!match) throw new Error('Current admin player was not present in the registry.');
          if (!Number.isFinite(Number(match.currentSessionMs)) || Number(match.currentSessionMs) < 0) {
            throw new Error('Player list omitted a valid currentSessionMs value.');
          }
          return match;
        },
        player => 'u/' + player.username + ' · level=' + player.level,
      );

      await step(
        "API · Save debug log contains recent test activity",
        async () => {
          const result = await request<any>('/api/dev/save-logs');
          const logs = Array.isArray(result) ? result : result.logs;
          if (!Array.isArray(logs) || logs.length === 0) throw new Error('Save debug log is empty after state mutations.');
          return logs;
        },
        logs => 'save logs=' + logs.length,
      );

      await step(
        "API · Global Booster debug log records activations",
        async () => {
          await request<any>('/api/dev/state', { shards: 50 });
          await request<any>('/api/global-boosters/activate', { id: 'luck' });
          const result = await request<any>('/api/dev/global-booster-logs');
          const logs = Array.isArray(result) ? result : result.logs;
          if (!Array.isArray(logs) || logs.length === 0) throw new Error('Global Booster debug log did not record the activation.');
          return logs;
        },
        logs => 'booster logs=' + logs.length,
      );

      await step(
        "API · Global Luck activation changes its tier",
        async () => {
          const result = await request<any>('/api/global-boosters');
          if (Number(result?.luck?.tier) < 1) throw new Error('Global Luck did not activate.');
          return result.luck;
        },
        state => 'Luck tier=' + state.tier,
      );

      await step(
        "API · Global Luck can stack repeatedly",
        async () => {
          await request<any>('/api/dev/state', { shards: 200, lastSeenAt: Date.now() });
          for (let i = 0; i < 3; i += 1) {
            await request<any>('/api/global-boosters/activate', { id: 'luck' });
          }
          const result = await request<any>('/api/global-boosters');
          if (Number(result?.luck?.activationProgress) < 3 && Number(result?.luck?.tier) < 2) {
            throw new Error('Repeated Global Luck activation did not advance progress.');
          }
          return result.luck;
        },
        state => 'Luck tier=' + state.tier + ' · progress=' + state.activationProgress,
      );

      await step(
        "API · Global Speed activation reduces cooldown",
        async () => {
          await request<any>('/api/dev/global-booster', { id: 'speed', tier: 0, minutes: 1 });
          await request<any>('/api/dev/state', { shards: 50 });
          const before = await request<any>('/api/dev/mechanics');
          await request<any>('/api/global-boosters/activate', { id: 'speed' });
          const after = await request<any>('/api/dev/mechanics');
          if (!(Number(after.mechanics.cooldownMs) < Number(before.mechanics.cooldownMs))) {
            throw new Error('Global Speed did not reduce cooldown.');
          }
          return { before, after };
        },
        result => 'cooldown ' + result.before.mechanics.cooldownMs + 'ms → ' + result.after.mechanics.cooldownMs + 'ms',
      );

      await step(
        "API · Global Crit activation returns a valid crit layer",
        async () => {
          await request<any>('/api/dev/global-booster', { id: 'crit', tier: 0, minutes: 1 });
          await request<any>('/api/dev/state', { shards: 50 });
          const before = await request<any>('/api/dev/mechanics');
          await request<any>('/api/global-boosters/activate', { id: 'crit' });
          const after = await request<any>('/api/dev/mechanics');
          if (!Number.isFinite(Number(after.mechanics.critMultiplier)) || Number(after.mechanics.critMultiplier) < 1) {
            throw new Error('Global Crit produced an invalid crit multiplier.');
          }
          if (Number(after.mechanics.critMultiplier) < Number(before.mechanics.critMultiplier)) {
            throw new Error('Global Crit reduced the crit multiplier.');
          }
          return { before, after };
        },
        result => 'crit multiplier=' + result.after.mechanics.critMultiplier,
      );

      await step(
        "API · Global Booster clear removes temporary state",
        async () => {
          await request<any>('/api/dev/global-booster', { id: 'luck', tier: 0, minutes: 1 });
          await request<any>('/api/dev/global-booster', { id: 'speed', tier: 0, minutes: 1 });
          await request<any>('/api/dev/global-booster', { id: 'crit', tier: 0, minutes: 1 });
          const result = await request<any>('/api/global-boosters');
          for (const id of ['luck', 'speed', 'crit']) {
            if (Number(result?.[id]?.tier) !== 0) throw new Error('Global ' + id + ' did not clear.');
          }
          return result;
        },
        () => 'all global boosters cleared',
      );

      await step(
        "API · Collection pagination obeys limit",
        async () => {
          await request<any>('/api/dev/state', { collection: { '2': 1, '3': 1, '4': 1, '5': 1, '6': 1 } });
          const result = await request<any>('/api/collection?offset=0&limit=2&tier=all&sort=rarity_desc');
          if (!Array.isArray(result.items) || result.items.length > 2) throw new Error('Collection pagination returned ' + result.items?.length + ' items for limit=2.');
          return result;
        },
        result => 'returned=' + result.items.length + ' · limit=2',
      );

      await step(
        "API · Collection rarity-desc sorting is ordered",
        async () => {
          const result = await request<any>('/api/collection?offset=0&limit=100&tier=all&sort=rarity_desc');
          const rarities = (result.items ?? []).map((item: any) => Number(item.rarity));
          for (let i = 1; i < rarities.length; i += 1) {
            if (rarities[i] > rarities[i - 1]) throw new Error('Collection rarity-desc order broke at index ' + i + '.');
          }
          return rarities;
        },
        rarities => 'sorted ' + rarities.length + ' entries',
      );

      await step(
        "API · Collection count sorting returns entries without crashing",
        async () => {
          const result = await request<any>('/api/collection?offset=0&limit=100&tier=all&sort=count');
          if (!Array.isArray(result.items)) throw new Error('Collection count sort returned no items array.');
          return result;
        },
        result => 'count-sorted entries=' + result.items.length,
      );

      await step(
        "API · Leaderboard endpoint remains readable after state mutations",
        async () => {
          const result = await request<any>('/api/leaderboard');
          const entries = Array.isArray(result) ? result : result.entries;
          if (!Array.isArray(entries)) throw new Error('Leaderboard response was invalid.');
          return entries;
        },
        entries => 'leaderboard entries=' + entries.length,
      );

      await step(
        "API · Social visit mutation succeeds",
        async () => {
          const result = await request<any>('/api/social/visit', {});
          if (result?.ok !== true) throw new Error('Social visit did not return ok=true.');
          return result;
        },
        () => 'social visit recorded',
      );

      await step(
        "API · Share creates an owned-orb community post",
        async () => {
          await request<any>('/api/dev/state', {
            coins: 100_000,
            shards: 50,
            collection: { '100': 1 },
            highestRarity: 100,
            collectionValue: 100,
            lastShareAt: 0,
          });
          const result = await request<any>('/api/share', { rarity: 100 });
          if (result.success !== true || !result.id) throw new Error('Share endpoint did not create a post.');
          return result;
        },
        result => 'shared post=' + result.id,
      );

      await step(
        "API · Share immediately records leaderboard eligibility",
        async () => {
          const result = await request<any>('/api/leaderboard');
          const entries = Array.isArray(result) ? result : result.entries;
          const context = await request<any>('/api/dev/context');
          const match = entries.find((entry: any) => String(entry.username).toLowerCase() === String(context.username).toLowerCase());
          if (!match) throw new Error('Current player was not eligible immediately after sharing.');
          if (!Number.isFinite(Number(match.sharedAt))) throw new Error('Leaderboard share timestamp was missing.');
          return match;
        },
        entry => 'leaderboard share recorded at ' + entry.sharedAt,
      );

      await step(
        "API · Share cooldown rejects immediate repeat posts",
        async () => {
          let rejected = false;
          try {
            await request<any>('/api/share', { rarity: 100 });
          } catch {
            rejected = true;
          }
          if (!rejected) throw new Error('Share cooldown allowed an immediate second post.');
          return true;
        },
        () => '30-second share cooldown enforced',
      );

      await step(
        "API · Frenzy admin start creates a dedicated post record",
        async () => {
          await request<any>('/api/dev/frenzy/reset', {});
          await request<any>('/api/dev/state', { coins: 100_000, shards: 50, lastFrenzyDate: '', lastFrenzyClaimDate: '' });
          const result = await request<any>('/api/dev/frenzy/start', { rarity: 250 });
          const orbRarity = Number(result.orb?.rarity ?? 0);
          const returnedRarity = Number(result.rarity ?? 0);
          // Critical hits may legitimately multiply the forced starting rarity.
          if (!result.postId || !result.url || orbRarity < 250 || returnedRarity !== orbRarity) {
            throw new Error(
              'Admin Frenzy did not create the expected post/result: postId=' + Boolean(result.postId) +
              ', url=' + Boolean(result.url) +
              ', orbRarity=' + orbRarity +
              ', returnedRarity=' + returnedRarity + '.'
            );
          }
          return result;
        },
        result => 'post=' + result.postId + ' · 1/' + formatRarity(result.orb.rarity, result.orb.isInfinity),
      );

      await step(
        "API · Frenzy admin claim returns the authoritative volley and owner reward",
        async () => {
          const start = await request<any>('/api/dev/frenzy/start', { rarity: 250 });
          const before = await request<any>('/api/me');
          const result = await request<any>('/api/dev/frenzy/claim', { postId: start.postId });
          const processed = Number(result.state?.totalRolls) - Number(before.totalRolls);
          if (!(processed >= 1) || !Array.isArray(result.batch) || result.batch.length < 1) {
            throw new Error('Frenzy claim did not return a processed roll and visible batch.');
          }
          if (Number(result.shardsGained) < 5) throw new Error('Frenzy owner did not receive the +5 Shard reward.');
          return { result, processed };
        },
        result => 'processed=' + result.processed + ' · shards +' + result.result.shardsGained,
      );

      await step(
        "API · Frenzy claim marks the player as claimed for today",
        async () => {
          const result = await request<any>('/api/me');
          if (String(result.lastFrenzyClaimDate) !== new Date().toISOString().slice(0, 10)) {
            throw new Error('Frenzy claim date was not persisted for today.');
          }
          return result;
        },
        result => 'lastFrenzyClaimDate=' + result.lastFrenzyClaimDate,
      );

      await step(
        'Restore Clean Final Test State',
        async () => {
          await request('/api/dev/reset-all', {});
          return request('/api/dev/state', {
            coins: 100_000,
            shards: 10,
            xp: 32_000,
            prestigeUpgrades: { shardSynthesis: 1 },
            lastRollAt: 0,
            lastSeenAt: Date.now(),
          });
        },
        result => 'fresh final fixture · ' + stateSummary(result),
      );

      await step(
        'Seed Final Baseline Orb',
        () => request<any>('/api/dev/force-roll', { rarity: 100, randomValue: 0.999999 }),
        result => '1/' + formatRarity(result.orb?.rarity ?? 0, result.orb?.isInfinity) + ' · tier=' + result.orb?.tier,
      );

      await step(
        'Synthesize Cosmic Dust',
        () => request<{ state: any; dustEarned: number }>('/api/prestige/synthesize', {}),
        result => `dust +${shortNumber(result.dustEarned, 0)} · ${stateSummary(result)}`,
      );

      await step(
        'Final client state read',
        () => request<any>('/api/me'),
        result => `level=${shortNumber(result.level, 0)} · rolls=${shortNumber(result.totalRolls, 0)} · highest=${shortRarity(result.highestRarity)} · dust=${shortNumber(result.cosmicDust, 0)}`,
      );

      const totalMs = performance.now() - startedAt;
      setMessage(
        `Full test finished in ${formatNumber(Math.round(totalMs))}ms · ${passed} passed · ${failed} failed · ${skipped} skipped.`,
      );
      setFullTestCurrentAction('Completed');
      await onRefresh().catch(() => null);
    } catch (error) {
      const totalMs = performance.now() - startedAt;
      failed += 1;
      appendTestLog(
        'Runner',
        'FAIL',
        totalMs,
        error instanceof Error ? error.message : String(error),
      );
      setMessage(
        `Full test aborted after ${Math.round(totalMs).toLocaleString()}ms · ${passed} passed · ${failed} failed · ${skipped} skipped.`,
      );
      setFullTestCurrentAction('Aborted');
    } finally {
      setFullTestRunning(false);
    }
  };

  const confirmation = (text: string) => window.confirm(text);
  const requestWipeConfirmation = (action: 'wipe-game' | 'wipe-and-ban' | 'wipe-and-unban') => {
    const username = targetUser.trim().replace(/^u\//i, '');
    if (!username) return;

    if (pendingWipe?.action === action && pendingWipe.username.toLowerCase() === username.toLowerCase()) {
      setPendingWipe(null);
      const endpoint = action === 'wipe-game'
        ? '/api/dev/moderation/wipe-game'
        : action === 'wipe-and-ban'
          ? '/api/dev/moderation/wipe-and-ban'
          : '/api/dev/moderation/wipe-and-unban';
      const body = action === 'wipe-game' || action === 'wipe-and-unban'
        ? { username }
        : {
            username,
            durationDays: banDuration === 'permanent' ? null : Number(banDuration),
            reason: banReason,
          };
      const label = action === 'wipe-game' ? 'Wiped' : action === 'wipe-and-ban' ? 'Wiped and banned' : 'Wiped and unbanned';
      void sendAdminAction(endpoint, body, true, label + ' u/' + username + ' successfully.');
      return;
    }

    setPendingWipe({ action, username });
    setMessage('Click the same wipe button again to confirm for u/' + username + '.');
  };


  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
      <div className="bg-slate-900 border border-emerald-500/50 rounded-3xl p-4 sm:p-6 max-w-5xl w-full space-y-4 shadow-2xl relative max-h-[94vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur z-10">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white">Admin Console</h3>
              <p className="text-xs text-slate-400">Server-authorized testing and moderation controls.</p>
              <p className="text-[10px] text-emerald-400/70 font-mono">Game moderation: {contextInfo?.gameModerationVersion ?? "loading"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button"
              title="Jump to aggregate Impressions analytics."
              onClick={() => {
                document.getElementById('io-impressions-tab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                void loadImpressions();
              }}
              className={buttonBase + ' bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-200 px-3 py-2'}
            >
              <Eye className="inline w-3.5 h-3.5 mr-1" /> Impressions
            </button>
            <button type="button" title="Close the admin console." onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <section id="io-impressions-tab" className={panelBase + ' border border-cyan-500/30 scroll-mt-4'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-200">
                <Eye className="w-4 h-4" /> Impressions
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Aggregate app-preview loads for main-game, Orb Share, and Frenzy posts. These are not Reddit feed views or online players. No usernames, user IDs, or raw device fingerprints are stored.
              </p>
            </div>
            <button type="button"
              title="Refresh aggregate post impression data."
              disabled={impressionsLoading}
              onClick={() => void loadImpressions()}
              className={buttonBase + ' bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-200 px-3 py-2 shrink-0'}
            >
              <RefreshCw className={'inline w-3.5 h-3.5 mr-1 ' + (impressionsLoading ? 'animate-spin' : '')} />
              {impressionsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {impressionsError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-200">
              {impressionsError}
            </div>
          )}
          {impressionStats ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {([
                  ['All-time impressions', impressionStats.total, 'text-cyan-200'],
                  ['Main game', impressionStats.byType['main-game'], 'text-emerald-200'],
                  ['Orb Share', impressionStats.byType['orb-share'], 'text-violet-200'],
                  ['Frenzy', impressionStats.byType.frenzy, 'text-orange-200'],
                ] as const).map(([label, count, color]) => (
                  <div key={label} className="rounded-xl bg-slate-900/80 border border-slate-800 px-3 py-3">
                    <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
                    <div className={'text-2xl font-black font-mono mt-1 ' + color}>{count.toLocaleString()}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Device breakdown · aggregate only</div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {(['mobile', 'tablet', 'desktop', 'unknown'] as ImpressionDeviceType[]).map(device => (
                    <div key={device} className="rounded-lg bg-black/20 border border-slate-800 p-2">
                      <div className="text-[10px] uppercase text-slate-500">{device}</div>
                      <div className="text-lg font-bold font-mono text-slate-100">{impressionStats.byDevice[device].toLocaleString()}</div>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[10px]">
                    <thead><tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 pr-3">Post type</th>
                      <th className="py-2 px-2">Mobile</th>
                      <th className="py-2 px-2">Tablet</th>
                      <th className="py-2 px-2">Desktop</th>
                      <th className="py-2 px-2">Unknown</th>
                    </tr></thead>
                    <tbody>
                      {(['main-game', 'orb-share', 'frenzy'] as ImpressionPostType[]).map(type => (
                        <tr key={type} className="border-b border-slate-800/70 text-slate-300">
                          <td className="py-2 pr-3 font-semibold">{type === 'main-game' ? 'Main game' : type === 'orb-share' ? 'Orb Share' : 'Frenzy'}</td>
                          {(['mobile', 'tablet', 'desktop', 'unknown'] as ImpressionDeviceType[]).map(device => (
                            <td key={device} className="py-2 px-2 font-mono">{impressionStats.byTypeAndDevice[type][device].toLocaleString()}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-800">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Individual post performance · {impressionStats.posts.length.toLocaleString()} listed / {impressionStats.trackedPostCount.toLocaleString()} tracked
                  </div>
                  <p className="mt-1 text-[9px] text-slate-600">Shows the highest load counts among the 500 most recently seen post IDs; type totals and time trends cover all recorded impressions.</p>
                </div>
                {impressionStats.posts.length ? (
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-left text-[10px]">
                      <thead className="sticky top-0 bg-slate-900 text-slate-500"><tr>
                        <th className="px-3 py-2">Type</th><th className="px-3 py-2">Reddit post ID</th><th className="px-3 py-2 text-right">Loads</th>
                      </tr></thead>
                      <tbody>
                        {impressionStats.posts.map(post => (
                          <tr key={post.postType + ':' + post.postId} className="border-t border-slate-800/70">
                            <td className="px-3 py-2 text-slate-300">{post.postType === 'main-game' ? 'Main game' : post.postType === 'orb-share' ? 'Orb Share' : 'Frenzy'}</td>
                            <td className="px-3 py-2 font-mono text-slate-500 break-all">{post.postId}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-cyan-200">{post.impressions.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 text-xs text-slate-500 text-center">No impressions have been recorded yet.</div>
                )}
              </div>

              <details className="rounded-xl border border-slate-800 bg-black/10 p-3">
                <summary className="cursor-pointer text-[10px] uppercase tracking-wider font-bold text-slate-400">Hourly trend · last 24 hours</summary>
                <div className="mt-3 max-h-64 overflow-auto divide-y divide-slate-800/70">
                  {impressionStats.last24Hours.slice().reverse().map(point => (
                    <div key={point.bucket} className="flex items-center gap-3 py-2 text-[10px]">
                      <span className="w-36 shrink-0 font-mono text-slate-500">{new Date(point.bucket).toLocaleString()}</span>
                      <span className="w-12 text-right font-mono font-bold text-cyan-200">{point.total.toLocaleString()}</span>
                      <span className="text-emerald-200">Main {point.byType['main-game'].toLocaleString()}</span>
                      <span className="text-violet-200">Share {point.byType['orb-share'].toLocaleString()}</span>
                      <span className="text-orange-200">Frenzy {point.byType.frenzy.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </details>
              <details className="rounded-xl border border-slate-800 bg-black/10 p-3">
                <summary className="cursor-pointer text-[10px] uppercase tracking-wider font-bold text-slate-400">Daily trend · last 30 days</summary>
                <div className="mt-3 max-h-64 overflow-auto divide-y divide-slate-800/70">
                  {impressionStats.last30Days.slice().reverse().map(point => (
                    <div key={point.bucket} className="flex items-center gap-3 py-2 text-[10px]">
                      <span className="w-24 shrink-0 font-mono text-slate-500">{point.bucket}</span>
                      <span className="w-12 text-right font-mono font-bold text-cyan-200">{point.total.toLocaleString()}</span>
                      <span className="text-emerald-200">Main {point.byType['main-game'].toLocaleString()}</span>
                      <span className="text-violet-200">Share {point.byType['orb-share'].toLocaleString()}</span>
                      <span className="text-orange-200">Frenzy {point.byType.frenzy.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </details>
              <div className="text-[9px] text-slate-600">
                Last refreshed {new Date(impressionStats.generatedAt).toLocaleString()}. A counted impression means the app preview loaded; Reddit feed impressions are not exposed to this app. Repeated loads are counted as separate impressions.
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-500">
              {impressionsLoading ? 'Loading aggregate impression statistics…' : 'Refresh to load impression statistics.'}
            </div>
          )}
        </section>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5">
            <div className="text-[9px] uppercase font-bold text-emerald-400">Admin</div>
            <div className="text-xs font-mono text-white truncate">{contextInfo?.username ?? '...'}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
            <div className="text-[9px] uppercase font-bold text-slate-500">User ID</div>
            <div className="text-[10px] font-mono text-slate-300 truncate">{contextInfo?.userId ?? '...'}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
            <div className="text-[9px] uppercase font-bold text-slate-500">Subreddit</div>
            <div className="text-xs font-semibold text-white truncate">{contextInfo?.subredditName ? `r/${contextInfo.subredditName}` : 'No context'}</div>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
            <div className="text-[9px] uppercase font-bold text-slate-500">Post</div>
            <div className="text-[10px] font-mono text-slate-300 truncate">{contextInfo?.postId ?? 'Game root'}</div>
          </div>
        </div>

        {message && (
          <div className="text-xs font-semibold px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-emerald-400">
            {message}
          </div>
        )}

        {chatReportsUnread > 0 && (
          <section className="rounded-2xl border border-rose-500/50 bg-rose-950/25 p-4 space-y-3 shadow-lg shadow-rose-950/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-rose-200">
                  <BellRing className="w-4 h-4" /> Chat Report Notification
                  <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[9px] text-white">{chatReportsUnread} new</span>
                </div>
                <p className="mt-1 text-[10px] text-rose-200/70">
                  A player reported an in-game chat message. Review the report below and mark it read after handling it.
                </p>
              </div>
              <button type="button"
                disabled={chatReportsLoading}
                onClick={() => void loadChatReports()}
                className={buttonBase + ' bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-200 px-3 py-2'}
              >
                {chatReportsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div className="space-y-2">
              {chatReports.filter(report => !report.readAt).slice(0, 5).map(report => (
                <div key={report.reportId} className="rounded-xl border border-rose-500/20 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="font-bold text-slate-200">{report.scope} · u/{report.author}</span>
                    <span className="text-slate-600">{new Date(report.reportedAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-300 whitespace-pre-wrap break-words">{report.text}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[9px] text-slate-500">Reported by u/{report.reporter} · message {report.messageId}</span>
                    <span
                      className={report.status === 'pending' ? 'text-[9px] text-amber-300' : 'text-[9px] text-slate-500'}
                      title={report.status === 'pending' ? 'Modmail may or may not have been created; check subreddit Modmail before retrying.' : undefined}
                    >
                      {report.status === 'pending'
                        ? 'Modmail outcome uncertain · check Modmail'
                        : report.status === 'sent' ? 'Modmail sent' : 'Legacy report'}
                    </span>
                    <button type="button"
                      onClick={() => void markChatReportRead(report.reportId)}
                      className={buttonBase + ' bg-rose-600/20 hover:bg-rose-600/30 border-rose-500/40 text-rose-100 px-2.5 py-1.5'}
                    >
                      Mark read
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <details className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-300">
            <span>Diagnostics</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
<section className={panelBase + ' border border-emerald-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
                <ClipboardCheck className="w-4 h-4" /> Full Comprehensive Test
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Rebuilds the current admin save, mutates test data, and drives the same client API endpoints used by gameplay. This intentionally changes the save.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button"
                disabled={fullTestRunning}
                title="Run the full end-to-end admin test. This wipes and rewrites the current admin save."
                onClick={() => {
                  void runFullComprehensiveTest();
                }}
                className={buttonBase + ' bg-emerald-600 hover:bg-emerald-500 border-emerald-500 text-white px-3 py-2'}
              >
                <ClipboardCheck className="inline w-3.5 h-3.5 mr-1" />
                {fullTestRunning ? 'Running…' : 'Run Full Test'}
              </button>
              <button type="button"
                disabled={fullTestRunning || fullTestLogs.length === 0}
                title="Copy the current comprehensive test log."
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      fullTestLogs.map(log =>
                        `[${log.status}] ${log.action} · ${log.durationMs}ms · ${log.detail}`,
                      ).join('\n'),
                    );
                    setMessage('Full comprehensive test log copied.');
                  } catch {
                    setMessage('Could not copy the comprehensive test log.');
                  }
                }}
                className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}
              >
                <Copy className="inline w-3.5 h-3.5 mr-1" /> Copy Log
              </button>
            </div>
          </div>

          {fullTestRunning && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-emerald-300 animate-spin shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] uppercase tracking-wider font-black text-emerald-300">
                    Test running
                  </div>
                  <div className="text-xs text-slate-200 truncate" title={fullTestCurrentAction}>
                    {fullTestCurrentAction || 'Working…'}
                  </div>
                </div>
                <div className="text-[10px] font-mono text-slate-400 shrink-0">
                  {fullTestLogs.length} completed
                </div>
              </div>
            </div>
          )}

          {!fullTestRunning && fullTestCurrentAction && fullTestLogs.length > 0 && (
            <div className="text-[10px] text-slate-500">
              Last run: <span className="text-slate-300">{fullTestCurrentAction}</span> · {fullTestLogs.length} logged steps
            </div>
          )}

          {fullTestLogs.length > 0 ? (
            <pre className="max-h-96 overflow-auto rounded-xl border border-slate-800 bg-black/30 p-3 text-[10px] leading-4 font-mono text-slate-300 whitespace-pre-wrap">
{fullTestLogs.map((log, index) =>
  `[${log.status}] ${log.action} · ${log.durationMs}ms${log.detail ? ` · ${log.detail}` : ''}${index === fullTestLogs.length - 1 && fullTestRunning ? ' · running…' : ''}`,
).join('\n')}
            </pre>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-500">
              No comprehensive test has been run in this admin session.
            </div>
          )}
        </section>
        <section className={panelBase + ' border border-fuchsia-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                <Users className="w-4 h-4" /> Fake CCU
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Adds a testing-only CCU offset to your Luck calculation. It does not change Current CCU or any historical Max CCU metric.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
            <input
              type="number"
              min="0"
              max="1000000"
              step="1"
              value={fakeCcuInput}
              onChange={e => setFakeCcuInput(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                void setFakeCcu(Math.max(0, Math.min(1_000_000, Math.floor(Number(fakeCcuInput) || 0))));
              }}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
              placeholder="Fake CCU to add"
              title="Number of additional virtual players to add to the current real CCU for your Luck calculation."
            />
            <button type="button"
              disabled={ccuLoading}
              onClick={() => void setFakeCcu(Math.max(0, Math.min(1_000_000, Math.floor(Number(fakeCcuInput) || 0))))}
              className={buttonBase + ' bg-fuchsia-600 hover:bg-fuchsia-500 border-fuchsia-500 text-white px-3 py-2'}
            >
              Set Fake CCU
            </button>
            <button type="button"
              disabled={ccuLoading}
              onClick={() => {
                setFakeCcuInput('0');
                void setFakeCcu(0);
              }}
              className={buttonBase + ' bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 px-3 py-2'}
            >
              Clear
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-3 py-3">
              <div className="text-[10px] uppercase font-bold text-slate-500">Real CCU</div>
              <div className="text-lg font-black text-cyan-300 font-mono mt-1">{(ccuStats?.current ?? 0).toLocaleString()}</div>
            </div>
            <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-3 py-3">
              <div className="text-[10px] uppercase font-bold text-slate-500">Luck CCU</div>
              <div className="text-lg font-black text-fuchsia-300 font-mono mt-1">
                {(ccuStats?.effectiveLuckCcu ?? ccuStats?.current ?? 0).toLocaleString()}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">
                +{(ccuStats?.fakeCcuBonus ?? 0).toLocaleString()} fake
              </div>
            </div>
          </div>
        </section>

        <section className={panelBase + ' border border-cyan-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
                <Gauge className="w-4 h-4" /> Max CCU
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Peak concurrent players recorded from the game's 30-second online presence window.
              </p>
            </div>
            <button type="button"
              title="Refresh current and historical peak concurrent-user counts."
              disabled={ccuLoading}
              onClick={() => void loadCcuStats()}
              className={buttonBase + ' bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-300 px-3 py-2'}
            >
              <RefreshCw className="inline w-3.5 h-3.5 mr-1" /> {ccuLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            {[
              ['Current', ccuStats?.current ?? 0],
              ['Last 24 Hours', ccuStats?.last24Hours ?? 0],
              ['Last 7 Days', ccuStats?.last7Days ?? 0],
              ['Last 30 Days', ccuStats?.last30Days ?? 0],
              ['All Time', ccuStats?.allTime ?? 0],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl bg-slate-900/80 border border-slate-800 px-3 py-3 text-center">
                <div className="text-[10px] uppercase font-bold text-slate-500">{label as string}</div>
                <div className="text-xl font-black text-cyan-300 font-mono mt-1">
                  {Number(value).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={panelBase}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
                <Database className="w-4 h-4" /> Reddit Gold Payment Logs
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Persistent server-side trace of the payment callback, buyer resolution, save read, and fulfillment. Run the sandbox purchase first, then press Refresh.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button"
                title="Load the latest payment trace from the server."
                disabled={paymentLogsLoading}
                onClick={() => void loadPaymentLogs()}
                className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}
              >
                {paymentLogsLoading ? 'Loading…' : 'Refresh'}
              </button>
              <button type="button"
                title="Copy the complete payment trace."
                disabled={paymentLogs.length === 0}
                onClick={() => void copyPaymentLogs()}
                className={buttonBase + ' bg-emerald-600/20 border-emerald-500/30 text-emerald-200 px-3 py-2'}
              >
                <Copy className="w-3.5 h-3.5 inline mr-1" /> Copy
              </button>
              <button type="button"
                title="Delete all stored payment traces."
                disabled={paymentLogsLoading || paymentLogs.length === 0}
                onClick={() => void clearPaymentLogs()}
                className={buttonBase + ' bg-red-600/20 border-red-500/30 text-red-200 px-3 py-2'}
              >
                <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Clear
              </button>
            </div>
          </div>

          <textarea
            id="payment-debug-log-copy"
            readOnly
            value={paymentLogs.length > 0 ? JSON.stringify(paymentLogs, null, 2) : 'No payment logs loaded. Run a Reddit Gold sandbox purchase, then press Refresh.'}
            className="w-full min-h-56 max-h-96 rounded-xl border border-slate-800 bg-black/40 p-3 text-[10px] leading-4 font-mono text-slate-300 resize-y"
            onFocus={e => e.currentTarget.select()}
          />
        </section>

        </div>
        </details>

        <details className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-300">
            <span>Controls & Simulation</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">

        <section className={panelBase}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
            <Power className="w-4 h-4" /> Global Booster Control
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <select title="Choose the Global Booster to edit." value={globalBooster} onChange={e => setGlobalBooster(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white">
              <option value="luck">Global Luck</option>
              <option value="speed">Global Speed</option>
              <option value="crit">Global Crit</option>
            </select>
            <select title="Choose the tier to force. Off disables the booster." value={globalTier} onChange={e => setGlobalTier(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white">
              {[0, 1, 5, 10].map(v => <option key={v} value={v}>{v === 0 ? 'Off' : 'Tier ' + v}</option>)}
            </select>
            <input value={globalMinutes} onChange={e => setGlobalMinutes(e.target.value)} type="number" min="1" title="How many minutes the forced Global Booster state should remain active." className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white font-mono" placeholder="minutes" />
            <button type="button"
              title="Set a Global Booster tier and duration directly without spending Shards."
              disabled={loading}
              onClick={() => void sendAdminAction('/api/dev/global-booster', { id: globalBooster, tier: Number(globalTier), minutes: Number(globalMinutes) })}
              className={buttonBase + ' bg-fuchsia-600 hover:bg-fuchsia-500 border-fuchsia-500 text-white px-3 py-2'}
            >
              Set Booster
            </button>
          </div>
        </section>

        <section className={panelBase + ' border border-emerald-500/30'}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <Gift className="w-4 h-4" /> Give Free Global Boosters
          </div>
          <p className="text-[10px] text-slate-500">
            Grants free Global Booster activation credits. Each credit can be used on Global Luck, Global Speed, or Global Crit.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1.3fr_0.6fr] gap-2">
            <input
              value={globalBoosterTargetUser}
              onChange={e => setGlobalBoosterTargetUser(e.target.value)}
              placeholder="Reddit username for one player"
              title="Reddit username to receive free Global Booster activation credits."
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
            />
            <input
              value={globalBoosterCreditAmount}
              onChange={e => setGlobalBoosterCreditAmount(e.target.value)}
              type="number"
              min="1"
              max="1000000"
              title="Number of free Global Booster activation credits to grant."
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
              placeholder="Credits"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button type="button"
              title="Give the entered number of free Global Booster activation credits to one specific Reddit user."
              disabled={globalBoosterGrantLoading || !globalBoosterTargetUser.trim()}
              onClick={() => void grantFreeGlobalBoosters('user')}
              className={buttonBase + ' bg-emerald-600/20 hover:bg-emerald-600/30 border-emerald-500/40 text-emerald-200 px-3 py-2'}
            >
              Give to User
            </button>
            <button
              title="Give the entered number of free Global Booster activation credits to every currently online player."
              type="button"
              onClick={() => void grantFreeGlobalBoosters('online')}
              className={buttonBase + ' bg-cyan-600/20 hover:bg-cyan-600/30 border-cyan-500/40 text-cyan-200 px-3 py-2'}
            >
              {globalBoosterGrantLoading ? 'Granting…' : 'Give to Online'}
            </button>
            <button
              title="Give the entered number of free Global Booster activation credits to every player registered in Infinity Orbs."
              type="button"
              onClick={() => void grantFreeGlobalBoosters('all')}
              className={buttonBase + ' bg-fuchsia-600/20 hover:bg-fuchsia-600/30 border-fuchsia-500/40 text-fuchsia-200 px-3 py-2'}
            >
              {globalBoosterGrantLoading ? 'Granting…' : 'Give to All Users'}
            </button>
          </div>
        </section>

        <section className={panelBase + ' border border-rose-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-300">
                <Save className="w-4 h-4" /> Save Trace
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Persistent diagnostics for save conflicts, including expected/stored revisions, generations, incoming state, stored state, and the save caller.
                Use the Player Spy username field to filter this trace to one player.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" title="Load recent save diagnostics, filtered by the Player Spy username when present." disabled={saveLogsLoading} onClick={() => void loadSaveLogs()} className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}>
                {saveLogsLoading ? 'Loading…' : 'Refresh'}
              </button>
              <button type="button" title="Copy the complete save trace." disabled={saveLogs.length === 0} onClick={() => void copySaveLogs()} className={buttonBase + ' bg-emerald-600/20 border-emerald-500/30 text-emerald-200 px-3 py-2'}>
                <Copy className="w-3.5 h-3.5 inline mr-1" /> Copy
              </button>
              <button type="button" title="Delete all save diagnostics." disabled={saveLogsLoading || saveLogs.length === 0} onClick={() => void clearSaveLogs()} className={buttonBase + ' bg-red-600/20 border-red-500/30 text-red-200 px-3 py-2'}>
                <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Clear
              </button>
            </div>
          </div>
          <textarea
            id="save-debug-log-copy"
            readOnly
            value={saveLogs.length > 0 ? JSON.stringify(saveLogs, null, 2) : 'No save diagnostics loaded. Reproduce the player-state error, then press Refresh.'}
            className="w-full min-h-56 max-h-96 rounded-xl border border-slate-800 bg-black/40 p-3 text-[10px] leading-4 font-mono text-slate-300 resize-y"
            onFocus={e => e.currentTarget.select()}
          />
        </section>

        <section className={panelBase + ' border border-emerald-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
                <Database className="w-4 h-4" /> Global Boosters Log
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Every successful player activation, newest first. Times are shown as normal dates and times.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button"
                title="Refresh the human-readable Global Boosters Log."
                disabled={globalBoosterActivationLogLoading}
                onClick={() => void loadGlobalBoosterActivationLog()}
                className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}
              >
                {globalBoosterActivationLogLoading ? 'Loading…' : 'Refresh'}
              </button>
              <button type="button"
                title="Clear the Global Boosters Log."
                disabled={globalBoosterActivationLogLoading || globalBoosterActivationLog.length === 0}
                onClick={() => void clearGlobalBoosterActivationLog()}
                className={buttonBase + ' bg-red-600/20 border-red-500/30 text-red-200 px-3 py-2'}
              >
                <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Clear
              </button>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-slate-800 overflow-hidden divide-y divide-slate-800/70">
            {globalBoosterActivationLog.length > 0 ? globalBoosterActivationLog.map((entry, index) => (
              <div
                key={entry.timestamp + '-' + entry.userId + '-' + entry.boosterId + '-' + index}
                className="px-3 py-3 bg-slate-900/45"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-white">
                      u/{entry.username} activated {entry.boosterName}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {new Date(entry.timestamp).toLocaleString()} · Tier {entry.tier} · {entry.usedCredit ? 'Free activation' : '25 Shards'}
                    </div>
                  </div>
                  <div className="shrink-0 text-[10px] text-slate-500">
                    {entry.endsAt > entry.timestamp ? 'Ends ' + new Date(entry.endsAt).toLocaleString() : ''}
                  </div>
                </div>
              </div>
            )) : (
              <div className="p-5 text-center text-xs text-slate-600">
                No Global Booster activations have been recorded yet.
              </div>
            )}
          </div>
        </section>

        <section className={panelBase}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                <Database className="w-4 h-4" /> Global Booster Debug Trace
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Low-level diagnostic trace for Global Booster reads, state calculations, writes, currency deduction, and failures.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button type="button" title="Load the latest Global Booster trace." disabled={globalBoosterLogsLoading} onClick={() => void loadGlobalBoosterLogs()} className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}>
                {globalBoosterLogsLoading ? 'Loading…' : 'Refresh'}
              </button>
              <button type="button" title="Copy the complete Global Booster trace." disabled={globalBoosterLogs.length === 0} onClick={() => void copyGlobalBoosterLogs()} className={buttonBase + ' bg-emerald-600/20 border-emerald-500/30 text-emerald-200 px-3 py-2'}>
                <Copy className="w-3.5 h-3.5 inline mr-1" /> Copy
              </button>
              <button type="button" title="Delete all Global Booster traces." disabled={globalBoosterLogsLoading || globalBoosterLogs.length === 0} onClick={() => void clearGlobalBoosterLogs()} className={buttonBase + ' bg-red-600/20 border-red-500/30 text-red-200 px-3 py-2'}>
                <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Clear
              </button>
            </div>
          </div>
          <textarea
            id="global-booster-debug-log-copy"
            readOnly
            value={globalBoosterLogs.length > 0 ? JSON.stringify(globalBoosterLogs, null, 2) : 'No Global Booster logs loaded. Clear the trace, activate one booster, then press Refresh.'}
            className="w-full min-h-56 max-h-96 rounded-xl border border-slate-800 bg-black/40 p-3 text-[10px] leading-4 font-mono text-slate-300 resize-y"
            onFocus={e => e.currentTarget.select()}
          />
        </section>

        <section className={panelBase + ' border border-fuchsia-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                <Megaphone className="w-4 h-4" /> Push Notification Test
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Sends a real Reddit push notification to the current admin account. Notifications must be enabled first.
              </p>
            </div>
            <button type="button"
              title="Send a real test push notification to the current admin account."
              disabled={pushTestLoading}
              onClick={() => void sendPushTest()}
              className={buttonBase + ' bg-fuchsia-600 hover:bg-fuchsia-500 border-fuchsia-500 text-white px-3 py-2'}
            >
              {pushTestLoading ? 'Sending…' : 'Send Test Push'}
            </button>
          </div>
        </section>

        <section className={panelBase}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
            <Megaphone className="w-4 h-4" /> Developer Announcement
          </div>
          <p className="text-[11px] text-slate-500">
            This text appears above the game navigation for every player. Leave it blank to hide the announcement.
          </p>
          <textarea
            value={announcementText}
            onChange={e => setAnnouncementText(e.target.value.slice(0, 1200))}
            disabled={!announcementLoaded || loading}
            rows={4}
            placeholder="Write the announcement players should see..."
            className="w-full rounded-xl bg-slate-900 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-600 p-3 resize-y focus:outline-none focus:border-cyan-500/50"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">{announcementText.length}/1200 characters</span>
            <button type="button"
              title="Publish the current developer announcement."
              disabled={!announcementLoaded || loading}
              onClick={() => void sendAdminAction('/api/dev/announcement', { message: announcementText }, true, 'Developer announcement updated.')}
              className={`${buttonBase} bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-2`}
            >
              <Save className="inline w-3.5 h-3.5 mr-1" /> Publish Announcement
            </button>
          </div>
        </section>

        <section className={panelBase}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
            <Wand2 className="w-4 h-4" /> Test Presets
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['fresh', 'Fresh Save', 'bg-slate-800 hover:bg-slate-700'],
              ['max', 'Max Everything', 'bg-emerald-600 hover:bg-emerald-500'],
              ['frenzy-ready', 'Frenzy Ready', 'bg-fuchsia-600 hover:bg-fuchsia-500'],
              ['offline-ready', '1,000 Offline', 'bg-indigo-600 hover:bg-indigo-500'],
              ['quests-ready', 'Quests Ready', 'bg-amber-600 hover:bg-amber-500'],
              ['prestige-ready', 'Prestige Ready', 'bg-violet-600 hover:bg-violet-500'],
              ['booster-test', 'Boosters 1h', 'bg-cyan-600 hover:bg-cyan-500'],
              ['upgrades-max', 'Upgrades Max', 'bg-emerald-700 hover:bg-emerald-600'],
              ['upgrades-reset', 'Upgrades 0', 'bg-slate-800 hover:bg-slate-700'],
              ['prestige-max', 'Prestige Max', 'bg-violet-700 hover:bg-violet-600'],
              ['prestige-reset', 'Prestige 0', 'bg-slate-800 hover:bg-slate-700'],
              ['mastery-max', 'Mastery Max', 'bg-purple-700 hover:bg-purple-600'],
              ['mastery-reset', 'Mastery 0', 'bg-slate-800 hover:bg-slate-700'],
              ['automations-on', 'Automation On', 'bg-cyan-700 hover:bg-cyan-600'],
              ['automations-off', 'Automation Off', 'bg-slate-800 hover:bg-slate-700'],
              ['boosters-off', 'Boosters Off', 'bg-slate-800 hover:bg-slate-700'],
              ['collection-clear', 'Clear Collection', 'bg-rose-700 hover:bg-rose-600'],
              ['quests-reset', 'Reset Quests', 'bg-slate-800 hover:bg-slate-700'],
              ['streak-reset', 'Reset Streak', 'bg-slate-800 hover:bg-slate-700'],
              ['offline-clear', 'Clear Offline', 'bg-slate-800 hover:bg-slate-700'],
            ].map(([id, label, cls]) => (
              <button type="button" title={`Apply the ${label} test preset.`} key={id} disabled={loading} onClick={() => void setPreset(id)} className={`${buttonBase} border-transparent px-3 py-2 text-white ${cls}`}>
                {label}
              </button>
            ))}
            <button type="button"
              title="Reset daily, weekly, streak, free-shard, and Frenzy timing flags."
              disabled={loading}
              onClick={() => void sendAdminAction('/api/dev/reset-daily')}
              className={`${buttonBase} bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/30 text-orange-300 px-3 py-2`}
            >
              <ListRestart className="inline w-3.5 h-3.5 mr-1" /> Reset Daily
            </button>
          </div>
        </section>

        <section className={panelBase}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
            <Play className="w-4 h-4" /> Force Exact Roll
          </div>
          <div className="flex gap-2">
            <input
              title="Exact rarity denominator for the forced roll. For example, 100000 means 1/100,000."
              type="number"
              value={customRarity}
              onChange={e => setCustomRarity(e.target.value)}
              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
              placeholder="Rarity denominator"
            />
            <button type="button" title="Perform one roll at the exact rarity entered in the field." onClick={() => void handleForceRoll(Number(customRarity))} disabled={loading} className={`${buttonBase} bg-cyan-600 hover:bg-cyan-500 border-cyan-500 text-white px-4`}>
              Roll Exact
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000].map(v => (
              <button type="button" title={`Force one roll at exact rarity 1/${formatRarity(v)}.`} key={v} onClick={() => void handleForceRoll(v)} disabled={loading} className={`${buttonBase} bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 px-2.5 py-1.5 font-mono`}>
                1/{v.toLocaleString()}
              </button>
            ))}
          </div>
        </section>

        <section className={panelBase}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
            <Coins className="w-4 h-4" /> Resources
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              ['/api/dev/currency', { coins: 10_000 }, '+10K Coins'],
              ['/api/dev/currency', { coins: 1_000_000 }, '+1M Coins'],
              ['/api/dev/currency', { coins: 100_000_000 }, '+100M Coins'],
              ['/api/dev/currency', { shards: 25 }, '+25 Shards'],
              ['/api/dev/currency', { shards: 500 }, '+500 Shards'],
              ['/api/dev/currency', { dust: 50 }, '+50 Dust'],
            ].map(([endpoint, body, label]) => (
              <button type="button" title="Add the displayed test resource amount without normal gameplay costs." key={label as string} onClick={() => void sendAdminAction(endpoint as string, body)} disabled={loading} className={`${buttonBase} bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-300 px-2.5 py-2`}>
                {label as string}
              </button>
            ))}
          </div>
        </section>

        <section className={panelBase}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-300">
              <Database className="w-4 h-4" /> Fine State Control
            </div>
            <button type="button" title="Make the next normal roll immediately available." disabled={loading} onClick={() => void sendAdminAction('/api/dev/reset-cooldown')} className={`${buttonBase} bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/30 text-indigo-300 px-3 py-1.5`}>
              <Gauge className="inline w-3.5 h-3.5 mr-1" /> Cooldown Ready
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {Object.entries(stateInputs).map(([key, value]) => (
              <label key={key} className="text-[10px] text-slate-400">
                <span className="block mb-1 uppercase font-bold">{key.replace(/([A-Z])/g, ' $1')}</span>
                <input
                  type="number"
                  value={value}
                  onChange={e => setStateInputs(prev => ({ ...prev, [key]: e.target.value }))}
                  title="Set this field directly for testing. Leave blank to keep its current value." placeholder="leave blank"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" title="Apply every nonblank state field above directly to the current test account." disabled={loading} onClick={() => void updateState()} className={`${buttonBase} bg-purple-600 hover:bg-purple-500 border-purple-500 text-white px-4 py-2`}>
              <Save className="inline w-3.5 h-3.5 mr-1" /> Apply State Fields
            </button>
            <button type="button" title="Set every standard upgrade to a high testing level." disabled={loading} onClick={() => void sendAdminAction('/api/dev/unlock-upgrades')} className={`${buttonBase} bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-300 px-3 py-2`}>
              Unlock Standard Upgrades
            </button>
            <button type="button" title="Populate the account with a broad maxed progression state for testing." disabled={loading} onClick={() => void sendAdminAction('/api/dev/unlock-everything')} className={`${buttonBase} bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30 text-rose-300 px-3 py-2`}>
              <Sparkles className="inline w-3.5 h-3.5 mr-1" /> Everything
            </button>
            <button type="button" title="Add 50 offline rolls to the vault." disabled={loading} onClick={() => void sendAdminAction('/api/dev/add-offline', { amount: 50 })} className={`${buttonBase} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 px-3 py-2`}>
              +50 Offline Rolls
            </button>
          </div>
        </section>

        <section className={`${panelBase} border border-fuchsia-500/30`}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
            <Flame className="w-4 h-4" /> Orb Frenzy Testing
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <input
              type="number"
              value={frenzyRarity}
              onChange={e => setFrenzyRarity(e.target.value)}
              placeholder="Optional forced Frenzy rarity, e.g. 1000000"
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
            />
            <button type="button"
              title="Create a new test Frenzy post. The optional rarity forces its starting rarity and bypasses the daily limit."
              disabled={loading}
              onClick={async () => {
                const data = await sendAdminAction('/api/dev/frenzy/start', frenzyRarity.trim() ? { rarity: Number(frenzyRarity) } : {});
                if (data) {
                  setFrenzyPostId(data.postId ?? '');
                  setFrenzyPostUrl(data.url ?? '');
                }
              }}
              className={`${buttonBase} bg-fuchsia-600 hover:bg-fuchsia-500 border-fuchsia-500 text-white px-4 py-2`}
            >
              <Flame className="inline w-4 h-4 mr-1" /> Trigger Test Frenzy
            </button>
          </div>
          {frenzyPostId && (
            <div className="rounded-xl bg-slate-900 border border-fuchsia-500/20 p-3 space-y-2">
              <div className="text-[10px] uppercase font-bold text-slate-500">Latest Test Post</div>
              <div className="text-xs font-mono text-fuchsia-200 break-all">{frenzyPostId}</div>
              {frenzyPostUrl && (
                <a href={frenzyPostUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 underline break-all">
                  Open Frenzy post
                </a>
              )}
              <button type="button"
                title="Claim the latest admin test Frenzy as the owner to test the reward flow."
                disabled={loading}
                onClick={() => {
                  if (!confirmation('Claim the latest admin test Frenzy with this admin account?')) return;
                  void sendAdminAction('/api/dev/frenzy/claim', { postId: frenzyPostId });
                }}
                className={`${buttonBase} bg-fuchsia-500/10 hover:bg-fuchsia-500/20 border-fuchsia-500/30 text-fuchsia-300 px-3 py-2`}
              >
                Claim Own Test Frenzy
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button"
              title="Open the Daily Frenzy popup immediately in the game so its interaction can be tested."
              disabled={loading}
              onClick={() => {
                sound.playClick();
                onForceFrenzyPopup?.();
              }}
              className={`${buttonBase} bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30 text-purple-300 px-3 py-2`}
            >
              <BellRing className="inline w-3.5 h-3.5 mr-1" /> Force Frenzy Popup
            </button>
            <button type="button" title="Clear Frenzy flags so another Frenzy test can run immediately." disabled={loading} onClick={() => void sendAdminAction('/api/dev/frenzy/reset')} className={`${buttonBase} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 px-3 py-2`}>
              <RotateCcw className="inline w-3.5 h-3.5 mr-1" /> Reset Frenzy Flags
            </button>
            {[100, 10_000, 1_000_000, 100_000_000].map(v => (
              <button type="button" title={`Use 1/${formatRarity(v)} as the forced Frenzy rarity.`} key={v} disabled={loading} onClick={() => setFrenzyRarity(String(v))} className={`${buttonBase} bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 px-2.5 py-1.5 font-mono`}>
                1/{v.toLocaleString()}
              </button>
            ))}
          </div>
        </section>

        <section className={`${panelBase} border border-purple-500/30`}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-300">
            <Sparkles className="w-4 h-4" /> Community Event
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[1_000, 10_000, 100_000, 1_000_000].map(goal => (
              <button type="button" title={`Set the community event goal to ${goal.toLocaleString()} rolls.`} key={goal} disabled={loading} onClick={() => void sendAdminAction('/api/dev/event', { goal })} className={`${buttonBase} bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 px-2.5 py-2 font-mono`}>
                Goal {goal >= 1_000_000 ? '1M' : goal >= 1_000 ? `${goal / 1000}K` : goal}
              </button>
            ))}
            {[0, 500, 5_000, 50_000].map(progress => (
              <button type="button" title={`Set community event progress to ${progress.toLocaleString()}.`} key={`progress-${progress}`} disabled={loading} onClick={() => void sendAdminAction('/api/dev/event', { progress })} className={`${buttonBase} bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 px-2.5 py-2`}>
                Progress {progress >= 1000 ? `${progress / 1000}K` : progress}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {[500, 5_000, 50_000].map(amount => (
              <button type="button" title={`Add ${amount.toLocaleString()} rolls to community event progress.`} key={amount} disabled={loading} onClick={() => void sendAdminAction('/api/dev/event', { addRolls: amount })} className={`${buttonBase} bg-purple-600/20 hover:bg-purple-600/30 border-purple-500/40 text-purple-300 px-3 py-1.5`}>
                +{amount.toLocaleString()} Event Rolls
              </button>
            ))}
            <button type="button" title="Reset the community event to its base state." disabled={loading} onClick={() => void sendAdminAction('/api/dev/event', { reset: true })} className={`${buttonBase} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 px-3 py-1.5`}>
              Reset Event
            </button>
          </div>
        </section>

        </div>
        </details>

        <details className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-300">
            <span>Players & Moderation</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">

        <section className={`${panelBase} border border-rose-500/30`}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-300">
            <Shield className="w-4 h-4" /> Game Moderation
          </div>
          <p className="text-[10px] text-slate-500">
            These actions affect Infinity Orbs accounts only. They do not ban, mute, approve, or otherwise moderate Reddit users.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <input
              value={targetUser}
              onChange={e => setTargetUser(e.target.value)}
              title="Enter the Reddit username whose Infinity Orbs game account you want to manage." placeholder="Reddit username, without u/"
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
            />
            <select
              title="Choose the duration of a game-only ban. Permanent stays until manually unbanned."
              value={banDuration}
              onChange={e => setBanDuration(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
            >
              <option value="permanent">Permanent game ban</option>
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              value={banReason}
              onChange={e => setBanReason(e.target.value)}
              title="This reason is shown to the player on the Infinity Orbs ban screen." placeholder="Game ban reason"
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
            />
            <button type="button"
              title="Ban your own Infinity Orbs account only. The ban screen will keep the admin console available so you can unban yourself."
              disabled={loading}
              onClick={() => {
                const self = contextInfo?.username ?? '';
                if (!self) {
                  setMessage('Could not determine the current admin username.');
                  return;
                }
                if (!confirmation('Ban your own Infinity Orbs account using the current game-ban settings?')) return;
                void sendAdminAction('/api/dev/moderation/self-game-ban', {
                  durationDays: banDuration === 'permanent' ? null : Number(banDuration),
                  reason: banReason,
                });
              }}
              className={`${buttonBase} bg-rose-600 hover:bg-rose-500 border-rose-500 text-white px-3 py-2`}
            >
              <Ban className="inline w-3.5 h-3.5 mr-1" /> Ban Myself (Test)
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <button type="button"
              title="Ban the selected account from Infinity Orbs only. This does not affect Reddit."
              disabled={loading || !targetUser.trim()}
              onClick={() => void sendAdminAction('/api/dev/moderation/ban', {
                username: targetUser,
                durationDays: banDuration === 'permanent' ? null : Number(banDuration),
                reason: banReason,
              })}
              className={`${buttonBase} bg-rose-600 hover:bg-rose-500 border-rose-500 text-white px-3 py-2`}
            >
              <Ban className="inline w-3.5 h-3.5 mr-1" /> Ban in Game
            </button>
            <button type="button"
              title="Remove the selected account's Infinity Orbs game ban."
              disabled={loading || !targetUser.trim()}
              onClick={() => void sendAdminAction('/api/dev/moderation/unban', { username: targetUser })}
              className={`${buttonBase} bg-rose-600 hover:bg-rose-500 border-rose-500 text-white px-3 py-2`}
            >
              <CheckCircle2 className="inline w-3.5 h-3.5 mr-1" /> Unban Game
            </button>
            <button type="button"
              title="Delete the selected player's Infinity Orbs save. This does not change their game-ban record."
              disabled={loading || !targetUser.trim()}
              onClick={() => requestWipeConfirmation('wipe-game')}
              className={`${buttonBase} bg-rose-600 hover:bg-rose-500 border-rose-500 text-white px-3 py-2`}
            >
              <UserX className="inline w-3.5 h-3.5 mr-1" /> Wipe Save
            </button>
            <button type="button"
              title="Delete the selected save and then apply the selected Infinity Orbs game ban."
              disabled={loading || !targetUser.trim()}
              onClick={() => requestWipeConfirmation('wipe-and-ban')}
              className={`${buttonBase} bg-rose-600 hover:bg-rose-500 border-rose-500 text-white px-3 py-2`}
            >
              <Ban className="inline w-3.5 h-3.5 mr-1" /> Wipe + Ban
            </button>
            <button type="button"
              title="Delete the selected save and remove the selected Infinity Orbs game ban."
              disabled={loading || !targetUser.trim()}
              onClick={() => requestWipeConfirmation('wipe-and-unban')}
              className={`${buttonBase} bg-rose-600 hover:bg-rose-500 border-rose-500 text-white px-3 py-2`}
            >
              <Trash2 className="inline w-3.5 h-3.5 mr-1" /> Wipe + Unban
            </button>
            <button type="button"
              title="Inspect the selected account\'s live save, generation, level, XP, and game-ban state."
              disabled={loading || !targetUser.trim()}
              onClick={async () => {
                setLoading(true);
                setMessage('');
                try {
                  const res = await fetch('/api/dev/moderation/save?username=' + encodeURIComponent(targetUser.trim()));
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data.error || 'Could not inspect player save.');
                  const save = data.save;
                  setMessage('Save: ' + (data.exists ? 'exists' : 'missing') + ' | Level ' + (save?.level ?? 1) + ' | XP ' + formatNumber(Number(save?.xp ?? 0)) + ' | Gen ' + (save?.saveGeneration ?? 0) + '/' + (data.generation ?? 0) + ' | Ban: ' + (data.ban ? 'ACTIVE' : 'none'));
                } catch (e: any) {
                  setMessage('Error: ' + (e?.message || 'Could not inspect player save.'));
                } finally {
                  setLoading(false);
                }
              }}
              className="rounded-xl border text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed bg-cyan-600 hover:bg-cyan-500 border-cyan-500 text-white px-3 py-2"
            >
              <Database className="inline w-3.5 h-3.5 mr-1" /> Inspect Save
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button"
              title="Load the current list of active Infinity Orbs game bans."
              disabled={loading}
              onClick={() => void getBannedUsers()}
              className={`${buttonBase} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 px-3 py-2`}
            >
              <RefreshCw className="inline w-3.5 h-3.5 mr-1" /> Load Banned Game Accounts
            </button>
            <button type="button"
              title="Delete your own Infinity Orbs save while keeping your game-ban record unchanged."
              disabled={loading}
              onClick={() => {
                const self = contextInfo?.username ?? '';
                if (!self) return;
                if (pendingWipe?.action === 'wipe-game' && pendingWipe.username.toLowerCase() === self.toLowerCase()) {
                  setPendingWipe(null);
                  void sendAdminAction('/api/dev/moderation/wipe-game', { username: self }, true, 'Wiped your save successfully.');
                  return;
                }
                setPendingWipe({ action: 'wipe-game', username: self });
                setMessage('Click "Wipe My Save" again to confirm for u/' + self + '.');
              }}
              className={`${buttonBase} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 px-3 py-2`}
            >
              Wipe My Save
            </button>
            <button type="button"
              title="Remove your own Infinity Orbs game ban. This is also available from the ban screen."
              disabled={loading}
              onClick={() => {
                const self = contextInfo?.username ?? '';
                if (!self) return;
                void sendAdminAction('/api/dev/moderation/unban', { username: self });
              }}
              className={`${buttonBase} bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-300 px-3 py-2`}
            >
              Unban Me
            </button>
          </div>

          {bannedUsers.length > 0 && (
            <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/80 divide-y divide-slate-800">
              {bannedUsers.map(user => (
                <div key={user.userId ?? user.username} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-slate-200">u/{user.username}</div>
                    <div className="text-[10px] text-slate-500">
                      {user.bannedUntil === null ? 'Permanent' : `Until ${new Date(user.bannedUntil).toLocaleString()}`} · {user.reason}
                    </div>
                  </div>
                  <button type="button"
                    title="Remove this listed player's Infinity Orbs game ban."
                    disabled={loading}
                    onClick={() => void sendAdminAction('/api/dev/moderation/unban', { username: user.username })}
                    className={`${buttonBase} bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-300 px-3 py-2`}
                  >
                    Unban
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={`${panelBase} border border-cyan-500/30`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
              <Users className="w-4 h-4" /> Player List
            </div>
            <button type="button"
              title="Load every player account Infinity Orbs has registered, with currently active players first."
              disabled={loading}
              onClick={() => void getPlayerList()}
              className={`${buttonBase} bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-300 px-3 py-2`}
            >
              <RefreshCw className="inline w-3.5 h-3.5 mr-1" /> Refresh Player List
            </button>
          </div>
          <p className="text-[10px] text-slate-500">Active means the account contacted the game within the last 90 seconds. Version badges compare the latest heartbeat with v{APP_VERSION}.</p>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {[
              ['DAU', playerActivity.dailyActiveUsers, 'Last 24 hours'],
              ['WAU', playerActivity.weeklyActiveUsers, 'Last 7 days'],
              ['MAU', playerActivity.monthlyActiveUsers, 'Last 30 days'],
            ].map(([label, value, detail]) => (
              <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 text-center">
                <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</div>
                <div className="mt-1 text-sm font-mono font-black text-cyan-200">{formatNumber(Number(value))}</div>
                <div className="text-[8px] text-slate-600">{detail}</div>
              </div>
            ))}
          </div>
          {playerList.length > 0 ? (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/80 divide-y divide-slate-800">
              {playerList.map(player => (
                <div key={player.userId} className="px-3 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-200 truncate">u/{player.username}</span>
                      {player.active && <span className="text-[9px] font-black uppercase text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5">Active</span>}
                      {player.isLatestVersion
                        ? <span className="text-[9px] font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5">v{player.clientVersion} · Latest</span>
                        : <span className="text-[9px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-1.5 py-0.5">v{player.clientVersion ?? 'unknown'}</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Level {player.level} · {formatNumber(player.totalRolls)} rolls · Session {formatPlaytime(player.currentSessionMs)} · Playtime {formatPlaytime(player.playtimeMs)} · Best 1/{formatRarity(Math.max(1, player.highestRarity))}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] text-slate-400">{player.active ? 'Online now' : player.lastSeenAt ? new Date(player.lastSeenAt).toLocaleString() : 'No recent activity'}</div>
                    <div className="text-[9px] text-slate-600 font-mono">ID {player.userId.slice(-8)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-500">No player accounts are registered yet.</div>
          )}
        </section>

        <section className={panelBase + ' border border-cyan-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
                <Gauge className="w-4 h-4" /> Stat Spy
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Calculates effective gameplay stats for a player and shows exactly what each upgrade, level bonus, mastery skill, prestige upgrade, guild perk, booster, Altar layer, CCU effect, and cap contributes.
              </p>
            </div>
            {statSpy && <span className="text-[10px] text-slate-600 font-mono">updated {new Date(statSpy.generatedAt).toLocaleTimeString()}</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <input
              value={statSpyUsername}
              onChange={e => setStatSpyUsername(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void loadStatSpy();
              }}
              title="Enter the Reddit username whose calculated stats you want to inspect."
              placeholder="Reddit username, without u/"
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
            />
            <button type="button"
              title="Load the player's complete calculated stat breakdown."
              disabled={statSpyLoading || !statSpyUsername.trim()}
              onClick={() => void loadStatSpy()}
              className={buttonBase + ' bg-cyan-600 hover:bg-cyan-500 border-cyan-500 text-slate-950 px-4 py-2'}
            >
              <Gauge className="inline w-3.5 h-3.5 mr-1" />
              {statSpyLoading ? 'Loading…' : 'Spy Stats'}
            </button>
          </div>

          {statSpy && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ['Level', formatNumber(statSpy.summary.level)],
                  ['XP', formatNumber(statSpy.summary.xp)],
                  ['Rolls', formatNumber(statSpy.summary.totalRolls)],
                  ['Best', '1/' + formatRarity(Math.max(1, statSpy.summary.highestRarity))],
                  ['Coins', formatNumber(statSpy.summary.coins)],
                  ['Shards', formatNumber(statSpy.summary.shards)],
                  ['Dust', formatNumber(statSpy.summary.cosmicDust)],
                  ['Prestiges', formatNumber(statSpy.summary.prestigeCount)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/65 p-2.5">
                    <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</div>
                    <div className="mt-1 text-xs font-mono font-bold text-slate-200 truncate">{value}</div>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {statSpy.stats.map(stat => (
                  <details key={stat.id} className="rounded-xl border border-slate-800 bg-slate-900/55 overflow-hidden">
                    <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold text-slate-200">{stat.label}</div>
                        {stat.detail && <div className="text-[9px] text-slate-500 mt-0.5">{stat.detail}</div>}
                      </div>
                      <div className="shrink-0 text-sm font-mono font-black text-cyan-200">{formatStatSpyTotal(stat.total, stat.unit)}</div>
                    </summary>

                    <div className="border-t border-slate-800 divide-y divide-slate-800/70">
                      {stat.sources.map((source, index) => (
                        <div key={source.label + '-' + index} className={"px-3 py-2 flex items-start justify-between gap-3 " + (source.active === false ? 'opacity-40' : '')}>
                          <div className="min-w-0">
                            <div className="text-[10px] text-slate-300">
                              {source.label}
                              {source.level !== undefined && <span className="ml-1 text-[9px] text-slate-600">Lv {formatNumber(source.level)}</span>}
                              {source.active === false && <span className="ml-2 text-[8px] uppercase tracking-wider text-slate-600">inactive</span>}
                            </div>
                            {source.detail && <div className="mt-0.5 text-[8px] leading-3.5 text-slate-600">{source.detail}</div>}
                          </div>
                          <span className={"shrink-0 font-mono text-[10px] " + (
                            source.kind === 'base' ? 'text-slate-400' :
                            source.kind === 'reduction' ? 'text-emerald-300' :
                            source.kind === 'multiply' ? 'text-amber-300' :
                            source.kind === 'special' ? 'text-purple-300' :
                            'text-cyan-300'
                          )}>
                            {formatStatSpyValue(source.value, source.unit)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {[
                  ['Standard upgrades', statSpy.allocations.upgrades],
                  ['Prestige upgrades', statSpy.allocations.prestigeUpgrades],
                  ['Mastery skills', statSpy.allocations.masterySkills],
                  ['Guild perks', statSpy.allocations.guildPerks],
                ].map(([title, values]) => (
                  <div key={title as string} className="rounded-xl border border-slate-800 bg-slate-900/55 p-3">
                    <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 mb-2">{title as string}</div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {Object.entries(values as Record<string, number>).map(([id, level]) => (
                        <div key={id} className="flex items-center justify-between gap-2 text-[9px]">
                          <span className="text-slate-500 truncate">{id}</span>
                          <span className="font-mono text-slate-300">{formatNumber(Number(level) || 0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/55 p-3 text-[9px] text-slate-500">
                Current CCU: <span className="font-mono text-slate-300">{formatNumber(statSpy.summary.currentCcu)}</span>
                {' · '}Stat Spy test CCU: <span className="font-mono text-slate-300">+{formatNumber(statSpy.summary.fakeCcuBonus)}</span>
                {' · '}Effective CCU for Luck: <span className="font-mono text-cyan-300">{formatNumber(statSpy.summary.effectiveCcu)}</span>
              </div>
            </>
          )}
        </section>

        <section className={panelBase + ' border border-fuchsia-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                <Users className="w-4 h-4" /> Player Spy
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Loads gameplay telemetry for one player so balance problems can be investigated from real progression and roll data.
              </p>
            </div>
            <span className="text-[10px] text-slate-600 font-mono">{playerSpyLogs.length}/500</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
            <input
              value={playerSpyUsername}
              onChange={e => setPlayerSpyUsername(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void loadPlayerSpy();
              }}
              title="Enter the Reddit username whose gameplay logs you want to inspect."
              placeholder="Reddit username, without u/"
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
            />
            <button type="button"
              title="Load the latest 500 gameplay telemetry events for this player."
              disabled={playerSpyLoading || !playerSpyUsername.trim()}
              onClick={() => void loadPlayerSpy()}
              className={buttonBase + ' bg-fuchsia-600 hover:bg-fuchsia-500 border-fuchsia-500 text-white px-3 py-2'}
            >
              <RefreshCw className="inline w-3.5 h-3.5 mr-1" />
              {playerSpyLoading ? 'Loading…' : 'Spy'}
            </button>
            <button type="button"
              title="Toggle a compact Player Spy format that removes duplicate activation entries and repeated state snapshots so the log is small enough to paste into chat."
              disabled={playerSpyLogs.length === 0}
              onClick={() => {
                const next = !playerSpyShortened;
                setPlayerSpyShortened(next);
                setMessage(next
                  ? 'Player Spy log shortened for chat. The detailed JSON is still available with Full Log.'
                  : 'Player Spy log restored to full JSON.');
              }}
              className={buttonBase + ' bg-cyan-600/20 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-200 px-3 py-2'}
            >
              <ListRestart className="inline w-3.5 h-3.5 mr-1" /> {playerSpyShortened ? 'Full Log' : 'Shorten Log'}
            </button>
            <button type="button"
              title={playerSpyShortened
                ? 'Copy the shortened Player Spy log for pasting into ChatGPT or another analysis tool.'
                : 'Copy the Player Spy data as JSON so it can be analyzed externally or pasted into ChatGPT.'}
              disabled={playerSpyLogs.length === 0}
              onClick={() => void copyPlayerSpy()}
              className={buttonBase + ' bg-emerald-600/20 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-200 px-3 py-2'}
            >
              <Copy className="inline w-3.5 h-3.5 mr-1" /> {playerSpyShortened ? 'Copy Shortened' : 'Copy'}
            </button>
          </div>

          {playerSpyUserId && (
            <div className="text-[10px] text-slate-600 font-mono">
              u/{playerSpyUsername.replace(/^u\//i, '')} · ID {playerSpyUserId.slice(-10)}
            </div>
          )}

          <textarea
            id="player-spy-log-copy"
            readOnly
            value={playerSpyLogs.length > 0
              ? (playerSpyShortened
                ? shortenedPlayerSpyLog()
                : fullPlayerSpyLog())
              : 'No Player Spy logs loaded. Enter a Reddit username and press Spy.'}
            className="w-full min-h-72 max-h-[32rem] rounded-xl border border-slate-800 bg-black/40 p-3 text-[10px] leading-4 font-mono text-slate-300 resize-y"
            onFocus={e => e.currentTarget.select()}
          />
        </section>

        <section className={panelBase + ' border border-violet-500/30'}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-300">
            <Users className="w-4 h-4" /> Admin Guild Authority
          </div>
          <p className="text-[10px] text-slate-500">
            Override normal Guild membership permissions for u/shadow_fen. This moves the admin account into the selected Guild and demotes any previous owner to Officer if ownership is transferred.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <select
              value={guildAuthorityGuildId}
              onChange={e => setGuildAuthorityGuildId(e.target.value)}
              className="min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              title="Select the Guild whose authority should be changed for u/shadow_fen."
            >
              <option value="">Select a Guild…</option>
              {guildChatSpy.map(guild => (
                <option key={guild.id} value={guild.id}>[{guild.tag}] {guild.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={loading || guildChatSpyLoading}
              onClick={() => void loadGuildChatSpy()}
              className={buttonBase + ' bg-violet-500/10 hover:bg-violet-500/20 border-violet-500/30 text-violet-200 px-3 py-2'}
            >
              <RefreshCw className="inline w-3.5 h-3.5 mr-1" /> Load Guilds
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={loading || !guildAuthorityGuildId}
              onClick={() => void (async () => {
                const result = await sendAdminAction('/api/dev/guild-authority', {
                  guildId: guildAuthorityGuildId,
                  authority: 'owner',
                }, false, 'u/shadow_fen is now the Guild owner.');
                if (result) {
                  await Promise.all([loadGuildChatSpy(true), onRefresh()]);
                }
              })()}
              className={buttonBase + ' bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-200 px-3 py-2'}
            >
              <Crown className="inline w-3.5 h-3.5 mr-1" /> Make u/shadow_fen Owner
            </button>
            <button
              type="button"
              disabled={loading || !guildAuthorityGuildId}
              onClick={() => void (async () => {
                const result = await sendAdminAction('/api/dev/guild-authority', {
                  guildId: guildAuthorityGuildId,
                  authority: 'trusted',
                }, false, 'u/shadow_fen is now a trusted Guild member.');
                if (result) {
                  await Promise.all([loadGuildChatSpy(true), onRefresh()]);
                }
              })()}
              className={buttonBase + ' bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-200 px-3 py-2'}
            >
              <UserCheck className="inline w-3.5 h-3.5 mr-1" /> Make Trusted Member
            </button>
          </div>
          {guildChatSpy.length === 0 && (
            <p className="text-[10px] text-slate-600">Load Guilds to populate the selector. This control is only available in the authenticated admin console.</p>
          )}
        </section>

        <section className={panelBase + ' border border-amber-500/30'}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
                <Shield className="w-4 h-4" /> Guild Chat Spy
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Moderation-only view of every message currently retained in every guild. Refreshes every 3 seconds after the first load.
              </p>
            </div>
            <button type="button"
              title="Load all stored Guild Chat messages and active chat mutes."
              disabled={guildChatSpyLoading}
              onClick={() => void loadGuildChatSpy()}
              className={buttonBase + ' bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-300 px-3 py-2'}
            >
              <RefreshCw className="inline w-3.5 h-3.5 mr-1" />
              {guildChatSpyLoading ? 'Loading…' : 'Refresh Spy'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <input
              value={guildChatMuteUser}
              onChange={e => setGuildChatMuteUser(e.target.value)}
              title="Enter a Reddit username to mute or unmute from Global Chat and Guild Chat."
              placeholder="Reddit username, without u/"
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
            />
            <div className="flex gap-2">
              <button type="button"
                title="Mute this account from Global Chat and Guild Chat."
                disabled={loading || !guildChatMuteUser.trim()}
                onClick={async () => {
                  const name = guildChatMuteUser.trim().replace(/^u\//i, '');
                  const data = await sendAdminAction('/api/dev/guild-chat/mute', { username: name }, false, 'Muted u/' + name + ' from Global Chat and Guild Chat.');
                  if (data) {
                    setGuildChatMuteUser('');
                    await loadGuildChatSpy(true);
                  }
                }}
                className={buttonBase + ' bg-rose-600/20 hover:bg-rose-600/30 border-rose-500/40 text-rose-200 px-3 py-2'}
              >
                Mute
              </button>
              <button type="button"
                title="Unmute this account from Global Chat and Guild Chat."
                disabled={loading || !guildChatMuteUser.trim()}
                onClick={async () => {
                  const name = guildChatMuteUser.trim().replace(/^u\//i, '');
                  const data = await sendAdminAction('/api/dev/guild-chat/unmute', { username: name }, false, 'Unmuted u/' + name + ' from Global Chat and Guild Chat.');
                  if (data) {
                    setGuildChatMuteUser('');
                    await loadGuildChatSpy(true);
                  }
                }}
                className={buttonBase + ' bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-300 px-3 py-2'}
              >
                Unmute
              </button>
            </div>
          </div>

          {guildChatMutes.length > 0 && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-950/10 p-3 space-y-2">
              <div className="text-[10px] uppercase font-bold text-rose-300">Muted accounts</div>
              <div className="flex flex-wrap gap-2">
                {guildChatMutes.map(mute => (
                  <button type="button"
                    key={mute.userId}
                    title={'Unmute u/' + mute.username + ' from Global Chat and Guild Chat.'}
                    disabled={loading}
                    onClick={() => void toggleGuildChatMute(mute.username, true)}
                    className={buttonBase + ' bg-rose-500/10 border-rose-500/30 text-rose-200 px-2.5 py-1.5'}
                  >
                    u/{mute.username} · Unmute
                  </button>
                ))}
              </div>
            </div>
          )}

          {guildChatSpy.length > 0 ? (
            <div className="space-y-3">
              {guildChatSpy.map(guild => {
                const mutedNames = new Set(guildChatMutes.map(mute => mute.username.toLowerCase()));
                return (
                  <div key={guild.id} className="rounded-xl border border-slate-800 bg-slate-900/70 overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-black text-white">[{guild.tag}] {guild.name}</div>
                        <div className="text-[10px] text-slate-500">{guild.memberCount} members · {guild.messages.length} stored messages</div>
                      </div>
                    </div>
                    {guild.messages.length > 0 ? (
                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/80">
                        {guild.messages.map(msg => {
                          const isMuted = !msg.isSystem && mutedNames.has(msg.username.toLowerCase());
                          return (
                            <div key={msg.id} className="px-3 py-2 flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={'text-xs font-bold ' + (msg.isSystem ? 'text-slate-500' : 'text-slate-200')}>u/{msg.username}</span>
                                  {isMuted && <span className="text-[9px] font-black uppercase text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-full px-1.5 py-0.5">Muted</span>}
                                  <span className="text-[9px] text-slate-600">{new Date(msg.timestamp).toLocaleString()}</span>
                                </div>
                                <div className={'text-xs mt-0.5 whitespace-pre-wrap break-words ' + (msg.isSystem ? 'text-slate-500 italic' : 'text-slate-300')}>{msg.text}</div>
                              </div>
                              {!msg.isSystem && (
                                <button type="button"
                                  title={(isMuted ? 'Unmute ' : 'Mute ') + 'u/' + msg.username + ' from all Guild Chat.'}
                                  disabled={loading}
                                  onClick={() => void toggleGuildChatMute(msg.username, isMuted)}
                                  className={buttonBase + ' ' + (isMuted
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                    : 'bg-rose-500/10 border-rose-500/30 text-rose-200') + ' px-2 py-1 shrink-0'}
                                >
                                  {isMuted ? 'Unmute' : 'Mute'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-3 text-xs text-slate-600 italic">No stored messages.</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-500">
              Press Refresh Spy to load Guild Chat across all guilds.
            </div>
          )}
        </section>

                  </div>
        </details>

        <CombatAdminTools />

        <details className="rounded-2xl border border-rose-500/40 bg-rose-950/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-rose-300">
            <span>Destructive Testing</span><span className="text-[10px] text-rose-400/60">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
        <section className="bg-rose-950/20 border border-rose-500/40 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-rose-300">
            <Trash2 className="w-4 h-4" /> Destructive Testing
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button"
              title="Erase the entire current Infinity Orbs save and restore the normal starting state."
              disabled={loading}
              onClick={() => {
                if (!confirmation('Reset your entire Infinity Orbs save to a fresh state?')) return;
                void sendAdminAction('/api/dev/reset-all');
              }}
              className={`${buttonBase} bg-rose-600 hover:bg-rose-500 border-rose-500 text-white px-3 py-2`}
            >
              <RotateCcw className="inline w-3.5 h-3.5 mr-1" /> Reset My Save
            </button>
            <button type="button" title="Reset the current test account to the ordinary new-player starting state." disabled={loading} onClick={() => void sendAdminAction('/api/dev/preset', { preset: 'fresh' })} className={`${buttonBase} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 px-3 py-2`}>
              <Database className="inline w-3.5 h-3.5 mr-1" /> Fresh State
            </button>
          </div>
        </section>
          </div>
        </details>
      </div>
    </div>
  );
};
