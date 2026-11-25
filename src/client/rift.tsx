import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { context, requestExpandedMode } from '@devvit/web/client';
import { ArrowRight, CheckCircle2, Clock3, Gamepad2, Heart, LockKeyhole, Sparkles, Trophy } from 'lucide-react';
import './styles.css';
import './post-revamp.css';
import './rift-post.css';

interface RiftCompletionInfo {
  postId: string;
  ownerUsername: string;
  challengeId: string;
  challengeName: string;
  createdAt: number;
  kudosExpiresAt: number;
  expired: boolean;
  isOwner: boolean;
  alreadyKudosed: boolean;
  canKudos: boolean;
}

interface KudosResult {
  alreadyKudosed: boolean;
  shardsGrantedToYou: number;
  shardsGrantedToOwner: number;
  progressMinutesGranted: number;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'The Rift post request failed.');
  }
  return payload as T;
}

function formatRemaining(milliseconds: number): string {
  const minutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours > 0) return hours + 'h ' + remainder + 'm';
  return minutes + 'm';
}

function RiftCompletionPost() {
  const [info, setInfo] = useState<RiftCompletionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reward, setReward] = useState<KudosResult | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let active = true;
    void fetch('/api/rift-completion/info', { cache: 'no-store' })
      .then(readJson<RiftCompletionInfo>)
      .then(result => { if (active) setInfo(result); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load the Rift completion details.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const sendKudos = async () => {
    if (!info?.canKudos || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await readJson<KudosResult>(await fetch('/api/rift-completion/kudos', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: context.postId }),
      }));
      setReward(result);
      setInfo(current => current ? { ...current, alreadyKudosed: true, canKudos: false } : current);
      setNotice(result.alreadyKudosed
        ? 'You have already sent Kudos for this first clear.'
        : 'Kudos delivered. Both Shard rewards and the Rift progress bonus have been applied.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send Kudos.');
    } finally {
      setBusy(false);
    }
  };

  const openGame = (event: React.MouseEvent<HTMLButtonElement>) => {
    setError('');
    void Promise.resolve(requestExpandedMode(event.nativeEvent, 'game')).catch(reason => {
      setError(reason instanceof Error ? reason.message : 'Could not open Infinity Orbs.');
    });
  };

  const expired = info ? info.expired || now >= info.kudosExpiresAt : false;
  const remaining = info ? Math.max(0, info.kudosExpiresAt - now) : 0;

  return (
    <main className="io-rift-post-wrap">
      <article className="io-rift-post-card">
        <div className="io-rift-post-glow" aria-hidden="true" />
        <div className="io-rift-post-header">
          <span className="io-rift-post-eyebrow"><Sparkles size={13} /> INFINITY ORBS · RIFT RECORD</span>
          <span className="io-rift-post-chip"><Trophy size={12} /> FIRST CLEAR</span>
        </div>

        <div className="io-rift-post-stage" aria-hidden="true">
          <div className="io-rift-post-orbit io-rift-post-orbit-a" />
          <div className="io-rift-post-orbit io-rift-post-orbit-b" />
          <div className="io-rift-post-orbit io-rift-post-orbit-c" />
          <div className="io-rift-post-core"><Trophy size={38} strokeWidth={1.6} /></div>
          <Sparkles className="io-rift-post-spark io-rift-post-spark-a" size={17} />
          <Sparkles className="io-rift-post-spark io-rift-post-spark-b" size={12} />
          <Sparkles className="io-rift-post-spark io-rift-post-spark-c" size={14} />
        </div>

        <div className="io-rift-post-copy">
          <div className="io-rift-post-overline">A new record has been written</div>
          {loading ? (
            <>
              <div className="io-rift-post-title">The Rift is recording a first clear…</div>
              <p className="io-rift-post-description">Synchronizing challenge details.</p>
            </>
          ) : info ? (
            <>
              <h1 className="io-rift-post-title">u/{info.ownerUsername} has completed the rift {info.challengeName} for the first time!</h1>
              <p className="io-rift-post-description">
                A permanent first clear. The Rift remembers. The rest of the leaderboard has been given something to think about.
              </p>
              <div className="io-rift-post-meta">
                <span><Trophy size={13} /> {info.challengeName}</span>
                <span><Clock3 size={13} /> {new Date(info.createdAt).toLocaleDateString()}</span>
              </div>
            </>
          ) : (
            <>
              <div className="io-rift-post-title">A Rift first clear</div>
              <p className="io-rift-post-description">The full announcement details are unavailable, but the game is still waiting.</p>
            </>
          )}
        </div>

        <div className="io-rift-post-rewards">
          <div className="io-rift-post-reward">
            <span className="io-rift-post-reward-value">+10</span>
            <span className="io-rift-post-reward-label">Shards for you</span>
          </div>
          <div className="io-rift-post-reward-divider" />
          <div className="io-rift-post-reward">
            <span className="io-rift-post-reward-value">+10</span>
            <span className="io-rift-post-reward-label">Shards for them</span>
          </div>
          <div className="io-rift-post-reward-divider" />
          <div className="io-rift-post-reward">
            <span className="io-rift-post-reward-value">+1 min</span>
            <span className="io-rift-post-reward-label">Their Rift progress</span>
          </div>
        </div>

        {reward && !reward.alreadyKudosed && (
          <div className="io-rift-post-success" role="status">
            <CheckCircle2 size={17} />
            <span>+{reward.shardsGrantedToYou} Shards to you · +{reward.shardsGrantedToOwner} to the champion · +{reward.progressMinutesGranted} minute of Rift progress.</span>
          </div>
        )}
        {notice && <div className="io-rift-post-notice" role="status">{notice}</div>}
        {error && <div className="io-rift-post-error" role="alert">{error}</div>}

        <div className="io-rift-post-actions">
          <button type="button" className="io-rift-post-play" onClick={openGame}>
            <Gamepad2 size={17} /> Play Infinity Orbs <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="io-rift-post-kudos"
            onClick={() => void sendKudos()}
            disabled={!info || !info.canKudos || expired || busy || loading}
            title={info?.isOwner ? 'You cannot Kudos your own first-clear post.' : expired ? 'Kudos closed 24 hours after this post was created.' : info?.alreadyKudosed ? 'You have already sent Kudos.' : 'Send Kudos without opening the game.'}
          >
            {busy ? <span className="io-rift-post-spinner" /> : info?.alreadyKudosed ? <CheckCircle2 size={16} /> : expired ? <LockKeyhole size={16} /> : <Heart size={16} />}
            {busy ? 'Sending…' : info?.isOwner ? 'Your achievement' : info?.alreadyKudosed ? 'Kudos sent' : expired ? 'Kudos closed' : 'Send Kudos'}
          </button>
        </div>

        <div className="io-rift-post-footer">
          {info?.isOwner
            ? 'This is your first-clear announcement. Other players can send you Kudos.'
            : info?.alreadyKudosed
              ? 'You have already congratulated this Rift champion.'
              : expired
                ? 'The Kudos window closed 24 hours after this post was published.'
                : info
                  ? 'Kudos closes in ' + formatRemaining(remaining) + '. Sending Kudos does not open the game.'
                  : 'Kudos is available for 24 hours after publication.'}
        </div>
      </article>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<RiftCompletionPost />);
