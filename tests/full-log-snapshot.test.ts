import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearFullLogEvents,
  getFullLogSnapshot,
  getFullLogStatus,
  getRecentFullLogEvents,
  recordFullLogEvent,
  sanitizeFullLogValue,
} from '../src/client/diagnostics/full-log-snapshot.js';

test('full log snapshots preserve ordered events and redact sensitive fields', () => {
  clearFullLogEvents();
  recordFullLogEvent('api.request', {
    path: '/api/example',
    username: 'private-name',
    userId: 'private-id',
    accessToken: 'private-token',
    text: 'private chat text',
    message: 'Player state changed while saving',
    attempt: 2,
  });

  const snapshot = getFullLogSnapshot() as {
    format: string;
    schemaVersion: number;
    events: Array<{ sequence: number; type: string; detail: Record<string, unknown> }>;
  };
  assert.equal(snapshot.format, 'infinity-orbs-full-log-snapshot');
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0]?.type, 'api.request');
  assert.equal(snapshot.events[0]?.detail.username, '[REDACTED]');
  assert.equal(snapshot.events[0]?.detail.userId, '[REDACTED]');
  assert.equal(snapshot.events[0]?.detail.accessToken, '[REDACTED]');
  assert.equal(snapshot.events[0]?.detail.text, '[REDACTED: user-entered content]');
  assert.equal(snapshot.events[0]?.detail.message, 'Player state changed while saving');
  assert.equal(snapshot.events[0]?.detail.attempt, 2);
  assert.equal(getRecentFullLogEvents(0).length, 0);
});

test('full log error count includes unsuccessful HTTP responses', () => {
  clearFullLogEvents();
  recordFullLogEvent('api.response', { status: 200, ok: true });
  recordFullLogEvent('api.response', { status: 403, ok: false });
  recordFullLogEvent('api.response', { status: 400, ok: false });
  recordFullLogEvent('api.network-error', { path: '/api/example' });
  recordFullLogEvent('browser.unhandled-rejection', { reason: 'test rejection' });

  const status = getFullLogStatus();
  assert.equal(status.errorCount, 4);
  assert.equal(status.warningCount, 0);
});

test('full log data is bounded and circular values are safe to serialize', () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const safe = sanitizeFullLogValue(circular) as Record<string, unknown>;
  assert.equal(safe.self, '[circular reference]');
  clearFullLogEvents();
  for (let index = 0; index < 1_510; index += 1) recordFullLogEvent('test.event', { index });
  const status = getFullLogStatus();
  assert.equal(status.eventCount, 1_500);
  assert.equal(status.droppedEvents, 10);
  assert.doesNotThrow(() => JSON.stringify(getFullLogSnapshot()));
});
