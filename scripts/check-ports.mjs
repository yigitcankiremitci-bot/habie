/**
 * Habie'nin kullanacağı portlar boş mu? Hiçbir şeyi başlatmadan önce çalıştır.
 *   npm run ports
 */
import { createServer } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseValue(raw) {
  let v = raw.trim();
  // Tırnaklıysa: tırnak içi değerdir, sonrasındaki her şey yorumdur
  if ((v.startsWith('"') && v.length > 1) || (v.startsWith("'") && v.length > 1)) {
    const quote = v[0];
    const end = v.indexOf(quote, 1);
    if (end > 0) return v.slice(1, end);
  }
  // Tırnaksızsa: boşluk + # sonrası satır sonu yorumudur
  const c = v.search(/\s#/);
  return (c >= 0 ? v.slice(0, c) : v).trim();
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
const p = join(ROOT, '.env');
if (existsSync(p)) {
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) env[t.slice(0, eq).trim()] = parseValue(t.slice(eq + 1));
  }
}

// Uzak veritabanı (Neon) kullanılıyorsa yerel Postgres portunu kontrol etmeye gerek yok
const remoteDb = Boolean(process.env.DATABASE_URL ?? env.DATABASE_URL);

const PORTS = [
  ['HABIE_GATEWAY_PORT', env.HABIE_GATEWAY_PORT ?? 8791,  'Gateway + WebSocket'],
  ['HABIE_WEB_PORT',     env.HABIE_WEB_PORT     ?? 5199,  'Vite arayüz'],
  ['HABIE_TOKEN_PORT',   env.HABIE_TOKEN_PORT   ?? 5198,  'Token sunucusu'],
];
if (!remoteDb) {
  PORTS.unshift(['HABIE_DB_PORT', env.HABIE_DB_PORT ?? 55432, 'Postgres (yerel)']);
}

const free = (port) => new Promise((resolve) => {
  const s = createServer();
  s.once('error', () => resolve(false));
  s.once('listening', () => s.close(() => resolve(true)));
  s.listen(port, '127.0.0.1');
});

console.log(existsSync(p) ? '.env okundu' : '.env yok — varsayılanlar kontrol ediliyor');
if (remoteDb) console.log('DATABASE_URL tanımlı → uzak veritabanı, yerel Postgres portu atlanıyor');
console.log();

let bad = 0;
for (const [key, port, label] of PORTS) {
  const ok = await free(Number(port));
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'}  ${String(port).padEnd(6)} ${label.padEnd(22)} ${ok ? 'boş' : 'DOLU  → .env içinde ' + key + ' değerini değiştir'}`);
}

if (bad) {
  console.log(`\n${bad} port dolu. .env dosyasındaki değerleri değiştirip tekrar çalıştır.`);
  console.log('Öneri: 40000-60000 aralığından rastgele bir sayı seç, çakışma ihtimali düşük.');
  process.exit(1);
}
console.log('\nTüm portlar boş. Devam edebilirsin.');
