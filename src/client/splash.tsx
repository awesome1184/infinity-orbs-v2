import { requestExpandedMode, context } from '@devvit/web/client';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { ArrowRight, BookOpen, Orbit, Share2, Trophy } from 'lucide-react';
import { getOrbInfo, formatNumber, formatRarity } from '../shared/game.js';
import './styles.css';

type SharedOrbPostData = {
  type?: string;
  rarity?: number;
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

function SharedOrbPost({ data }: { data: SharedOrbPostData }) {
  const rarity = Number.isInteger(data.rarity) && Number(data.rarity) > 0 ? Number(data.rarity) : 0;
  const info = rarity > 0 ? getOrbInfo(rarity) : null;
  const username = String(data.username ?? '').trim().replace(/^u\//i, '') || 'a player';
  const totalRolls = Math.max(0, Math.floor(Number(data.totalRolls ?? 0)));
  const collectionValue = Math.max(0, Math.floor(Number(data.collectionValue ?? 0)));

  if (!info) return null;

  return (
    <PublicShell compact>
      <section className="io-public-card io-share-card">
        <div className="io-public-eyebrow">
          <Share2 className="w-3.5 h-3.5" />
          Community discovery
        </div>

        <div className="io-share-heading">
          <div>
            <h1><span>u/{username}</span> found an Orb</h1>
            <p>One roll. One discovery. Logged to the Codex.</p>
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
              boxShadow: `0 0 34px ${info.color}22, inset 0 1px rgba(255,255,255,.32)`,
            }}
            aria-label={`1/${formatRarity(rarity)} ${info.tier} Orb`}
          >
            <span className="io-public-orb-ring" />
            <span className="io-public-orb-tier">{info.tier}</span>
            <strong>1/{formatRarity(rarity)}</strong>
            <small>{info.name}</small>
          </div>

          <div className="io-share-copy">
            <div className="io-public-rarity">1/{formatRarity(rarity)}</div>
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

        <div className="io-public-actions">
          <button
            className="io-public-button io-public-button-primary"
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
          >
            <Orbit className="w-4 h-4" />
            Play Infinity Orbs
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>
    </PublicShell>
  );
}

function Splash() {
  const postData = (context.postData ?? {}) as SharedOrbPostData;

  if (postData.type === 'shared-orb' && Number(postData.rarity) > 0) {
    return <SharedOrbPost data={postData} />;
  }

  return (
    <PublicShell>
      <section className="io-public-card io-launch-card">
        <div className="io-launch-kicker">A REDDIT-NATIVE RNG GAME</div>

        <div className="io-launch-title-row">
          <div>
            <h1>Find the next impossible Orb.</h1>
            <p>Roll for rarity, spend Coins on upgrades, and build a Codex of increasingly absurd discoveries.</p>
          </div>
          <div className="io-launch-mark" aria-hidden="true">
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

        <button
          className="io-public-button io-public-button-primary io-launch-button"
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          Play Infinity Orbs
          <ArrowRight className="w-4 h-4" />
        </button>

        <div className="io-launch-footer">
          <span>Persistent Reddit save</span>
          <span>·</span>
          <span>Server-authoritative rolls</span>
          <span>·</span>
          <span>v{context.appVersion ?? 'unknown'}</span>
        </div>
      </section>
    </PublicShell>
  );
}

createRoot(document.getElementById('root')!).render(<Splash />);
