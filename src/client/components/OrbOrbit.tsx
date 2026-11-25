import React, { useEffect, useState } from 'react';
import type { Orb } from '../../shared/game.js';
import { getOrbInfo } from '../../shared/game.js';

interface Props {
  orbs: Orb[];
  radius?: number;
  primaryOrb?: Orb | null;
}

function isMobileViewport(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 760px)').matches;
}

export function OrbOrbit({ orbs, radius = 152, primaryOrb }: Props) {
  const [isMobile, setIsMobile] = useState(isMobileViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 760px)');
    const syncViewport = (event?: MediaQueryListEvent) => setIsMobile(event?.matches ?? media.matches);
    syncViewport();
    media.addEventListener?.('change', syncViewport);
    return () => media.removeEventListener?.('change', syncViewport);
  }, []);

  // The large centerpiece already displays the best Orb from this batch. Remove
  // one matching batch entry before previewing companions to avoid duplicating it.
  const primaryIndex = primaryOrb
    ? orbs.findIndex(orb =>
        orb.rarity === primaryOrb.rarity &&
        (orb.isInfinity === true) === (primaryOrb.isInfinity === true) &&
        orb.name === primaryOrb.name
      )
    : -1;
  // The centerpiece is the best result, so only its companion multiballs orbit it.
  const companionOrbs = primaryIndex >= 0
    ? orbs.filter((_orb, index) => index !== primaryIndex)
    : orbs;
  const visibleOrbs = isMobile ? companionOrbs.slice(0, 2) : companionOrbs.slice(0, 7);
  const orbitRadius = isMobile ? Math.min(radius, 104) : radius;

  if (visibleOrbs.length === 0) return null;

  return (
    <div aria-hidden="true" className="io-orbit-layer absolute inset-0 flex items-center justify-center pointer-events-none">
      <div
        className="io-orbit-track absolute rounded-full border border-dashed border-slate-700/50"
        style={{ width: orbitRadius * 2, height: orbitRadius * 2 }}
      />
      <div className="relative w-0 h-0 animate-orbit-ring">
        {visibleOrbs.map((orb, index) => {
          const angle = (index / visibleOrbs.length) * Math.PI * 2 - Math.PI / 2;
          const info = getOrbInfo(orb.rarity, orb.isInfinity);
          return (
            <div
              key={orb.rarity + ':' + (orb.isInfinity ? 1 : 0) + ':' + index}
              className="io-orbit-satellite absolute -translate-x-1/2 -translate-y-1/2"
              style={{
                left: Math.cos(angle) * orbitRadius,
                top: Math.sin(angle) * orbitRadius,
              }}
            >
              <span className={`io-orbit-satellite-core animate-orbit-counter ${info.animated ? 'io-rarity-color-cycle' : ''}`} style={{ background: info.bgGradient, borderColor: info.color }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
