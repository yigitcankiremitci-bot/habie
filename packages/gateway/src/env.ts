import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Depo kökündeki .env dosyasını process.env'e yükler.
 * Bağımlılıksız — dotenv kurmaya gerek yok.
 *
 * Zaten tanımlı olan değişkenlerin ÜZERİNE YAZMAZ. Böylece Render'daki
 * gerçek ortam değişkenleri her zaman kazanır, dosya sadece yerelde etkilidir.
 */
function parseValue(raw: string): string {
  const v = raw.trim();
  // Tırnaklıysa: tırnak içi değerdir, sonrasındaki her şey yorumdur
  if ((v.startsWith('"') || v.startsWith("'")) && v.length > 1) {
    const end = v.indexOf(v[0], 1);
    if (end > 0) return v.slice(1, end);
  }
  // Tırnaksızsa: boşluk + # sonrası satır sonu yorumudur
  const c = v.search(/\s#/);
  return (c >= 0 ? v.slice(0, c) : v).trim();
}

export function loadEnv() {
  const path = join(__dirname, '../../../.env');
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;

    const eq = t.indexOf('=');
    if (eq < 1) continue;

    const key = t.slice(0, eq).trim();
    if (process.env[key] === undefined) process.env[key] = parseValue(t.slice(eq + 1));
  }
}

// ÖNEMLİ: ESM'de tüm import'lar, modül gövdesindeki hiçbir ifade çalışmadan ÖNCE
// değerlendirilir. Bu yüzden index.ts içinde "loadEnv()" çağırmak yetmiyordu —
// db.ts zaten import sırasında process.env'i okumuş oluyordu.
// Çözüm: yükleme burada, modül seviyesinde bir yan etki olarak yapılıyor.
loadEnv();

/** Gateway portu. Render `PORT` verir; yerelde çakışmasın diye ayrı isim. */
export function gatewayPort(): number {
  return Number(
    process.env.HABIE_GATEWAY_PORT ?? process.env.PORT ?? 8791
  );
}
