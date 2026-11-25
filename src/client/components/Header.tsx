import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX, Sparkles, HelpCircle, Coins, Gem, Zap, Wrench, Star, Users, MessageSquarePlus, Bell, BellOff, ScrollText, Swords } from 'lucide-react';
import type { PlayerState } from '../../shared/game.js';
import { getLevelBenefits, getLevelProgress, onlinePlayerLuckMultiplier, formatShardAmount, formatNumber, MAX_PLAYER_LEVEL } from '../../shared/game.js';
import { sound } from '../sound.js';
import { APP_VERSION } from '../../shared/version.js';

interface HeaderProps {
  state: PlayerState;
  combatMode?: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenOdds: () => void;
  onOpenFeedback: () => void;
  onOpenChangelog: () => void;
  changelogUnread?: boolean;
  onClaimOffline: () => void;
  onOpenDevDebug?: () => void;
  adminStatusUnavailable?: boolean;
  onRetryAdminStatus?: () => void;
  onOpenProfile?: () => void;
  notificationsEnabled: boolean;
  notificationPreferences: { updates: boolean; offlineOrbs: boolean };
  notificationSettingsLoaded: boolean;
  onSetNotificationPreference: (type: 'updates' | 'offlineOrbs', enabled: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({
  state,
  combatMode = false,
  soundEnabled,
  onToggleSound,
  onOpenOdds,
  onOpenFeedback,
  onOpenChangelog,
  changelogUnread = false,
  onClaimOffline,
  onOpenDevDebug,
  adminStatusUnavailable = false,
  onRetryAdminStatus,
  onOpenProfile,
  notificationsEnabled,
  notificationPreferences,
  notificationSettingsLoaded,
  onSetNotificationPreference,
}) => {
  const fmt = (n: number) => Number.isFinite(n) ? Math.max(0, n).toLocaleString() : '0';
  const onlineCountRaw = Number(state.onlinePlayers ?? 1);
  const onlineCount = Number.isFinite(onlineCountRaw) ? Math.max(1, Math.floor(onlineCountRaw)) : 1;
  const [combatMarks,setCombatMarks]=useState(0);
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false);
  useEffect(()=>{
    let cancelled=false;
    const refreshCombatMarks=async()=>{
      try{
        const response=await fetch('/api/combat/marks',{cache:'no-store'});
        if(!response.ok)return;
        const payload=await response.json() as {combatMarks?:unknown};
        const value=Number(payload.combatMarks);
        if(!cancelled&&Number.isSafeInteger(value)&&value>=0)setCombatMarks(value);
      }catch{
        // Combat currency is supplemental HUD information; offline combat must not break the header.
      }
    };
    const onCombatMarksUpdated=(event:Event)=>{
      const value=Number((event as CustomEvent<{combatMarks?:unknown}>).detail?.combatMarks);
      if(Number.isSafeInteger(value)&&value>=0)setCombatMarks(value);
    };
    void refreshCombatMarks();
    window.addEventListener('io-combat-marks-updated',onCombatMarksUpdated);
    return()=>{cancelled=true;window.removeEventListener('io-combat-marks-updated',onCombatMarksUpdated);};
  },[]);
  const levelInfo = getLevelProgress(
    Math.max(1, state.level || 1),
    state.xp || 0,
    state.levelXpFloor,
  );
  const displayedLevel = levelInfo.level;
  const levelBenefits = getLevelBenefits(displayedLevel);
  return (
    <>
      <header className="app-header bg-slate-900/90 border-b border-slate-800/80 backdrop-blur-md sticky top-0 z-30 px-4 py-3">
      <div className="header-inner max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Player Identity & EXP Bar */}
        <div className="brand-lockup flex items-center space-x-3">
          <div className="brand-mark relative w-10 h-10 rounded-xl border border-purple-400/35 bg-slate-950 flex items-center justify-center">
            <div className="brand-glyph w-full h-full rounded-[10px] flex items-center justify-center font-semibold text-xl text-purple-200">
              ∞
            </div>
          </div>
          <div className="brand-copy">
            <div className="flex items-center gap-2">
              <h1 className="font-extrabold text-base sm:text-lg tracking-tight text-white flex items-center gap-1.5">
                Infinity Orbs
              </h1>
              <span
                aria-label={`App version ${APP_VERSION}`}
                className="rounded border border-slate-700/70 px-1.5 py-0.5 text-[9px] font-mono font-semibold text-slate-500"
              >
                v{APP_VERSION}
              </span>
              {/* Level Badge with click to view perks */}
              <button
                type="button"
                aria-label={`View Level ${levelInfo.level} perks`}
                onClick={() => onOpenProfile?.()}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-200 border border-purple-400/25 hover:border-purple-300/50 flex items-center gap-1 cursor-pointer transition-colors"
                title={`Level ${levelInfo.level} Perks: ${levelBenefits.luckMultiplier.toFixed(2)}× Luck, ${levelBenefits.coinsMultiplier.toFixed(2)}× Coins, +${levelBenefits.bonusBalls} Balls`}
              >
                <Star className="w-2.5 h-2.5 text-amber-300 fill-current" />
                <span>Lv {levelInfo.level}</span>
              </button>
            </div>

            <button
              type="button"
              className="io-level-progress"
              aria-label={displayedLevel >= MAX_PLAYER_LEVEL
                ? `Maximum Paragon Level ${MAX_PLAYER_LEVEL} reached.`
                : `View progress. ${fmt(levelInfo.currentLevelXp)} of ${fmt(levelInfo.nextLevelXp)} XP toward level ${levelInfo.level + 1}.`}
              onClick={() => onOpenProfile?.()}
              title={displayedLevel >= MAX_PLAYER_LEVEL
                ? `Maximum Paragon Level ${MAX_PLAYER_LEVEL} reached`
                : `Progress to Level ${levelInfo.level + 1}: ${fmt(levelInfo.currentLevelXp)} / ${fmt(levelInfo.nextLevelXp)} XP`}
            >
              <span className="io-level-progress-track" aria-hidden="true">
                <span style={{ width: `${levelInfo.progressPercent}%` }} />
              </span>
              <span className="io-level-progress-copy">
                {displayedLevel >= MAX_PLAYER_LEVEL ? 'MAX LEVEL' : `${fmt(levelInfo.currentLevelXp)} / ${fmt(levelInfo.nextLevelXp)} XP`}
              </span>
            </button>
          </div>
        </div>

        {/* Currencies & Global Actions */}
        <div className="header-actions flex flex-wrap items-center justify-end gap-2 sm:gap-4 ml-auto">
          {/* Live player count / social luck */}
          <div
            className="hidden sm:flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-2.5 py-1.5 text-[10px] font-black text-indigo-200"
            aria-label={`Online players: ${fmt(onlineCount)}; community Luck multiplier ${onlinePlayerLuckMultiplier(onlineCount).toFixed(2)} times.`}
            title="Players currently active in this game installation. More players increase everyone’s Luck bonus."
          >
            <Users className="w-3.5 h-3.5 text-indigo-300" />
            <span>{fmt(onlineCount)} Online</span>
            <span className="text-indigo-300/70">×{onlinePlayerLuckMultiplier(onlineCount).toFixed(2)} Luck</span>
          </div>

          {/* Currencies */}
          <div role="group" aria-label={combatMode ? "Combat resources" : "Player resources"} className="header-resource-row resource-chip flex items-center gap-2 bg-slate-950/70 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs font-semibold">
            {/* Core-game Coins stay hidden while in Combat. */}
            {!combatMode && <>
              <div className="resource-item resource-coins" aria-label={`${formatNumber(state.coins)} Coins`} title="Spend Coins on upgrades to improve your rolls.">
                <Coins className="w-4 h-4" />
                <span className="resource-value">{formatNumber(state.coins)}</span>
                <span className="resource-label">Coins</span>
              </div>
              <div className="w-[1px] h-3.5 bg-slate-800" />
            </>}

            {/* Combat Marks are shown only while in the Combat section. */}
            {combatMode && <>
              <div className="resource-item resource-marks" title="Earn Combat Marks in battles and spend them on combat upgrades.">
                <Swords className="w-4 h-4" />
                <span className="resource-value">{fmt(combatMarks)}</span>
                <span className="resource-label">Marks</span>
              </div>
              <div className="w-[1px] h-3.5 bg-slate-800" />
            </>}

            {/* Shards */}
            <div className="resource-item resource-shards" aria-label={`${formatShardAmount(state.shards ?? 0)} Shards`} title="Use Shards for special tools and boosters.">
              <Gem className="w-4 h-4" />
              <span className="resource-value">{formatShardAmount(state.shards ?? 0)}</span>
              <span className="resource-label">Shards</span>
            </div>

            {/* Cosmic Dust */}
            {(state.cosmicDust > 0 || state.prestigeCount > 0) && (
              <>
                <div className="w-[1px] h-3.5 bg-slate-800" />
                <div className="resource-item resource-dust" aria-label={`${fmt(state.cosmicDust)} Cosmic Dust`} title="Use Cosmic Dust for permanent Prestige upgrades.">
                  <Sparkles className="w-4 h-4" />
                  <span className="resource-value">{fmt(state.cosmicDust)}</span>
                  <span className="resource-label">Dust</span>
                </div>
              </>
            )}
          </div>

          {/* Offline Rolls Waiting Notification */}
          {state.offlineRolls > 0 && (
            <button
              type="button"
              aria-label={`Claim ${fmt(state.offlineRolls)} offline rolls`}
              onClick={onClaimOffline}
              className="offline-button flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3 py-1.5 rounded-xl shadow-md transition-all"
              title="Claim the rolls accumulated while you were away. They are added to your Free Rolls."
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Claim +{fmt(state.offlineRolls)} Rolls</span>
            </button>
          )}

          {/* Fair RNG Odds Button */}
          <button
            type="button"
            aria-label="View probability and drop odds"
            onClick={onOpenOdds}
            className="header-icon-button p-2 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded-lg transition-colors"
            title="View Probability & Drop Odds"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Changelog */}
          <div className={changelogUnread ? 'relative rounded-lg ring-2 ring-emerald-400/80 shadow-[0_0_16px_rgba(74,222,128,0.75)] animate-pulse' : 'relative rounded-lg'}>
            {changelogUnread && <span className="absolute -top-1 -right-1 z-10 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[8px] font-black text-slate-950 shadow-md">NEW</span>}
            <button type="button" aria-label="View Changelog" onClick={() => { sound.playClick(); onOpenChangelog(); }}
              className="header-icon-button p-2 text-slate-400 hover:text-purple-300 hover:bg-slate-800/80 rounded-lg transition-colors"
              title={changelogUnread ? 'New changelog since your last visit' : 'View Changelog'}>
              <ScrollText className="w-4 h-4" />
            </button>
          </div>

          {/* Bug report / suggestions */}
          <button
            type="button"
            aria-label="Report a bug or suggest an improvement"
            onClick={() => {
              sound.playClick();
              onOpenFeedback();
            }}
            className="header-icon-button p-2 text-slate-400 hover:text-amber-300 hover:bg-slate-800/80 rounded-lg transition-colors"
            title="Report a bug or suggest an improvement"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>

          {/* Admin Console */}
          {adminStatusUnavailable && onRetryAdminStatus && (
            <button
              type="button"
              aria-label="Retry admin console availability check"
              onClick={onRetryAdminStatus}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-bold transition-all"
              title="Admin tools could not be checked. Retry."
            >
              <Wrench className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Retry Admin</span>
            </button>
          )}
          {onOpenDevDebug && (
            <button
              type="button"
              aria-label="Open admin console"
              onClick={() => {
                sound.playClick();
                onOpenDevDebug();
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg text-xs font-bold transition-all"
              title="Admin Console"
            >
              <Wrench className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Admin</span>
            </button>
          )}

          {/* Independent Reddit Notification Settings */}
          <div className="relative">
            <button
              type="button"
              aria-label="Notification settings"
              aria-expanded={notificationSettingsOpen}
              aria-haspopup="dialog"
              onClick={() => {
                sound.playClick();
                setNotificationSettingsOpen(open => !open);
              }}
              className="header-icon-button p-2 text-slate-400 hover:text-fuchsia-300 hover:bg-slate-800/80 rounded-lg transition-colors"
              title="Choose which Infinity Orbs notifications you receive"
            >
              {notificationsEnabled
                ? <Bell className="w-4 h-4 text-fuchsia-400" />
                : <BellOff className="w-4 h-4 text-slate-500" />}
            </button>
            {notificationSettingsOpen && (
              <div
                role="dialog"
                aria-label="Notification preferences"
                className="absolute right-0 top-full mt-2 z-[80] w-72 rounded-2xl border border-slate-700 bg-slate-950/98 p-3 shadow-2xl shadow-black/50"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-black uppercase tracking-wider text-white">Push notifications</div>
                  <button
                    type="button"
                    aria-label="Close notification settings"
                    onClick={() => setNotificationSettingsOpen(false)}
                    className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
                  >
                    ×
                  </button>
                </div>
                <p className="mb-3 text-[10px] leading-relaxed text-slate-400">
                  Choose each type independently. Reddit notifications are enabled while at least one type is on.
                </p>
                {!notificationSettingsLoaded ? (
                  <div className="py-3 text-center text-[10px] text-slate-500">Loading preferences…</div>
                ) : (
                  <div className="space-y-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notificationPreferences.updates}
                      onClick={() => onSetNotificationPreference('updates', !notificationPreferences.updates)}
                      className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-left hover:border-fuchsia-500/40"
                    >
                      <span>
                        <span className="block text-xs font-bold text-slate-100">Game updates</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">Announcements and new release alerts</span>
                      </span>
                      <span className={'relative h-5 w-9 shrink-0 rounded-full transition-colors ' + (notificationPreferences.updates ? 'bg-fuchsia-500' : 'bg-slate-700')}>
                        <span className={'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ' + (notificationPreferences.updates ? 'translate-x-4' : 'translate-x-0.5')} />
                      </span>
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={notificationPreferences.offlineOrbs}
                      onClick={() => onSetNotificationPreference('offlineOrbs', !notificationPreferences.offlineOrbs)}
                      className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-left hover:border-emerald-500/40"
                    >
                      <span>
                        <span className="block text-xs font-bold text-slate-100">Offline Orbs</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">Reminder when your offline storage is full</span>
                      </span>
                      <span className={'relative h-5 w-9 shrink-0 rounded-full transition-colors ' + (notificationPreferences.offlineOrbs ? 'bg-emerald-500' : 'bg-slate-700')}>
                        <span className={'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ' + (notificationPreferences.offlineOrbs ? 'translate-x-4' : 'translate-x-0.5')} />
                      </span>
                    </button>
                    <div className="pt-1 text-[9px] text-slate-500">
                      {notificationsEnabled ? 'Reddit push permission is active.' : 'Both types are off.'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sound Toggle */}
          <button
            type="button"
            aria-label={soundEnabled ? 'Mute sound' : 'Enable sound'}
            aria-pressed={soundEnabled}
            onClick={() => {
              sound.playClick();
              onToggleSound();
            }}
            className="p-2 text-slate-400 hover:text-amber-300 hover:bg-slate-800/80 rounded-lg transition-colors"
            title={soundEnabled ? 'Mute Sound' : 'Enable Sound'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-cyan-400" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </button>
        </div>
      </div>
    </header>
    </>
  );
};
