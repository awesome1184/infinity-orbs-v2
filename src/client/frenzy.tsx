import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { requestExpandedMode } from '@devvit/web/client';
import { ArrowRight, Flame, Users } from 'lucide-react';
import './styles.css';
import { formatRarity, getOrbInfo } from '../shared/game.js';

interface FrenzyInfo {
  rarity: number;
  ownerUsername: string;
  createdAt: number;
  claimedToday: boolean;
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
    let frame = 0;
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
    return () => window.cancelAnimationFrame(frame);
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

  const claim = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!info?.canClaim || loading) return;
    setLoading(true);
    setError(null);

    const claimRequest = fetch('/api/frenzy/claim', { method: 'POST' });

    try {
      requestExpandedMode(event.nativeEvent, 'game');
      setOpenedGame(true);
      void claimRequest.catch(() => null);
      return;
    } catch {
      // Some previews cannot expand. Finish the claim on this screen instead.
    }

    try {
      const res = await claimRequest;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not claim Frenzy.');
      setClaimed(true);
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
  const canClaim = info.canClaim && !claimed && !openedGame;

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

            <p className="io-frenzy-ball-label">ball in their Frenzy</p>
            <p className="io-frenzy-instruction">
              Click below to claim it. You can only claim one a day.
            </p>
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
                : claimed
                  ? 'Already Claimed Today'
                  : info.selfClaimTest
                    ? 'Claim Your Frenzy · Test'
                    : info.isOwner
                      ? 'Your Frenzy'
                      : 'Claim Frenzy · Open Game'}
            </button>
          )}

          {error && <p className="io-public-inline-error">{error}</p>}

          <div className="io-public-note">
            <div><Users className="w-3.5 h-3.5" /> One Frenzy claim per player, per day.</div>
            <div><Flame className="w-3.5 h-3.5" /> Your Multi Roll multiplies the Frenzy size when you claim it.</div>
            <div><Flame className="w-3.5 h-3.5" /> When someone claims this Frenzy, u/{info.ownerUsername} gets +5 Shards.</div>
            <div><Flame className="w-3.5 h-3.5" /> That +5 Shard reward bypasses the 50 Shard daily cap.</div>
            {info.selfClaimTest && <div><Users className="w-3.5 h-3.5" /> Self-claim is enabled for admin testing.</div>}
          </div>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<FrenzyPost />);
