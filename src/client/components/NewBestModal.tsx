import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Crown, Sparkles, Share2, ArrowRight, Zap, Trophy, Star } from 'lucide-react';
import type { Orb } from '../../shared/game.js';
import { getOrbInfo, formatRarity } from '../../shared/game.js';
import { sound } from '../sound.js';

interface NewBestModalProps {
  orb: Orb;
  prevBest: number;
  onClose: () => void;
  onOpenShareModal: (rarity: number) => void;
}

export const NewBestModal: React.FC<NewBestModalProps> = ({
  orb,
  prevBest,
  onClose,
  onOpenShareModal,
}) => {
  const orbInfo = getOrbInfo(orb.rarity);
  const isMinorDiscovery = orb.rarity < 100;

  useEffect(() => {
    if (isMinorDiscovery) {
      sound.playChime(587.33, 'sine', 0.25);
      return;
    }

    sound.playNewBestFanfare();

    // Multi-stage confetti celebration for major discoveries (1/100+)
    const count = 200;
    const defaults = {
      origin: { y: 0.7 },
      colors: ['#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#ffffff'],
    };

    function fire(particleRatio: number, opts: confetti.Options) {
      confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio),
      });
    }

    fire(0.25, {
      spread: 26,
      startVelocity: 55,
    });
    fire(0.2, {
      spread: 60,
    });
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.8,
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2,
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 45,
    });

    // Side cannons after 300ms
    const timer = setTimeout(() => {
      confetti({
        particleCount: 50,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#fbbf24', '#f43f5e', '#a855f7'],
      });
      confetti({
        particleCount: 50,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#38bdf8', '#34d399', '#f59e0b'],
      });
    }, 350);

    return () => clearTimeout(timer);
  }, [orb, isMinorDiscovery]);

  const multiplier = prevBest > 0 ? (orb.rarity / prevBest).toFixed(1) : '∞';

  // Less flashy, compact card for small early discoveries (< 1/100)
  if (isMinorDiscovery) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="relative z-10 w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-xl text-center space-y-4 animate-in zoom-in-95 duration-200">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold">
            <Star className="w-3.5 h-3.5 text-amber-400" />
            <span>NEW PERSONAL BEST</span>
          </div>

          <div className="py-2 flex items-center justify-center">
            <div
              className="w-20 h-20 rounded-full flex flex-col items-center justify-center shadow-lg relative border border-white/20"
              style={{ background: orbInfo.bgGradient }}
            >
              <span className="text-[9px] font-bold uppercase text-white/80">
                {orbInfo.tier}
              </span>
              <div className="text-sm font-black text-white font-mono">
                1 / {formatRarity(orb.rarity)}
              </div>
              <div className="text-[10px] text-white/90">
                {orbInfo.name}
              </div>
            </div>
          </div>

          <div className="text-xs text-slate-400">
            {prevBest > 0 ? (
              <span>You beat your previous record by {multiplier}×.</span>
            ) : (
              <span>Your first record is on the board.</span>
            )}
          </div>

          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-colors cursor-pointer"
          >
            Continue Rolling
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-300">
      {/* Background Rotating Sunburst Rays */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        <div
          className="w-[800px] h-[800px] rounded-full opacity-25 animate-ray-spin"
          style={{
            background: `conic-gradient(from 0deg at 50% 50%, ${orbInfo.color} 0deg, transparent 30deg, ${orbInfo.color} 60deg, transparent 90deg, ${orbInfo.color} 120deg, transparent 150deg, ${orbInfo.color} 180deg, transparent 210deg, ${orbInfo.color} 240deg, transparent 270deg, ${orbInfo.color} 300deg, transparent 330deg, ${orbInfo.color} 360deg)`,
          }}
        />
        <div
          className="absolute w-96 h-96 rounded-full blur-3xl opacity-40 animate-pulse-glow"
          style={{ backgroundColor: orbInfo.color }}
        />
      </div>

      {/* Main Record Card */}
      <div className="relative z-10 w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-2 border-amber-400/60 rounded-3xl p-6 sm:p-8 shadow-[0_0_80px_rgba(251,191,36,0.35)] text-center space-y-6 animate-in zoom-in-95 duration-400">
        {/* Crown & Title */}
        <div className="space-y-1.5">
          <div className="inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-300 text-xs font-black tracking-widest uppercase shadow-md animate-bounce">
            <Crown className="w-4 h-4 text-amber-300" />
            <span>NEW PERSONAL BEST!</span>
            <Crown className="w-4 h-4 text-amber-300" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-400 drop-shadow-sm">
            YOU BEAT YOUR RECORD!
          </h2>
        </div>

        {/* Central Orb Display */}
        <div className="relative py-4 flex items-center justify-center">
          {/* Pulsing Aura Rings */}
          <div
            className="absolute w-44 h-44 rounded-full animate-ping opacity-30 pointer-events-none"
            style={{ backgroundColor: orbInfo.color }}
          />
          <div
            className="w-36 h-36 sm:w-40 sm:h-40 rounded-full flex flex-col items-center justify-center shadow-2xl relative transition-transform duration-500 hover:scale-105"
            style={{
              background: orbInfo.bgGradient,
              boxShadow: `0 0 50px ${orbInfo.color}66`,
            }}
          >
            <div className="absolute inset-2 rounded-full border border-white/30" />
            <span
              className="text-[10px] font-black uppercase tracking-widest drop-shadow block"
              style={{ color: orbInfo.color }}
            >
              {orbInfo.tier}
            </span>
            <div className="text-xl sm:text-2xl font-black text-white font-mono drop-shadow-md">
              1 / {formatRarity(orb.rarity)}
            </div>
            <div className="text-xs font-bold text-white/90 drop-shadow mt-0.5">
              {orbInfo.name}
            </div>
          </div>
        </div>

        {/* Comparison Stats */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Previous Record:</span>
            <span className="font-mono font-bold text-slate-300">
              {prevBest > 0 ? `1 / ${formatRarity(prevBest)}` : 'None'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm font-bold text-emerald-400 border-t border-slate-800/80 pt-2">
            <span className="flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>Record Jump:</span>
            </span>
            <span className="font-mono text-base font-black text-amber-300">
              {multiplier !== '∞' ? `${multiplier}× Higher!` : 'First Roll!'}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={() => {
              onClose();
              onOpenShareModal(orb.rarity);
            }}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-orange-600 via-amber-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-950/50 transition-all active:scale-95 cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>Share This Record</span>
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-950/50 transition-all active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Keep Rolling</span>
          </button>
        </div>
      </div>
    </div>
  );
};
