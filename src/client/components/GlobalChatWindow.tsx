import React, { memo, useEffect, useRef, useState } from 'react';
import { Flag, MessageCircle, Minimize2, Send, X } from 'lucide-react';
import type { GlobalChatMessage } from '../../shared/social.js';

interface GlobalChatWindowProps {
  username?: string;
  launcherContext?: 'main' | 'frenzy';
}

/** Bound slow embedded-webview requests so chat controls never stay busy forever. */
async function fetchChat(url: string, options: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Chat request timed out. Check the conversation before retrying.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadChat(): Promise<GlobalChatMessage[]> {
  const response = await fetchChat('/api/chat?ts=' + Date.now(), {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw new Error('Could not load chat.');
  const payload: unknown = await response.json().catch(() => null);
  if (!Array.isArray(payload)) throw new Error('Chat history response was invalid.');
  return payload.filter((value): value is GlobalChatMessage => Boolean(
    value && typeof value === 'object' &&
    typeof (value as GlobalChatMessage).id === 'string' &&
    typeof (value as GlobalChatMessage).username === 'string' &&
    typeof (value as GlobalChatMessage).text === 'string'
  )).map(message => ({
    ...message,
    timestamp: Number.isFinite(message.timestamp) && message.timestamp >= 0 ? message.timestamp : 0,
  }));
}

const GlobalChatWindowComponent: React.FC<GlobalChatWindowProps> = ({
  username = '',
}) => {
  const [open, setOpen] = useState(false);
  // Server status permits only the registered main Game or a registered Frenzy context.
  // Submissions from either context are routed to the canonical main Game post.
  const [chatAvailable, setChatAvailable] = useState<boolean | null>(null);
  const [chatUnavailableReason, setChatUnavailableReason] = useState('');
  const [messages, setMessages] = useState<GlobalChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const hasPersistedSeenStateRef = useRef(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const sendingInFlightRef = useRef(false);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const reportingInFlightRef = useRef<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowMessagesRef = useRef(true);
  const jumpToBottomRef = useRef(false);
  const refreshRequestRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('io-global-chat-seen-v1');
      if (stored !== null) {
        const ids = JSON.parse(stored);
        if (Array.isArray(ids)) {
          seenMessageIdsRef.current = new Set(ids.filter((id): id is string => typeof id === 'string').slice(-100));
          hasPersistedSeenStateRef.current = true;
        }
      }
    } catch {
      // Chat unread tracking is best-effort in restricted embedded webviews.
    }
  }, []);

  const markMessagesSeen = (list: GlobalChatMessage[]) => {
    const ids = new Set(seenMessageIdsRef.current);
    for (const message of list.slice(-100)) ids.add(message.id);
    const bounded = new Set(Array.from(ids).slice(-100));
    seenMessageIdsRef.current = bounded;
    hasPersistedSeenStateRef.current = true;
    setUnreadCount(0);
    try {
      window.localStorage.setItem('io-global-chat-seen-v1', JSON.stringify(Array.from(bounded)));
    } catch {
      // The current session still tracks seen messages if localStorage is disabled.
    }
  };

  const mergeMessages = (current: GlobalChatMessage[], incoming: GlobalChatMessage[]) => {
    const merged = new Map<string, GlobalChatMessage>();
    for (const message of current) merged.set(message.id, message);
    for (const message of incoming) merged.set(message.id, message);
    return Array.from(merged.values())
      .sort((a, b) => {
        const left = Number.isFinite(a.timestamp) && a.timestamp >= 0 ? a.timestamp : 0;
        const right = Number.isFinite(b.timestamp) && b.timestamp >= 0 ? b.timestamp : 0;
        return left - right;
      })
      .slice(-100);
  };

  const isDocumentVisible = (): boolean => document.visibilityState === 'visible';

  const refreshChat = async (queueIfBusy = false) => {
    if (document.visibilityState === 'hidden') return;
    if (!isDocumentVisible()) return;
    if (refreshInFlightRef.current) {
      if (queueIfBusy) refreshPendingRef.current = true;
      return;
    }
    refreshInFlightRef.current = true;
    // A new request satisfies any queued refresh; requests arriving while this
    // one is active can schedule at most one follow-up.
    refreshPendingRef.current = false;
    refreshRequestRef.current += 1;
    const requestId = refreshRequestRef.current;
    try {
      const next = await loadChat();
      // Ignore responses from older requests. Embedded webviews can finish
      // overlapping GETs out of order, which otherwise lets stale history
      // briefly replace a newer snapshot.
      if (requestId !== refreshRequestRef.current) return;
      const visible = next.slice(-100);
      setMessages(visible);
      if (open) {
        // Every message visible in an open chat is immediately marked seen.
        markMessagesSeen(visible);
      } else if (!hasPersistedSeenStateRef.current) {
        // On first use we have no previous read marker. Establish a baseline
        // instead of incorrectly showing the whole historical chat as unread.
        markMessagesSeen(visible);
      } else {
        const unread = visible.filter(message => !seenMessageIdsRef.current.has(message.id));
        setUnreadCount(unread.length);
      }
    } catch {
      // Chat is auxiliary UI and should never block gameplay.
    } finally {
      refreshInFlightRef.current = false;
      if (refreshPendingRef.current && isDocumentVisible()) {
        refreshPendingRef.current = false;
        void refreshChat(true);
      }
    }
  };

  useEffect(() => {
    let cancelled = false;

    const checkAvailability = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (cancelled) return;
        try {
          const response = await fetchChat('/api/chat/status?ts=' + Date.now(), {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          });
          const payload = await response.json().catch(() => ({})) as { enabled?: unknown; reason?: unknown };
          if (!response.ok) throw new Error('Could not determine Global Chat availability.');
          const enabled = payload.enabled === true;
          if (!cancelled) {
            setChatAvailable(enabled);
            setChatUnavailableReason(enabled
              ? ''
              : typeof payload.reason === 'string' && payload.reason.trim()
                ? payload.reason
                : "Global Chat is waiting for the canonical main Game post to be registered.");
          }
          return;
        } catch {
          if (cancelled) return;
          if (attempt === 2) {
            if (!cancelled) {
              setChatAvailable(false);
              setChatUnavailableReason("Global Chat is waiting for the canonical main Game post to be registered.");
            }
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
    };

    void checkAvailability();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Escape closes the floating chat without requiring precise pointer targeting.
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    // Poll only while visible. A queued refresh resumes after a pending request
    // settles, avoiding overlapping chat history requests in slow webviews.
    const refreshWhenVisible = () => {
      if (cancelled || document.visibilityState === 'hidden') return;
      void refreshChat(true);
    };
    refreshWhenVisible();
    const interval = window.setInterval(() => {
      if (!cancelled && document.visibilityState !== 'hidden') void refreshChat();
    }, open ? 3000 : 10000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      refreshRequestRef.current += 1;
    };
  }, [open, chatAvailable]);

  useEffect(() => {
    if (!open || !shouldFollowMessagesRef.current) return;
    const behavior: ScrollBehavior = jumpToBottomRef.current ? 'auto' : 'smooth';
    jumpToBottomRef.current = false;
    endRef.current?.scrollIntoView({ behavior, block: 'end' });
  }, [messages, open]);

  const reportMessage = async (message: GlobalChatMessage) => {
    if (reportingInFlightRef.current || reportedIds.has(message.id)) return;
    reportingInFlightRef.current = message.id;
    setReportingId(message.id);
    setActionError(null);
    try {
      const response = await fetchChat('/api/chat/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.id }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not report message.');
      setReportedIds(prev => {
        const next = new Set(prev);
        next.add(message.id);
        return new Set(Array.from(next).slice(-200));
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not report message.');
      console.error('Global chat report error:', error);
    } finally {
      reportingInFlightRef.current = null;
      setReportingId(null);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || sendingInFlightRef.current || chatAvailable !== true) return;

    sendingInFlightRef.current = true;
    setSending(true);
    setActionError(null);
    try {
      const response = await fetchChat('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const payload = await response.json() as GlobalChatMessage | { error?: string };
      if (!response.ok) {
        throw new Error('error' in payload ? payload.error || 'Could not send message.' : 'Could not send message.');
      }
      const sentMessage = payload as GlobalChatMessage;
      setInput('');
      // Sending a message is an explicit decision to resume following the conversation.
      shouldFollowMessagesRef.current = true;
      jumpToBottomRef.current = true;
      setMessages(prev => mergeMessages(prev, [sentMessage]));
      // Pull the authoritative history after posting. The merge keeps any
      // newer local messages if a concurrent poll is still in flight.
      void refreshChat(true);
    } catch (error: any) {
      setActionError(error instanceof Error ? error.message : 'Could not send message.');
      console.error('Global chat error:', error);
    } finally {
      sendingInFlightRef.current = false;
      setSending(false);
    }
  };

  // Keep Global Chat discoverable in every context. If the canonical main
  // launcher is not available, the open panel explains why posting is disabled.
  useEffect(() => () => {
    // Ignore any poll that resolves after this launcher panel unmounts.
    refreshRequestRef.current += 1;
  }, []);

  if (!open) {
    return (
      <button
        type="button"
        aria-label={unreadCount>0?'Open Global Chat, '+unreadCount+' unread messages':'Open Global Chat'}
        onClick={() => {
          markMessagesSeen(messages);
          shouldFollowMessagesRef.current = true;
          jumpToBottomRef.current = true;
          setOpen(true);
        }}
        className="io-chat-launcher fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-2xl border border-indigo-500/30 bg-slate-900/95 px-4 py-3 text-xs font-black text-white shadow-2xl backdrop-blur-md hover:bg-slate-800 transition-all"
        title={chatAvailable === true ? 'Open global chat' : 'Open Global Chat to read messages and see why posting is unavailable here'}
      >
        <MessageCircle className="w-4 h-4 text-indigo-300" />
        <span className="io-chat-launcher-label">Global Chat</span>
        {chatAvailable === false && (
          <span className="io-chat-read-only rounded-full border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">Read only</span>
        )}
        {unreadCount > 0 && (
          <span aria-label={unreadCount + ' unread messages'} className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] text-indigo-200">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <section role="dialog" aria-modal={false} aria-label="Global Chat" className="io-chat-window fixed bottom-4 right-4 z-40 w-[min(380px,calc(100vw-2rem))] rounded-3xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur-xl overflow-hidden">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-indigo-300" />
          <div>
            <h3 className="text-sm font-black text-white">Global Chat</h3>
            <p className="text-[9px] text-slate-500">Messages are public Reddit comments on the main Game post, submitted as your account. Comments posted there also appear here.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"
          aria-label="Minimize Global Chat"
          title="Minimize chat"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
      </header>

      {actionError && (
        <div role="alert" className="border-b border-rose-500/20 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          {actionError}
        </div>
      )}

      {chatAvailable !== true && (
        <div role="status" className="border-b border-amber-500/20 bg-amber-950/30 px-3 py-2.5 text-[11px] leading-relaxed text-amber-200">
          {chatAvailable === null ? 'Checking Global Chat availability…' : chatUnavailableReason || "Global Chat is available only in the registered main Game or a registered Frenzy post."}
          <div className="mt-1 text-[10px] text-amber-200/60">Messages remain visible; public comments are always routed to the registered main Game post.</div>
        </div>
      )}

      <div
        role="log"
        aria-label="Global Chat message history"
        aria-relevant="additions text"
        ref={chatListRef}
        onScroll={() => {
          const element = chatListRef.current;
          if (!element) return;
          // Follow new messages only while the reader is already near the bottom.
          shouldFollowMessagesRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        className="h-72 max-h-[45vh] min-h-40 overflow-y-auto px-3 py-3 space-y-2"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-xs text-slate-600">
            <div>
              <MessageCircle className="mx-auto mb-2 h-6 w-6" />
              No messages yet. Send a message to start the conversation.
            </div>
          </div>
        ) : (
          messages.map(message => (
            <article key={message.id} aria-label={`Message from ${message.username}`} className="rounded-xl border border-slate-800/80 bg-slate-900/70 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <span className={(message.isAdmin === true)
                    ? 'text-xs font-black text-red-400'
                    : message.username === username
                    ? 'text-xs font-black text-indigo-300'
                    : 'text-xs font-bold text-slate-200'}>
                    {message.username}
                  </span>
                  {(message.isAdmin === true) && (
                    <span className="rounded border border-red-500/40 bg-red-500/10 px-1 py-0.5 text-[8px] font-black tracking-wider text-red-300">ADMIN</span>
                  )}
                </span>
                <span className="text-[9px] text-slate-600" aria-label={`Sent at ${new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}>
                  {new Date(message.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div className="mt-1 flex items-start justify-between gap-2">
                <p className="min-w-0 break-words text-[11px] text-slate-400">{message.text}</p>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void reportMessage(message);
                  }}
                  disabled={reportingId === message.id || reportedIds.has(message.id)}
                  className="relative z-20 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-950/20 px-3 py-2 text-[10px] font-black text-rose-300 hover:border-rose-400/60 hover:bg-rose-950/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer touch-manipulation"
                  title={reportedIds.has(message.id) ? 'Report sent to subreddit moderators' : 'Report this message'}
                  aria-label={reportedIds.has(message.id) ? 'Message reported' : 'Report message'}
                >
                  <Flag className="h-3.5 w-3.5" />
                  <span>{reportedIds.has(message.id) ? 'Sent' : reportingId === message.id ? 'Sending…' : 'Report'}</span>
                </button>
              </div>
            </article>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form aria-label="Post a public chat comment" autoComplete="off" onSubmit={sendMessage} className="border-t border-slate-800 bg-slate-900/95 p-3">
        <div className="flex items-center gap-2">
          <label htmlFor="io-global-chat-input" className="sr-only">Public chat comment</label>
          <input
            id="io-global-chat-input"
            name="io-global-chat-message"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={input}
            onChange={e => setInput(e.target.value.slice(0, 200))}
            aria-label="Write a public Global Chat message"
            aria-describedby="io-global-chat-length"
            maxLength={200}
            placeholder={chatAvailable === true ? 'Write a public Reddit comment...' : 'Open a registered Game or Frenzy post to chat'}
            disabled={sending || chatAvailable !== true}
            className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            aria-label={sending ? 'Sending public comment' : 'Send public comment'}
            aria-busy={sending}
            disabled={chatAvailable !== true || sending || !input.trim()}
            className="rounded-xl bg-indigo-600 px-3 py-2.5 text-white transition-all hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600"
            title={sending ? "Sending public comment…" : "Post public comment"}
          >
            {sending ? <X className="w-4 h-4 animate-pulse" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <div id="io-global-chat-length" role="status" aria-live="polite" aria-label={`${input.length} of 200 characters used`} className="mt-1 text-right text-[9px] text-slate-600">{input.length} / 200 characters</div>
      </form>
    </section>
  );
};


export const GlobalChatWindow = memo(GlobalChatWindowComponent);
