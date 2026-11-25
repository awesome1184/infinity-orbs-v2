import React, { useRef, useState } from 'react';
import { ArrowBigUp, ArrowRight, CheckCircle2, MessageSquare, Share2, X } from 'lucide-react';
import type { PlayerState } from '../../shared/game.js';
import { formatNumber, formatRarity, getOrbInfo } from '../../shared/game.js';
import { sound } from '../sound.js';

interface RedditShareModalProps {
  rarity: number;
  isInfinity?: boolean;
  state: PlayerState;
  onClose: () => void;
  onShare: (rarity: number, isInfinity?: boolean) => Promise<{ success: boolean; id?: string }>;
}

export const RedditShareModal: React.FC<RedditShareModalProps> = ({
  rarity,
  isInfinity = false,
  state,
  onClose,
  onShare,
}) => {
  const [busy, setBusy] = useState(false);
  const shareLockRef = useRef(false);
  const [successPostId, setSuccessPostId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const info = getOrbInfo(rarity, isInfinity);

  const handleShare = async () => {
    if (busy || shareLockRef.current) return;
    shareLockRef.current = true;
    setBusy(true);
    setErrorMessage(null);
    sound.playClick();
    try {
      const res = await onShare(rarity, isInfinity);
      if (res.success) {
        sound.playEpicFanfare();
        setSuccessPostId(res.id ?? 'post-shared');
      } else {
        setErrorMessage('Reddit did not confirm that the post was created. Please try again.');
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Could not create the Reddit post. Please try again.',
      );
    } finally {
      shareLockRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div
      className="io-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      onMouseDown={event => {
        if (!busy && event.target === event.currentTarget) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && !busy) onClose();
      }}
    >
      <div role="dialog" aria-modal="true"
        aria-labelledby="io-share-dialog-title"
        aria-describedby="io-share-dialog-description io-share-status"
        aria-busy={busy}
        className="io-modal-card bg-slate-900 text-slate-100 relative w-full max-w-xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain"
      >
        <button type="button" onClick={onClose} disabled={busy} className="io-modal-close disabled:opacity-40 disabled:cursor-not-allowed" aria-label="Close share dialog" title={busy?'Wait for Reddit to confirm the post before closing':'Close share dialog'}>
          <X className="w-4 h-4" />
        </button>

        <div className="io-modal-heading">
          <div className="io-public-brand-mark io-modal-mark" aria-hidden="true"><span>∞</span></div>
          <div>
            <div className="io-public-eyebrow">
              <Share2 className="w-3.5 h-3.5" />
              Share discovery
            </div>
            <h3 id="io-share-dialog-title">Post this Orb to Reddit</h3>
          </div>
        </div>

        <p id="io-share-dialog-description" className="io-modal-intro">
          Preview your discovery, then choose Post to Reddit to create a community post. Nothing is posted until you confirm.
        </p>
        <p id="io-share-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {busy ? 'Posting your Orb to Reddit. Keep this dialog open until the request finishes.' : successPostId ? 'Your Orb post was created successfully.' : ''}
        </p>

        {errorMessage && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
          >
            {errorMessage}
          </p>
        )}

        <div className="io-share-preview" role="group" aria-label="Preview of the Reddit discovery post">
          <div className="io-share-preview-head">
            <div>
              <span>r/infinityorbs</span>
              <small>Preview by u/you · just now</small>
            </div>
            <span
              className="io-public-tier"
              style={{
                color: info.color,
                borderColor: `${info.color}55`,
                backgroundColor: `${info.color}10`,
              }}
            >
              {info.tier}
            </span>
          </div>

          <h4>u/you found a 1/{formatRarity(rarity, isInfinity)} Orb</h4>

          <div className="io-share-preview-orb">
            <div
              role="img"
              aria-label={`${info.name}, ${info.tier} Orb, odds one in ${formatRarity(rarity, isInfinity)}`}
              className="io-public-orb io-share-preview-orb-mark"
              style={{
                background: info.bgGradient,
                borderColor: `${info.color}66`,
                boxShadow: `0 0 30px ${info.color}22, inset 0 1px rgba(255,255,255,.3)`,
              }}
            >
              <span className="io-public-orb-ring" aria-hidden="true" />
              <span className="io-public-orb-tier">{info.tier}</span>
              <strong>1/{formatRarity(rarity, isInfinity)}</strong>
              <small>{info.name}</small>
            </div>
            <div>
              <strong>{info.name}</strong>
              <p>Odds: 1 in {formatRarity(rarity, isInfinity)}</p>
              <p>Roll #{formatNumber(state.totalRolls)}</p>
            </div>
          </div>

          <div className="io-share-preview-stats">
            <span><b>{formatNumber(state.totalRolls)}</b> rolls</span>
            <span><b>{formatNumber(state.collectionValue)}</b> collection value</span>
          </div>

          <div className="io-share-preview-actions" role="group" aria-label="Reddit voting and comments preview">
            <span><ArrowBigUp className="w-4 h-4" /> Vote</span>
            <span><MessageSquare className="w-4 h-4" /> Comments</span>
          </div>
        </div>

        {successPostId ? (
          <div className="io-modal-success" role="status" aria-live="polite" aria-atomic="true">
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            <div>
              <strong>Shared to r/infinityorbs</strong>
              <span>The discovery post is ready for other players.</span>
            </div>
          </div>
        ) : (
          <div className="io-modal-actions">
            <button type="button" onClick={onClose} disabled={busy} className="io-public-button io-public-button-secondary disabled:opacity-40">Cancel</button>
            <button type="button" onClick={handleShare} disabled={busy} aria-busy={busy} aria-label={busy ? 'Posting discovery to Reddit' : 'Post discovery to Reddit'} className="io-public-button io-public-button-primary">
              <Share2 className="w-4 h-4" />
              {busy ? 'Posting…' : 'Post to Reddit'}
              {!busy && <ArrowRight className="w-4 h-4" />}
            </button>
          </div>
        )}

        {successPostId && (
          <button type="button" onClick={onClose} className="io-public-button io-public-button-secondary io-modal-close-button" aria-label="Close share confirmation">
            Close
          </button>
        )}
      </div>
    </div>
  );
};
