// RFC 9562 UUIDv7 (48-bit unix-ms + random), as src/lib/uuidv7.ts.
import { randomBytes } from 'node:crypto';

export function uuidv7(ms = Date.now()) {
  const b = randomBytes(16);
  const t = BigInt(ms);
  for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(40 - 8 * i)) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
