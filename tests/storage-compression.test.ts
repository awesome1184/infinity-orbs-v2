import test from 'node:test';
import assert from 'node:assert/strict';
import { compressStorageString, decompressStorageString, isCompressedStorageString } from '../src/server/storage-compression.js';

test('storage compression round-trips large Unicode JSON payloads', () => {
  const source = JSON.stringify({
    username: 'StorageTester',
    inventory: Array.from({ length: 800 }, (_, index) => ({
      id: 'gear-' + index, slot: 'weapon', name: 'Starforged Riftbound Edge',
      quality: 87.5, sourceFloor: 744,
    })),
    collection: Object.fromEntries(Array.from({ length: 3_000 }, (_, index) => [String(10_000 + index * 10), index + 1])),
    description: 'Infinity Orbs — compressed progression data 🚀 '.repeat(40),
  });
  const stored = compressStorageString(source);
  assert.ok(isCompressedStorageString(stored));
  assert.ok(stored.length < source.length * 0.5);
  assert.equal(decompressStorageString(stored), source);
});

test('legacy plain JSON remains readable and small values are not expanded', () => {
  const legacy = '{"coins":123,"shards":5}';
  assert.equal(decompressStorageString(legacy), legacy);
  assert.equal(compressStorageString('{"coins":1}'), '{"coins":1}');
});

test('corrupt compressed values fail closed', () => {
  assert.throws(() => decompressStorageString('ioz1:not-valid-base64'));
});
