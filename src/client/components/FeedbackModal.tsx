import React, { useEffect, useState } from 'react';
import { Bug, Lightbulb, Send, X } from 'lucide-react';
import { sound } from '../sound.js';

interface FeedbackModalProps {
  onClose: () => void;
  onSubmit: (type: 'bug' | 'suggestion', message: string) => Promise<void>;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ onClose, onSubmit }) => {
  const [type, setType] = useState<'bug' | 'suggestion'>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const submit = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      setError('Please describe the bug or suggestion.');
      return;
    }
    setBusy(true);
    setError('');
    sound.playClick();
    try {
      await onSubmit(type, trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send feedback.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        aria-describedby="feedback-modal-description"
        className="relative w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4"
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800"
          aria-label="Close feedback"
        >
          <X className="w-5 h-5" />
        </button>

        <div>
          <div className="flex items-center gap-2">
            <Bug className="w-5 h-5 text-amber-300" />
            <h2 id="feedback-modal-title" className="text-lg font-black text-white">Bug Report / Suggestion</h2>
          </div>
          <p id="feedback-modal-description" className="mt-1 text-xs text-slate-400">
            This goes straight to the subreddit moderators through Modmail.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => {
              setType('bug');
              sound.playClick();
            }}
            className={type === 'bug'
              ? 'rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2.5 text-xs font-black text-rose-200'
              : 'rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-xs font-bold text-slate-400 hover:text-white'}
          >
            <Bug className="w-4 h-4 mx-auto mb-1" />
            Bug Report
          </button>
          <button
            onClick={() => {
              setType('suggestion');
              sound.playClick();
            }}
            className={type === 'suggestion'
              ? 'rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-3 py-2.5 text-xs font-black text-cyan-200'
              : 'rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-xs font-bold text-slate-400 hover:text-white'}
          >
            <Lightbulb className="w-4 h-4 mx-auto mb-1" />
            Suggestion
          </button>
        </div>

        <textarea
          aria-label={type === 'bug' ? 'Describe the bug' : 'Describe your suggestion'}
          value={message}
          onChange={e => setMessage(e.target.value.slice(0, 2000))}
          rows={8}
          placeholder={type === 'bug'
            ? 'What happened? Include what you expected to happen and what actually happened.'
            : 'What would you like to see changed or added?'}
          className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm text-slate-200 outline-none focus:border-cyan-500/50"
        />

        <div className="flex items-center justify-between gap-3 text-[10px]">
          <span role={error ? 'alert' : undefined} className={error ? 'text-rose-300' : 'text-slate-600'}>
            {error || message.length + '/2000'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || !message.trim()}
              className="rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 px-4 py-2.5 text-xs font-black text-white hover:from-cyan-500 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {busy ? 'Sending…' : 'Send to Modmail'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
