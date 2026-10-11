import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('payment grant fails closed when an existing order receipt is malformed', () => {
  const game = source('src/server/game.ts');
  const parserStart = game.indexOf('function parsePaymentPlayerState');
  const parserEnd = game.indexOf('export async function hasReadablePlayerSave', parserStart);
  assert.ok(parserStart >= 0 && parserEnd > parserStart, 'payment parser must exist');
  const parser = game.slice(parserStart, parserEnd);

  // A malformed, present receipt ledger cannot safely be treated like a legacy
  // save with no receipt ledger. Doing so erases evidence needed for replay
  // protection and may make an already-fulfilled order look new.
  assert.doesNotMatch(
    parser,
    /paymentReceipts:\s*validatedRecord\.paymentReceipts[\s\S]{0,180}\?[\s\S]{0,180}:\s*\{\}/,
    'malformed receipt containers must not be silently normalized to an empty object',
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
    'unrecognized receipt data for the requested order must be rejected before resource mutation',
  );
});
