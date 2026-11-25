import React, { useEffect, useRef, useState } from 'react';
import {
  X, Wrench, Coins, Gem, Sparkles, Zap, RotateCcw, Play, Shield, Megaphone,
  Users, Bell, BellRing, Crown, UserCheck,
  Ban, UserX, CheckCircle2, RefreshCw, Flame,
  Database, Wand2, Trash2, Gauge, ListRestart, Save, Power, Copy, ClipboardCheck, Gift, Eye, Search,
} from 'lucide-react';
import { PRESTIGE_UPGRADES, PREMIUM_BOOSTERS, AUTOMATIONS, CONTINUUM_TIERS, getOrbInfo, visibleContinuumTiers, formatRarity, formatNumber, frenzyOrbCountForRarity, DEFAULT_POPUP_CONFIG } from '../../shared/game.js';
import type { RollResponse, PlayerState, PopupConfig, PopupStats, GamePopupId } from '../../shared/game.js';
import { APP_VERSION } from '../../shared/version.js';
import { sound } from '../sound.js';
import { CombatAdminTools } from './CombatAdminTools.js';
import { FullLogSnapshotPanel } from './FullLogSnapshotPanel.js';

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

function formatServerBytes(value: number): string {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1_000) return Math.round(bytes) + ' B';
  if (bytes < 1_000_000) return (bytes / 1_000).toFixed(1) + ' KB';
  if (bytes < 1_000_000_000) return (bytes / 1_000_000).toFixed(2) + ' MB';
  return (bytes / 1_000_000_000).toFixed(3) + ' GB';
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
  onForceRollQueued?: (state: PlayerState, targetRarity: number) => void;
  onForceFrenzyPopup?: () => void;
  onForceFrenzyShardPopup?: () => void;
  onForceNotificationPopup?: () => void;
  onForceJoinSubredditPopup?: () => void;
  onPopupConfigChanged?: (config: PopupConfig) => void;
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
type ServerMonitorEvent = {
  id: number;
  timestamp: number;
  severity: 'info' | 'warn' | 'error';
  actor: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  message: string;
  details?: Record<string, unknown>;
};
type ServerMonitorSnapshot = {
  generatedAt: number;
  scope: string;
  metrics: {
    requestsLastMinute: number;
    requestsPerSecond: number;
    peakRequestsPerSecond: number;
    activeRequests: number;
    averageLatencyMs: number;
    clientErrorsLastMinute: number;
    serverErrorsLastMinute: number;
    redisOperationsPerSecond: number;
    peakRedisOperationsPerSecond: number;
    redisCapacityPercent: number;
  };
  limits: { redisCommandsPerSecond: number; redisStorageBytes: number; httpRequestsPerSecond: number | null };
  upgradeBatches?: {
    serverAttempts: number;
    serverAccepted: number;
    serverPartial: number;
    serverRejected: number;
    clientRollbacks: number;
    averageServerDurationMs: number;
    lastFailureAt: number | null;
  };
  events: ServerMonitorEvent[];
};
type ServerStorageEstimate = {
  generatedAt: number;
  storageLimitBytes: number;
  knownBytes: number;
  knownPercent: number;
  playerCount: number;
  keysCounted: number;
  recordsCounted: number;
  groups: Array<{ label: string; bytes: number; keys: number; records: number }>;
  partial: boolean;
  note: string;
  errors: string[];
};
type ImpressionDeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';
type ImpressionTimePoint = {
  bucket: string;
  total: number;
  byType: Record<ImpressionPostType, number>;
};
type ImpressionDashboardData = {
  generatedAt: number;
  total: number;
  uniqueUsers: number;
  uniqueToday: number;
  uniqueByType: Record<ImpressionPostType, number>;
  newPlayersToday: number;
  day1Retention: { cohortDay: string; cohortSize: number; retained: number; rate: number | null };
  day3Retention: { cohortDay: string; cohortSize: number; retained: number; rate: number | null };
  conversion: Record<'main-game' | 'orb-share' | 'frenzy', { eligibleViewers: number; conversions: number; rate: number | null }>;
  conversionByDevice: Record<ImpressionDeviceType, { eligibleViewers: number; conversions: number; rate: number | null }>;
  viewers: Array<{
    username: string;
    uniquePostViews: number;
    byType: Record<ImpressionPostType, number>;
    firstSeenAt: number;
    lastSeenAt: number;
  }>;
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
  playerSave: unknown;
  calculatedPlayerState: Record<string, any>;
  combat: {
    saveExists: boolean;
    inCombat: boolean;
    status: string;
    statusNote: string;
    dungeonId: string;
    depth: number;
    bestDepth: number;
    dungeonBestDepths: Record<string, number>;
    playerHp: number;
    playerMaxHp: number;
    enemy: { name: string; kind: string; boss: boolean; room: string; hp: number; maxHp: number; damage: number; speed: number };
    stats: Record<string, number>;
    gear: Array<{ slot: string; itemId: string | null; item: Record<string, any> | null }>;
    equippedSkills: Array<{ id: string; name: string; rarity: string; effect: string; rank: number; cooldownUntilSequence: number | null }>;
    equippedRunes: Array<Record<string, any>>;
    runeBonuses: { luckPct: number; coinGainPct: number; shardChancePct: number; xpGainPct: number };
    runeLuckMultiplier: number;
    lastAcceptedBeatAtMs: number;
    state: Record<string, any>;
    save: unknown;
  };
};

type AdminConsoleTool = { id: string; label: string; target: string };
type AdminConsoleSection = { id: string; label: string; target: string; tools: AdminConsoleTool[] };

const ADMIN_CONSOLE_SECTIONS: AdminConsoleSection[] = [
  { id: 'monitoring', label: 'Monitoring', target: 'io-server-monitor', tools: [
    { id: 'server-monitor', label: 'Server Monitor', target: 'io-server-monitor' },
  ] },
  { id: 'impressions', label: 'Impressions', target: 'io-impressions-tab', tools: [
    { id: 'impressions-dashboard', label: 'Impressions Dashboard', target: 'io-impressions-tab' },
  ] },
  { id: 'diagnostics', label: 'Diagnostics', target: 'io-diagnostics-group', tools: [
    { id: 'full-log-snapshot', label: 'Full Log Snapshot', target: 'io-tool-full-log-snapshot' },
    { id: 'e2e-test', label: 'End-to-End Test', target: 'io-tool-e2e-test' },
    { id: 'ccu-load', label: 'CCU & Load Testing', target: 'io-tool-ccu-load' },
    { id: 'payment-logs', label: 'Payment Logs', target: 'io-tool-payment-logs' },
  ] },
  { id: 'simulation', label: 'Simulation', target: 'io-simulation-group', tools: [
    { id: 'global-boosters', label: 'Global Booster Operations', target: 'io-tool-global-boosters' },
    { id: 'save-logs', label: 'Save & Booster Logs', target: 'io-tool-save-booster-logs' },
    { id: 'notifications-presets', label: 'Notifications & Test Presets', target: 'io-tool-notifications-presets' },
    { id: 'roll-resources', label: 'Roll & Resource Tools', target: 'io-tool-roll-resources' },
    { id: 'state-overrides', label: 'Fine State Control', target: 'io-tool-state-overrides' },
    { id: 'community-events', label: 'Frenzy, Popup & Community Events', target: 'io-tool-community-events' },
    { id: 'alignment-events', label: 'Alignment Events & Choice Stats', target: 'io-tool-alignment-events' },
  ] },
  { id: 'players', label: 'Players', target: 'io-moderation-group', tools: [
    { id: 'leaderboard-diagnostics', label: 'Leaderboard Diagnostics', target: 'io-tool-leaderboard-diagnostics' },
    { id: 'player-moderation', label: 'Game Moderation', target: 'io-tool-player-moderation' },
    { id: 'player-list', label: 'Player List', target: 'io-tool-player-list' },
    { id: 'stat-spy', label: 'Stat Spy', target: 'io-tool-stat-spy' },
    { id: 'player-spy', label: 'Player Spy', target: 'io-tool-player-spy' },
    { id: 'admin-cli', label: 'Command Line', target: 'io-tool-admin-cli' },
    { id: 'guild-chat', label: 'Guild Administration & Chat', target: 'io-tool-guild-chat' },
  ] },
  { id: 'combat', label: 'Combat', target: 'io-combat-tools', tools: [
    { id: 'combat-tools', label: 'Combat Admin Tools', target: 'io-combat-tools' },
  ] },
  // Keep Rift tools registered here. The menu, search, and jump navigation are derived from this registry.
  { id: 'rift', label: 'Rift Administration', target: 'io-rift-admin-group', tools: [
    { id: 'rift-admin', label: 'Rift Player Controls', target: 'io-tool-rift-admin' },
  ] },
  { id: 'destructive', label: 'Destructive Testing', target: 'io-destructive-group', tools: [
    { id: 'destructive-tools', label: 'Destructive Testing', target: 'io-destructive-group' },
  ] },
];
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
  onForceRollQueued,
  onForceFrenzyPopup,
  onForceFrenzyShardPopup,
  onForceNotificationPopup,
  onForceJoinSubredditPopup,
  onPopupConfigChanged,
}) => {
  const [customRarity, setCustomRarity] = useState('100000');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [contextInfo, setContextInfo] = useState<AdminContext | null>(null);
  const [globalChatRegistrationBusy, setGlobalChatRegistrationBusy] = useState(false);
  const [activeAdminSection, setActiveAdminSection] = useState('monitoring');
  const [activeAdminTool, setActiveAdminTool] = useState('server-monitor');
  const [adminToolSearch, setAdminToolSearch] = useState('');
  const [popupConfig, setPopupConfig] = useState<PopupConfig>(() => ({ ...DEFAULT_POPUP_CONFIG }));
  const [popupStats, setPopupStats] = useState<PopupStats | null>(null);
  const [popupStatsLoading, setPopupStatsLoading] = useState(false);
  const [popupStatsError, setPopupStatsError] = useState<string | null>(null);
  const [popupStatsUpdatedAt, setPopupStatsUpdatedAt] = useState<number | null>(null);
  const [riftAdminUsername, setRiftAdminUsername] = useState('');
  const [riftAdminData, setRiftAdminData] = useState<Record<string, any> | null>(null);
  const [riftAdminLoading, setRiftAdminLoading] = useState(false);
  const [riftAdminPoints, setRiftAdminPoints] = useState('0');
  const [riftAdminMinutes, setRiftAdminMinutes] = useState('0');
  const [alignmentChoiceStats, setAlignmentChoiceStats] = useState<{
    total: number;
    choices: { starseeker: number; goldenOrbit: number; clockwork: number };
    recent: Array<{ username: string; choice: 'starseeker' | 'goldenOrbit' | 'clockwork'; chosenAt: number; adminTest: boolean }>;
    generatedAt?: number;
  } | null>(null);
  const [alignmentChoiceStatsLoading, setAlignmentChoiceStatsLoading] = useState(false);
  const [alignmentChoiceStatsError, setAlignmentChoiceStatsError] = useState<string | null>(null);

  const [targetUser, setTargetUser] = useState('');
  const [executeAsUsername, setExecuteAsUsername] = useState('');
  const [executeAsCommands, setExecuteAsCommands] = useState('');
  const [cliHistory, setCliHistory] = useState<Array<{ command: string; output: string; ok: boolean; at: number }>>([]);
  const [executeAsResult, setExecuteAsResult] = useState('');
  const [executeAsLoading, setExecuteAsLoading] = useState(false);
  const [pendingWipe, setPendingWipe] = useState<{ action: 'wipe-game' | 'wipe-and-ban' | 'wipe-and-unban'; username: string } | null>(null);
  const [banDuration, setBanDuration] = useState('permanent');
  const [banReason, setBanReason] = useState('Infinity Orbs admin action');
  const [announcementText, setAnnouncementText] = useState('');
  const [announcementLoaded, setAnnouncementLoaded] = useState(false);
  const [paymentLogs, setPaymentLogs] = useState<Array<Record<string, unknown>>>([]);
  const [paymentLogsLoading, setPaymentLogsLoading] = useState(false);
  const [saveLogs, setSaveLogs] = useState<Array<Record<string, unknown>>>([]);
  const [saveLogsLoading, setSaveLogsLoading] = useState(false);
  const [clearAllLogsLoading, setClearAllLogsLoading] = useState(false);
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
  const [serverMonitor, setServerMonitor] = useState<ServerMonitorSnapshot | null>(null);
  const [serverMonitorLoading, setServerMonitorLoading] = useState(false);
  const [serverMonitorError, setServerMonitorError] = useState('');
  const [serverMonitorPaused, setServerMonitorPaused] = useState(false);
  const [serverMonitorAutoScroll, setServerMonitorAutoScroll] = useState(true);
  const [serverStorage, setServerStorage] = useState<ServerStorageEstimate | null>(null);
  const [serverStorageLoading, setServerStorageLoading] = useState(false);
  const [serverStorageError, setServerStorageError] = useState('');
  const serverLogFeedRef = useRef<HTMLDivElement | null>(null);
  const serverMonitorPollLockRef = useRef(false);
  const serverStoragePollLockRef = useRef(false);
  const [leaderboardDiagnostics, setLeaderboardDiagnostics] = useState<Record<string, any> | null>(null);
  const [leaderboardDiagnosticsLoading, setLeaderboardDiagnosticsLoading] = useState(false);
  const [leaderboardDiagnosticsError, setLeaderboardDiagnosticsError] = useState('');
  const [leaderboardDiagnosticsCopied, setLeaderboardDiagnosticsCopied] = useState(false);
  const [fakeCcuInput, setFakeCcuInput] = useState('0');
  const [pushTestLoading, setPushTestLoading] = useState(false);
  const [pushBroadcastLoading, setPushBroadcastLoading] = useState(false);
  const [pushBroadcastError, setPushBroadcastError] = useState('');
  const [notificationStats, setNotificationStats] = useState<{
    optedInPlayers: number;
    updatesEnabledPlayers: number;
    offlineOrbsEnabledPlayers: number;
    totalPlayers: number;
    percentage: number;
    updatesPercentage: number;
    offlineOrbsPercentage: number;
  } | null>(null);
  const [notificationStatsLoading, setNotificationStatsLoading] = useState(false);
  const [notificationCampaignId, setNotificationCampaignId] = useState('');
  const [notificationCampaign, setNotificationCampaign] = useState<{
    status: 'queued' | 'sending' | 'complete' | 'failed';
    sent: number;
    queued: number;
    attributionTracked: number;
    error?: string;
  } | null>(null);

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

  const loadRiftAdmin = async () => {
    const username = riftAdminUsername.trim().replace(/^u\//i, '');
    if (!username) {
      setMessage('Enter a Reddit username to inspect its Rift archive.');
      return;
    }
    setRiftAdminLoading(true);
    try {
      const response = await fetch('/api/dev/rift/status?username=' + encodeURIComponent(username), { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not inspect Rift progression.');
      setRiftAdminData(data);
      setMessage('Loaded Rift archive for u/' + username + '.');
    } catch (error) {
      setMessage('Error: ' + (error instanceof Error ? error.message : 'Could not inspect Rift progression.'));
    } finally {
      setRiftAdminLoading(false);
    }
  };

  const grantRiftAdminProgress = async () => {
    const username = riftAdminUsername.trim().replace(/^u\//i, '');
    const points = Math.max(0, Math.floor(Number(riftAdminPoints) || 0));
    const minutes = Math.max(0, Math.floor(Number(riftAdminMinutes) || 0));
    if (!username || (points === 0 && minutes === 0)) {
      setMessage('Enter a username and a positive Rift Point or minute amount.');
      return;
    }
    const result = await sendAdminAction('/api/dev/rift/grant', { username, points, minutes }, false,
      'Granted ' + points.toLocaleString() + ' Rift Points and ' + minutes.toLocaleString() + ' minutes of Rift progress to u/' + username + '.');
    if (result) await loadRiftAdmin();
  };

  const loadPopupAnalytics = async (silent = false) => {
    setPopupStatsLoading(true);
    try {
      const res = await fetch('/api/dev/popups', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load popup settings and analytics.');
      if (!data.config || !data.stats) throw new Error('Popup analytics response is incomplete.');
      setPopupConfig({ ...DEFAULT_POPUP_CONFIG, ...data.config });
      setPopupStats(data.stats as PopupStats);
      setPopupStatsUpdatedAt(Number(data.generatedAt) || Date.now());
      setPopupStatsError(null);
      if (!silent) setMessage('Loaded popup visibility settings and acceptance metrics.');
    } catch (error: any) {
      const detail = error?.message || 'Could not load popup analytics.';
      setPopupStatsError(detail);
      if (!silent) setMessage('Error: ' + detail);
    } finally {
      setPopupStatsLoading(false);
    }
  };

  const loadAlignmentChoiceStats = async (silent = false) => {
    setAlignmentChoiceStatsLoading(true);
    try {
      const response = await fetch('/api/dev/alignment/stats', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not load Alignment choice statistics.');
      setAlignmentChoiceStats({
        total: Math.max(0, Number(data.total) || 0),
        choices: {
          starseeker: Math.max(0, Number(data.choices?.starseeker) || 0),
          goldenOrbit: Math.max(0, Number(data.choices?.goldenOrbit) || 0),
          clockwork: Math.max(0, Number(data.choices?.clockwork) || 0),
        },
        recent: Array.isArray(data.recent) ? data.recent : [],
        generatedAt: Number(data.generatedAt) || Date.now(),
      });
      setAlignmentChoiceStatsError(null);
      if (!silent) setMessage('Loaded Celestial Alignment choices and player activity.');
    } catch (error: any) {
      const detail = error?.message || 'Could not load Alignment choice statistics.';
      setAlignmentChoiceStatsError(detail);
      if (!silent) setMessage('Error: ' + detail);
    } finally {
      setAlignmentChoiceStatsLoading(false);
    }
  };

  const forceAlignmentChooserForAdmin = async () => {
    const result = await sendAdminAction('/api/dev/alignment/force', {}, false,
      'A Celestial Alignment chooser was queued for your admin account.');
    if (result?.queued === true) onClose();
  };

  useEffect(() => {
    if (activeAdminTool !== 'alignment-events') return;
    void loadAlignmentChoiceStats(true);
    const interval = window.setInterval(() => void loadAlignmentChoiceStats(true), 10_000);
    return () => window.clearInterval(interval);
  }, [activeAdminTool]);

  const updatePopupSetting = async (id: GamePopupId, enabled: boolean) => {
    const data = await sendAdminAction('/api/dev/popups/config', { [id]: enabled }, false,
      (enabled ? 'Enabled ' : 'Disabled ') + (id === 'notification' ? 'notification' : id === 'frenzy' ? 'Frenzy' : 'join subreddit') + ' popup.');
    if (data?.config) {
      const nextConfig = { ...DEFAULT_POPUP_CONFIG, ...data.config };
      setPopupConfig(nextConfig);
      onPopupConfigChanged?.(nextConfig);
    }
    if (data?.stats) setPopupStats(data.stats as PopupStats);
    if (data) await loadPopupAnalytics(true);
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
    lastSessionNotificationSource?: 'offline-full' | 'manual';
    lastSessionNotificationAt?: number;
    legacyOnly?: boolean;
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

  const loadServerMonitor = async (showLoading = false) => {
    if (serverMonitorPollLockRef.current) return;
    serverMonitorPollLockRef.current = true;
    if (showLoading) setServerMonitorLoading(true);
    try {
      const res = await fetch('/api/dev/server-monitor', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load server monitor.');
      setServerMonitor(data as ServerMonitorSnapshot);
      setServerMonitorError('');
    } catch (error: unknown) {
      setServerMonitorError(error instanceof Error ? error.message : 'Could not load server monitor.');
    } finally {
      serverMonitorPollLockRef.current = false;
      if (showLoading) setServerMonitorLoading(false);
    }
  };

  const loadServerStorage = async (showLoading = false) => {
    if (serverStoragePollLockRef.current) return;
    serverStoragePollLockRef.current = true;
    if (showLoading) setServerStorageLoading(true);
    try {
      const res = await fetch('/api/dev/server-monitor/storage', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not estimate Redis storage.');
      setServerStorage(data as ServerStorageEstimate);
      setServerStorageError('');
    } catch (error: unknown) {
      setServerStorageError(error instanceof Error ? error.message : 'Could not estimate Redis storage.');
    } finally {
      serverStoragePollLockRef.current = false;
      if (showLoading) setServerStorageLoading(false);
    }
  };

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

  const matchesAdminSearch = (section: AdminConsoleSection, tool: AdminConsoleTool) => {
    const query = adminToolSearch.trim().toLocaleLowerCase();
    return !query || section.label.toLocaleLowerCase().includes(query) || tool.label.toLocaleLowerCase().includes(query);
  };

  const visibleAdminSections = ADMIN_CONSOLE_SECTIONS
    .map(section => ({ ...section, tools: section.tools.filter(tool => matchesAdminSearch(section, tool)) }))
    .filter(section => section.tools.length > 0);

  const selectAdminTool = (sectionId: string, tool: AdminConsoleTool) => {
    setActiveAdminSection(sectionId);
    setActiveAdminTool(tool.id);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(tool.target);
      let parent: HTMLElement | null = target;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const renderAdminToolBar = (sectionId: string) => {
    const section = ADMIN_CONSOLE_SECTIONS.find(item => item.id === sectionId);
    if (!section) return null;
    const tools = section.tools.filter(tool => matchesAdminSearch(section, tool));
    return (
      <div className="my-3 rounded-xl border border-slate-800 bg-black/20 p-2 space-y-2">
        <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{section.label} tools</div>
        <div className="flex flex-wrap gap-1.5">
          {tools.map(tool => {
            const selected = activeAdminSection === section.id && activeAdminTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectAdminTool(section.id, tool)}
                className={buttonBase + ' px-2.5 py-1.5 ' + (selected
                  ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200 ring-1 ring-emerald-400/15'
                  : 'bg-slate-900 border-slate-700 hover:border-emerald-500/40 hover:bg-slate-800 text-slate-300')}
              >
                {tool.label}
              </button>
            );
          })}
          {tools.length === 0 && <span className="text-[10px] text-slate-600">No matching tools.</span>}
        </div>
      </div>
    );
  };

  const loadLeaderboardDiagnostics = async () => {
    setLeaderboardDiagnosticsLoading(true);
    setLeaderboardDiagnosticsError('');
    setLeaderboardDiagnosticsCopied(false);
    try {
      const res = await fetch('/api/dev/leaderboard-diagnostics', { cache: 'no-store' });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : 'Could not load leaderboard diagnostics.';
        throw new Error(message);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Diagnostics returned an invalid response.');
      }
      setLeaderboardDiagnostics(data as Record<string, any>);
      setMessage('Leaderboard/player-list diagnostic snapshot collected from this running installation.');
    } catch (error) {
      setLeaderboardDiagnosticsError(error instanceof Error ? error.message : 'Could not load leaderboard diagnostics.');
    } finally {
      setLeaderboardDiagnosticsLoading(false);
    }
  };

  const copyLeaderboardDiagnostics = async () => {
    if (!leaderboardDiagnostics) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(leaderboardDiagnostics, null, 2));
      setLeaderboardDiagnosticsCopied(true);
      setMessage('Diagnostic JSON copied. It contains usernames and redacted account-ID suffixes.');
    } catch {
      setLeaderboardDiagnosticsError('Clipboard access was blocked. The JSON report remains visible below for manual copying.');
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
          !Number.isSafeInteger(data.uniqueUsers) || Number(data.uniqueUsers) < 0 ||
          !Number.isSafeInteger(data.uniqueToday) || Number(data.uniqueToday) < 0 ||
          !Number.isSafeInteger(data.newPlayersToday) || Number(data.newPlayersToday) < 0 ||
          !data.day1Retention || !data.day3Retention || !data.conversion || !data.uniqueByType ||
          !Array.isArray(data.viewers) || !Array.isArray(data.posts) || !Array.isArray(data.last24Hours) || !Array.isArray(data.last30Days) ||
          !data.byType || !data.byDevice || !data.byTypeAndDevice || !data.conversionByDevice) {
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
    void loadPopupAnalytics(true);
    // Keep the dashboard current while the Admin Console is open. Previously
    // it loaded only once, which made new popup events appear not to count.
    const interval = window.setInterval(() => void loadPopupAnalytics(true), 15_000);
    return () => window.clearInterval(interval);
  }, []);

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

  const loadNotificationStats = async () => {
    setNotificationStatsLoading(true);
    try {
      const res = await fetch('/api/dev/notifications/stats', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load notification audience statistics.');
      setNotificationStats({
        optedInPlayers: Math.max(0, Number(data.optedInPlayers) || 0),
        updatesEnabledPlayers: Math.max(0, Number(data.updatesEnabledPlayers) || 0),
        offlineOrbsEnabledPlayers: Math.max(0, Number(data.offlineOrbsEnabledPlayers) || 0),
        totalPlayers: Math.max(0, Number(data.totalPlayers) || 0),
        percentage: Math.max(0, Math.min(100, Number(data.percentage) || 0)),
        updatesPercentage: Math.max(0, Math.min(100, Number(data.updatesPercentage) || 0)),
        offlineOrbsPercentage: Math.max(0, Math.min(100, Number(data.offlineOrbsPercentage) || 0)),
      });
    } catch (error: any) {
      setNotificationStats(null);
      setMessage('Notification stats unavailable: ' + (error?.message || 'Could not read Reddit opt-ins.'));
    } finally {
      setNotificationStatsLoading(false);
    }
  };

  const sendManualPushBroadcast = async () => {
    if (pushBroadcastLoading) return;
    setPushBroadcastError('');
    setPushBroadcastLoading(true);
    setNotificationCampaign(null);
    setNotificationCampaignId('');
    setMessage('');
    try {
      const res = await fetch('/api/dev/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not queue the Game Update preset.');
      setNotificationCampaignId(String(data.campaignId ?? ''));
      setNotificationCampaign({ status: 'queued', sent: 0, queued: 0, attributionTracked: 0 });
      setMessage('Game Update preset queued for players who enabled Game updates.');
    } catch (error: any) {
      setPushBroadcastError(error?.message || 'Could not queue the Game Update preset.');
    } finally {
      setPushBroadcastLoading(false);
      void loadNotificationStats();
    }
  };

  useEffect(() => {
    void loadNotificationStats();
  }, []);

  useEffect(() => {
    if (!notificationCampaignId) return;
    let cancelled = false;
    let inFlight = false;
    let interval: number | undefined;
    const refreshCampaign = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch('/api/dev/notifications/campaign/' + encodeURIComponent(notificationCampaignId), { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load broadcast status.');
        if (!cancelled) {
          setNotificationCampaign({
            status: data.status,
            sent: Math.max(0, Number(data.sent) || 0),
            queued: Math.max(0, Number(data.queued) || 0),
            attributionTracked: Math.max(0, Number(data.attributionTracked) || 0),
            ...(typeof data.error === 'string' ? { error: data.error } : {}),
          });
        }
        if (data.status === 'complete' || data.status === 'failed') {
          if (interval !== undefined) window.clearInterval(interval);
          void loadNotificationStats();
        }
      } catch (error) {
        if (!cancelled) console.warn('[Notification Broadcast] Status refresh failed.', error);
      } finally {
        inFlight = false;
      }
    };
    void refreshCampaign();
    interval = window.setInterval(() => void refreshCampaign(), 5000);
    return () => {
      cancelled = true;
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [notificationCampaignId]);

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

  const clearAllDiagnosticLogs = async () => {
    if (!window.confirm('Delete all stored diagnostic logs, including per-player Player Spy traces? Player saves, combat saves, Codex, leaderboards, and player progression will not be deleted.')) return;
    setClearAllLogsLoading(true);
    try {
      const res = await fetch('/api/dev/diagnostic-logs/clear-all', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not clear diagnostic logs.');
      setSaveLogs([]);
      setPaymentLogs([]);
      setGlobalBoosterLogs([]);
      setGlobalBoosterActivationLog([]);
      setMessage('Diagnostic cleanup deleted ' + Number(data.sharedLogKeysDeleted ?? 0) + ' shared log keys and ' + Number(data.playerSpyLogsDeleted ?? 0) + ' Player Spy logs. Player data was preserved.');
    } catch (e: any) {
      setMessage('Error: ' + (e?.message || 'Could not clear diagnostic logs.'));
    } finally {
      setClearAllLogsLoading(false);
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

  const appendCliHistory = (command: string, output: string, ok: boolean) => {
    setExecuteAsResult(output);
    setCliHistory(previous => [...previous.slice(-29), { command, output, ok, at: Date.now() }]);
  };

  const runAdminCli = async () => {
    const command = executeAsCommands.trim();
    if (!command) {
      appendCliHistory('', 'Enter a command.', false);
      return;
    }

    if (/^(?:target\s+clear|clear\s+target|as\s+off)$/i.test(command)) {
      setExecuteAsUsername('');
      appendCliHistory(command, 'One-shot player target cleared.', true);
      setExecuteAsCommands('');
      return;
    }

    const arm = /^(?:as|target)\s+(.+)$/i.exec(command);
    if (arm) {
      const username = arm[1]!.trim().replace(/^u\//i, '');
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(username)) {
        appendCliHistory(command, 'Invalid Reddit username. Use letters, numbers, underscores, or hyphens.', false);
        setExecuteAsCommands('');
        return;
      }
      setExecuteAsUsername(username);
      appendCliHistory(command, 'Armed u/' + username + '. The next player command will run against that account, then the target will clear.', true);
      setExecuteAsCommands('');
      return;
    }

    if (/^(?:help|\?)$/i.test(command)) {
      appendCliHistory(command, [
        'as <username>                 Arm the next player command for one account',
        'target clear                  Disarm the player target',
        'give coins|shards|dust|offline|rolls <amount>',
        'set <path> <JSON value>       Example: set coins 1e50',
        'add|subtract <path> <amount>  Example: add shards 100',
        'delete <path>                 Example: delete activeBoosters.fortune',
        'upgrade <id> <level>          Example: upgrade speed 20',
        'mastery <id> <level>          Example: mastery continuumLuck 50',
        'prestige-upgrade <id> <level>',
        'boost <fortune|hyperdrive|barrage|prosperity|ascension> <minutes>',
        'offline add|set <amount>      cooldown ready',
        'menus disable [reason]        menus enable',
        'maintenance on [reason]     maintenance off',
        'read-only on [reason]       read-only off',
        'features                       List global feature switches',
        'feature <name> disable [reason]',
        'feature <name> enable',
        'feature gameplay disable [reason] stops all mapped game actions',
        'feature player-actions disable blocks writes but keeps reads available',
        'Feature switches include bulk upgrades, Chain Patcher, Altar, Prestige upgrades,',
        'combat tactics/gear/runes, guild actions, Frenzy setup/rewards, and presence.',
        'announce <message>            announce clear',
        'balance list                  Show all live balance settings',
        'balance get <key>             Read one value',
        'balance preview <key> <value> Preview without changing it',
        'balance set <key> <value>     Apply immediately for everyone',
        'balance reset <key|all>       Restore default value(s)',
        'balance history               Show retained audit revisions',
        'balance rollback <revision>   Restore the configuration before that revision',
        '',
        'Player commands require an armed target. The target is consumed on the next player command, including a failed attempt.',
        'Global menu, feature, read-only, announcement, and balance commands never run as a player.',
        'Only registered commands are accepted. JavaScript and shell commands are not executed.',
      ].join('\n'), true);
      setExecuteAsCommands('');
      return;
    }

    if (/^clear$/i.test(command)) {
      setCliHistory([]);
      setExecuteAsResult('');
      setExecuteAsCommands('');
      return;
    }

    const isGlobal = /^(?:menus?|announce(?:ment)?|features?|maintenance|read-only|balance)\b/i.test(command);
    const target = executeAsUsername.trim().replace(/^u\//i, '');
    if (isGlobal && target) {
      appendCliHistory(command, 'A player target is armed. Run a player command first or enter "target clear" before using a global command.', false);
      setExecuteAsCommands('');
      return;
    }
    if (!isGlobal && !target) {
      appendCliHistory(command, 'No player target is armed. Enter "as <username>" before a player command.', false);
      setExecuteAsCommands('');
      return;
    }

    if (!window.confirm(
      isGlobal
        ? 'Run this global Admin CLI command?'
        : 'Run the next command as u/' + target + '? The one-shot target will clear after this attempt.',
    )) return;

    setExecuteAsLoading(true);
    setExecuteAsCommands('');
    if (!isGlobal) setExecuteAsUsername('');
    try {
      const response = await fetch('/api/dev/cli/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, ...(isGlobal ? {} : { username: target }) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Admin CLI command failed.');

      let output = '';
      if (data.localOnly) output = 'GitHub Pages simulation only. This does not change the live Devvit game.\n';
      if (data.scope === 'everyone') {
        if (data.balance) {
          const balance = data.balance;
          const formatValue = (value: unknown, unit: string) => {
            const numeric = Number(value);
            return Number.isFinite(numeric) ? String(Number(numeric.toFixed(4))) + unit : String(value ?? '?');
          };
          if (balance.action === 'list') {
            output += 'Live balance settings · revision ' + balance.revision + '\n' +
              (balance.settings ?? []).map((setting: any) =>
                setting.key + ' = ' + formatValue(setting.value, setting.unit) +
                ' (default ' + formatValue(setting.defaultValue, setting.unit) +
                ', range ' + setting.min + '–' + setting.max + ')\n  ' + setting.description,
              ).join('\n');
          } else if (balance.action === 'history') {
            output += 'Live balance history · current revision ' + balance.revision + '\n' +
              (balance.history?.length
                ? balance.history.map((entry: any) =>
                    '#' + entry.revision + ' ' + entry.action +
                    (entry.key ? ' ' + entry.key : '') +
                    ' by ' + (entry.updatedBy || 'unknown') +
                    (entry.rollbackOf ? ' (rollback of #' + entry.rollbackOf + ')' : '') +
                    ' · ' + new Date(entry.updatedAt).toLocaleString(),
                  ).join('\n')
                : 'No balance changes have been made.');
          } else if (balance.setting) {
            const setting = balance.setting;
            output += setting.key + ' = ' + formatValue(setting.value, setting.unit);
            if (balance.action === 'preview') {
              output += '\nProposed: ' + formatValue(setting.proposedValue, setting.unit);
              output += '\n' + (setting.changed ? 'No changes applied.' : 'This is already the active value.');
            }
          } else if (balance.action === 'set') {
            output += balance.changed
              ? 'Updated ' + balance.key + ': ' + formatValue(balance.previousValue, '') + ' → ' + formatValue(balance.value, '') + '.\nRevision ' + balance.revision + '.'
              : balance.key + ' is already ' + formatValue(balance.value, '') + '. No new revision created.';
          } else if (balance.action === 'reset') {
            output += balance.changed
              ? 'Reset ' + balance.key + ' to ' + formatValue(balance.value, '') + '. Revision ' + balance.revision + '.'
              : balance.key + ' already has its default value.';
          } else if (balance.action === 'reset-all') {
            output += 'All live balance settings reset to defaults. Revision ' + balance.revision + '.';
          } else if (balance.action === 'rollback') {
            output += 'Restored the configuration from before revision #' + balance.rolledBackRevision + '. New revision: ' + balance.revision + '.';
          } else {
            output += JSON.stringify(balance, null, 2);
          }
          if (balance.action === 'set' || balance.action === 'reset' || balance.action === 'reset-all' || balance.action === 'rollback') {
            window.dispatchEvent(new Event('io-live-balance-updated'));
          }
        } else output += data.menuControl
          ? data.menuControl.enabled
            ? 'Menus enabled for everyone.'
            : 'Menus disabled for everyone.\nDeveloper reason: ' + data.menuControl.reason
          : data.featureControl
            ? data.featureControl.feature + (data.featureControl.enabled ? ' enabled for everyone.' : ' disabled for everyone.\nDeveloper reason: ' + data.featureControl.reason)
            : data.featureControls
              ? 'Global feature switches:\n' + Object.values(data.featureControls).map((control: any) =>
                  (control.enabled ? 'ON  ' : 'OFF ') + control.feature + (control.enabled ? '' : ' | ' + control.reason),
                ).join('\n')
              : data.announcement?.message
                ? 'Developer announcement updated.'
                : 'Developer announcement cleared.';
      } else {
        output += 'Executed ' + (data.results?.length ?? 0) + ' save operation(s) as u/' + (data.username ?? target) + '.';
        output += '\nSave revision: ' + String(data.stateRevision ?? '?');
        if (data.invalidatedRollTicket) output += '\nThe player’s pending roll ticket was invalidated.';
        output += '\n\n' + JSON.stringify(data.results ?? [], null, 2);
      }
      appendCliHistory(command, output, true);
    } catch (error: any) {
      appendCliHistory(command, 'Command failed: ' + (error?.message || 'Unknown Admin CLI error.'), false);
    } finally {
      setExecuteAsLoading(false);
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

  const registerCurrentPostForGlobalChat = async () => {
    if (globalChatRegistrationBusy) return;
    const confirmed = window.confirm(
      'Register the CURRENT Reddit post as the main Infinity Orbs Game destination for Global Chat? Only confirm while the actual main Game post is open. Never run this on a Frenzy or shared-Orb post.'
    );
    if (!confirmed) return;
    setGlobalChatRegistrationBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/dev/chat/register-current-post', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not register the current post.');
      setMessage('Registered ' + String(data.postId ?? 'the current post') + ' for Global Chat. Reload the main Game post to refresh chat availability.');
    } catch (error) {
      setMessage('Global Chat registration failed: ' + (error instanceof Error ? error.message : 'Unknown error.'));
    } finally {
      setGlobalChatRegistrationBusy(false);
    }
  };

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
      const res = await fetch('/api/dev/players', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load player list.');
      const players = Array.isArray(data.players) ? data.players : [];
      setPlayerList(players);
      if (data.notificationStats && typeof data.notificationStats === 'object') {
        setNotificationStats({
          optedInPlayers: Math.max(0, Number(data.notificationStats.optedInPlayers) || 0),
          updatesEnabledPlayers: Math.max(0, Number(data.notificationStats.updatesEnabledPlayers) || 0),
          offlineOrbsEnabledPlayers: Math.max(0, Number(data.notificationStats.offlineOrbsEnabledPlayers) || 0),
          totalPlayers: Math.max(0, Number(data.notificationStats.totalPlayers) || 0),
          percentage: Math.max(0, Math.min(100, Number(data.notificationStats.percentage) || 0)),
          updatesPercentage: Math.max(0, Math.min(100, Number(data.notificationStats.updatesPercentage) || 0)),
          offlineOrbsPercentage: Math.max(0, Math.min(100, Number(data.notificationStats.offlineOrbsPercentage) || 0)),
        });
      }
      const activity = data.activity && typeof data.activity === 'object' ? data.activity : {};
      setPlayerActivity({
        dailyActiveUsers: Math.max(0, Number(activity.dailyActiveUsers ?? 0) || 0),
        weeklyActiveUsers: Math.max(0, Number(activity.weeklyActiveUsers ?? 0) || 0),
        monthlyActiveUsers: Math.max(0, Number(activity.monthlyActiveUsers ?? 0) || 0),
      });
      const activeCount = players.filter((player: { active?: boolean }) => player.active).length;
      const recoveredCount = players.filter(
        (player: { registryRecovered?: boolean }) => player.registryRecovered === true,
      ).length;
      const legacyOnlyCount = players.filter(
        (player: { legacyOnly?: boolean }) => player.legacyOnly === true,
      ).length;
      const loadedMessage = 'Loaded ' + players.length + ' player accounts (' + activeCount + ' active now).';
      if (legacyOnlyCount > 0) {
        setMessage(loadedMessage + ' Showing ' + legacyOnlyCount + ' historical leaderboard account(s) without stored account IDs; these entries cannot be targeted for admin actions.');
      } else if (recoveredCount > 0) {
        setMessage(loadedMessage + ' Recovered ' + recoveredCount + ' shared account(s) from the legacy leaderboard; the full list may still be incomplete.');
      } else if (players.length === 0) {
        setMessage(loadedMessage + ' If this installation had players before, the registry and its fallback data may be missing; refreshing cannot recreate lost records.');
      } else {
        setMessage(loadedMessage);
      }
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

  const handleQueueGuaranteedRoll = async (rarityNum: number) => {
    const data = await sendAdminAction('/api/dev/queue-force-roll', { rarity: rarityNum });
    if (data?.state && onForceRollQueued) {
      onForceRollQueued(data.state as PlayerState, Number(data.targetRarity) || rarityNum);
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
            seeds: string[];
            predictionStartIndex: number;
          }>('/api/dev/reset-cooldown', {});
          const ticketSeed = ticket.seeds[
            ticket.nextIndex - ticket.predictionStartIndex
          ];
          if (!ticketSeed) throw new Error('Fresh roll ticket did not include the next seed.');
          return await request<RollResponse>('/api/roll', {
            auto,
            ticketId: ticket.ticketId,
            ticketIndex: ticket.nextIndex,
            ticketSeed,
          });
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const message = lastError.message;
          const retryable =
            message.includes('Cooldown:') ||
            message.includes('Your action is queued') ||
            message.includes('PLAYER_MUTATION_QUEUED') ||
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
        'Mechanic · Premium Booster Catalog',
        async () => {
          const activated: string[] = [];
          for (const id of Object.keys(PREMIUM_BOOSTERS) as Array<keyof typeof PREMIUM_BOOSTERS>) {
            await request('/api/dev/state', { shards: 10_000, activeBoosters: {} });
            const result = await request<{ state: any }>('/api/boosters/activate', { id });
            const state = recordValue(result.state) as Record<string, any>;
            const activeUntil = Number(state.activeBoosters?.[id] ?? 0);
            if (activeUntil < Date.now() + PREMIUM_BOOSTERS[id].durationMs - 5_000) throw new Error(id + ' did not activate for its configured duration.');
            if (Number(state.shards) !== 10_000 - PREMIUM_BOOSTERS[id].costShards) throw new Error(id + ' spent the wrong Shard cost: ' + state.shards + ' remaining.');
            activated.push(id);
          }
          return activated;
        },
        ids => 'activated and cost-checked ' + ids.length + '/' + Object.keys(PREMIUM_BOOSTERS).length + ' premium boosters',
      );

      await step(
        'Set 1,000 Shards',
        () => request('/api/dev/state', { shards: 1_000, lastSeenAt: Date.now() }),
        () => 'shards=1,000',
      );
      await step(
        'Activate Global Luck',
        () => request<{ state: any }>('/api/global-boosters/activate', { id: 'luck' }),
        (result: any) => `global luck tier=${shortNumber(result.state?.globalBoosters?.luck?.tier, 0)} · ${stateSummary(result)}`,
      );
      await step(
        'Set 1,000 Shards',
        () => request('/api/dev/state', { shards: 1_000, lastSeenAt: Date.now() }),
        () => 'shards=1,000',
      );
      await step(
        'Activate Global Speed',
        () => request<{ state: any }>('/api/global-boosters/activate', { id: 'speed' }),
        (result: any) => `global speed tier=${shortNumber(result.state?.globalBoosters?.speed?.tier, 0)} · ${stateSummary(result)}`,
      );
      await step(
        'Set 1,000 Shards',
        () => request('/api/dev/state', { shards: 1_000, lastSeenAt: Date.now() }),
        () => 'shards=1,000',
      );
      await step(
        'Activate Global Crit',
        () => request<{ state: any }>('/api/global-boosters/activate', { id: 'crit' }),
        (result: any) => `global crit tier=${shortNumber(result.state?.globalBoosters?.crit?.tier, 0)} · ${stateSummary(result)}`,
      );

      await step(
        'Mechanic · Automation Catalog',
        async () => {
          await request('/api/dev/state', { shards: 100_000, automations: {} });
          const unlocked: string[] = [];
          for (const id of Object.keys(AUTOMATIONS) as Array<keyof typeof AUTOMATIONS>) {
            const result = await request<{ state: any }>('/api/automation/buy', { id });
            const state = recordValue(result.state) as Record<string, any>;
            if (state.automations?.[id] !== true) throw new Error('Automation ' + id + ' was not persisted as unlocked.');
            unlocked.push(id);
          }
          return unlocked;
        },
        ids => 'purchased and verified ' + ids.length + '/' + Object.keys(AUTOMATIONS).length + ' automations',
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

      // Force-roll API checks run after the optional prestige sweep, so their
      // isolated fixture must live outside that conditional's lexical scope.
      const seedSingleBallForceRoll = async (highestRarity = 0) => {
        // Clear subreddit-wide bonuses as well as account-specific sources so
        // extra balls and criticals cannot contaminate a deterministic test.
        for (const id of ['luck', 'speed', 'crit'] as const) {
          await request('/api/dev/global-booster', { id, tier: 0, minutes: 1 });
        }

        const result = await request<any>('/api/dev/state', {
          coins: 100_000,
          shards: 50,
          cosmicDust: 0,
          level: 4,
          levelXpFloor: 533,
          xp: 600,
          freeShardsEarnedToday: 0,
          totalRolls: 0,
          totalCrits: 0,
          highestRarity,
          collection: {},
          collectionValue: 0,
          lifetimeCollectionValue: 0,
          offlineRolls: 0,
          currentRunRolls: 0,
          rollsSinceBest: 0,
          lastRollAt: 0,
          aftershockRecord: 0,
          longestRollingSessionMs: 0,
          rollingSessionStartedAt: 0,
          rollingSessionLastRollAt: 0,
          lastSeenAt: Date.now(),
          lastFreeShardReset: '2020-01-01',
          onlinePlayers: 1,
          turboRollUntil: 0,
          autoRollEnabled: false,
          upgrades: {
            speed: 0, multi: 0, clusterRoll: 0, auto: 0, luck: 0, coinBonus: 0,
            shardChance: 0, xpBonus: 0, critChance: 0, critPower: 0,
            offlineRate: 0, valueBonus: 0,
          },
          prestigeUpgrades: Object.fromEntries(
            Object.keys(PRESTIGE_UPGRADES).map(id => [id, 0]),
          ),
          masterySkills: {
            continuumLuck: 0, prosperity: 0, shardAttunement: 0, critMastery: 0,
            aftershock: 0, chronoFlow: 0, infiniteVault: 0, cosmicAttunement: 0, celestialSurge: 0,
            pityAccelerant: 0, apexFortune: 0, celestialVolley: 0,
          },
          activeBoosters: {},
          automations: {
            autoQuestClaim: false,
            autoStreakClaim: false,
            autoCommunityClaim: false,
            autoOfflineClaim: false,
            autoUpgrade: false,
          },
          sacrifices: {
            coinsSacrificed: 0,
            shardsSacrificed: 0,
            altarLevel: 0,
            luckSurgeUntil: 0,
          },
        });
        const state = recordValue(result.state);
        if (Number(state.level) < 2 || Number(state.xp) < 1) {
          throw new Error('Force-roll fixture failed to persist an unlocked player state (level=' + state.level + ', xp=' + state.xp + ').');
        }
        return result;
      };



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
          aftershock: 0, chronoFlow: 0, infiniteVault: 0, cosmicAttunement: 0, celestialSurge: 0,
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
            // Pin session records so the test outcome never depends on the admin's real save.
            aftershockRecord: 0,
            longestRollingSessionMs: 0,
            rollingSessionStartedAt: 0,
            rollingSessionLastRollAt: 0,
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
            automations: {
              autoQuestClaim: false,
              autoStreakClaim: false,
              autoCommunityClaim: false,
              autoOfflineClaim: false,
              autoUpgrade: false,
            },
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

        // The admin mechanic sweep pins the player to Level 4, where Guilds is
        // intentionally locked. Upgrades remains available and still forces a
        // RollSection unmount/remount so mount-only preferences are re-read.
        const remountRollSection = async () => {
          const navButtons = () => Array.from(document.querySelectorAll('button'));
          const upgradesNav = navButtons().find(el =>
            el.classList.contains('nav-tab') &&
            el.getAttribute('aria-label') === 'Upgrades' &&
            el.getClientRects().length > 0
          ) as HTMLButtonElement | undefined;
          if (!upgradesNav) throw new Error('Visible Upgrades navigation control was not found.');
          upgradesNav.click();
          await new Promise(resolve => setTimeout(resolve, 100));

          const rollNav = navButtons().find(el =>
            el.classList.contains('nav-tab') &&
            el.getAttribute('aria-label') === 'Roll' &&
            el.getClientRects().length > 0
          ) as HTMLButtonElement | undefined;
          if (!rollNav) throw new Error('Visible Roll navigation control was not found after the tab transition.');
          rollNav.click();
          await new Promise(resolve => setTimeout(resolve, 100));
          await onRefresh();
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

        await step('Mechanic · Mastery · Continuum Luck', async () => {
          await setMechanicState(); const before = await readMechanics();
          await setMechanicState({}, { masterySkills: { ...zeroMastery, continuumLuck: 1 } }); const after = await readMechanics();
          if (!(Number(after.luckMultiplier) > Number(before.luckMultiplier))) throw new Error('Continuum Luck did not increase Luck.');
          return { before, after };
        }, r => 'Luck ' + shortNumber(r.before.luckMultiplier, 3) + ' → ' + shortNumber(r.after.luckMultiplier, 3));
        await step('Mechanic · Mastery · Prosperity', async () => {
          await setMechanicState({}, { masterySkills: { ...zeroMastery, prosperity: 0 } });
          const before = await request<any>('/api/dev/force-roll', { rarity: 100, randomValue: 0.999999 });
          await setMechanicState({}, { masterySkills: { ...zeroMastery, prosperity: 10 } });
          const after = await request<any>('/api/dev/force-roll', { rarity: 100, randomValue: 0.999999 });
          if (!(Number(after.coinsGained) > Number(before.coinsGained))) throw new Error('Prosperity did not increase Coin rewards.');
          return { before, after };
        }, r => 'Coins +' + shortNumber(r.before.coinsGained, 0) + ' → +' + shortNumber(r.after.coinsGained, 0));
        await step('Mechanic · Mastery · Shard Attunement', async () => {
          await setMechanicState({}, { masterySkills: { ...zeroMastery, shardAttunement: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { masterySkills: { ...zeroMastery, shardAttunement: 10 } }); const after = await readMechanics();
          if (!(Number(after.shardProcChance) > Number(before.shardProcChance))) throw new Error('Shard Attunement did not increase Shard chance.');
          return { before, after };
        }, r => 'Shard chance ' + shortNumber(r.before.shardProcChance * 100, 3) + '% → ' + shortNumber(r.after.shardProcChance * 100, 3) + '%');
        await step('Mechanic · Mastery · Critical Mastery', async () => {
          await setMechanicState({}, { masterySkills: { ...zeroMastery, critMastery: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { masterySkills: { ...zeroMastery, critMastery: 1 } }); const after = await readMechanics();
          if (!(Number(after.critMultiplier) > Number(before.critMultiplier) && Number(after.effectiveCritChance) > Number(before.effectiveCritChance))) throw new Error('Critical Mastery did not improve critical strength and chance.');
          return { before, after };
        }, r => 'Critical multiplier ' + shortNumber(r.before.critMultiplier, 2) + '× → ' + shortNumber(r.after.critMultiplier, 2) + '×');
        await step('Mechanic · Mastery · Chrono Flow', async () => {
          await setMechanicState({}, { masterySkills: { ...zeroMastery, chronoFlow: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { masterySkills: { ...zeroMastery, chronoFlow: 1 } }); const after = await readMechanics();
          if (!(Number(after.cooldownMs) < Number(before.cooldownMs))) throw new Error('Chrono Flow did not reduce cooldown.');
          return { before, after };
        }, r => 'Cooldown ' + shortNumber(r.before.cooldownMs, 0) + 'ms → ' + shortNumber(r.after.cooldownMs, 0) + 'ms');
        await step('Mechanic · Mastery · Infinite Vault', async () => {
          await setMechanicState({}, { masterySkills: { ...zeroMastery, infiniteVault: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { masterySkills: { ...zeroMastery, infiniteVault: 1 } }); const after = await readMechanics();
          if (Number(after.offlineRollCap) !== Number(before.offlineRollCap) + 200) throw new Error('Infinite Vault did not add 200 offline rolls.');
          return { before, after };
        }, r => 'Offline cap ' + shortNumber(r.before.offlineRollCap, 0) + ' → ' + shortNumber(r.after.offlineRollCap, 0));
        await step('Mechanic · Mastery · Cosmic Attunement', async () => {
          await setMechanicState({}, { collectionValue: 20_000_000, cosmicDust: 0, masterySkills: { ...zeroMastery, cosmicAttunement: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { collectionValue: 20_000_000, cosmicDust: 0, masterySkills: { ...zeroMastery, cosmicAttunement: 1 } }); const after = await readMechanics();
          if (!(Number(after.prestigeDust) > Number(before.prestigeDust))) throw new Error('Cosmic Attunement did not increase pending Dust.');
          return { before, after };
        }, r => 'Pending Dust ' + shortNumber(r.before.prestigeDust, 0) + ' → ' + shortNumber(r.after.prestigeDust, 0));
        await step('Mechanic · Mastery · Celestial Surge', async () => {
          const collection = { '2': 1, '3': 1, '4': 1, '5': 1, '6': 1 };
          await setMechanicState({}, { collection, masterySkills: { ...zeroMastery, celestialSurge: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { collection, masterySkills: { ...zeroMastery, celestialSurge: 1 } }); const after = await readMechanics();
          if (!(Number(after.luckMultiplier) > Number(before.luckMultiplier))) throw new Error('Celestial Surge did not boost Codex-chain Luck.');
          return { before, after };
        }, r => 'Codex Luck ' + shortNumber(r.before.luckMultiplier, 3) + ' → ' + shortNumber(r.after.luckMultiplier, 3));
        await step('Mechanic · Mastery · Pity Accelerant', async () => {
          const prestigeUpgrades = { ...zeroPrestige, resonanceMeter: 1 };
          await setMechanicState({}, { rollsSinceBest: 16, prestigeUpgrades, masterySkills: { ...zeroMastery, pityAccelerant: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { rollsSinceBest: 16, prestigeUpgrades, masterySkills: { ...zeroMastery, pityAccelerant: 1 } }); const after = await readMechanics();
          if (!(Number(after.luckMultiplier) > Number(before.luckMultiplier))) throw new Error('Pity Accelerant did not start Dry Streak Luck earlier.');
          return { before, after };
        }, r => 'Dry-streak Luck ' + shortNumber(r.before.luckMultiplier, 3) + ' → ' + shortNumber(r.after.luckMultiplier, 3));
        await step('Mechanic · Mastery · Apex Fortune', async () => {
          await setMechanicState({}, { masterySkills: { ...zeroMastery, apexFortune: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { masterySkills: { ...zeroMastery, apexFortune: 15 } }); const after = await readMechanics();
          if (!(Number(after.apexFortuneChance) > Number(before.apexFortuneChance) && Math.abs(Number(after.apexFortuneChance) - 0.45) < 1e-9)) throw new Error('Apex Fortune did not reach its configured 45% cap.');
          return { before, after };
        }, r => 'Double-Luck chance ' + shortNumber(r.before.apexFortuneChance * 100, 0) + '% → ' + shortNumber(r.after.apexFortuneChance * 100, 0) + '%');
        await step('Mechanic · Mastery · Celestial Volley', async () => {
          await setMechanicState({}, { masterySkills: { ...zeroMastery, celestialVolley: 0 } }); const before = await readMechanics();
          await setMechanicState({}, { masterySkills: { ...zeroMastery, celestialVolley: 1 } }); const after = await readMechanics();
          if (Number(after.rollsPerActivation) !== Number(before.rollsPerActivation) + 1) throw new Error('Celestial Volley did not add an orb per activation.');
          return { before, after };
        }, r => 'Orbs per activation ' + shortNumber(r.before.rollsPerActivation, 0) + ' → ' + shortNumber(r.after.rollsPerActivation, 0));

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
          'Mechanic · Cosmic Reserve',
          async () => {
            await setMechanicState({ cosmicReserve: 0 }, { cosmicDust: 20 });
            const before = await readMechanics();
            await setMechanicState({ cosmicReserve: 1 }, { cosmicDust: 20 });
            const after = await readMechanics();
            if (!(Number(after.luckMultiplier) > Number(before.luckMultiplier))) throw new Error('Cosmic Reserve did not increase Luck from unspent Dust: ' + before.luckMultiplier + ' → ' + after.luckMultiplier + '.');
            return { before, after };
          },
          result => 'Luck ' + shortNumber(result.before.luckMultiplier, 3) + ' → ' + shortNumber(result.after.luckMultiplier, 3) + ' with unspent Dust',
        );

        await step(
          'Mechanic · Silent Alert Mode',
          async () => {
            await setMechanicState({ sonarPing: 1 });
            sound.setSonarMode(false);
            sound.setSonarThreshold(100);
            await onRefresh();

            // Remount the RollSection so its mount-only preference follows the test fixture.
            await remountRollSection();

            const deadline = Date.now() + 2_000;
            let button: HTMLButtonElement | undefined;
            while (Date.now() < deadline) {
              button = Array.from(document.querySelectorAll('button'))
                .find(el => (el as HTMLButtonElement).dataset.testid === 'sonar-mode-toggle') as HTMLButtonElement | undefined;
              if (button) break;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!button) throw new Error('Sonar control did not unlock after prestige state was applied (prestige=' + JSON.stringify((await request<any>('/api/me')).prestigeUpgrades?.sonarPing) + ').');
            button.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            let activeButton = Array.from(document.querySelectorAll('button'))
              .find(el => (el as HTMLButtonElement).dataset.testid === 'sonar-mode-toggle') as HTMLButtonElement | undefined;
            if (!sound.sonarMode || activeButton?.getAttribute('aria-pressed') !== 'true' || !activeButton.textContent?.includes('Sonar Ping: ON')) throw new Error('Sonar control did not enable Silent Mode.');
            activeButton.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            const resetButton = Array.from(document.querySelectorAll('button'))
              .find(el => (el as HTMLButtonElement).dataset.testid === 'sonar-mode-toggle') as HTMLButtonElement | undefined;
            if (sound.sonarMode || resetButton?.getAttribute('aria-pressed') !== 'false' || !resetButton.textContent?.includes('Sonar Ping: OFF')) throw new Error('Sonar control did not return to OFF after the toggle check.');
            return { text: 'ON → OFF' };
          },
          result => 'Client control unlocked · ' + result.text,
        );

        await step(
          'Mechanic · Sonar Ping Rare Trigger',
          async () => {
            // Near-best mode pings an Orb within 10% of the best, while still below the record.
            await request('/api/dev/state', { highestRarity: 110 });
            await onRefresh();
            await new Promise(resolve => setTimeout(resolve, 50));
            sound.setSonarAlertMode('near-best');
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

            // Reopen RollSection so the component re-reads the mount-only preference.
            await remountRollSection();

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
            const forcedRoll = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            const processed = Math.max(1, Number(forcedRoll.rollsProcessed ?? forcedRoll.batch?.length ?? 1));
            const afterState = await request<any>('/api/me');
            const after = await readMechanics();
            const expectedDryRolls = 17 + processed;
            if (Number(afterState.rollsSinceBest) !== expectedDryRolls || !(Number(after.luckMultiplier) > Number(before.luckMultiplier))) {
              throw new Error('Pity did not activate during the processed volley: expected rollsSinceBest=' + expectedDryRolls + ', got=' + afterState.rollsSinceBest + ', Luck ' + before.luckMultiplier + ' → ' + after.luckMultiplier + '.');
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
            const fixture = { upgrades: { ...zeroUpgrades, multi: 1 } };
            await setMechanicState({ stellarMagnet: 0 }, fixture);
            const baseline = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0 });
            await setMechanicState({ stellarMagnet: 5 }, fixture);
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0 });
            if (Number(result.rollsProcessed) !== Number(baseline.rollsProcessed) + 2) {
              throw new Error('Stellar Magnet should add exactly 2 orbs to this activation: baseline=' + baseline.rollsProcessed + ', upgraded=' + result.rollsProcessed + '.');
            }
            return { baseline, result };
          },
          result => 'Processed ' + shortNumber(result.baseline.rollsProcessed, 0) + ' → ' + shortNumber(result.result.rollsProcessed, 0) + ' (+2 from Stellar Magnet)',
        );

        await step(
          'Mechanic · Turbo Duration',
          async () => {
            await setMechanicState({ chronoOverdrive: 0 }, { shards: 1_000 });
            const beforeNormal = recordValue(await request<any>('/api/me'));
            if (Number(beforeNormal.level) < 2) {
              throw new Error('Turbo test fixture was not unlocked before activation (level=' + beforeNormal.level + ', xp=' + beforeNormal.xp + ').');
            }
            const normal = await request<any>('/api/turbo/activate', {});
            await setMechanicState({ chronoOverdrive: 1 }, { shards: 1_000 });
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
            await setMechanicState({ astralBarrage: 0 });
            const baseline = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            await setMechanicState({ astralBarrage: 1 });
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            if (Number(result.rollsProcessed) !== Number(baseline.rollsProcessed) + 1) {
              throw new Error('Astral Barrage should add one orb to baseline: ' + baseline.rollsProcessed + ' → ' + result.rollsProcessed + '.');
            }
            return { baseline, result };
          },
          result => 'Processed ' + shortNumber(result.baseline.rollsProcessed, 0) + ' → ' + shortNumber(result.result.rollsProcessed, 0) + ' (+1 from Barrage)',
        );

        await step(
          'Mechanic · Cosmic Inheritance',
          async () => {
            await setMechanicState(
              { cosmicInheritance: 1 },
              { coins: 1_000, shards: 100, xp: 32_000, collectionValue: 1_000_000, lifetimeCollectionValue: 1_000_000 },
            );
            const before = recordValue(await request<any>('/api/me'));
            const expectedCoins = Math.max(50, Math.floor(Number(before.coins) * 0.10));
            const expectedShards = Number(before.shards);
            const result = await request<any>('/api/prestige', {});
            if (Number(result.state?.coins) !== expectedCoins || Number(result.state?.shards) !== expectedShards) {
              throw new Error('Inheritance expected Coins=' + expectedCoins + ' and full Shard preservation=' + expectedShards + ': Coins=' + result.state?.coins + ', Shards=' + result.state?.shards + '.');
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
            // The inverse-CDF sampler maps low values to no procs; a high value
// deterministically selects both the critical and Supernova procs.
const result = await request<any>('/api/dev/force-roll', { rarity: 9, randomValue: 0.999999, exactRarity: false });
            if (Number(result.orb?.rarity) <= 45 || !result.orb?.isCrit) {
              throw new Error('Supernova should magnify deterministic critical strength beyond 1/45, got 1/' + result.orb?.rarity + ', crit=' + result.orb?.isCrit + '.');
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
          'Mechanic · Lucky Floor',
          async () => {
            await setMechanicState({ luckyFloor: 5 });
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999, exactRarity: false });
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
            await setMechanicState({ astralArsenal: 0 });
            const baseline = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            await setMechanicState({ astralArsenal: 1 });
            const result = await request<any>('/api/dev/force-roll', { rarity: 2, randomValue: 0.999999 });
            if (Number(result.rollsProcessed) !== Number(baseline.rollsProcessed) + 1) {
              throw new Error('Astral Arsenal should add one orb to baseline: ' + baseline.rollsProcessed + ' → ' + result.rollsProcessed + '.');
            }
            return { baseline, result };
          },
          result => 'Processed ' + shortNumber(result.baseline.rollsProcessed, 0) + ' → ' + shortNumber(result.result.rollsProcessed, 0) + ' (+1 from Arsenal)',
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
          'Mechanic · Auto Scrap',
          async () => {
            await setMechanicState({ autoScrap: 1 });
            await request('/api/dev/state', { level: 8 });
            try {
              const result = await request<any>('/api/combat/auto-scrap', { enabled: true, maxQuality: 55 });
              const me = await request<any>('/api/me');
              if (result.settings?.enabled !== true || Number(result.settings?.maxQuality) !== 55 ||
                  me.combatAutoScrap?.enabled !== true || Number(me.combatAutoScrap?.maxQuality) !== 55) throw new Error('Auto Scrap did not persist enabled state and quality threshold.');
              return result.settings;
            } finally {
              await request('/api/combat/auto-scrap', { enabled: false, maxQuality: 55 }).catch(() => undefined);
            }
          },
          settings => 'enabled=' + String(settings.enabled) + ' · quality threshold=' + shortNumber(settings.maxQuality, 2) + '%',
        );

        await step(
          'Mechanic · Aftershock',
          async () => {
            await setMechanicState({}, { aftershockRecord: 80_000, masterySkills: { ...zeroMastery, aftershock: 0 } });
            const before = await readMechanics();
            await setMechanicState({}, { aftershockRecord: 80_000, masterySkills: { ...zeroMastery, aftershock: 1 } });
            const after = await readMechanics();
            if (!(Number(after.critMultiplier) > Number(before.critMultiplier))) throw new Error('Aftershock did not add Critical Luck after purchase: ' + before.critMultiplier + ' → ' + after.critMultiplier + '.');
            return { before, after };
          },
          result => 'Critical multiplier ' + shortNumber(result.before.critMultiplier, 3) + '× → ' + shortNumber(result.after.critMultiplier, 3) + '×',
        );

        await step(
          'Mechanic · Unbroken Momentum',
          async () => {
            await setMechanicState({ unbrokenMomentum: 0 });
            const before = await readMechanics();
            await setMechanicState({ unbrokenMomentum: 1 }, { longestRollingSessionMs: 48 * 60 * 60_000 });
            const after = await readMechanics();
            if (!(Number(after.cooldownMs) < Number(before.cooldownMs))) throw new Error('Purchased Unbroken Momentum should apply its 48-hour Speed bonus: ' + before.cooldownMs + ' → ' + after.cooldownMs + '.');
            return { before, after };
          },
          result => 'Cooldown ' + shortNumber(result.before.cooldownMs, 0) + 'ms → ' + shortNumber(result.after.cooldownMs, 0) + 'ms at +20% Speed',
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
            const normalRollsPerActivation = Number((await readMechanics()).rollsPerActivation ?? 1);
            const normalStart = await request<any>('/api/dev/frenzy/start', { rarity: 100 });
            const normalBeforeClaim = Number(normalStart.state?.totalRolls ?? 0);
            const normalClaim = await request<any>('/api/dev/frenzy/claim', { postId: normalStart.postId });
            const normalCount = Number(normalClaim.state?.totalRolls ?? 0) - normalBeforeClaim;

            await request('/api/dev/frenzy/reset', {});
            await setMechanicState({ frenzyVolley: 1 }, { upgrades: { ...zeroUpgrades, multi: 1 } });
            const volleyRollsPerActivation = Number((await readMechanics()).rollsPerActivation ?? 1);
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
            const expectedNormal = frenzyOrbCountForRarity(normalRarity) * Math.max(1, normalRollsPerActivation);
            const expectedVolley = Math.floor(frenzyOrbCountForRarity(volleyRarity) * Math.max(1, volleyRollsPerActivation) * 1.20);
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
            const expected = Math.round(Number(base.totalValueGained) * 1.05);
            if (Number(upgraded.totalValueGained) !== expected) {
              throw new Error('Cosmic Valuation should multiply deterministic Collection Value by 1.05 (rounded), expected ' + expected + ', got ' + upgraded.totalValueGained + '.');
            }
            const gained = Number(upgraded.totalValueGained) - Number(base.totalValueGained);
            return { base, upgraded, gained };
          },
          result => 'Collection Value ' + shortNumber(result.base.totalValueGained, 0) + ' → ' + shortNumber(result.upgraded.totalValueGained, 0) + ' (+5 from Cosmic Valuation)',
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
        'Contract · Rarity ladder has 27 tiers',
        async () => {
          if (CONTINUUM_TIERS.length !== 27) {
            throw new Error('Expected 27 rarity tiers, found ' + CONTINUUM_TIERS.length + '.');
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
          const initial = visibleContinuumTiers(8);
          const existing = visibleContinuumTiers(1_000_000);
          const expanded = visibleContinuumTiers(1e15);
          if (initial.length !== 9) throw new Error('Rarity gate exposed ' + initial.length + ' initial tiers below the discovery unlock.');
          if (existing.length !== 18) throw new Error('Discovery gate revealed ' + existing.length + ' tiers at 1/1e6.');
          if (expanded.length !== 27) throw new Error('Expansion gate revealed ' + expanded.length + ' tiers at 1/1e15.');
          return { initial, existing, expanded };
        },
        result => 'initial=' + result.initial.length + ' · discovery=' + result.existing.length + ' · expansion=' + result.expanded.length + ' tiers',
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
          await seedSingleBallForceRoll(9);
          const result = await request<any>('/api/dev/force-roll', { rarity: 1_000_000_000_000_000, randomValue: 0.999999 });
          if (result.orb?.tier !== 'Paradox') throw new Error('Expected Paradox, got ' + result.orb?.tier + '.');
          return result;
        },
        result => '1/' + formatRarity(result.orb.rarity, result.orb.isInfinity) + ' · ' + result.orb.tier,
      );

      await step(
        'API · Force-roll 1/1e16 Beyond',
        async () => {
          await seedSingleBallForceRoll(9);
          const result = await request<any>('/api/dev/force-roll', { rarity: 10_000_000_000_000_000, randomValue: 0.999999 });
          if (result.orb?.tier !== 'Beyond') throw new Error('Expected Beyond, got ' + result.orb?.tier + '.');
          return result;
        },
        result => '1/' + formatRarity(result.orb.rarity, result.orb.isInfinity) + ' · ' + result.orb.tier,
      );

      await step(
        'API · Force-roll 1/1e17 Endless',
        async () => {
          await seedSingleBallForceRoll(9);
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
          // The status check now repairs a stale Frenzy/share target only for shadow_fen
          // when the active post is a valid main Game post.
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
          await seedSingleBallForceRoll(0);
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
          await seedSingleBallForceRoll(0);
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
        'API · Combat Lab validates gear, runes, and scaling',
        async () => {
          const result = await request<any>('/api/dev/combat-lab/state');
          const checks = Array.isArray(result.balance?.checks) ? result.balance.checks : [];
          const required = [
            'Gear quality is within 0–100',
            'Equipped gear references are valid',
            'Equipped Rune references are valid',
            'High gear grades are genuinely rare',
            'High-quality gear owns a larger stat budget',
            'Player Speed is independent of dungeon depth',
            'Late-game HP reaches millions',
            'Late-game high-orb crit damage reaches millions',
            'Rune Major Ability data is valid',
          ];
          for (const label of required) {
            const check = checks.find((entry: any) => entry.label === label);
            if (!check || typeof check.passed !== 'boolean') throw new Error('Combat Lab diagnostic is missing or malformed: ' + label + '.');
            if (!check.passed) throw new Error('Combat Lab balance check failed: ' + label + ' — ' + String(check.detail || 'No diagnostic detail.'));
          }
          return { state: result.state, checks };
        },
        result => result.checks.length + ' Combat Lab invariants passed · depth=' + shortNumber(result.state?.depth, 0) + ' · gear=' + shortNumber(result.state?.inventory?.length, 0) + ' · runes=' + shortNumber(result.state?.runes?.length, 0),
      );

      await step(
        'API · Impressions reach admin analytics',
        async () => {
          const session = await request<any>('/api/dev/context');
          const postId = String(session.postId ?? '').trim();
          if (!postId) throw new Error('The active Reddit post ID is unavailable for impression tracking.');
          const before = await request<any>('/api/dev/impressions');
          const response = await request<any>('/api/impressions', { postType: 'main-game', deviceType: 'unknown', postId });
          if (typeof response.recorded !== 'boolean') throw new Error('Impression endpoint did not return a deduplication result.');
          const after = await request<any>('/api/dev/impressions');
          if (!Number.isSafeInteger(after.total) || !Number.isSafeInteger(after.uniqueUsers) || !Array.isArray(after.viewers) ||
              !Array.isArray(after.posts) || !Array.isArray(after.last24Hours) || !Array.isArray(after.last30Days)) throw new Error('Impressions dashboard response is incomplete.');
          if (response.recorded && Number(after.total) <= Number(before.total)) throw new Error('A new impression did not increment the dashboard total.');
          const normalizedPostId = postId.startsWith('t3_') ? postId : 't3_' + postId;
          if (!after.posts.some((post: any) => post.postId === normalizedPostId)) throw new Error('The active post is not listed in admin impression analytics.');
          return { before, after, response };
        },
        r => 'post view ' + (r.response.recorded ? 'recorded' : 'already counted') + ' · views=' + shortNumber(r.after.total, 0) + ' · accounts=' + shortNumber(r.after.uniqueUsers, 0),
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
          if (!result.playerSave || !result.calculatedPlayerState) throw new Error('Stat Spy omitted the saved or calculated player state.');
          if (!result.combat || !result.combat.state || !Array.isArray(result.combat.gear) ||
              !Array.isArray(result.combat.equippedSkills) || !Array.isArray(result.combat.equippedRunes) ||
              typeof result.combat.inCombat !== 'boolean' || typeof result.combat.playerHp !== 'number' ||
              typeof result.combat.enemy?.hp !== 'number' || typeof result.combat.enemy?.maxHp !== 'number' ||
              !result.combat.runeBonuses || !result.combat.statusNote) {
            throw new Error('Stat Spy omitted Combat HP/status or equipped loadout details.');
          }
          const statIds = new Set(result.stats.map((stat: { id: string }) => stat.id));
          for (const required of ['luck', 'luckTail', 'runeLuck', 'apexFortune', 'supernova', 'critPower', 'shardChance']) {
            if (!statIds.has(required)) throw new Error('Stat Spy omitted expected stat breakdown: ' + required);
          }
          for (const stat of result.stats) {
            if (!Array.isArray(stat.sources)) throw new Error('Stat Spy stat lacked source breakdown: ' + stat.label);
          }
          return result;
        },
        result => 'stats=' + result.stats.length + ' · combat snapshot + full saves + Rune Luck sources',
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
          await request<any>('/api/dev/state', { shards: 1_000 });
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
          await request<any>('/api/dev/state', { shards: 1_000, lastSeenAt: Date.now() });
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
          await request<any>('/api/dev/state', { shards: 1_000 });
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
          await request<any>('/api/dev/state', { shards: 1_000 });
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
        "API · Share records eligibility in a fresh leaderboard snapshot",
        async () => {
          // The normal leaderboard endpoint may serve its short-lived snapshot
          // cache. The eligibility contract is checked against a fresh rebuild
          // from the player's durable save after the share request has returned.
          const result = await request<any>('/api/leaderboards?fresh=1');
          const entries = Array.isArray(result?.collectionValue) ? result.collectionValue : [];
          const context = await request<any>('/api/dev/context');
          const match = entries.find((entry: any) =>
            String(entry.username).toLowerCase() === String(context.username).toLowerCase()
          );
          if (!match) throw new Error('Current player was not eligible in the fresh leaderboard snapshot after sharing.');
          if (!Number.isFinite(Number(match.sharedAt)) || Number(match.sharedAt) <= 0) {
            throw new Error('Leaderboard share timestamp was missing or invalid.');
          }
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
            shards: 1_000,
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


  useEffect(() => {
    if (serverMonitorPaused) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      await loadServerMonitor(false);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [serverMonitorPaused]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      await loadServerStorage(false);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!serverMonitorAutoScroll) return;
    const feed = serverLogFeedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [serverMonitor?.events, serverMonitorAutoScroll]);


  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
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
              title="Repair the canonical Global Chat destination while the main Game post is open."
              disabled={globalChatRegistrationBusy}
              onClick={() => void registerCurrentPostForGlobalChat()}
              className={buttonBase + ' bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-200 px-3 py-2'}
            >
              {globalChatRegistrationBusy ? 'Registering…' : 'Repair Global Chat'}
            </button>
            <button type="button"
              title="Jump to aggregate Impressions analytics."
              onClick={() => {
                const section = ADMIN_CONSOLE_SECTIONS.find(item => item.id === 'impressions');
                if (section?.tools[0]) selectAdminTool('impressions', section.tools[0]);
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

        <div className="space-y-2 border-b border-slate-800 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={adminToolSearch}
              onChange={event => setAdminToolSearch(event.target.value)}
              aria-label="Search admin tools"
              placeholder="Search tools by name or section…" 
              className="w-full rounded-xl border border-slate-700 bg-slate-950/80 py-2.5 pl-9 pr-3 text-xs text-white placeholder:text-slate-600 focus:border-emerald-500/60 focus:outline-none"
            />
          </div>
          <nav aria-label="Admin console sections" className="flex flex-wrap items-center gap-2">
            {visibleAdminSections.map(section => (
              <button
                key={section.id}
                type="button"
                aria-pressed={activeAdminSection === section.id}
                onClick={() => selectAdminTool(section.id, section.tools[0])}
                className={buttonBase + ' px-2.5 py-1.5 ' + (activeAdminSection === section.id
                  ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                  : 'bg-slate-950/80 border-slate-700 hover:border-emerald-500/40 hover:bg-slate-800 text-slate-300')}
              >
                {section.label}
                <span className="ml-1.5 text-[9px] opacity-60">{section.tools.length}</span>
              </button>
            ))}
          </nav>
          <div className="text-[9px] text-slate-600">
            {visibleAdminSections.reduce((count, section) => count + section.tools.length, 0)} tools across {visibleAdminSections.length} sections
          </div>
        </div>

        <section id="io-server-monitor" hidden={activeAdminSection !== 'monitoring'} className={panelBase + ' border border-emerald-500/30 scroll-mt-4'}>
          {renderAdminToolBar('monitoring')}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
                <Gauge className="w-4 h-4" /> Server Monitor
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-200 normal-case">
                  {serverMonitorPaused ? 'Paused' : 'Live'}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                {serverMonitor?.scope ?? 'This server process'} · request feed refreshes every 2.5 seconds. Values are process-local.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={serverMonitorLoading}
                onClick={() => void loadServerMonitor(true)}
                className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}>
                <RefreshCw className={'inline w-3.5 h-3.5 mr-1 ' + (serverMonitorLoading ? 'animate-spin' : '')} />
                {serverMonitorLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" onClick={() => setServerMonitorPaused(value => !value)}
                className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}>
                {serverMonitorPaused ? 'Resume Feed' : 'Pause Feed'}
              </button>
              <button type="button" onClick={() => setServerMonitorAutoScroll(value => !value)}
                className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}>
                Auto-scroll {serverMonitorAutoScroll ? 'On' : 'Off'}
              </button>
            </div>
          </div>

          {serverMonitorError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-200">
              Server monitor error: {serverMonitorError}
            </div>
          )}

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="text-[10px] uppercase font-bold text-slate-500">HTTP requests / sec</div>
              <div className="mt-1 text-2xl font-black font-mono text-emerald-200">
                {(serverMonitor?.metrics.requestsPerSecond ?? 0).toFixed(2)}
              </div>
              <div className="text-[9px] text-slate-500">10-second rolling average</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="text-[10px] uppercase font-bold text-slate-500">Peak requests / sec</div>
              <div className="mt-1 text-2xl font-black font-mono text-cyan-200">
                {(serverMonitor?.metrics.peakRequestsPerSecond ?? 0).toLocaleString()}
              </div>
              <div className="text-[9px] text-slate-500">Highest 1-second bucket in the last minute</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="text-[10px] uppercase font-bold text-slate-500">Redis operations / sec</div>
              <div className="mt-1 text-2xl font-black font-mono text-violet-200">
                {(serverMonitor?.metrics.redisOperationsPerSecond ?? 0).toFixed(1)}
              </div>
              <div className="text-[9px] text-slate-500">Instrumented app-issued operations</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="text-[10px] uppercase font-bold text-slate-500">Redis throughput used</div>
              <div className="mt-1 text-2xl font-black font-mono text-amber-200">
                {(serverMonitor?.metrics.redisCapacityPercent ?? 0).toFixed(4)}%
              </div>
              <div className="text-[9px] text-slate-500">
                Reference ceiling: {(serverMonitor?.limits.redisCommandsPerSecond ?? 40_000).toLocaleString()} commands/sec
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-black/20 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
              <span className="font-bold uppercase tracking-wider text-slate-400">Redis throughput reference</span>
              <span className="font-mono text-slate-300">
                {(serverMonitor?.metrics.redisOperationsPerSecond ?? 0).toFixed(1)} / {(serverMonitor?.limits.redisCommandsPerSecond ?? 40_000).toLocaleString()} ops/sec
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-emerald-400 transition-all"
                style={{ width: Math.min(100, Math.max(0, serverMonitor?.metrics.redisCapacityPercent ?? 0)) + '%' }} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
              <div><span className="text-slate-500">Requests last minute</span><div className="text-slate-200 font-mono">{(serverMonitor?.metrics.requestsLastMinute ?? 0).toLocaleString()}</div></div>
              <div><span className="text-slate-500">Requests in flight</span><div className="text-slate-200 font-mono">{(serverMonitor?.metrics.activeRequests ?? 0).toLocaleString()}</div></div>
              <div><span className="text-slate-500">Average latency</span><div className="text-slate-200 font-mono">{(serverMonitor?.metrics.averageLatencyMs ?? 0).toFixed(1)} ms</div></div>
              <div><span className="text-slate-500">HTTP errors · 4xx / 5xx</span><div className="text-slate-200 font-mono">{(serverMonitor?.metrics.clientErrorsLastMinute ?? 0).toLocaleString()} / {(serverMonitor?.metrics.serverErrorsLastMinute ?? 0).toLocaleString()}</div></div>
            </div>
            <p className="text-[9px] leading-4 text-slate-500">
              Devvit publishes a Redis command-throughput limit, not a universal HTTP requests/sec limit. The percentage above compares measured Redis operations with that documented reference; it is an operational estimate, not a provider-side capacity reading.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-black/20 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-200">
              <Gauge className="w-4 h-4" /> Upgrade batch diagnostics
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2 text-[10px]">
              <div><span className="text-slate-500">Server attempts</span><div className="text-slate-100 font-mono text-base">{(serverMonitor?.upgradeBatches?.serverAttempts ?? 0).toLocaleString()}</div></div>
              <div><span className="text-slate-500">Fully accepted</span><div className="text-emerald-200 font-mono text-base">{(serverMonitor?.upgradeBatches?.serverAccepted ?? 0).toLocaleString()}</div></div>
              <div><span className="text-slate-500">Partial purchases</span><div className="text-amber-200 font-mono text-base">{(serverMonitor?.upgradeBatches?.serverPartial ?? 0).toLocaleString()}</div></div>
              <div><span className="text-slate-500">Server rejections</span><div className="text-rose-200 font-mono text-base">{(serverMonitor?.upgradeBatches?.serverRejected ?? 0).toLocaleString()}</div></div>
              <div><span className="text-slate-500">Client rollbacks</span><div className="text-rose-200 font-mono text-base">{(serverMonitor?.upgradeBatches?.clientRollbacks ?? 0).toLocaleString()}</div></div>
              <div><span className="text-slate-500">Avg server time</span><div className="text-cyan-200 font-mono text-base">{(serverMonitor?.upgradeBatches?.averageServerDurationMs ?? 0).toFixed(1)} ms</div></div>
            </div>
            <p className="text-[9px] leading-4 text-slate-500">
              Each batch is correlated across the server response and client rollback. Partial purchases include the server stop reason; rejected requests include the HTTP/error code. Counters and the 250-event feed are process-local and reset when that server process restarts. No Redis writes are added.
            </p>
            {serverMonitor?.upgradeBatches?.lastFailureAt ? (
              <div className="text-[9px] text-slate-500">Most recent partial, rejected, or rolled-back batch: {new Date(serverMonitor.upgradeBatches.lastFailureAt).toLocaleString()}</div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-800 bg-black/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <Gauge className="w-4 h-4 text-emerald-300" /> Live event feed
                </div>
                <p className="mt-1 text-[9px] text-slate-500">Successful writes and all failed requests · newest events appear at the bottom · max 250 recent events in this process.</p>
              </div>
              <span className="text-[10px] font-mono text-slate-500">{serverMonitor?.events.length ?? 0} events</span>
            </div>
            <div ref={serverLogFeedRef} className="max-h-72 min-h-28 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/80">
              {serverMonitor?.events.length ? serverMonitor.events.map(event => (
                <div key={event.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 border-b border-slate-900 px-2.5 py-2 last:border-0">
                  <span className="pt-0.5 text-[9px] font-mono text-slate-600">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  <div className="min-w-0">
                    <div className={'text-[10px] leading-4 break-words ' + (event.severity === 'error' ? 'text-rose-300' : event.severity === 'warn' ? 'text-amber-200' : 'text-slate-200')}>
                      {event.message}
                    </div>
                    <div className="mt-0.5 text-[9px] text-slate-600 font-mono">{event.method} {event.path}</div>
                    {event.details ? (
                      <div className="mt-1 break-words text-[9px] leading-4 text-slate-500 font-mono">{JSON.stringify(event.details).slice(0, 420)}</div>
                    ) : null}
                  </div>
                </div>
              )) : (
                <div className="p-4 text-center text-[10px] text-slate-500">
                  {serverMonitorPaused ? 'Feed paused. Resume or refresh to load new activity.' : 'Waiting for server activity. Successful GET polling is intentionally omitted.'}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-black/20 p-3 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-200">
                  <Database className="w-4 h-4" /> Redis storage
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  Devvit limit: {formatServerBytes(serverStorage?.storageLimitBytes ?? serverMonitor?.limits.redisStorageBytes ?? 5_000_000_000)} per installation · tracked payload estimate only.
                </p>
              </div>
              <button type="button" disabled={serverStorageLoading}
                onClick={() => void loadServerStorage(true)}
                className={buttonBase + ' bg-slate-900 border-slate-700 text-slate-200 px-3 py-2'}>
                <RefreshCw className={'inline w-3.5 h-3.5 mr-1 ' + (serverStorageLoading ? 'animate-spin' : '')} />
                {serverStorageLoading ? 'Estimating…' : 'Refresh storage'}
              </button>
            </div>
            {serverStorageError && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2 text-[10px] text-rose-200">{serverStorageError}</div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <div className="text-[9px] uppercase text-slate-500">Tracked payload</div>
                <div className="mt-1 text-base font-black font-mono text-cyan-200">{formatServerBytes(serverStorage?.knownBytes ?? 0)}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <div className="text-[9px] uppercase text-slate-500">Estimated limit share</div>
                <div className="mt-1 text-base font-black font-mono text-amber-200">{(serverStorage?.knownPercent ?? 0).toFixed(5)}%</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <div className="text-[9px] uppercase text-slate-500">Indexed players</div>
                <div className="mt-1 text-base font-black font-mono text-slate-100">{(serverStorage?.playerCount ?? 0).toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                <div className="text-[9px] uppercase text-slate-500">Keys counted</div>
                <div className="mt-1 text-base font-black font-mono text-slate-100">{(serverStorage?.keysCounted ?? 0).toLocaleString()}</div>
              </div>
            </div>
            <div className="space-y-2">
              {(serverStorage?.groups ?? []).map(group => {
                const share = serverStorage && serverStorage.knownBytes > 0 ? group.bytes / serverStorage.knownBytes * 100 : 0;
                return (
                  <div key={group.label} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] font-bold text-slate-200">{group.label}</span>
                      <span className="text-[10px] font-mono text-cyan-200">{formatServerBytes(group.bytes)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: Math.min(100, Math.max(0, share)) + '%' }} />
                    </div>
                    <div className="mt-1 text-[9px] text-slate-500">{group.keys.toLocaleString()} keys · {group.records.toLocaleString()} tracked records · {share.toFixed(1)}% of tracked payload</div>
                  </div>
                );
              })}
            </div>
            {serverStorage && (
              <>
                <p className="text-[9px] leading-4 text-slate-500">{serverStorage.note}</p>
                {serverStorage.errors.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[9px] text-amber-200">
                    Partial estimate: {serverStorage.errors.join(' ')}
                  </div>
                )}
                <div className="text-[9px] text-slate-600">Last storage scan: {new Date(serverStorage.generatedAt).toLocaleTimeString()}</div>
              </>
            )}
          </div>
        </section>

        <section id="io-impressions-tab" hidden={activeAdminSection !== 'impressions'} className={panelBase + ' border border-cyan-500/30 scroll-mt-4'}>
          {renderAdminToolBar('impressions')}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-200">
                <Eye className="w-4 h-4" /> Impressions
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Unique account/post previews for main-game, Orb Share, and Frenzy. Repeated loads of the same post count once per account for 180 days. Raw Reddit user IDs are not stored. Public usernames and per-account unique-view counts are visible only in this admin dashboard. Reddit feed views are not exposed.
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
                  ['Unique post views', impressionStats.total, 'text-cyan-200'],
                  ['Unique accounts', impressionStats.uniqueUsers, 'text-fuchsia-200'],
                  ['Unique today', impressionStats.uniqueToday, 'text-emerald-200'],
                  ['New players today', impressionStats.newPlayersToday, 'text-amber-200'],
                  ['Main game views', impressionStats.byType['main-game'], 'text-emerald-200'],
                  ['Orb Share views', impressionStats.byType['orb-share'], 'text-violet-200'],
                  ['Frenzy views', impressionStats.byType.frenzy, 'text-orange-200'],
                ] as const).map(([label, count, color]) => (
                  <div key={label} className="rounded-xl bg-slate-900/80 border border-slate-800 px-3 py-3">
                    <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
                    <div className={'text-2xl font-black font-mono mt-1 ' + color}>{count.toLocaleString()}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                {([
                  ['Day-1 retention', impressionStats.day1Retention],
                  ['Day-3 retention', impressionStats.day3Retention],
                ] as const).map(([label, metric]) => (
                  <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3">
                    <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
                    <div className="text-2xl font-black font-mono mt-1 text-cyan-200">
                      {metric.rate === null ? '—' : (metric.rate * 100).toFixed(1) + '%'}
                    </div>
                    <div className="mt-1 text-[9px] text-slate-500">{metric.retained.toLocaleString()} / {metric.cohortSize.toLocaleString()} returned on {metric.cohortDay}</div>
                  </div>
                ))}
                {(['main-game', 'orb-share', 'frenzy'] as const).map(type => {
                  const metric = impressionStats.conversion[type];
                  const label = type === 'main-game' ? 'Main game post conversion' : type === 'orb-share' ? 'Orb Share conversion' : 'Frenzy conversion';
                  const detail = type === 'main-game'
                    ? 'unique main-post views clicked Play'
                    : 'unique viewers played for the first time';
                  return (
                    <div key={type} className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3">
                      <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
                      <div className="text-2xl font-black font-mono mt-1 text-emerald-200">
                        {metric.rate === null ? '—' : (metric.rate * 100).toFixed(1) + '%'}
                      </div>
                      <div className="mt-1 text-[9px] text-slate-500">{metric.conversions.toLocaleString()} / {metric.eligibleViewers.toLocaleString()} {detail}</div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Device breakdown · aggregate only</div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {(['mobile', 'tablet', 'desktop', 'unknown'] as ImpressionDeviceType[]).map(device => (
                    <div key={device} className="rounded-lg bg-black/20 border border-slate-800 p-2">
                      <div className="text-[10px] uppercase text-slate-500">{device}</div>
                      <div className="text-lg font-bold font-mono text-slate-100">{impressionStats.byDevice[device].toLocaleString()}</div>
                      <div className="mt-1 text-[9px] text-slate-500">Main-game conversion</div>
                      <div className="text-sm font-bold font-mono text-emerald-200">
                        {impressionStats.conversionByDevice[device].rate === null ? '—' : (impressionStats.conversionByDevice[device].rate! * 100).toFixed(1) + '%'}
                      </div>
                      <div className="text-[9px] text-slate-500">{impressionStats.conversionByDevice[device].conversions.toLocaleString()} Play clicks</div>
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
                <div className="overflow-x-auto border-t border-slate-800 pt-3">
                  <div className="mb-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">Main game Play conversion rate by device</div>
                  <table className="w-full text-left text-[10px]">
                    <thead><tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 pr-3">Device</th>
                      <th className="py-2 px-2">Main post views</th>
                      <th className="py-2 px-2">Play conversions</th>
                      <th className="py-2 px-2">Conversion rate</th>
                    </tr></thead>
                    <tbody>
                      {(['mobile', 'tablet', 'desktop', 'unknown'] as ImpressionDeviceType[]).map(device => {
                        const metric = impressionStats.conversionByDevice[device];
                        return (
                          <tr key={device} className="border-b border-slate-800/70 text-slate-300">
                            <td className="py-2 pr-3 font-semibold capitalize">{device}</td>
                            <td className="py-2 px-2 font-mono">{impressionStats.byTypeAndDevice['main-game'][device].toLocaleString()}</td>
                            <td className="py-2 px-2 font-mono">{metric.conversions.toLocaleString()}</td>
                            <td className="py-2 px-2 font-mono font-bold text-emerald-200">{metric.rate === null ? '—' : (metric.rate * 100).toFixed(1) + '%'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-800">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Per-account view counts · top {impressionStats.viewers.length.toLocaleString()}
                  </div>
                  <p className="mt-1 text-[9px] text-slate-600">Public Reddit usernames and cumulative unique post-view counts for the 2,000 most recently active accounts. Viewer records expire 180 days after the last new unique post view. Repeat previews of the same post by the same account count once. Raw Reddit user IDs are not exposed.</p>
                </div>
                {impressionStats.viewers.length ? (
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-left text-[10px]">
                      <thead className="sticky top-0 bg-slate-900 text-slate-500"><tr>
                        <th className="px-3 py-2">Username</th>
                        <th className="px-3 py-2 text-right">Unique views</th>
                        <th className="px-3 py-2 text-right">Main</th>
                        <th className="px-3 py-2 text-right">Share</th>
                        <th className="px-3 py-2 text-right">Frenzy</th>
                        <th className="px-3 py-2">Last seen</th>
                      </tr></thead>
                      <tbody>
                        {impressionStats.viewers.map(viewer => (
                          <tr key={viewer.username + ':' + viewer.lastSeenAt} className="border-t border-slate-800/70">
                            <td className="px-3 py-2 font-semibold text-slate-200">u/{viewer.username}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-cyan-200">{viewer.uniquePostViews.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono text-emerald-200">{viewer.byType['main-game'].toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono text-violet-200">{viewer.byType['orb-share'].toLocaleString()}</td>
                            <td className="px-3 py-2 text-right font-mono text-orange-200">{viewer.byType.frenzy.toLocaleString()}</td>
                            <td className="px-3 py-2 text-slate-500">{new Date(viewer.lastSeenAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 text-xs text-slate-500 text-center">No account-level impression details are available yet.</div>
                )}
              </div>

              <div className="rounded-xl border border-slate-800 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-800">
                  <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400">
                    Unique post viewers · {impressionStats.posts.length.toLocaleString()} listed / {impressionStats.trackedPostCount.toLocaleString()} tracked
                  </div>
                  <p className="mt-1 text-[9px] text-slate-600">Shows unique-account counts among the 500 most recently seen post IDs; type totals and time trends count unique account/post views.</p>
                </div>
                {impressionStats.posts.length ? (
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-left text-[10px]">
                      <thead className="sticky top-0 bg-slate-900 text-slate-500"><tr>
                        <th className="px-3 py-2">Type</th><th className="px-3 py-2">Reddit post ID</th><th className="px-3 py-2 text-right">Unique viewers</th>
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
                Last refreshed {new Date(impressionStats.generatedAt).toLocaleString()}. Reddit feed views are not exposed. Repeated loads of a post count once per account in the rolling 180-day window.
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

        <details id="io-diagnostics-group" open={activeAdminSection === 'diagnostics'} hidden={activeAdminSection !== 'diagnostics'} className="scroll-mt-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-300">
            <span>Diagnostics & Analytics</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
          {renderAdminToolBar('diagnostics')}
          <div className="mt-3 space-y-3">
        <details id="io-tool-full-log-snapshot" hidden={activeAdminTool !== 'full-log-snapshot'} open={activeAdminTool === 'full-log-snapshot'} className="rounded-xl border border-cyan-500/30 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-cyan-200">
            <span>Full Log Snapshot · live browser session</span><span className="text-slate-600">Expand</span>
          </summary>
          <div className="mt-3"><FullLogSnapshotPanel /></div>
        </details>
        <details id="io-tool-e2e-test" hidden={activeAdminTool !== 'e2e-test'} open={activeAdminTool === 'e2e-test'} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>Full End-to-End Test · rewrites admin save</span><span className="text-slate-600">Expand</span>
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
          </div>
        </details>
        <details id="io-tool-ccu-load" hidden={activeAdminTool !== 'ccu-load'} open={activeAdminTool === 'ccu-load'} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>CCU & Load Testing</span><span className="text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
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
          </div>
        </details>

        <section id="io-tool-payment-logs" hidden={activeAdminTool !== 'payment-logs'} className={panelBase}>
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

        <details id="io-simulation-group" open={activeAdminSection === 'simulation'} hidden={activeAdminSection !== 'simulation'} className="scroll-mt-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-300">
            <span>Controls & Simulation</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
          {renderAdminToolBar('simulation')}
          <div className="mt-3 space-y-3">

        <details id="io-tool-global-boosters" hidden={activeAdminTool !== 'global-boosters'} open={activeAdminTool === 'global-boosters'} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>Global Booster Operations</span><span className="text-slate-600">Expand</span>
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
          </div>
        </details>

        <details id="io-tool-save-booster-logs" hidden={activeAdminTool !== 'save-logs'} open={activeAdminTool === 'save-logs'} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>Save & Booster Logs</span><span className="text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
            <section className={panelBase + ' border border-red-500/30'}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-red-300">Emergency Diagnostic Cleanup</div>
                  <p className="mt-1 text-[11px] text-slate-500">Deletes stored save, payment, Global Booster, and per-player Player Spy logs using Redis DEL. Does not touch player saves or progression.</p>
                </div>
                <button type="button" title="Delete all stored diagnostic logs without deleting player data." disabled={clearAllLogsLoading} onClick={() => void clearAllDiagnosticLogs()} className={buttonBase + ' bg-red-600/20 border-red-500/30 text-red-200 px-3 py-2'}>
                  <Trash2 className="w-3.5 h-3.5 inline mr-1" /> {clearAllLogsLoading ? 'Clearing…' : 'Clear All Diagnostic Logs'}
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
          </div>
        </details>

        <details id="io-tool-notifications-presets" hidden={activeAdminTool !== 'notifications-presets'} open={activeAdminTool === 'notifications-presets'} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>Notifications & Test Presets</span><span className="text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
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

        <section className={panelBase + ' border border-fuchsia-500/30'}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                <Users className="w-4 h-4" /> Notification Audience
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Audience counts are grouped by the notification type each player enabled. Percentages use all registered accounts.
              </p>
            </div>
            <button
              type="button"
              disabled={notificationStatsLoading}
              onClick={() => void loadNotificationStats()}
              className={buttonBase + ' bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 px-3 py-2'}
            >
              <RefreshCw className={'inline w-3.5 h-3.5 mr-1 ' + (notificationStatsLoading ? 'animate-spin' : '')} />
              Refresh
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-center">
              <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">Game Updates</div>
              <div className="mt-1 text-lg font-mono font-black text-fuchsia-200">{notificationStats ? formatNumber(notificationStats.updatesEnabledPlayers) : '—'}</div>
              <div className="text-[8px] text-emerald-300">{notificationStats ? notificationStats.updatesPercentage.toFixed(1) + '%' : '—'} enabled</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-center">
              <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">Offline Orbs</div>
              <div className="mt-1 text-lg font-mono font-black text-emerald-200">{notificationStats ? formatNumber(notificationStats.offlineOrbsEnabledPlayers) : '—'}</div>
              <div className="text-[8px] text-emerald-300">{notificationStats ? notificationStats.offlineOrbsPercentage.toFixed(1) + '%' : '—'} enabled</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-center">
              <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">Players</div>
              <div className="mt-1 text-lg font-mono font-black text-cyan-200">{notificationStats ? formatNumber(notificationStats.totalPlayers) : '—'}</div>
              <div className="text-[8px] text-slate-600">Registered accounts</div>
            </div>
          </div>
        </section>

        <section className={panelBase + ' border border-fuchsia-500/30'}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
            <Megaphone className="w-4 h-4" /> Game Update Preset
          </div>
          <p className="text-[10px] text-slate-500">
            Sends the fixed Game Update notification to players who enabled Game updates. Offline-Orbs-only subscribers are excluded. Players who have already received two pushes today are queued for the next UTC day.
          </p>
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Title</div>
            <div className="mt-1 text-sm font-bold text-white">Infinity Orbs Update</div>
            <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Message sent to players</div>
            <p className="mt-1 text-xs leading-relaxed text-slate-200">A new update is live! Jump back in and see what's changed.</p>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={pushBroadcastLoading}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                void sendManualPushBroadcast();
              }}
              className={buttonBase + ' bg-fuchsia-600 hover:bg-fuchsia-500 border-fuchsia-500 text-white px-3 py-2'}
            >
              {pushBroadcastLoading ? 'Queuing…' : 'Send Game Update'}
            </button>
          </div>
          {pushBroadcastError && (
            <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-200">
              {pushBroadcastError}
            </p>
          )}
          {notificationCampaign && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-[10px] text-slate-300">
              <strong>Broadcast:</strong> {notificationCampaign.status.toUpperCase()} · {formatNumber(notificationCampaign.sent)} sent now · {formatNumber(notificationCampaign.queued)} queued for the next day
              {notificationCampaign.error && <div className="mt-1 text-rose-300">{notificationCampaign.error}</div>}
            </div>
          )}
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
          </div>
        </details>

        <details id="io-tool-roll-resources" hidden={activeAdminTool !== 'roll-resources'} open={activeAdminTool === 'roll-resources'} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>Roll & Resource Tools</span><span className="text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
        <section className={panelBase}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-300">
            <Play className="w-4 h-4" /> Guaranteed Next Roll
          </div>
          <div className="flex gap-2">
            <input
              title="Exact rarity denominator for your next manual roll. For example, 100000 means 1/100,000."
              type="number"
              min="2"
              step="1"
              value={customRarity}
              onChange={e => setCustomRarity(e.target.value)}
              className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
              placeholder="Rarity denominator"
            />
            <button type="button" title="Queue this exact rarity for the next manual Roll. It will process rewards and challenge completion normally." onClick={() => void handleQueueGuaranteedRoll(Number(customRarity))} disabled={loading} className={`${buttonBase} bg-cyan-600 hover:bg-cyan-500 border-cyan-500 text-white px-4`}>
              Queue Next
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000].map(v => (
              <button type="button" title={`Queue the next manual roll at exact rarity 1/${formatRarity(v)}.`} key={v} onClick={() => void handleQueueGuaranteedRoll(v)} disabled={loading} className={`${buttonBase} bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 px-2.5 py-1.5 font-mono`}>
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
          <button
            type="button"
            title="Set your Time Energy bank to its full one-million-second test capacity."
            onClick={() => void sendAdminAction(
              '/api/dev/time-energy/grant-test',
              {},
              true,
              'Time Energy set to 1,000,000 seconds.',
            )}
            disabled={loading}
            className={`${buttonBase} mt-2 w-full bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-400/30 text-cyan-200 px-3 py-2.5`}
          >
            <Zap className="inline w-3.5 h-3.5 mr-1.5" /> Set Time Energy to 1,000,000 Seconds
          </button>
          <p className="text-[10px] text-slate-500">Fills your bank to its cap. Only the trusted admin account can use this test control.</p>
        </section>
          </div>
        </details>

        <section id="io-tool-state-overrides" hidden={activeAdminTool !== 'state-overrides'} className={panelBase}>
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

        <details id="io-tool-community-events" hidden={activeAdminTool !== 'community-events'} open={activeAdminTool === 'community-events'} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>Frenzy, Popup & Community Events</span><span className="text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
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

        <section className={`${panelBase} border border-teal-500/30`}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-200"><Bell className="w-4 h-4" /> Popup Testing & Analytics</div>
          <p className="text-[11px] leading-relaxed text-slate-400">Toggle each player-facing popup and track displays, acceptances, dismissals, and acceptance rate. The Frenzy Shard popup appears after a player receives the Frenzy owner Shard reward. Its preview button is cosmetic only: it grants no Shards and records no metrics. Admin previews and u/shadow_fen's gameplay are excluded.</p>
          {popupStatsError && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">Popup analytics refresh failed: {popupStatsError}. The numbers below may be stale.</div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={loading} onClick={() => { sound.playClick(); onForceFrenzyPopup?.(); }} className={`${buttonBase} bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30 text-purple-300 px-3 py-2`}><Flame className="inline w-3.5 h-3.5 mr-1" /> Force Frenzy Popup</button>
            <button type="button" disabled={loading} onClick={() => { sound.playClick(); onForceFrenzyShardPopup?.(); }} className={`${buttonBase} bg-fuchsia-500/10 hover:bg-fuchsia-500/20 border-fuchsia-500/30 text-fuchsia-200 px-3 py-2`}><Sparkles className="inline w-3.5 h-3.5 mr-1" /> Preview Frenzy Shard Popup</button>
            <button type="button" disabled={loading} onClick={() => { sound.playClick(); onForceNotificationPopup?.(); }} className={`${buttonBase} bg-teal-500/10 hover:bg-teal-500/20 border-teal-500/30 text-teal-200 px-3 py-2`}><Bell className="inline w-3.5 h-3.5 mr-1" /> Preview Notification Popup</button>
            <button type="button" disabled={loading} onClick={() => { sound.playClick(); onForceJoinSubredditPopup?.(); }} className={`${buttonBase} bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30 text-cyan-200 px-3 py-2`}><Users className="inline w-3.5 h-3.5 mr-1" /> Preview Join Popup</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            {([
              { id: 'notification', label: 'Notification prompt' },
              { id: 'frenzy', label: 'Daily Frenzy prompt' },
              { id: 'frenzyShard', label: 'Frenzy Shard reward notice' },
              { id: 'joinSubreddit', label: 'Join subreddit reward' },
            ] as const).map(item => {
              const metric = popupStats?.[item.id];
              const enabled = popupConfig[item.id];
              return (
                <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <strong className="text-[11px] text-slate-200">{item.label}</strong>
                    <button type="button" aria-pressed={enabled} disabled={loading || popupStatsLoading} onClick={() => void updatePopupSetting(item.id, !enabled)} className={`${buttonBase} px-2 py-1 ${enabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>{enabled ? 'Enabled' : 'Disabled'}</button>
                  </div>
                  <div className="text-[10px] leading-relaxed text-slate-400">Shown <strong className="text-white">{metric ? formatNumber(metric.shown) : '—'}</strong>{' · '}Accepted <strong className="text-emerald-200">{metric ? formatNumber(metric.accepted) : '—'}</strong>{' · '}Dismissed <strong className="text-slate-300">{metric ? formatNumber(metric.dismissed) : '—'}</strong></div>
                  <div className="text-xs font-bold text-cyan-200">Acceptance rate: {metric ? metric.acceptanceRate.toFixed(1) : '—'}%</div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">{popupStatsLoading ? 'Refreshing popup metrics…' : popupStatsUpdatedAt ? 'Updated ' + new Date(popupStatsUpdatedAt).toLocaleTimeString() + ' · auto-refreshes every 15s.' : 'Acceptance rate = accepted actions ÷ displays.'}</span>
            <button type="button" disabled={popupStatsLoading} onClick={() => void loadPopupAnalytics()} className={`${buttonBase} bg-slate-900 hover:bg-slate-800 border-slate-700 px-3 py-1.5 text-slate-300`}><RefreshCw className="inline w-3 h-3 mr-1" /> Refresh metrics</button>
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

        <section id="io-tool-alignment-events" hidden={activeAdminTool !== 'alignment-events'} className={`${panelBase} border border-cyan-500/30`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-cyan-200">Celestial Alignment</div>
              <p className="mt-1 text-[10px] text-slate-500">Force a test chooser for your admin account and inspect the choices players have made.</p>
            </div>
            <button type="button" disabled={loading} onClick={() => void forceAlignmentChooserForAdmin()} className={`${buttonBase} bg-cyan-500/15 hover:bg-cyan-500/25 border-cyan-400/35 text-cyan-100 px-3 py-2`}>
              <Sparkles className="inline w-3.5 h-3.5 mr-1" /> Force chooser on my account
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">This is an admin-only test prompt, not a global broadcast. The chooser opens after this console closes. It can be used before the admin account purchases the Mastery.</p>
          {alignmentChoiceStatsError && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">Alignment stats refresh failed: {alignmentChoiceStatsError}</div>}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="text-[9px] uppercase tracking-wider font-bold text-slate-500">Total choices</div>
              <div className="mt-1 text-xl font-black text-white">{formatNumber(alignmentChoiceStats?.total ?? 0)}</div>
            </div>
            {([
              { id: 'starseeker', name: 'Starseeker', tint: 'text-cyan-200' },
              { id: 'goldenOrbit', name: 'Golden Orbit', tint: 'text-amber-200' },
              { id: 'clockwork', name: 'Clockwork', tint: 'text-emerald-200' },
            ] as const).map(item => {
              const count = alignmentChoiceStats?.choices[item.id] ?? 0;
              const percentage = alignmentChoiceStats?.total ? count / alignmentChoiceStats.total * 100 : 0;
              return (
                <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className={`text-[9px] uppercase tracking-wider font-bold ${item.tint}`}>{item.name}</div>
                  <div className="mt-1 text-xl font-black text-white">{formatNumber(count)}</div>
                  <div className="text-[10px] text-slate-400">{percentage.toFixed(1)}% of choices</div>
                </div>
              );
            })}
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-[10px] uppercase tracking-wider text-slate-300">Recent player choices</strong>
              <span className="text-[9px] text-slate-500">Latest 25 · live refresh</span>
            </div>
            {alignmentChoiceStats?.recent.length ? (
              <div className="space-y-1.5">
                {alignmentChoiceStats.recent.slice(0, 25).map((entry, index) => (
                  <div key={entry.username + ':' + entry.chosenAt + ':' + index} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-950/70 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-200">u/{entry.username}</span>
                    <span className="text-[10px] font-bold text-cyan-200">{entry.choice === 'starseeker' ? 'Starseeker' : entry.choice === 'goldenOrbit' ? 'Golden Orbit' : 'Clockwork'}</span>
                    {entry.adminTest && <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[8px] font-black text-violet-200">ADMIN TEST</span>}
                    <span className="text-[9px] text-slate-500">{new Date(entry.chosenAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-[11px] text-slate-500">No Alignment choices have been recorded yet.</p>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">
              {alignmentChoiceStatsLoading ? 'Refreshing choice statistics…' : alignmentChoiceStats?.generatedAt ? 'Updated ' + new Date(alignmentChoiceStats.generatedAt).toLocaleTimeString() : 'Statistics are all-time.'}
            </span>
            <button type="button" disabled={alignmentChoiceStatsLoading} onClick={() => void loadAlignmentChoiceStats()} className={`${buttonBase} bg-slate-900 hover:bg-slate-800 border-slate-700 px-3 py-1.5 text-slate-300`}>
              <RefreshCw className="inline w-3 h-3 mr-1" /> Refresh choices
            </button>
          </div>
        </section>

        </div>
        </details>

        <details id="io-moderation-group" open={activeAdminSection === 'players'} hidden={activeAdminSection !== 'players'} className="scroll-mt-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-300">
            <span>Players & Moderation</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
        </details>

        <details id="io-rift-admin-group" open={activeAdminSection === 'rift'} hidden={activeAdminSection !== 'rift'} className="scroll-mt-4 rounded-2xl border border-violet-500/25 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-violet-200">
            <span>Rift Administration</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
          {renderAdminToolBar('rift')}
          <section id="io-tool-rift-admin" hidden={activeAdminTool !== 'rift-admin'} className={panelBase + ' mt-3 border-violet-500/25'}>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-violet-200">
              <Sparkles className="h-4 w-4" /> Rift Player Controls
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">Inspect a player's isolated Rift archive, recent Kudos, hourly progress rate, and active challenge. Grants apply to Rift progression only. Main-game currency and saves are not touched.</p>
            <div className="flex flex-wrap gap-2">
              <input value={riftAdminUsername} onChange={event => setRiftAdminUsername(event.target.value)} placeholder="Reddit username" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder:text-slate-500" />
              <button type="button" disabled={riftAdminLoading || !riftAdminUsername.trim()} onClick={() => void loadRiftAdmin()} className={buttonBase + ' border-violet-500/30 bg-violet-500/10 px-3 py-2 text-violet-100'}>
                {riftAdminLoading ? 'Loading…' : 'Inspect Rift'}
              </button>
            </div>
            {riftAdminData && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Rift Points', value: formatNumber(riftAdminData.archive?.riftPoints ?? 0) },
                    { label: 'Progress / hour', value: shortNumber(riftAdminData.archive?.riftRatePerHour ?? 1, 2) + ' RP' },
                    { label: 'Completed runs', value: formatNumber(riftAdminData.archive?.totalCompletedRuns ?? 0) },
                    { label: 'Kudos · 24h', value: formatNumber(riftAdminData.kudosStats?.last24Hours ?? 0) },
                    { label: 'Kudos · Since open', value: formatNumber(riftAdminData.kudosStats?.sinceLastOpen ?? 0) },
                    { label: 'Total clear types', value: formatNumber(riftAdminData.archive?.completedChallengeIds?.length ?? 0) },
                    { label: 'Rift progress', value: (Math.max(0, Number(riftAdminData.archive?.riftProgress) || 0) * 100).toFixed(1) + '%' },
                    { label: 'Active challenge', value: riftAdminData.archive?.activeRun?.challengeId ?? 'None' },
                  ].map(item => (
                    <div key={item.label} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{item.label}</div>
                      <div className="mt-1 break-words text-sm font-black text-white">{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Add Rift Points
                    <input type="number" min="0" max="1000000" value={riftAdminPoints} onChange={event => setRiftAdminPoints(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                  </label>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Add progress minutes
                    <input type="number" min="0" max="1000000" value={riftAdminMinutes} onChange={event => setRiftAdminMinutes(event.target.value)} className="mt-1 block w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" />
                  </label>
                </div>
                <button type="button" disabled={loading || riftAdminLoading} onClick={() => void grantRiftAdminProgress()} className={buttonBase + ' border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-100'}>
                  Grant Rift Progress
                </button>
              </>
            )}
          </section>
        </details>

        <details id="io-moderation-group" open={activeAdminSection === 'players'} hidden={activeAdminSection !== 'players'} className="scroll-mt-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-300">
            <span>Players & Moderation</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
          {renderAdminToolBar('players')}
          <div className="mt-3 space-y-3">

        <section id="io-tool-leaderboard-diagnostics" hidden={activeAdminTool !== 'leaderboard-diagnostics'} className={`${panelBase} border border-amber-500/30`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
                <Database className="w-4 h-4" /> Leaderboard & Player List Diagnostics
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Read-only snapshot from this exact running subreddit installation. Use it to distinguish missing Redis data, legacy records without IDs, malformed registry entries, API errors, and stale-version/context issues.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button"
                disabled={leaderboardDiagnosticsLoading}
                onClick={() => void loadLeaderboardDiagnostics()}
                className={`${buttonBase} bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-200 px-3 py-2`}
                title="Read the live registry, legacy leaderboard, player-list output, and all leaderboard outputs from this installation."
              >
                <RefreshCw className={`inline w-3.5 h-3.5 mr-1 ${leaderboardDiagnosticsLoading ? 'animate-spin' : ''}`} />
                {leaderboardDiagnosticsLoading ? 'Collecting…' : 'Run Diagnostics'}
              </button>
              <button type="button"
                disabled={!leaderboardDiagnostics}
                onClick={() => void copyLeaderboardDiagnostics()}
                className={`${buttonBase} bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200 px-3 py-2`}
                title="Copy the diagnostic report as JSON for analysis."
              >
                <Copy className="inline w-3.5 h-3.5 mr-1" />
                {leaderboardDiagnosticsCopied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
          </div>

          {leaderboardDiagnosticsError && (
            <div role="alert" className="mt-3 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200">
              {leaderboardDiagnosticsError}
            </div>
          )}

          {leaderboardDiagnostics ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  ['Running version', String(leaderboardDiagnostics.appVersion ?? 'unknown')],
                  ['Subreddit context', String((leaderboardDiagnostics.runningContext as any)?.subredditName ?? 'not provided')],
                  ['Registry fields', String((leaderboardDiagnostics.storage as any)?.registry?.fieldCount ?? 'unavailable')],
                  ['Legacy board rows', String((leaderboardDiagnostics.storage as any)?.legacyLeaderboard?.entryCount ?? 'unavailable')],
                  ['List output', (leaderboardDiagnostics.computed as any)?.playerList?.ok === true ? String((leaderboardDiagnostics.computed as any).playerList.count) + ' players' : 'ERROR'],
                  ['Active players', (leaderboardDiagnostics.computed as any)?.playerList?.ok === true ? String((leaderboardDiagnostics.computed as any).playerList.activeCount) : 'unavailable'],
                  ['Legacy rows without IDs', String((leaderboardDiagnostics.storage as any)?.legacyLeaderboard?.entriesWithoutUserId ?? 'unavailable')],
                  ['Registry parse errors', String((leaderboardDiagnostics.storage as any)?.registry?.malformedEntries ?? 'unavailable')],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</div>
                    <div className="mt-1 break-words text-xs font-mono font-bold text-slate-100">{value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">Leaderboard endpoint output</div>
                {(leaderboardDiagnostics.computed as any)?.leaderboards?.ok === true ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries((leaderboardDiagnostics.computed as any).leaderboards.counts ?? {}).map(([name, count]) => (
                      <span key={name} className={`rounded-lg border px-2 py-1 text-[10px] font-mono ${Number(count) > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
                        {name}: {String(count)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-rose-300">
                    {String((leaderboardDiagnostics.computed as any)?.leaderboards?.error ?? 'Leaderboard calculation failed; inspect the JSON report below.')}
                  </p>
                )}
                {(leaderboardDiagnostics.computed as any)?.playerList?.ok !== true && (
                  <p className="mt-2 text-xs text-rose-300">Player list error: {String((leaderboardDiagnostics.computed as any)?.playerList?.error ?? 'unknown error')}</p>
                )}
              </div>

              <details className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-slate-300">Full Diagnostic JSON</summary>
                <pre className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-300">{JSON.stringify(leaderboardDiagnostics, null, 2)}</pre>
              </details>
              <p className="text-[9px] text-slate-600">The report never includes full account IDs or raw player saves. It does include sample usernames and the last 8 characters of IDs; review those before sharing the report.</p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Run diagnostics to collect a live snapshot. It does not alter Redis data or repair records.</p>
          )}
        </section>

        <section id="io-tool-player-moderation" hidden={activeAdminTool !== 'player-moderation'} className={`${panelBase} border border-rose-500/30`}>
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

        <details hidden={!(['player-list', 'stat-spy', 'player-spy'].includes(activeAdminTool))} open={(['player-list', 'stat-spy', 'player-spy'].includes(activeAdminTool))} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>Player Lookup & Analysis</span><span className="text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
        <section id="io-tool-player-list" hidden={activeAdminTool !== 'player-list'} className={`${panelBase} border border-cyan-500/30`}>
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
          <p className="text-[10px] text-slate-500">Active means the account contacted the game within the last 90 seconds. “Push Return” means this session began after a push was sent while the account was offline; Reddit does not provide a per-player click receipt. Version badges compare the latest heartbeat with v{APP_VERSION}.</p>
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
                <div key={player.userId || 'legacy:' + player.username.toLowerCase()} className="px-3 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-200 truncate">u/{player.username}</span>
                      {player.active && <span className="text-[9px] font-black uppercase text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5">Active</span>}
                      {player.active && player.lastSessionNotificationSource && (
                        <span
                          title={'This active session followed a ' + (player.lastSessionNotificationSource === 'offline-full' ? 'full offline Orbs' : 'manual broadcast') + ' push sent while the player was offline.'}
                          className="text-[9px] font-black uppercase text-fuchsia-200 bg-fuchsia-500/10 border border-fuchsia-500/25 rounded-full px-1.5 py-0.5"
                        >
                          Push Return
                        </span>
                      )}
                      {player.legacyOnly
                        ? <span className="text-[9px] font-bold text-slate-300 bg-slate-700/50 border border-slate-600 rounded-full px-1.5 py-0.5">Legacy · ID unavailable</span>
                        : player.isLatestVersion
                          ? <span className="text-[9px] font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-1.5 py-0.5">v{player.clientVersion} · Latest</span>
                          : <span className="text-[9px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-full px-1.5 py-0.5">v{player.clientVersion ?? 'unknown'}</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">Level {player.level} · {formatNumber(player.totalRolls)} rolls · Session {formatPlaytime(player.currentSessionMs)} · Playtime {formatPlaytime(player.playtimeMs)} · Best 1/{formatRarity(Math.max(1, player.highestRarity))}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] text-slate-400">{player.active ? 'Online now' : player.lastSeenAt ? new Date(player.lastSeenAt).toLocaleString() : 'No recent activity'}</div>
                    <div className="text-[9px] text-slate-600 font-mono">{player.userId ? 'ID ' + player.userId.slice(-8) : 'Legacy projection · no account ID'}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-500">No player accounts are registered yet.</div>
          )}
        </section>

        <section id="io-tool-stat-spy" hidden={activeAdminTool !== 'stat-spy'} className={panelBase + ' border border-cyan-500/30'}>
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

              <section className="rounded-xl border border-violet-500/30 bg-slate-950/60 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-black uppercase tracking-wider text-violet-200">Combat Save &amp; Live Encounter</div>
                  <span className={"rounded-lg border px-2 py-1 text-[9px] font-black " + (
                    !statSpy.combat.saveExists ? 'border-slate-700 text-slate-500' :
                    statSpy.combat.inCombat ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' :
                    'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  )}>
                    {statSpy.combat.saveExists ? (statSpy.combat.inCombat ? 'ENCOUNTER LIVE' : statSpy.combat.status.toUpperCase()) : 'NO COMBAT SAVE'}
                  </span>
                </div>
                <p className="text-[9px] leading-4 text-slate-500">{statSpy.combat.statusNote}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['Dungeon', statSpy.combat.dungeonId],
                    ['Current depth', formatNumber(statSpy.combat.depth)],
                    ['Best depth', formatNumber(statSpy.combat.bestDepth)],
                    ['Boss status', statSpy.combat.enemy.boss ? 'Boss' : statSpy.combat.enemy.kind],
                    ['Player HP', formatNumber(statSpy.combat.playerHp) + ' / ' + formatNumber(statSpy.combat.playerMaxHp)],
                    ['Enemy HP', formatNumber(statSpy.combat.enemy.hp) + ' / ' + formatNumber(statSpy.combat.enemy.maxHp)],
                    ['Energy', formatNumber(Number(statSpy.combat.state.energy ?? 0)) + ' / ' + formatNumber(Number(statSpy.combat.state.maxEnergy ?? 0))],
                    ['Combat Marks', formatNumber(Number(statSpy.combat.state.combatMarks ?? 0))],
                    ['Scrap', formatNumber(Number(statSpy.combat.state.scrap ?? 0))],
                    ['Enemy', statSpy.combat.enemy.name],
                    ['Room', statSpy.combat.enemy.room],
                    ['Damage', formatNumber(Number(statSpy.combat.stats.damage ?? 0))],
                    ['Speed', formatNumber(Number(statSpy.combat.stats.speed ?? 0))],
                    ['Armor', formatNumber(Number(statSpy.combat.stats.armor ?? 0))],
                    ['Crit chance', (Number(statSpy.combat.stats.critChance ?? 0) * 100).toFixed(2) + '%'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-slate-800 bg-slate-900/70 p-2 min-w-0">
                      <div className="text-[8px] font-black uppercase tracking-wider text-slate-500">{label}</div>
                      <div className="mt-1 text-[10px] font-mono font-bold text-slate-200 break-words">{value}</div>
                    </div>
                  ))}
                </div>

                <div>
                  <div className="mb-2 text-[9px] font-black uppercase tracking-wider text-slate-400">Currently equipped gear</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {statSpy.combat.gear.map(({ slot, item, itemId }) => (
                      <div key={slot} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[8px] font-black uppercase tracking-wider text-slate-500">{slot}</span>
                          <span className="text-[8px] font-mono text-slate-600">{itemId ? String(itemId).slice(0, 12) : 'empty slot'}</span>
                        </div>
                        {item ? (
                          <>
                            <div className="mt-1 text-[10px] font-bold text-slate-100 break-words">{String(item.name ?? item.id)}</div>
                            <div className="mt-1 text-[9px] text-slate-400">
                              {String(item.rarity ?? 'Gear')} · Quality {formatNumber(Number(item.quality ?? 0))} · Power {formatNumber(Number(item.power ?? 0))} · Obtained depth {formatNumber(Number(item.sourceFloor ?? 0))}
                            </div>
                            <div className="mt-1 text-[8px] leading-3.5 text-slate-500">
                              Damage +{formatNumber(Number(item.damageBonus ?? 0))} · Speed +{formatNumber(Number(item.speedBonus ?? 0))} · HP +{formatNumber(Number(item.maxHealthBonus ?? 0))} · Armor +{formatNumber(Number(item.armorBonus ?? 0))} · Crit +{(Number(item.critChanceBonus ?? 0) * 100).toFixed(2)}%
                            </div>
                            {item.majorAbility && (
                              <div className="mt-1 rounded border border-violet-500/20 bg-violet-500/5 p-1.5 text-[8px] text-violet-200">
                                {String(item.majorAbility.name ?? item.majorAbility.id)}{item.majorAbility.description ? ' · ' + String(item.majorAbility.description) : ''}
                              </div>
                            )}
                            {item.trait && <div className="mt-1 text-[8px] text-slate-500">Trait: {String(item.trait)}{item.effect ? ' · ' + String(item.effect) : ''}</div>}
                          </>
                        ) : <div className="mt-1 text-[9px] text-slate-600">No item equipped</div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="mb-2 text-[9px] font-black uppercase tracking-wider text-slate-400">Equipped skills / abilities</div>
                    {statSpy.combat.equippedSkills.length ? (
                      <div className="space-y-1.5">
                        {statSpy.combat.equippedSkills.map(skill => (
                          <div key={skill.id} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-bold text-slate-200">{skill.name}</span>
                              <span className="text-[9px] font-mono text-violet-200">{skill.rarity} · Rank {formatNumber(skill.rank)}</span>
                            </div>
                            <div className="mt-1 text-[8px] leading-3.5 text-slate-400">{skill.effect}</div>
                            <div className="mt-1 text-[8px] text-slate-600">Ability ID: {skill.id} · Ready sequence: {skill.cooldownUntilSequence == null ? 'not set' : formatNumber(skill.cooldownUntilSequence)}</div>
                          </div>
                        ))}
                      </div>
                    ) : <div className="text-[9px] text-slate-600">No abilities equipped</div>}
                  </div>
                  <div>
                    <div className="mb-2 text-[9px] font-black uppercase tracking-wider text-slate-400">Equipped Combat Runes</div>
                    <div className="mb-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2 text-[9px] text-slate-300">
                      Rune Luck: <span className="font-mono text-cyan-200">{formatStatSpyTotal(statSpy.combat.runeLuckMultiplier, 'mult')}</span>
                      {' · '}Coin +{formatNumber(statSpy.combat.runeBonuses.coinGainPct)}%
                      {' · '}XP +{formatNumber(statSpy.combat.runeBonuses.xpGainPct)}%
                      {' · '}Shard factor +{formatNumber(statSpy.combat.runeBonuses.shardChancePct)}%
                    </div>
                    {statSpy.combat.equippedRunes.length ? (
                      <div className="space-y-1.5">
                        {statSpy.combat.equippedRunes.map((rune, index) => (
                          <div key={String(rune.id ?? index)} className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
                            <div className="text-[10px] font-bold text-slate-200">{String(rune.name ?? rune.id)} <span className="text-[8px] font-normal text-slate-500">· {String(rune.rarity ?? 'Rune')} · Lv {formatNumber(Number(rune.level ?? 1))}</span></div>
                            <div className="mt-1 text-[8px] text-slate-500">{String(rune.stat ?? 'unknown stat')} · value {formatNumber(Number(rune.value ?? 0))} · depth {formatNumber(Number(rune.sourceDepth ?? 0))} · {String(rune.sourceDungeon ?? 'unknown dungeon')}</div>
                            {rune.majorAbility && <div className="mt-1 text-[8px] text-violet-200">{String(rune.majorAbility.name ?? rune.majorAbility.id)}{rune.majorAbility.description ? ' · ' + String(rune.majorAbility.description) : ''}</div>}
                          </div>
                        ))}
                      </div>
                    ) : <div className="text-[9px] text-slate-600">No Combat Runes equipped</div>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[8px] text-slate-500">
                  <span>Inventory: {formatNumber(statSpy.combat.state.inventory?.length ?? 0)} pieces</span>
                  <span>Run haul: {formatNumber(statSpy.combat.state.runInventoryIds?.length ?? 0)} items</span>
                  <span>Total kills: {formatNumber(statSpy.combat.state.totalKills ?? 0)}</span>
                  <span>Combat level: {formatNumber(statSpy.combat.state.level ?? 1)}</span>
                  <span>Last accepted beat: {statSpy.combat.lastAcceptedBeatAtMs ? new Date(statSpy.combat.lastAcceptedBeatAtMs).toLocaleString() : 'never'}</span>
                </div>
              </section>

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

              <div className="space-y-2">
                <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-slate-300">Full persisted player save (JSON)</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/35 p-2 text-[8px] leading-3.5 text-slate-400">{JSON.stringify(statSpy.playerSave ?? {}, null, 2)}</pre>
                </details>
                <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-slate-300">Hydrated player state used for Stat Spy</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/35 p-2 text-[8px] leading-3.5 text-slate-400">{JSON.stringify(statSpy.calculatedPlayerState ?? {}, null, 2)}</pre>
                </details>
                <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-slate-300">Full persisted Combat save (JSON)</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/35 p-2 text-[8px] leading-3.5 text-slate-400">{JSON.stringify(statSpy.combat.save ?? {}, null, 2)}</pre>
                </details>
                <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <summary className="cursor-pointer text-[10px] font-black uppercase tracking-wider text-slate-300">Normalized current Combat state</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-black/35 p-2 text-[8px] leading-3.5 text-slate-400">{JSON.stringify(statSpy.combat.state ?? {}, null, 2)}</pre>
                </details>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/55 p-3 text-[9px] text-slate-500">
                Current CCU: <span className="font-mono text-slate-300">{formatNumber(statSpy.summary.currentCcu)}</span>
                {' · '}Stat Spy test CCU: <span className="font-mono text-slate-300">+{formatNumber(statSpy.summary.fakeCcuBonus)}</span>
                {' · '}Effective CCU for Luck: <span className="font-mono text-cyan-300">{formatNumber(statSpy.summary.effectiveCcu)}</span>
              </div>
            </>
          )}
        </section>

        <section id="io-tool-player-spy" hidden={activeAdminTool !== 'player-spy'} className={panelBase + ' border border-fuchsia-500/30'}>
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
          </div>
        </details>

        <section id="io-tool-admin-cli" hidden={activeAdminTool !== 'admin-cli'} className={panelBase + ' border border-rose-500/30'}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-rose-200">
                <Wand2 className="w-4 h-4" /> Admin Command Line
              </div>
              <p className="mt-1 text-[10px] leading-4 text-slate-400">
                Arm a player with <code>as username</code>. Exactly the next player command runs against that account, then the target clears automatically. Global commands operate on everyone.
              </p>
            </div>
            <div className={'rounded-lg border px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider ' + (
              executeAsUsername
                ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                : 'border-slate-700 bg-slate-900 text-slate-500'
            )}>
              {executeAsUsername ? 'Armed · u/' + executeAsUsername : 'No player target'}
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-black/30 p-3 space-y-2">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">Examples</div>
            <pre className="whitespace-pre-wrap break-words text-[10px] leading-5 font-mono text-slate-300">{'as shadow_fen\n' +
              'give coins 1000000\n' +
              'upgrade speed 20\n' +
              'set masterySkills.continuumLuck 50\n' +
              'cooldown ready\n\n' +
              'menus disable "The developer has disabled the menus."\n' +
              'menus enable\n' +
              'announce "Maintenance is complete."\n' +
              'announce clear'}</pre>
            <p className="text-[9px] leading-4 text-slate-500">
              Also supports set, add, subtract, delete, give shards/dust/offline/rolls, mastery, prestige-upgrade, boost, and offline set/add. Up to 50 save commands per batch.
            </p>
            <p className="text-[9px] leading-4 text-amber-300/80">
              Player commands edit the target’s persisted game state using that account’s save lock. They do not impersonate Reddit or send arbitrary API requests. Global commands cannot be run while a player target is armed.
            </p>
          </div>
          <textarea
            value={executeAsCommands}
            onChange={event => setExecuteAsCommands(event.target.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void runAdminCli();
              }
            }}
            rows={4}
            spellCheck={false}
            placeholder={'Enter a command, then press Run Command…\nas shadow_fen'}
            aria-label="Admin CLI command input"
            className="w-full rounded-xl border border-slate-700 bg-black/50 p-3 text-[11px] leading-5 font-mono text-slate-100 resize-y"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button"
              disabled={executeAsLoading || !executeAsCommands.trim()}
              onClick={() => void runAdminCli()}
              className={buttonBase + ' bg-rose-600 hover:bg-rose-500 border-rose-500 text-white px-4 py-2'}
            >
              <Wand2 className="inline w-3.5 h-3.5 mr-1" /> {executeAsLoading ? 'Executing…' : 'Run Command'}
            </button>
            <button type="button"
              disabled={executeAsLoading || !executeAsUsername}
              onClick={() => { setExecuteAsUsername(''); appendCliHistory('target clear', 'One-shot player target cleared.', true); }}
              className={buttonBase + ' bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300 px-3 py-2'}
            >
              Clear Target
            </button>
            <button type="button"
              disabled={executeAsLoading || cliHistory.length === 0}
              onClick={() => { setCliHistory([]); setExecuteAsResult(''); }}
              className={buttonBase + ' bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300 px-3 py-2'}
            >
              Clear History
            </button>
            <button type="button"
              disabled={executeAsLoading}
              onClick={() => { setExecuteAsCommands('help'); }}
              className={buttonBase + ' bg-slate-900 hover:bg-slate-800 border-slate-700 text-cyan-200 px-3 py-2'}
            >
              Help
            </button>
          </div>
          {executeAsResult && (
            <pre role="status" className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-800 bg-black/40 p-3 text-[10px] leading-4 font-mono text-emerald-200">{executeAsResult}</pre>
          )}
          <div className="rounded-xl border border-slate-800 bg-black/25 p-3">
            <div className="mb-2 flex items-center justify-between gap-2 text-[9px] font-black uppercase tracking-wider text-slate-500">
              <span>Command history</span><span>{cliHistory.length}/30</span>
            </div>
            {cliHistory.length ? (
              <div className="max-h-72 space-y-2 overflow-auto">
                {cliHistory.map((entry, index) => (
                  <div key={entry.at.toString() + '-' + index} className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <code className="min-w-0 break-all text-[10px] text-cyan-200">{entry.command || 'Console'}</code>
                      <span className={'shrink-0 text-[8px] font-black uppercase ' + (entry.ok ? 'text-emerald-300' : 'text-rose-300')}>{entry.ok ? 'OK' : 'FAILED'}</span>
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-words text-[9px] leading-4 font-mono text-slate-400">{entry.output}</pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-slate-600">No commands have been run in this session.</div>
            )}
          </div>
        </section>

        <details id="io-tool-guild-chat" hidden={activeAdminTool !== 'guild-chat'} open={activeAdminTool === 'guild-chat'} className="rounded-xl border border-slate-800 bg-black/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-wider text-slate-300">
            <span>Guild Administration & Chat</span><span className="text-slate-600">Expand</span>
          </summary>
          <div className="mt-3 space-y-3">
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

                  </div>
        </details>

        <details id="io-combat-tools" open={activeAdminSection === 'combat'} hidden={activeAdminSection !== 'combat'} className="scroll-mt-4 rounded-2xl border border-amber-500/30 bg-slate-950/50 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-amber-200">
            <span>Combat Admin Tools</span><span className="text-[10px] text-slate-600">Expand</span>
          </summary>
          {renderAdminToolBar('combat')}
          <div className="mt-3">
            <CombatAdminTools />
          </div>
        </details>

        <details id="io-destructive-group" open={activeAdminSection === 'destructive'} hidden={activeAdminSection !== 'destructive'} className="scroll-mt-4 rounded-2xl border border-rose-500/40 bg-rose-950/10 p-3">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-rose-300">
            <span>Destructive Testing</span><span className="text-[10px] text-rose-400/60">Expand</span>
          </summary>
          {renderAdminToolBar('destructive')}
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
