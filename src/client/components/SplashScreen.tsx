import { ArrowRight, Sparkles } from 'lucide-react';
import '../post-revamp.css';
import { APP_VERSION } from '../../shared/version.js';
import { formatNumber, formatRarity } from '../../shared/game.js';

type SplashScreenProps = {
  ready: boolean;
  hasProgress: boolean;
  highestRarity?: number;
  highestRarityIsInfinity?: boolean;
  totalRolls?: number;
  loadingProgress?: number;
  loadingLabel?: string;
  onEnter: () => void;
};

export function SplashScreen({
  ready,
  hasProgress,
  highestRarity = 2,
  highestRarityIsInfinity = false,
  totalRolls = 0,
  loadingProgress = ready ? 100 : 12,
  loadingLabel = 'Connecting to your saved game…',
  onEnter,
}: SplashScreenProps) {
  const progress = Math.max(0, Math.min(100, Math.round(Number.isFinite(loadingProgress) ? loadingProgress : 0)));

  return (
    <main
      className="io-splash-screen fixed inset-0 z-[100] flex min-h-screen items-center justify-center overflow-y-auto px-5 py-8 text-slate-100"
      aria-label="Infinity Orbs start screen"
    >
      <section className="io-splash-content w-full max-w-lg text-center">
        <div
          className="io-splash-mark mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl text-4xl font-light"
          aria-hidden="true"
        >
          ∞
        </div>

        <h1 className="io-splash-title text-4xl sm:text-5xl">
          Infinity Orbs
        </h1>
        <p className="io-splash-tagline mt-2 text-sm">
          Find an Orb worth keeping.
        </p>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-300">
          {hasProgress
            ? 'Your collection is right where you left it. Pick up where you stopped.'
            : 'Roll to find Orbs, earn Coins and XP, then improve your odds.'}
        </p>

        <div className={`io-splash-loading ${ready ? 'is-ready' : 'is-loading'}`}>
          <div className="io-splash-loading-header">
            <span>{ready ? 'GAME READY' : 'LOADING YOUR GAME'}</span>
            <strong>{progress}%</strong>
          </div>
          <div
            className="io-splash-progress-track"
            role="progressbar"
            aria-label="Infinity Orbs loading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-valuetext={ready ? 'Your saved game is ready to play' : `${loadingLabel} ${progress}%`}
          >
            <span className="io-splash-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="io-splash-loading-label" role="status" aria-live="polite">
            {ready ? 'Your save is loaded. Everything is ready.' : loadingLabel}
          </p>
        </div>

        {ready && !hasProgress && (
          <ol className="io-splash-steps" aria-label="How to get started">
            <li><span>1</span><div><strong>Roll</strong><small>See what you find</small></div></li>
            <li><span>2</span><div><strong>Earn</strong><small>Collect Coins and XP</small></div></li>
            <li><span>3</span><div><strong>Improve</strong><small>Make the next roll count</small></div></li>
          </ol>
        )}

        {ready && hasProgress && (
          <div className="io-splash-save mx-auto mt-7 grid max-w-xs grid-cols-2 px-4 py-3">
            <div className="px-2">
              <div className="io-splash-stat-label">
                Best orb
              </div>
              <div className="io-splash-stat-value mt-1 text-sm">
                1 / {formatRarity(highestRarity, highestRarityIsInfinity)}
              </div>
            </div>
            <div className="px-2">
              <div className="io-splash-stat-label">
                Rolls
              </div>
              <div className="io-splash-stat-value mt-1 text-sm">
                {formatNumber(totalRolls)}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onEnter}
          disabled={!ready}
          aria-busy={!ready}
          aria-describedby="io-splash-hint"
          className={`io-immersive-play-cta io-splash-cta mt-7 min-h-14 w-full rounded-xl px-6 py-4 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-wait ${ready ? 'is-ready' : 'is-loading'}`}
        >
          {ready && <Sparkles className="io-splash-cta-sparkle" size={18} aria-hidden="true" />}
          <span>{ready ? (hasProgress ? 'Continue playing' : 'Start playing') : 'Getting your game ready…'}</span>
          {ready && <ArrowRight className="io-splash-cta-arrow" size={18} aria-hidden="true" />}
        </button>

        <p id="io-splash-hint" className="io-splash-hint mt-3 min-h-5 text-xs" aria-live="polite">
          {ready ? (hasProgress ? `Best find so far: 1 in ${formatRarity(highestRarity, highestRarityIsInfinity)}.` : 'No setup needed. Your first roll is free.') : 'Loading your saved game…'}
        </p>
        <p className="io-splash-version" aria-label={`App version ${APP_VERSION}`}>v{APP_VERSION}</p>
      </section>
    </main>
  );
}
