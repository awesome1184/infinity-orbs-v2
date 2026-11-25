import { APP_VERSION } from '../../shared/version.js';

export interface FullLogEvent {
  sequence: number;
  timestamp: string;
  elapsedMs: number;
  type: string;
  detail: unknown;
}

export interface FullLogStatus {
  eventCount: number;
  droppedEvents: number;
  errorCount: number;
  warningCount: number;
  startedAt: string;
}

const MAX_EVENTS = 1_500;
const MAX_EVENT_CHARS = 9_000;
const MAX_STRING_CHARS = 2_000;
const MAX_RESPONSE_CHARS = 16_000;
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const sessionId = createSessionId();
const events: FullLogEvent[] = [];
let sequence = 0;
let droppedEvents = 0;
let captureInstalled = false;
let errorCount = 0;
let warningCount = 0;
let requestSequence = 0;

function createSessionId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch {
    // Fall back to a local identifier. It is diagnostic metadata, not a credential.
  }
  return 'session-' + Date.now().toString(36);
}

const sensitiveKeyPattern =
  /authorization|cookie|password|secret|access.?token|refresh.?token|api.?key|user.?id|username|account.?id|session.?id|private.?key|roll.?ticket|credential/i;
const privateTextKeyPattern = /^(text|content|messageBody|messageText)$/i;

export function sanitizeFullLogValue(value: unknown, depth = 0, seen = new WeakSet<object>(), key = ''): unknown {
  if (sensitiveKeyPattern.test(key)) return '[REDACTED]';
  if (privateTextKeyPattern.test(key)) return '[REDACTED: user-entered content]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value ?? null;
  if (typeof value === 'string') return value.length > MAX_STRING_CHARS
    ? value.slice(0, MAX_STRING_CHARS) + '…[truncated]'
    : value;
  if (typeof value === 'bigint') return value.toString() + 'n';
  if (typeof value === 'function') return '[function]';
  if (typeof value !== 'object') return String(value);
  if (depth >= 5) return '[maximum detail depth reached]';
  if (seen.has(value)) return '[circular reference]';
  seen.add(value);

  if (value instanceof Error) {
    const error = value as Error & { code?: unknown; status?: unknown; diagnosticId?: unknown };
    return {
      name: error.name,
      message: sanitizeFullLogValue(error.message, depth + 1, seen, 'message'),
      stack: typeof error.stack === 'string' ? error.stack.slice(0, 6_000) : undefined,
      ...(error.code !== undefined ? { code: error.code } : {}),
      ...(error.status !== undefined ? { status: error.status } : {}),
      ...(error.diagnosticId !== undefined ? { diagnosticId: error.diagnosticId } : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map(item => sanitizeFullLogValue(item, depth + 1, seen));
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const property of Object.keys(input).slice(0, 60)) {
    output[property] = sanitizeFullLogValue(input[property], depth + 1, seen, property);
  }
  if (Object.keys(input).length > 60) output.__truncatedKeys = Object.keys(input).length - 60;
  return output;
}

export function recordFullLogEvent(type: string, detail: unknown = {}): void {
  const safeType = String(type || 'event').slice(0, 100);
  const safeDetail = sanitizeFullLogValue(detail);
  let event: FullLogEvent = {
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    elapsedMs: Math.max(0, Date.now() - startedAtMs),
    type: safeType,
    detail: safeDetail,
  };
  try {
    if (JSON.stringify(event).length > MAX_EVENT_CHARS) {
      event = { ...event, detail: { truncated: true, reason: 'event exceeded size limit' } };
    }
  } catch {
    event = { ...event, detail: '[unserializable diagnostic detail]' };
  }
  events.push(event);
  const failedApiResponse = safeType === 'api.response' &&
    safeDetail !== null &&
    typeof safeDetail === 'object' &&
    !Array.isArray(safeDetail) &&
    (safeDetail as Record<string, unknown>).ok === false;
  if (
    failedApiResponse ||
    safeType.includes('error') ||
    safeType === 'browser.unhandled-rejection'
  ) errorCount += 1;
  if (safeType.includes('warn')) warningCount += 1;
  while (events.length > MAX_EVENTS) {
    events.shift();
    droppedEvents += 1;
  }
}

export function getRecentFullLogEvents(limit = 30): FullLogEvent[] {
  const count = Math.max(0, Math.min(MAX_EVENTS, Math.floor(Number(limit) || 0)));
  if (count === 0) return [];
  return events.slice(-count).map(event => ({ ...event }));
}

export function getFullLogStatus(): FullLogStatus {
  return { eventCount: events.length, droppedEvents, errorCount, warningCount, startedAt };
}

export function clearFullLogEvents(): void {
  events.length = 0;
  droppedEvents = 0;
  errorCount = 0;
  warningCount = 0;
}

function safeRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== 'string') return body == null ? undefined : '[non-text request body omitted]';
  if (body.length > MAX_RESPONSE_CHARS) return { truncated: true, characterCount: body.length };
  try {
    return sanitizeFullLogValue(JSON.parse(body));
  } catch {
    return sanitizeFullLogValue(body);
  }
}

function shouldOmitResponseBody(path: string): boolean {
  return /^\/api\/(?:me|chat)(?:\/|$)/.test(path) ||
    /^\/api\/dev\/(?:player-spy|leaderboard-diagnostics|player-list)(?:\/|$)/.test(path);
}

function captureResponseBody(response: Response, path: string, requestId: number): void {
  if (shouldOmitResponseBody(path)) {
    recordFullLogEvent('api.response-body-omitted', { requestId, path, reason: 'contains player or private message data' });
    return;
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json')) return;
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > 250_000) {
    recordFullLogEvent('api.response-body-omitted', { requestId, path, contentLength: declaredLength, reason: 'response too large' });
    return;
  }
  void response.clone().text().then(raw => {
    if (raw.length > MAX_RESPONSE_CHARS) {
      recordFullLogEvent('api.response-body-truncated', { requestId, path, characterCount: raw.length });
      return;
    }
    try {
      recordFullLogEvent('api.response-body', { requestId, path, body: sanitizeFullLogValue(JSON.parse(raw)) });
    } catch {
      recordFullLogEvent('api.response-body', { requestId, path, body: sanitizeFullLogValue(raw) });
    }
  }).catch(error => {
    recordFullLogEvent('api.response-body-read-error', { requestId, path, error });
  });
}

function installFetchCapture(): void {
  const originalFetch = window.fetch.bind(window);
  const wrappedFetch: typeof window.fetch = async (input, init) => {
    let url: URL;
    try {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      url = new URL(rawUrl, window.location.href);
    } catch {
      return originalFetch(input, init);
    }
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return originalFetch(input, init);
    }

    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const requestId = ++requestSequence;
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    recordFullLogEvent('api.request', {
      requestId,
      method,
      path: url.pathname,
      requestBody: safeRequestBody(init?.body),
    });
    try {
      const response = await originalFetch(input, init);
      const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordFullLogEvent('api.response', {
        requestId,
        method,
        path: url.pathname,
        status: response.status,
        ok: response.ok,
        durationMs: Math.max(0, Math.round(ended - started)),
        requestIdHeader: response.headers.get('x-request-id'),
      });
      captureResponseBody(response, url.pathname, requestId);
      return response;
    } catch (error) {
      const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordFullLogEvent('api.network-error', {
        requestId,
        method,
        path: url.pathname,
        durationMs: Math.max(0, Math.round(ended - started)),
        error,
      });
      throw error;
    }
  };
  window.fetch = wrappedFetch;
}

function installBrowserEventCapture(): void {
  window.addEventListener('error', event => {
    recordFullLogEvent('browser.error', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  });
  window.addEventListener('unhandledrejection', event => {
    recordFullLogEvent('browser.unhandled-rejection', { reason: event.reason });
  });
  window.addEventListener('pagehide', () => recordFullLogEvent('page.lifecycle', { event: 'pagehide' }));
  document.addEventListener('visibilitychange', () => {
    recordFullLogEvent('page.visibility', { state: document.visibilityState });
  });
  document.addEventListener('click', event => {
    const target = event.target instanceof Element
      ? event.target.closest('button,[role="button"],a,[data-testid]')
      : null;
    if (!(target instanceof HTMLElement)) return;
    const label = target.getAttribute('aria-label') ||
      target.getAttribute('title') ||
      target.getAttribute('data-testid') ||
      target.innerText ||
      target.textContent ||
      '';
    recordFullLogEvent('ui.click', {
      tag: target.tagName.toLowerCase(),
      label: label.trim().replace(/\s+/g, ' ').slice(0, 120),
      testId: target.getAttribute('data-testid'),
    });
  }, true);
}

function installConsoleCapture(): void {
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    recordFullLogEvent('console.error', { arguments: args });
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    recordFullLogEvent('console.warn', { arguments: args });
    originalWarn(...args);
  };
}

export function installFullLogCapture(): void {
  if (captureInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  captureInstalled = true;
  installFetchCapture();
  installBrowserEventCapture();
  installConsoleCapture();
  const runtime = window.location.hostname.endsWith('.github.io') ? 'github-pages-test' : 'devvit-or-local';
  recordFullLogEvent('session.started', {
    appVersion: APP_VERSION,
    runtime,
    path: window.location.pathname,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: navigator.userAgent,
  });
}

export function getFullLogSnapshot(): Record<string, unknown> {
  const status = getFullLogStatus();
  const runtime = typeof window !== 'undefined' && window.location.hostname.endsWith('.github.io')
    ? 'github-pages-test'
    : typeof window !== 'undefined' ? 'devvit-or-local' : 'non-browser-test';
  const environment = typeof window === 'undefined'
    ? { runtime }
    : {
      runtime,
      host: window.location.host,
      path: window.location.pathname,
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      online: navigator.onLine,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: navigator.userAgent,
    };
  return {
    format: 'infinity-orbs-full-log-snapshot',
    schemaVersion: 1,
    appVersion: APP_VERSION,
    session: {
      id: sessionId,
      startedAt,
      generatedAt: new Date().toISOString(),
      elapsedMs: Math.max(0, Date.now() - startedAtMs),
      ...status,
    },
    environment,
    eventTypeCounts: events.reduce<Record<string, number>>((counts, event) => {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      return counts;
    }, {}),
    events: events.map(event => ({ ...event })),
  };
}
