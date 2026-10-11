import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('payment fulfillment uses the canonical PlayerState parser for required core fields', () => {
  const game = source('src/server/game.ts');
  const parserStart = game.indexOf('function parsePaymentPlayerState');
  const parserEnd = game.indexOf('export async function hasReadablePlayerSave', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'payment parser must exist');
  const parser = game.slice(parserStart, parserEnd);

  // A partial record must not be accepted merely because every field it happens
  // to contain is valid. The normal loader requires coins, shards and totalRolls.
  assert.match(
    parser,
    /parsePlayerStateValue\(record\)/,
    'payment fulfillment must reuse the canonical required-field validator',
  );
  assert.match(
    parser,
    /if\s*\(!validatedState\)\s*\{\s*throw new Error/,
    'invalid or incomplete core state must fail before default-merging the save',
  );
});

test('payment parser does not erase malformed receipt metadata into an empty ledger', () => {
  const game = source('src/server/game.ts');
  const parserStart = game.indexOf('function parsePaymentPlayerState');
  const parserEnd = game.indexOf('export async function hasReadablePlayerSave', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'payment parser must exist');
  const parser = game.slice(parserStart, parserEnd);

  // A present malformed receipt container is not equivalent to a genuinely
  // missing legacy field: replacing it with {} can permit a replayed order
  // to be applied a second time.
  assert.doesNotMatch(
    parser,
    /paymentReceipts:\s*(?:record|validatedRecord)\.paymentReceipts[\s\S]{0,180}\?[^;\n]*:\s*\{\}/,
    'malformed existing payment receipts must not be silently discarded',
  );

  const grantStart = game.indexOf('export async function grantPurchasedPack');
  const grantEnd = game.indexOf('export async function refundPurchasedPack', grantStart);
  assert.ok(grantStart >= 0 && grantEnd > grantStart, 'purchase grant must exist');
  const grant = game.slice(grantStart, grantEnd);
  const receiptStart = grant.indexOf('const existingReceipt = state.paymentReceipts[orderId]');
  const walletStart = grant.indexOf('const currentShardBalance', receiptStart);
  assert.ok(receiptStart >= 0 && walletStart > receiptStart, 'receipt check must precede wallet mutations');
  const receiptGate = grant.slice(receiptStart, walletStart);
  assert.match(
    receiptGate,
    /existingReceipt[\s\S]{0,1000}(?:malformed|invalid|unrecognized)[\s\S]{0,200}throw new Error/i,
    'an unrecognized existing receipt must be rejected, not treated as a fresh order',
  );
});
