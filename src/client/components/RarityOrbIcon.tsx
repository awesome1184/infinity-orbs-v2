import React from 'react';
import { getOrbInfo } from '../../shared/game.js';

interface RarityOrbIconProps {
  rarity: number;
  unlocked: boolean;
  compact?: boolean;
}

/** A shared, color-accurate orb badge for Codex and rarity-table milestones. */
export const RarityOrbIcon: React.FC<RarityOrbIconProps> = ({ rarity, unlocked, compact = false }) => {
  const info = getOrbInfo(rarity);
  return (
    <span
      aria-hidden="true"
      className={`io-rarity-orb-icon ${unlocked ? 'is-unlocked' : 'is-locked'} ${compact ? 'io-rarity-orb-icon--compact' : ''} ${info.animated ? 'io-rarity-color-cycle' : ''}`}
      style={{
        '--io-rarity-orb-color': info.color,
        '--io-rarity-orb-gradient': info.bgGradient,
      } as React.CSSProperties}
    >
      <span className="io-rarity-orb-icon__glint" />
      <span className="io-rarity-orb-icon__shine" />
    </span>
  );
};
