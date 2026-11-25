export interface RollRandomSource {
  next(): number;
  nextRarity(): number;
}

const CONSTANTS = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574] as const;

function rotl(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 16) >>> 0;
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 12) >>> 0;
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 8) >>> 0;
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 7) >>> 0;
}

export function createRollRandomSource(seed: string): RollRandomSource {
  if (!/^[a-f0-9]{64}$/i.test(seed)) throw new Error('Invalid roll seed.');
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(seed.slice(i * 2, i * 2 + 2), 16));
  const key = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    const p = i * 4;
    key[i] = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
  }

  let counter = 0;
  let block = new Uint32Array(16);
  let offset = 16;
  const nextUint32 = (): number => {
    if (offset >= 16) {
      if (counter > 0xffff_ffff) throw new Error('Roll seed stream exhausted.');
      const initial = new Uint32Array(16);
      initial.set(CONSTANTS, 0);
      initial.set(key, 4);
      initial[12] = counter >>> 0;
      block = new Uint32Array(initial);
      for (let round = 0; round < 10; round++) {
        quarterRound(block, 0, 4, 8, 12);
        quarterRound(block, 1, 5, 9, 13);
        quarterRound(block, 2, 6, 10, 14);
        quarterRound(block, 3, 7, 11, 15);
        quarterRound(block, 0, 5, 10, 15);
        quarterRound(block, 1, 6, 11, 12);
        quarterRound(block, 2, 7, 8, 13);
        quarterRound(block, 3, 4, 9, 14);
      }
      for (let i = 0; i < 16; i++) block[i] = (block[i] + initial[i]) >>> 0;
      counter++;
      offset = 0;
    }
    return block[offset++] >>> 0;
  };

  return {
    next: () => {
      const high = nextUint32() >>> 5;
      const low = nextUint32() >>> 6;
      return (high * 67_108_864 + low) / 9_007_199_254_740_992;
    },
    nextRarity: () => {
      let sample = 0n;
      for (let i = 0; i < 34; i++) sample = (sample << 32n) | BigInt(nextUint32());
      if (sample === 0n) return Number.MIN_VALUE;
      const bitLength = sample.toString(2).length;
      const mantissaBits = Math.min(53, bitLength);
      const leadingBits = sample >> BigInt(bitLength - mantissaBits);
      const mantissa = Number(leadingBits) / Math.pow(2, mantissaBits);
      const value = mantissa * Math.pow(2, bitLength - 1088);
      return Number.isFinite(value)
        ? Math.min(1 - Number.EPSILON, Math.max(Number.MIN_VALUE, value))
        : Number.MIN_VALUE;
    },
  };
}
