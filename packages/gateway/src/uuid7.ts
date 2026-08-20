import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 — ilk 48 bit Unix ms zaman damgası.
 * Sonuç: leksikografik sıralama = kronolojik sıralama.
 * Bu sayede ayrı bir `seq` sütununa ve karmaşık cursor mantığına gerek kalmıyor;
 * `WHERE id > $cursor ORDER BY id` yeterli.
 */
export function uuidv7(): string {
  const ts = Date.now();
  const b = randomBytes(16);

  b[0] = (ts / 2 ** 40) & 0xff;
  b[1] = (ts / 2 ** 32) & 0xff;
  b[2] = (ts / 2 ** 24) & 0xff;
  b[3] = (ts / 2 ** 16) & 0xff;
  b[4] = (ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;

  b[6] = (b[6] & 0x0f) | 0x70; // sürüm 7
  b[8] = (b[8] & 0x3f) | 0x80; // varyant

  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
