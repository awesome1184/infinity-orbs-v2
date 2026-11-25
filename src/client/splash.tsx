import { requestExpandedMode, context } from '@devvit/web/client';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { ArrowRight, BookOpen, Orbit, Share2, Trophy } from 'lucide-react';
import { getOrbInfo, formatNumber, formatRarity, MAX_ORB_RARITY } from '../shared/game.js';
import { recordPostImpression, recordMainGamePostConversion, type ImpressionPostType } from './impressions.js';
import './styles.css';
import './post-revamp.css';

type SharedOrbPostData = {
  type?: string;
  rarity?: number;
  isInfinity?: boolean;
  username?: string;
  totalRolls?: number;
  collectionValue?: number;
};

function BrandMark() {
  return (
    <div className="io-public-brand-mark" aria-hidden="true">
      <span>∞</span>
    </div>
  );
}

function PlayGameButton({
  label = 'Play Infinity Orbs',
  className = 'io-public-button io-public-button-primary',
  leadingIcon,
  trackMainGameConversion = false,
}: {
  label?: string;
  className?: string;
  leadingIcon?: ReactNode;
  trackMainGameConversion?: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const openGame = (e: MouseEvent<HTMLButtonElement>) => {
    if (opening) return;
    setOpening(true);
    setError('');
    const trackConversion = () => {
      if (trackMainGameConversion) recordMainGamePostConversion(context.postId);
    };
    const failed = () => {
      setError("Reddit couldn't open the game from this preview. Try reloading the post and opening it again.");
      setOpening(false);
    };
    try {
      // This API must be invoked synchronously inside the trusted click turn.
      const request = requestExpandedMode(e.nativeEvent, 'game');
      trackConversion();
      void Promise.resolve(request).catch(failed);
    } catch {
      trackConversion();
      failed();
    }
  };
  return (
    <>
      <button type="button" className={`${className} io-post-cta`} onClick={openGame} disabled={opening} aria-busy={opening}>
        {opening ? 'Opening Infinity Orbs…' : <>{leadingIcon}{label}<ArrowRight className="w-4 h-4" /></>}
      </button>
      {error && <p className="io-public-inline-error" role="alert" aria-live="assertive">{error}</p>}
    </>
  );
}

function PublicShell({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <main className={`io-public ${compact ? 'io-public-compact' : ''}`}>
      <div className="io-public-grid" aria-hidden="true" />
      <div className="io-public-glow" aria-hidden="true" />
      <div className="io-public-frame">
        <div className="io-public-brand">
          <BrandMark />
          <div>
            <div className="io-public-brand-title">Infinity Orbs</div>
            <div className="io-public-brand-subtitle">ROLL · COLLECT · GO FURTHER</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

function SharedOrbPost({ data, playedBefore }: { data: SharedOrbPostData; playedBefore: boolean | null }) {
  const rarity = Number.isInteger(data.rarity) && Number(data.rarity) > 0 && Number(data.rarity) <= MAX_ORB_RARITY
    ? Number(data.rarity)
    : 0;
  const isInfinity = data.isInfinity === true && rarity === MAX_ORB_RARITY;
  const info = rarity > 0 ? getOrbInfo(rarity, isInfinity) : null;
  const rawUsername = String(data.username ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^u\//i, '');
  const username = rawUsername.slice(0, 25) || 'a player';
  const safeMetadataCount = (value: unknown) => {
    const count = typeof value === 'number' ? value : Number(value ?? 0);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  };
  const totalRolls = safeMetadataCount(data.totalRolls);
  const collectionValue = safeMetadataCount(data.collectionValue);

  if (!info) return null;

  return (
    <PublicShell compact>
      <section className="io-public-card io-share-card io-post-reveal">
        <div className="io-public-eyebrow">
          <Share2 className="w-3.5 h-3.5" />
          Community discovery
        </div>

        <div className="io-share-heading">
          <div>
            <h1><span>u/{username}</span> found an Orb</h1>
            <p>{playedBefore === true ? 'Your Codex is saved. Roll again and chase something rarer.' : playedBefore === false ? 'One roll. One discovery. Logged to the Codex.' : 'A rare find could be one roll away.'}</p>
          </div>
          <div
            className="io-public-tier"
            style={{
              color: info.color,
              borderColor: `${info.color}55`,
              backgroundColor: `${info.color}10`,
            }}
          >
            {info.tier}
          </div>
        </div>

        <div className="io-share-orb-row">
          <div
            className="io-public-orb io-share-orb"
            style={{
              background: info.bgGradient,
              borderColor: `${info.color}66`,
              boxShadow: `0 0 16px ${info.color}18, inset 0 1px rgba(255,255,255,.22)`,
            }}
            aria-label={`1/${formatRarity(rarity, isInfinity)} ${info.tier} Orb`}
          >
            <span className="io-public-orb-ring io-public-orb-ring-secondary" aria-hidden="true" />
            <span className="io-public-orb-ring io-public-orb-ring-tertiary" aria-hidden="true" />
            <span className="io-share-orb-spark io-share-orb-spark-a" aria-hidden="true" />
            <span className="io-share-orb-spark io-share-orb-spark-b" aria-hidden="true" />
            <span className="io-share-orb-spark io-share-orb-spark-c" aria-hidden="true" />
            <span className="io-public-orb-ring" />
            <span className="io-public-orb-tier">{info.tier}</span>
            <strong>1/{formatRarity(rarity, isInfinity)}</strong>
            <small>{info.name}</small>
          </div>

          <div className="io-share-copy">
            <div className="io-public-rarity">1/{formatRarity(rarity, isInfinity)}</div>
            <div className="io-public-name" style={{ color: info.color }}>{info.name}</div>
            <p>The orb's rarity is its denominator. Higher numbers mean a rarer find.</p>
          </div>
        </div>

        <div className="io-public-stats">
          <div>
            <span>ROLL</span>
            <strong>#{formatNumber(totalRolls)}</strong>
          </div>
          <div>
            <span>COLLECTION VALUE</span>
            <strong>{formatNumber(collectionValue)}</strong>
          </div>
          <div>
            <span>TIER</span>
            <strong>{info.tier}</strong>
          </div>
        </div>

        <div className="io-public-actions io-post-conversion">
          <div className="io-cta-caption"><span aria-hidden="true" /> {playedBefore === true ? 'YOUR NEXT DISCOVERY IS WAITING' : playedBefore === false ? 'YOUR CODEX STARTS WITH ONE ROLL' : 'ONE TAP TO YOUR NEXT ORB'}</div>
          <PlayGameButton
            className="io-public-button io-public-button-primary"
            leadingIcon={<Orbit className="w-4 h-4" />}
            label={playedBefore === true ? 'Find a rarer Orb' : playedBefore === false ? 'Play Infinity Orbs' : 'Open Infinity Orbs'}
          />
          <p className="io-cta-footnote">Free to play. Tap in and chase your own impossible Orb.</p>
        </div>
      </section>
    </PublicShell>
  );
}

function Splash() {
  const [playedBefore, setPlayedBefore] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void fetch('/api/player/experience', { cache: 'no-store' })
      .then(response => response.ok ? response.json() as Promise<{ playedBefore?: unknown }> : null)
      .then(result => { if (active && typeof result?.playedBefore === 'boolean') setPlayedBefore(result.playedBefore); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const postData = (context.postData ?? {}) as SharedOrbPostData;
  const impressionPostType: ImpressionPostType = postData.type === 'shared-orb' ? 'orb-share' : 'main-game';
  const impressionRecordedRef = useRef(false);

  useEffect(() => {
    if (impressionRecordedRef.current) return;
    impressionRecordedRef.current = true;
    void recordPostImpression(impressionPostType, context.postId);
  }, [impressionPostType]);

  if (postData.type === 'shared-orb') {
    if (
      Number.isInteger(postData.rarity) &&
      Number(postData.rarity) > 0 &&
      Number(postData.rarity) <= MAX_ORB_RARITY
    ) {
      return <SharedOrbPost data={postData} playedBefore={playedBefore} />;
    }
    // Bad metadata should not masquerade as a normal main-game post.
    return (
      <PublicShell compact>
        <section className="io-public-card io-share-card io-post-reveal">
          <div className="io-public-eyebrow">Community discovery</div>
          <h1>Orb preview unavailable</h1>
          <p>This shared Orb has missing or outdated post data. You can still open Infinity Orbs and keep rolling.</p>
          <PlayGameButton label={playedBefore === true ? 'Continue playing' : playedBefore === false ? 'Play Infinity Orbs' : 'Open Infinity Orbs'} />
        </section>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <section className="io-public-card io-launch-card io-post-reveal">
        <div className="io-launch-kicker">A REDDIT-NATIVE RNG GAME</div>

        <div className="io-launch-title-row">
          <div>
            <h1>{playedBefore === true ? 'Your next impossible Orb is waiting.' : 'Find the next impossible Orb.'}</h1>
            <p>{playedBefore === true ? 'Pick up where you left off: chase a rarer Orb, beat your best, and keep your Codex growing.' : 'Roll for rarity, spend Coins on upgrades, and build a Codex of increasingly absurd discoveries.'}</p>
          </div>
          <div className="io-launch-mark" aria-hidden="true">
            <span>∞</span>
          </div>
        </div>

        <div className="io-launch-orb-stage" aria-hidden="true">
          <div className="io-launch-orb-aura" />
          <span className="io-launch-orb-vortex io-launch-orb-vortex-a" />
          <span className="io-launch-orb-vortex io-launch-orb-vortex-b" />
          <span className="io-launch-orb-ring io-launch-orb-ring-a" />
          <span className="io-launch-orb-ring io-launch-orb-ring-b" />
          <span className="io-launch-orb-ring io-launch-orb-ring-c" />
          <span className="io-launch-orb-spark io-launch-orb-spark-a" />
          <span className="io-launch-orb-spark io-launch-orb-spark-b" />
          <span className="io-launch-orb-spark io-launch-orb-spark-c" />
          <span className="io-launch-orb-spark io-launch-orb-spark-d" />
          <div className="io-launch-orb-sphere">
            <span className="io-launch-orb-sphere-shine" />
            <span>∞</span>
          </div>
        </div>

        <div className="io-launch-steps">
          <div>
            <span className="io-step-index">01</span>
            <BookOpen className="w-4 h-4" />
            <div>
              <strong>ROLL</strong>
              <span>Chase better numbers.</span>
            </div>
          </div>
          <div>
            <span className="io-step-index">02</span>
            <Trophy className="w-4 h-4" />
            <div>
              <strong>COLLECT</strong>
              <span>Build your Codex.</span>
            </div>
          </div>
          <div>
            <span className="io-step-index">03</span>
            <ArrowRight className="w-4 h-4" />
            <div>
              <strong>GO FURTHER</strong>
              <span>Push the next roll.</span>
            </div>
          </div>
        </div>

        <div className="io-launch-footer">
          <span>Persistent Reddit save</span>
          <span>·</span>
          <span>Server-authoritative rolls</span>
          <span>·</span>
          <span>v{context.appVersion ?? 'unknown'}</span>
        </div>

        <div className="io-post-conversion io-main-cta">
          <div className="io-cta-caption"><span aria-hidden="true" /> {playedBefore === true ? 'YOUR NEXT RECORD IS ONE TAP AWAY' : playedBefore === false ? 'YOUR FIRST ORB IS ONE TAP AWAY' : 'YOUR NEXT ORB IS ONE TAP AWAY'}</div>
          <PlayGameButton className="io-public-button io-public-button-primary io-launch-button" label={playedBefore === true ? 'Continue playing' : playedBefore === false ? 'Play Infinity Orbs' : 'Open Infinity Orbs'} trackMainGameConversion />
          <p className="io-cta-footnote">{playedBefore === true ? 'Your Codex and upgrades are saved on Reddit' : 'Free to play · No download · Your progress saves on Reddit'}</p>
        </div>
      </section>
    </PublicShell>
  );
}

createRoot(document.getElementById('root')!).render(<Splash />);
