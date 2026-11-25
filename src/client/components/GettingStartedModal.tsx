import React from 'react';
import { BookOpen, Calendar, Sparkles, Swords, Users, X, Zap } from 'lucide-react';

type GettingStartedModalProps = {
  level: number;
  onClose: () => void;
};

const NEXT_UNLOCKS = [
  { level: 2, name: 'Upgrades', detail: 'Improve Luck to find rarer Orbs and Speed to roll sooner.' },
  { level: 3, name: 'Quests', detail: 'Pick up short goals and claim extra rewards.' },
  { level: 4, name: 'Collection', detail: 'Browse every Orb you have discovered.' },
  { level: 5, name: 'Boosters', detail: 'Use temporary boosts to shape a play session.' },
  { level: 7, name: 'Community', detail: 'Join a guild and compare your progress.' },
  { level: 8, name: 'Combat', detail: 'Fight, find gear, and earn Runes for your rolls.' },
  { level: 10, name: 'Altar', detail: 'Trade spare finds for useful rewards.' },
  { level: 15, name: 'Mastery', detail: 'Choose permanent bonuses for your play style.' },
  { level: 20, name: 'Prestige', detail: 'Start a new climb with lasting bonuses.' },
] as const;

export function GettingStartedModal({ level, onClose }: GettingStartedModalProps) {
  const currentLevel = Math.max(1, Math.floor(Number(level) || 1));
  const nextUnlock = NEXT_UNLOCKS.find(unlock => currentLevel < unlock.level);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-5"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="io-getting-started-title"
        aria-describedby="io-getting-started-description"
        className="relative max-h-[88dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
          aria-label="Close how to play"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="pr-10">
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-sky-300">A quick guide</p>
          <h2 id="io-getting-started-title" className="mt-1 text-2xl font-bold tracking-tight text-white">How to play</h2>
          <p id="io-getting-started-description" className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
            Find Orbs, earn rewards, and use each new level to open another way to play.
          </p>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
            <Sparkles className="h-5 w-5 text-sky-300" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-white">Roll an Orb</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Every roll gives XP and Coins. Rarer finds are worth more, and some rolls also find Shards.</p>
          </article>
          <article className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
            <Zap className="h-5 w-5 text-amber-300" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-white">Make rolls better</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Upgrades open at Level 2. Spend Coins on Luck for rarer finds or Speed for shorter waits.</p>
          </article>
          <article className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
            <BookOpen className="h-5 w-5 text-sky-300" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-white">Keep your finds</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Collection opens at Level 4 and keeps a record of the Orbs you discover.</p>
          </article>
        </div>

        <div className="mt-4 rounded-xl border border-sky-300/20 bg-sky-300/[.06] p-4">
          {nextUnlock ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-[.13em] text-sky-200/80">Your next unlock</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong className="text-sm text-white">{nextUnlock.name}</strong>
                <span className="text-xs text-slate-400">Level {nextUnlock.level} · {Math.max(1, nextUnlock.level - currentLevel)} {nextUnlock.level - currentLevel === 1 ? 'level' : 'levels'} to go</span>
              </div>
              <p className="mt-1 text-xs text-slate-300">{nextUnlock.detail}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-white">All core features are open</p>
              <p className="mt-1 text-xs text-slate-300">Keep collecting Orbs, improve your best rarity, and build on your progress.</p>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400" role="group" aria-label="More unlocks">
          <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />Quests · Level 3</span>
          <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-sky-300" aria-hidden="true" />Community · Level 7</span>
          <span className="inline-flex items-center gap-1.5"><Swords className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" />Combat · Level 8</span>
        </div>
      </section>
    </div>
  );
}
