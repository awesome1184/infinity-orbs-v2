import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { requestExpandedMode } from '@devvit/web/client';
import { ArrowRight, Flame, Users } from 'lucide-react';
import './styles.css';
import { formatRarity, getOrbInfo, FRENZY_POST_LIFETIME_MS } from '../shared/game.js';

interface FrenzyInfo {
  rarity: number;
  ownerUsername: string;
  createdAt: number;
  expiresAt: number;
  expired: boolean;
  consumed?: boolean;
  claimedToday: boolean;
  claimCooldownRemainingMs: number;
  claimCooldownEndsAt: number;
  isOwner: boolean;
  canClaim: boolean;
  selfClaimTest: boolean;
  postId: string;
  inGame?: boolean;
}

function PublicBrand() {
  return (
    <div className="io-public-brand">
      <div className="io-public-brand-mark" aria-hidden="true"><span>∞</span></div>
      <div>
        <div className="io-public-brand-title">Infinity Orbs</div>
        <div className="io-public-brand-subtitle">ROLL · COLLECT · GO FURTHER</div>
      </div>
    </div>
  );
}

function AnimatedRarity({ rarity, color }: { rarity: number; color: string }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const handleMotionPreference = (event: MediaQueryListEvent) => {
      if (event.matches) {
        window.cancelAnimationFrame(frame);
        setDisplay(rarity);
      }
    };
    reducedMotion.addEventListener('change', handleMotionPreference);
    if (reducedMotion.matches) {
      setDisplay(rarity);
      return () => reducedMotion.removeEventListener('change', handleMotionPreference);
    }

    const started = performance.now();
    const duration = 1200;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = progress >= 1 ? rarity : Math.floor(rarity * eased);
      setDisplay(value);
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };
    setDisplay(0);
    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', handleMotionPreference);
    };
  }, [rarity]);

  return (
    <div className="io-frenzy-rarity-lockup" style={{ color }}>
      <span className="io-frenzy-rarity-prefix">1 /</span>
      <span
        key={rarity}
        className="io-frenzy-rarity-number"
        aria-label={'1/' + formatRarity(rarity)}
        style={{ textShadow: '0 0 34px ' + color + '55' }}
      >
        {formatRarity(display)}
      </span>
    </div>
  );
}

function FrenzyPost() {
  const [info, setInfo] = useState<FrenzyInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [openedGame, setOpenedGame] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = async () => {
    try {
      const res = await fetch('/api/frenzy/info');
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not load Frenzy.');
      const data = await res.json() as FrenzyInfo;
      setInfo(data);
      setClaimed(Boolean(data.claimedToday));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load Frenzy.');
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const claim = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!info?.canClaim || loading) return;
    setLoading(true);
    setError(null);

    // Expanded mode must be requested synchronously in the trusted click turn.
    // Start the handoff request concurrently; the expanded game retries its
    // read-only preflight while this request finishes.
    let expansionPromise: Promise<void>;
    try {
      expansionPromise = Promise.resolve(requestExpandedMode(event.nativeEvent, 'game'));
    } catch (error) {
      expansionPromise = Promise.reject(error);
    }
    const armPromise = fetch('/api/frenzy/arm', { method: 'POST' }).then(async arm => {
      const armData = await arm.json().catch(() => ({}));
      if (!arm.ok) throw new Error(armData.error || 'Could not arm Frenzy.');
    });
    const [expansionResult, armResult] = await Promise.allSettled([expansionPromise, armPromise]);

    if (expansionResult.status === 'fulfilled') {
      if (armResult.status === 'fulfilled') {
        setOpenedGame(true);
      } else {
        setError(armResult.reason instanceof Error ? armResult.reason.message : 'Could not arm Frenzy. Return to the post and retry.');
        setLoading(false);
      }
      return;
    }

    // Some previews cannot expand. Finish the claim on this screen instead.
    // The claim endpoint is called exactly once, regardless of arm outcome.
    try {
      const res = await fetch('/api/frenzy/claim', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not claim Frenzy.');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not claim Frenzy.');
    } finally {
      setLoading(false);
    }
  };

  if (error && !info) {
    return (
      <main className="io-public">
        <div className="io-public-grid" aria-hidden="true" />
        <div className="io-public-frame io-public-error">
          <PublicBrand />
          <section className="io-public-card">
            <div className="io-public-eyebrow io-public-eyebrow-error">Frenzy error</div>
            <h1>Could not load Orb Frenzy</h1>
            <p>{error}</p>
          </section>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="io-public">
        <div className="io-public-grid" aria-hidden="true" />
        <div className="io-public-frame">
          <PublicBrand />
          <section className="io-public-card io-public-loading">
            <div className="io-public-loader" />
            <strong>Loading Orb Frenzy</strong>
            <span>Checking the current post state…</span>
          </section>
        </div>
      </main>
    );
  }

  const orb = getOrbInfo(info.rarity);
  const expiresAt = info.expiresAt || info.createdAt + FRENZY_POST_LIFETIME_MS;
  const expiresIn = Math.max(0, expiresAt - now);
  const totalExpirySeconds = Math.ceil(expiresIn / 1000);
  const expiryHours = Math.floor(totalExpirySeconds / 3600);
  const expiryMinutes = Math.floor((totalExpirySeconds % 3600) / 60);
  const expirySeconds = totalExpirySeconds % 60;
  const expiryLabel = expiresIn <= 0 ? 'EXPIRED' : expiryHours + ':' + String(expiryMinutes).padStart(2, '0') + ':' + String(expirySeconds).padStart(2, '0');
  const claimCooldownIn = Math.max(0, info.claimCooldownEndsAt - now);
  const claimTotalSeconds = Math.ceil(claimCooldownIn / 1000);
  const claimHours = Math.floor(claimTotalSeconds / 3600);
  const claimMinutes = Math.floor((claimTotalSeconds % 3600) / 60);
  const claimSeconds = claimTotalSeconds % 60;
  const claimCooldownLabel = claimCooldownIn > 0 ? claimHours + ':' + String(claimMinutes).padStart(2, '0') + ':' + String(claimSeconds).padStart(2, '0') : '';
  const canClaim = info.canClaim && !openedGame && expiresIn > 0 && claimCooldownIn <= 0;

  return (
    <main className="io-public">
      <div className="io-public-grid" aria-hidden="true" />
      <div
        className="io-public-glow"
        aria-hidden="true"
        style={{ background: 'radial-gradient(ellipse at center, ' + orb.color + '18, transparent 68%)' }}
      />

      <div className="io-public-frame">
        <PublicBrand />

        <section className="io-public-card io-frenzy-card">
          <div className="io-public-eyebrow io-public-eyebrow-frenzy">
            <Flame className="w-3.5 h-3.5" />
            Posted Frenzy
          </div>

          <div className="io-frenzy-copy">
            <p className="io-frenzy-lede">
              <strong>u/{info.ownerUsername}</strong> got a
            </p>

            <AnimatedRarity rarity={info.rarity} color={orb.color} />

            <div
              className="io-frenzy-orb-visual"
              aria-label={orb.name + ' orb'}
              style={{
                background: orb.bgGradient,
                borderColor: orb.color + '88',
                boxShadow: '0 0 28px ' + orb.color + '44, inset -12px -14px 22px rgba(0,0,0,.28), inset 10px 10px 18px rgba(255,255,255,.2)',
              }}
            >
              <div className="io-frenzy-orb-highlight" />
              <div className="io-frenzy-orb-core" style={{ background: orb.color }} />
            </div>

            <p className="io-frenzy-orb-label">orb in their Frenzy</p>
            <p className="io-frenzy-instruction">
              {info.consumed
                ? 'This Frenzy has already been claimed.'
                : info.expired
                  ? 'This Frenzy has expired.'
                  : 'Click below to claim it. You can only claim one every 23 hours.'}
            </p>
          </div>

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-center" style={{ borderColor: orb.color + '33' }}>
            <div className="text-[10px] uppercase tracking-widest font-black text-slate-500">Frenzy expires in</div>
            <div className="mt-1 text-2xl font-black tabular-nums" style={{ color: expiresIn > 0 ? orb.color : '#94a3b8' }}>{expiryLabel}</div>
          </div>

          <div className="io-frenzy-meta" style={{ borderColor: orb.color + '22' }}>
            <span>{orb.tier}</span>
            <span>{orb.name}</span>
          </div>

          {openedGame ? (
            <div className="io-public-result io-frenzy-opened">
              <div className="io-public-eyebrow io-public-eyebrow-success">Opening game</div>
              <strong>Your Frenzy is loading in Infinity Orbs.</strong>
              <p>The full claim result appears in the game.</p>
            </div>
          ) : (
            <button
              onClick={(event) => void claim(event)}
              disabled={!canClaim || loading}
              className="io-public-button io-public-button-primary io-frenzy-button"
              style={canClaim ? {
                borderColor: orb.color + '66',
                boxShadow: '0 10px 34px ' + orb.color + '18',
              } : undefined}
            >
              <ArrowRight className="w-4 h-4" />
              {loading
                ? 'Opening Game…'
                : info.consumed
                  ? 'Frenzy Already Claimed'
                  : info.selfClaimTest
                    ? 'Claim Your Frenzy · Test'
                    : claimed && claimCooldownIn > 0
                    ? 'Claim Cooldown · ' + claimCooldownLabel
                    : info.isOwner
                      ? 'Your Frenzy'
                      : expiresIn <= 0
                        ? 'Frenzy Expired'
                        : 'Claim Frenzy · Open Game'}
            </button>
          )}

          {error && <p className="io-public-inline-error">{error}</p>}

          <div className="io-public-note">
            <div><Users className="w-3.5 h-3.5" /> Claim cooldown: 23 hours per player.</div>
            <div><Flame className="w-3.5 h-3.5" /> Your Multi Roll multiplies the Frenzy size when you claim it.</div>
          </div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<FrenzyPost />);
