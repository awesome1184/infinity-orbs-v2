import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

const PREFIX = 'ioz1:';
const MIN_INPUT_BYTES = 1_024;
const MIN_SAVING_RATIO = 0.08;
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const a = bytes[offset] ?? 0;
    const hasB = offset + 1 < bytes.length;
    const hasC = offset + 2 < bytes.length;
    const b = hasB ? bytes[offset + 1]! : 0;
    const c = hasC ? bytes[offset + 2]! : 0;
    output += BASE64[a >>> 2];
    output += BASE64[((a & 3) << 4) | (b >>> 4)];
    output += hasB ? BASE64[((b & 15) << 2) | (c >>> 6)] : '=';
    output += hasC ? BASE64[c & 63] : '=';
  }
  return output;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Compressed storage payload has invalid Base64 data.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const output = new Uint8Array(Math.max(0, (value.length / 4) * 3 - padding));
  let buffer = 0;
  let bits = 0;
  let cursor = 0;
  for (const character of value) {
    if (character === '=') break;
    const digit = BASE64.indexOf(character);
    if (digit < 0) throw new Error('Compressed storage payload has invalid Base64 data.');
    buffer = ((buffer << 6) | digit) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (cursor < output.length) output[cursor++] = (buffer >>> bits) & 0xff;
      buffer &= (1 << bits) - 1;
    }
  }
  if (cursor !== output.length) throw new Error('Compressed storage payload is truncated.');
  return output;
}

export function compressStorageString(serialized: string): string {
  if (typeof serialized !== 'string' || serialized.length < MIN_INPUT_BYTES) return serialized;
  try {
    const encoded = PREFIX + encodeBase64(deflateSync(strToU8(serialized), { level: 6 }));
    return encoded.length <= serialized.length * (1 - MIN_SAVING_RATIO) ? encoded : serialized;
  } catch {
    return serialized;
  }
}

export function decompressStorageString(stored: string): string {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored;
  return strFromU8(inflateSync(decodeBase64(stored.slice(PREFIX.length))));
}

export function isCompressedStorageString(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
