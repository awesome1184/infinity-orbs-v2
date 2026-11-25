import React, { useMemo, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { APP_VERSION } from '../../shared/version.js';

interface ChangelogModalProps {
  onClose: () => void;
}

const sections: Array<{
  title: string;
  entries: Array<{ title: string; description: string }>;
}> = [
  {
    title: "New in 2.2.3",
    entries: [
      { title: "Auto Roll Cooldown Reliability", description: "Fixed Auto Roll occasionally retrying too early at very high speeds. It now waits for the server-reported remaining cooldown before trying again." },
      { title: "Sonar Ping Menu", description: "Removed the duplicate Record alerts summary. Near-best and new-record trigger settings remain in the Sonar Ping options." },
    ],
  },
  {
    title: "New in 2.2.2",
    entries: [
      { title: "Time Energy Generation", description: "Cooldown Reclaimer now earns 1% of your current roll cooldown per level with each normal manual or Auto Roll activation, including at the 300ms cooldown floor. Free Rolls, Chain Patcher rolls, and Time Energy-powered rolls do not generate more energy." },
    ],
  },
  {
    title: "New in 2.2.0",
    entries: [
      { title: "Celestial Alignments", description: "Unlock a rare event and choose one of three temporary effects within 60 seconds: Starseeker raises ordinary Luck, Golden Orbit grants +50% Coins, or Clockwork makes Auto Roll 20% faster. Each chosen effect lasts 2 hours and stacks independently with earlier activations, with its own countdown." },
      { title: "Time Energy Bank", description: "Time Energy banks recovered roll cooldown and can fund multiple complete manual or Auto Rolls. Unused partial energy carries forward." },
      { title: "Sonar Ping Controls", description: "Choose whether Sonar pings on non-record Orbs within 10% of your current best or only on a new record. You can also allow Celestial Alignment sounds while Sonar is blocking other sounds." },
      { title: "Three New Rune Rarities", description: "Astral, Celestial, and Transcendent Runes now extend the Rune rarity ladder beyond Cosmic." },
      { title: "Rarity-Scaled Rune Abilities", description: "Higher-rarity Runes now grant stronger Rune Major Abilities, and Rune details show the rarity-scaled effect strength." },
      { title: "Guild Task and Combo Progress", description: "Rare-Orb Guild tasks count every qualifying Orb earned, including rewards from large Multi Rolls. Guild Combos show the time remaining compared with the total time you earned." },
      { title: "Rarity Milestone Orbs", description: "Collection milestones and the rarity table now use recognizable, rarity-colored Orb icons, with a glow for tiers you have discovered." },
      { title: "Responsive Orb Results", description: "Orb results now fit the screen: fullscreen displays use 9 Orbs per row, while mobile displays use 3 across. Game and Combat screens also adapt more cleanly to phones, tablets, and desktop." },
      { title: "Faster Mobile Gear Equipping", description: "Unequipped Gear items on mobile now have an Equip button right on the inventory card, so you do not need to open the item inspector first. Desktop Gear tiles are more compact." },
      { title: "Upgraded Main-Game Post", description: "The in-feed game preview has a larger animated infinity-orb energy field, with Continue playing anchored at the bottom of the card." },
      { title: "Frenzy Claim Activity", description: "Embedded Frenzy posts now show the claim count and the five most recent players who claimed that Frenzy." },
    ],
  },
  {
    title: "New in 2.0.0",
    entries: [
      { title: "Major feature — Combat Mode", description: "Added Combat as a separate game mode, unlocked at Core Level 8, with a guided introduction and its own progression." },
      { title: "Major feature — Three Expeditions", description: "Added Undercrypt, Cinder Vault, and Glass Labyrinth. Each dungeon tracks its own best depth and has a boss every tenth depth." },
      { title: "Major feature — Dungeon Runs", description: "Added automatic dungeon runs, selectable combat tactics, manual actions, persistent health between encounters, and new-run resets." },
      { title: "Major feature — Gear, Forge & Abilities", description: "Added seven gear slots, randomized gear stats and traits, quality rolls, nonlinear gear power, the Forge, Scrap, and 30 Gear Major Abilities." },
      { title: "Major feature — Combat Skill Gacha", description: "Added 35 active skills. Duplicate skills increase ranks, making repeated pulls useful." },
      { title: "Major feature — Arena", description: "Added asynchronous player-build battles against recently active players, with rating and win/loss records." },
      { title: "Major feature — Rune System", description: "Added seven Rune rarities, from Common through Cosmic. Monsters drop Runes; bosses always drop one and elites have improved drop odds." },
      { title: "Major feature — Rune Loadouts", description: "Rune loadouts improve core-game Orb Luck, Coins, Shard chance, and XP. Unlock more Rune slots through Delver levels and dungeon depth, then strengthen Runes by sacrificing duplicates or enabling Auto Sacrifice." },
      { title: "Core game — Push Notification Opt-In", description: "Added a one-time push notification prompt. Notifications stay off unless enabled, and the prompt explains the limited alerts and the bell control for changing the setting later." },
      { title: "Core game — First-Roll Tutorial", description: "Added a first-roll tutorial that introduces rolling an Orb, the result screen, Upgrades, and the Codex. It can be skipped at any time." },
      { title: "Core game — Aftershock", description: "Added Aftershock, a Mastery skill that provides Critical Luck based on the best dry interval between successive all-time rarity records." },
      { title: "Core game — Unbroken Momentum", description: "Added Unbroken Momentum, a Prestige upgrade that grants permanent roll Speed based on the longest uninterrupted online rolling session." },
      { title: "Core game — Codex Devotion", description: "Updated Codex Devotion to show its current Luck bonus and the bonus from the next level." },
      { title: "Core game — Chain Patcher", description: "Added Chain Patcher to the Codex. It guarantees the cheapest missing rarity adjacent to the longest consecutive Codex chain on the next accepted roll, for a Shard cost and with a 24-hour purchase cooldown." },
      { title: "Core game — Shared Orb Frenzies", description: "Shared Orb Frenzies can be claimed by multiple different players during the post’s lifetime. Each player still has their own claim cooldown." },
      { title: "Core game — Rune Inventory Improvements", description: "Added Rune inventory search, equipped filters, level and XP progress, capacity warnings, and clearer Strengthen and Auto Sacrifice controls." },
      { title: "Core game — Global Chat & Player Sessions", description: "Improved Global Chat status messaging when posting is unavailable and added active-session length to the player list." },
      { title: "Core game — Main-Game Visual Feedback", description: "Made the first dozen rolls easier to spot with a brighter Orb stage, a clear first-roll action, and a restrained pulsing Roll button. Newly discovered Orbs receive a short visual highlight; reduced-motion preferences are respected." },
      { title: "Core game — Post Previews & Play CTA", description: "Revamped main-game, shared-Orb, and Frenzy previews with animated Orb visuals and a glowing, pulsing Play button that makes starting the game unmistakable." },
      { title: "Core game — Frenzy Reward Reveal", description: "Reworked Frenzy rewards into a full animated Orb reveal with orbiting effects, visible personal claim cooldowns, post-expiry timer, and a persistent Play button. Main-game and shared-Orb posts now feature animated Orb energy effects." },
      { title: "Core game — Frenzy Roll Payouts", description: "Frenzies now grant ordinary random Orb rolls instead of guaranteeing the posted Orb rarity. Payouts use the full Multiball multiplier, with Frenzy Volley adding a separate +20% bonus; the post shows your exact personal roll count." },
      { title: "Core game — Infinity Overflow", description: "Rolls whose calculated rarity exceeds JavaScript’s largest finite number now display as 1/Infinity. The finite 1.797693e308 rarity remains a numeric rarity." },
      { title: "Balance change — Repeatable Upgrade Costs", description: "Unlimited repeatable core-game upgrades cost 15% more; capped Roll Speed and Offline Generation Speed keep their existing cost curves." },
      { title: "Balance change — Supernova Critical Scaling", description: "Supernova now multiplies the normal critical multiplier instead of replacing it, so it remains powerful as Critical upgrades grow." },
      { title: "Balance change — Mastery Engine Removed", description: "Mastery Engine has been removed for balancing purposes." },
      { title: "Bug fix — Notification Prompt", description: "Fixed the one-time push notification prompt for returning players." },
      { title: "Bug fix — Silent Alert Mode", description: "Fixed Silent Alert Mode’s toggle becoming out of sync with the active sound mode." },
      { title: "Bug fix — Combat Encounter Effects", description: "Fixed encounter effects carrying into a new run." },
      { title: "Bug fix — Shared Orb Previews", description: "Fixed shared Orb previews rejecting valid large rarity values." },
      { title: "Bug fix — Leaderboard Recovery", description: "Kept older shared-Orb leaderboard entries visible when legacy records are missing account IDs." },
      { title: "Bug fix — Frenzy Claims & Post Performance", description: "Fixed Frenzy claims so the main game consumes the armed handoff and plays the reward-batch reveal; centered orbit rings, smoothed their rotation, reduced shared-Orb glow, and kept skill details open long enough to equip abilities." },
      { title: "Bug fix — Rune Controls", description: "Fixed Rune controls so Equip, Strengthen, and Auto Sacrifice actions no longer conflict when used in quick succession." },
    ],
  },
];;

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ onClose }) => {
  const [search, setSearch] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const normalizedSearch = search.trim().toLowerCase();
  const filteredSections = useMemo(
    () => sections
      .map(section => ({
        ...section,
        entries: section.entries.filter(entry =>
          `${entry.title} ${entry.description}`.toLowerCase().includes(normalizedSearch),
        ),
      }))
      .filter(section => section.entries.length > 0),
    [normalizedSearch],
  );
  const matchCount = filteredSections.reduce((total, section) => total + section.entries.length, 0);

  return (
    <div
      className="fixed inset-0 z-[80] io-modal-backdrop flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="io-changelog-title"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <section className="io-modal-card w-full max-w-lg bg-slate-950/95 border border-purple-500/30 shadow-2xl shadow-purple-950/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-black text-purple-300">
              <BookOpen className="w-4 h-4" />
              Changelog
            </div>
            <h2 id="io-changelog-title" className="mt-1 text-2xl font-black text-white">
              Update {APP_VERSION}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close changelog"
            title="Close changelog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <label htmlFor="io-changelog-search" className="sr-only">Search update notes</label>
          <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3 focus-within:border-purple-400/70">
            <input
              id="io-changelog-search"
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search features, balance changes, fixes…"
              aria-describedby="io-changelog-match-count"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-white placeholder:text-slate-500 outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear changelog search"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p id="io-changelog-match-count" role="status" aria-live="polite" className="px-1 text-[10px] text-slate-500">
            {matchCount} update note{matchCount === 1 ? '' : 's'}{normalizedSearch ? ' match your search.' : ' in this version.'}
          </p>
        </div>

        <div className="mt-3 max-h-[60dvh] overflow-y-auto overscroll-contain pr-1 space-y-5">
          {filteredSections.length === 0 && (
            <p role="status" className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
              No update notes match “{search.trim()}”. Try a shorter search.
            </p>
          )}
          {filteredSections.map((section, index) => {
            const isCollapsed = !normalizedSearch && Boolean(collapsedSections[section.title]);
            return (
              <section key={section.title} className="space-y-2">
                <button
                  type="button"
                  onClick={() => setCollapsedSections(current => ({ ...current, [section.title]: !current[section.title] }))}
                  aria-expanded={!isCollapsed}
                  aria-controls={`io-changelog-section-${index}`}
                  className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-[10px] uppercase tracking-[0.16em] font-black text-purple-300 transition-colors hover:bg-purple-500/5 hover:text-purple-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300"
                >
                  <span>{section.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full border border-purple-400/20 bg-purple-400/10 px-2 py-0.5 text-[9px] normal-case tracking-normal">{section.entries.length}</span>
                    <span aria-hidden="true" className="text-sm">{isCollapsed ? '+' : '−'}</span>
                  </span>
                </button>
                <div id={`io-changelog-section-${index}`} hidden={isCollapsed} className="space-y-2">
                  {section.entries.map(({ title, description }) => (
                    <article
                      key={title}
                      className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
                    >
                      <h4 className="text-sm font-black text-white">{title}</h4>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 min-h-11 w-full rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-black text-slate-200 transition-colors"
        >
          Close
        </button>
      </section>
    </div>
  );
};
