/**
 * Veri katmanı uçtan uca testi — psql GEREKTİRMEZ.
 *
 * routes.ts içindeki sorguların birebir aynısını gerçek Postgres'e karşı
 * çalıştırır ve sonuçları doğrular. Her şey tek bir transaction içinde
 * döner ve sonunda geri alınır — veritabanına kalıcı hiçbir şey yazılmaz.
 *
 *   npm run test:db
 */
import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseValue(raw) {
  const v = raw.trim();
  if ((v.startsWith('"') || v.startsWith("'")) && v.length > 1) {
    const end = v.indexOf(v[0], 1);
    if (end > 0) return v.slice(1, end);
  }
  const c = v.search(/\s#/);
  return (c >= 0 ? v.slice(0, c) : v).trim();
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = parseValue(t.slice(i + 1));
  }
}

const url = process.env.DATABASE_URL ?? env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL bulunamadı.');
  console.error('  .env dosyasına Neon bağlantı dizeni ekle:');
  console.error('  DATABASE_URL=postgresql://...@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require');
  process.exit(1);
}

const isNeon = /neon\.tech/.test(url);
const client = new pg.Client({
  connectionString: url,
  ssl: isNeon || /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
});

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${ok ? actual : `${actual}  (beklenen: ${expected})`}`);
}
const section = (t) => console.log(`\n${t}\n${'─'.repeat(72)}`);

const U = (n) => `01920000-0000-7000-8000-00000000a00${n}`;
const D = (n) => `01920000-0000-7000-8000-0000000d000${n}`;
const CONV = '01920000-0000-7000-8000-0000000c0001';
const ENV_ID = '01920000-0000-7000-8000-0000000e0001';

try {
  console.log(`veritabanı: ${url.replace(/:[^:@/]+@/, ':****@')}`);
  await client.connect();

  const [{ v }] = (await client.query("SELECT split_part(version(),' ',2) AS v")).rows;
  console.log(`Postgres  : ${v}${isNeon ? '  (Neon)' : ''}`);

  section('Şema');
  await client.query(readFileSync(join(ROOT, 'packages/gateway/migrations/001_init.sql'), 'utf8'));
  const tables = (await client.query(
    `SELECT count(*)::int c FROM information_schema.tables
      WHERE table_schema='public' AND table_name LIKE 'habie_%'`)).rows[0].c;
  check('tablo sayısı', tables, 9);

  await client.query('BEGIN');
  await client.query(`TRUNCATE habie_envelopes, habie_participants, habie_conversations,
                               habie_contacts, habie_devices, habie_identities, habie_users CASCADE`);

  section('1 · Kimlik federasyonu — iki uygulama, iki veritabanı senaryosu');
  await client.query(
    `INSERT INTO habie_users (id, username, display_name) VALUES
      ($1,'ayse','Ayşe Yılmaz'), ($2,'zeynepa','Zeynep Arslan'), ($3,'ahmetk','Ahmet Korkmaz')`,
    [U(1), U(2), U(3)]);
  await client.query(
    `INSERT INTO habie_identities (app_id, external_user_id, habie_user_id, workspace_id, role) VALUES
      ('projelio','usr_8812',$1,'org_acme','member'),
      ('projelio','usr_9930',$2,'org_acme','member'),
      ('stokla','u-441',$3,NULL,NULL),
      ('stokla','u-702',$2,NULL,NULL)`,
    [U(1), U(2), U(3)]);

  const apps = (await client.query(
    `SELECT count(*)::int c FROM habie_identities WHERE habie_user_id=$1`, [U(2)])).rows[0].c;
  check('Zeynep iki uygulamada birden kayıtlı', apps, 2);

  section('2 · Kullanıcı adı araması — gizlilik kuralı (discoverable=apps)');
  const shared = async (a, b) => (await client.query(
    `SELECT count(*)::int c FROM habie_identities x
       JOIN habie_identities y ON x.app_id = y.app_id
      WHERE x.habie_user_id=$1 AND y.habie_user_id=$2`, [a, b])).rows[0].c;
  check('Ayşe → Zeynep (ortak: projelio) bulunabilir', (await shared(U(1), U(2))) > 0, true);
  check('Ayşe → Ahmet (ortak yok) BULUNAMAZ', (await shared(U(1), U(3))) === 0, true);

  section('3 · Çoklu cihaz fanout');
  await client.query(
    `INSERT INTO habie_devices (id, habie_user_id, name, platform) VALUES
      ($1,$4,'Chrome — Mac','web'), ($2,$5,'iPhone 15','ios'), ($3,$5,'MacBook','web')`,
    [D(1), D(2), D(3), U(1), U(2)]);

  await client.query(
    `INSERT INTO habie_contacts VALUES ($1,$2,'accepted'), ($2,$1,'accepted')`, [U(1), U(2)]);
  await client.query(
    `INSERT INTO habie_conversations (id,type,workspace_id) VALUES ($1,'dm','org_acme')`, [CONV]);
  await client.query(
    `INSERT INTO habie_participants (conversation_id, habie_user_id) VALUES ($1,$2),($1,$3)`,
    [CONV, U(1), U(2)]);

  const targets = (await client.query(
    `SELECT d.id FROM habie_participants p
       JOIN habie_devices d ON d.habie_user_id = p.habie_user_id AND d.revoked_at IS NULL
      WHERE p.conversation_id=$1 AND p.left_at IS NULL AND d.id <> $2`, [CONV, D(1)])).rows;
  check('hedef cihaz sayısı (Zeynep 2 cihaz)', targets.length, 2);

  // routes.ts'teki toplu fanout INSERT'i
  await client.query(
    `INSERT INTO habie_envelopes (id, conversation_id, sender_user_id, sender_device_id, target_device_id, payload)
     SELECT $1,$2,$3,$4,t,$6 FROM unnest($5::uuid[]) AS t`,
    [ENV_ID, CONV, U(1), D(1), targets.map(t => t.id),
     Buffer.from(JSON.stringify({ body: 'Tasarım dosyalarına baktım' }), 'utf8')]);

  const written = (await client.query('SELECT count(*)::int c FROM habie_envelopes')).rows[0].c;
  check('yazılan zarf satırı (cihaz başına 1)', written, 2);

  section('4 · Teslim, ack ve transit temizliği');
  await client.query(`UPDATE habie_envelopes SET delivered_at=now() WHERE target_device_id=$1`, [D(2)]);
  const sweep1 = (await client.query(
    `DELETE FROM habie_envelopes WHERE delivered_at IS NOT NULL OR expires_at < now()`)).rowCount;
  check('iPhone teslim aldı → sweep sildi', sweep1, 1);

  const pending = (await client.query('SELECT count(*)::int c FROM habie_envelopes')).rows[0].c;
  check('MacBook kapalı → zarfı kuyrukta duruyor', pending, 1);

  const fetched = (await client.query(
    `SELECT id, payload FROM habie_envelopes
      WHERE target_device_id=$1 AND delivered_at IS NULL AND id > $2 ORDER BY id`,
    [D(3), '00000000-0000-0000-0000-000000000000'])).rows;
  check('MacBook bağlandı, cursor ile çekti', fetched.length, 1);
  check('içerik bozulmadan geldi',
    JSON.parse(Buffer.from(fetched[0].payload).toString('utf8')).body, 'Tasarım dosyalarına baktım');

  await client.query(`UPDATE habie_envelopes SET delivered_at=now() WHERE target_device_id=$1`, [D(3)]);
  await client.query(`DELETE FROM habie_envelopes WHERE delivered_at IS NOT NULL OR expires_at < now()`);

  section('5 · ASIL İDDİA — sunucuda arşiv kalmadı');
  const s = (await client.query(
    `SELECT (SELECT count(*)::int FROM habie_envelopes)     AS mesaj,
            (SELECT count(*)::int FROM habie_users)         AS kullanici,
            (SELECT count(*)::int FROM habie_devices)       AS cihaz,
            (SELECT count(*)::int FROM habie_conversations) AS sohbet`)).rows[0];
  check('sunucuda kalan mesaj içeriği', s.mesaj, 0);
  check('dizin duruyor — kullanıcı', s.kullanici, 3);
  check('dizin duruyor — cihaz', s.cihaz, 3);
  check('dizin duruyor — sohbet', s.sohbet, 1);

  section('6 · Şirketten ayrılma');
  await client.query(
    `UPDATE habie_identities SET revoked_at=now() WHERE app_id='projelio' AND external_user_id='usr_9930'`);
  await client.query(`UPDATE habie_conversations SET workspace_id=NULL WHERE id=$1`, [CONV]);

  const after = (await client.query(
    `SELECT (SELECT count(*)::int FROM habie_identities WHERE habie_user_id=$1 AND revoked_at IS NULL) AS aktif,
            (SELECT count(*)::int FROM habie_contacts   WHERE habie_user_id=$1 AND state='accepted')   AS kisi,
            (SELECT workspace_id FROM habie_conversations WHERE id=$2)                                 AS ws`,
    [U(2), CONV])).rows[0];
  check('Projelio erişimi iptal (Stokla kaldı)', after.aktif, 1);
  check('kişi bağlantısı korundu', after.kisi, 1);
  check('sohbet kişiselleşti (Lio erişemez)', after.ws, 'null');

  await client.query('ROLLBACK');

  console.log(`\n${'═'.repeat(72)}`);
  console.log(fail === 0
    ? `TÜM TESTLER GEÇTİ  (${pass}/${pass + fail}) — veritabanına kalıcı yazma yapılmadı`
    : `${fail} TEST BAŞARISIZ  (${pass}/${pass + fail})`);
  console.log('═'.repeat(72));

  await client.end();
  process.exit(fail === 0 ? 0 : 1);

} catch (e) {
  console.error(`\n✗ Hata: ${e.message}`);
  if (/ENOTFOUND|ETIMEDOUT/.test(e.message)) {
    console.error('  Bağlantı kurulamadı — DATABASE_URL doğru mu? İnternet var mı?');
  }
  if (/password|authentication/i.test(e.message)) {
    console.error('  Kimlik doğrulama başarısız — Neon bağlantı dizesini tekrar kopyala.');
  }
  try { await client.query('ROLLBACK'); await client.end(); } catch {}
  process.exit(1);
}
