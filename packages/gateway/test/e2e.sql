-- Habie — veri katmanı uçtan uca testi
-- routes.ts içindeki sorguların BİREBİR aynısını, gerçek Postgres üzerinde çalıştırır.
-- Amaç: mimarinin baş iddiasını kanıtlamak — teslim sonrası sunucuda arşiv kalmaz.
--
-- Çalıştırma:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test/e2e.sql

\set QUIET on
\pset pager off
\timing off

BEGIN;

-- Temiz başlangıç
TRUNCATE habie_envelopes, habie_participants, habie_conversations,
         habie_contacts, habie_devices, habie_identities, habie_users CASCADE;

\echo '=============================================='
\echo ' 1. Kimlik federasyonu — iki farklı uygulama'
\echo '=============================================='

-- Ayşe: Projelio'dan gelir (Supabase'de yaşıyor varsayalım)
INSERT INTO habie_users (id, username, display_name)
VALUES ('01920000-0000-7000-8000-00000000a001','ayse','Ayşe Yılmaz');
INSERT INTO habie_identities (app_id, external_user_id, habie_user_id, workspace_id, role)
VALUES ('projelio','usr_8812','01920000-0000-7000-8000-00000000a001','org_acme','member');

-- Zeynep: aynı uygulama, aynı şirket
INSERT INTO habie_users (id, username, display_name)
VALUES ('01920000-0000-7000-8000-00000000a002','zeynepa','Zeynep Arslan');
INSERT INTO habie_identities (app_id, external_user_id, habie_user_id, workspace_id, role)
VALUES ('projelio','usr_9930','01920000-0000-7000-8000-00000000a002','org_acme','member');

-- Ahmet: SADECE Stokla'da (Neon'da yaşıyor varsayalım) — Ayşe ile ortak uygulaması yok
INSERT INTO habie_users (id, username, display_name)
VALUES ('01920000-0000-7000-8000-00000000a003','ahmetk','Ahmet Korkmaz');
INSERT INTO habie_identities (app_id, external_user_id, habie_user_id)
VALUES ('stokla','u-441','01920000-0000-7000-8000-00000000a003');

\echo '--> Aynı kişi iki uygulamada da olabilir mi? (Zeynep Stokla''ya da kayıtlı)'
INSERT INTO habie_identities (app_id, external_user_id, habie_user_id)
VALUES ('stokla','u-702','01920000-0000-7000-8000-00000000a002');

\set QUIET off
SELECT u.username, string_agg(i.app_id, ', ' ORDER BY i.app_id) AS uygulamalar
  FROM habie_users u JOIN habie_identities i ON i.habie_user_id = u.id
 GROUP BY u.username ORDER BY u.username;
\set QUIET on

\echo ''
\echo '=============================================='
\echo ' 2. Kullanıcı adı araması — gizlilik kuralı'
\echo '=============================================='
\echo 'discoverable=apps varsayılan: yalnızca ORTAK uygulaması olanlar bulabilir.'

\set QUIET off
-- routes.ts /users/lookup içindeki "shared app" sorgusu
\echo '--> Ayşe, Zeynep''i arıyor (ortak uygulama: projelio) — BULMALI:'
SELECT count(*) AS ortak_uygulama_var
  FROM habie_identities a JOIN habie_identities b ON a.app_id = b.app_id
 WHERE a.habie_user_id = '01920000-0000-7000-8000-00000000a001'
   AND b.habie_user_id = '01920000-0000-7000-8000-00000000a002';

\echo '--> Ayşe, Ahmet''i arıyor (ortak uygulama yok) — BULMAMALI (0 beklenir):'
SELECT count(*) AS ortak_uygulama_var
  FROM habie_identities a JOIN habie_identities b ON a.app_id = b.app_id
 WHERE a.habie_user_id = '01920000-0000-7000-8000-00000000a001'
   AND b.habie_user_id = '01920000-0000-7000-8000-00000000a003';
\set QUIET on

\echo ''
\echo '=============================================='
\echo ' 3. Cihazlar — Ayşe 1, Zeynep 2 cihaz'
\echo '=============================================='
INSERT INTO habie_devices (id, habie_user_id, name, platform) VALUES
 ('01920000-0000-7000-8000-0000000d0001','01920000-0000-7000-8000-00000000a001','Chrome — Windows','web'),
 ('01920000-0000-7000-8000-0000000d0002','01920000-0000-7000-8000-00000000a002','iPhone 15','ios'),
 ('01920000-0000-7000-8000-0000000d0003','01920000-0000-7000-8000-00000000a002','MacBook','web');

\echo ''
\echo '=============================================='
\echo ' 4. Kişi ekleme — istek → kabul'
\echo '=============================================='
INSERT INTO habie_contacts VALUES
 ('01920000-0000-7000-8000-00000000a001','01920000-0000-7000-8000-00000000a002','pending_out'),
 ('01920000-0000-7000-8000-00000000a002','01920000-0000-7000-8000-00000000a001','pending_in');

UPDATE habie_contacts SET state='accepted'
 WHERE (habie_user_id,contact_user_id) IN (
   ('01920000-0000-7000-8000-00000000a001','01920000-0000-7000-8000-00000000a002'),
   ('01920000-0000-7000-8000-00000000a002','01920000-0000-7000-8000-00000000a001'));

\echo ''
\echo '=============================================='
\echo ' 5. DM oluşturma + mesaj fanout'
\echo '=============================================='
INSERT INTO habie_conversations (id, type, workspace_id)
VALUES ('01920000-0000-7000-8000-0000000c0001','dm','org_acme');
INSERT INTO habie_participants (conversation_id, habie_user_id) VALUES
 ('01920000-0000-7000-8000-0000000c0001','01920000-0000-7000-8000-00000000a001'),
 ('01920000-0000-7000-8000-0000000c0001','01920000-0000-7000-8000-00000000a002');

-- routes.ts POST /messages: hedef cihazları bul (gönderenin kendi cihazı hariç)
\set QUIET off
\echo '--> Ayşe mesaj atıyor. Kaç hedef cihaz? (Zeynep''in 2 cihazı beklenir):'
SELECT count(*) AS hedef_cihaz
  FROM habie_participants p
  JOIN habie_devices d ON d.habie_user_id = p.habie_user_id AND d.revoked_at IS NULL
 WHERE p.conversation_id = '01920000-0000-7000-8000-0000000c0001'
   AND p.left_at IS NULL
   AND d.id <> '01920000-0000-7000-8000-0000000d0001';
\set QUIET on

-- routes.ts'teki toplu INSERT ... SELECT unnest(...) — grup fanout'unda tek sorgu
INSERT INTO habie_envelopes (id, conversation_id, sender_user_id, sender_device_id, target_device_id, payload)
SELECT '01920000-0000-7000-8000-0000000e0001',
       '01920000-0000-7000-8000-0000000c0001',
       '01920000-0000-7000-8000-00000000a001',
       '01920000-0000-7000-8000-0000000d0001',
       t,
       convert_to('{"body":"Tasarım dosyalarına baktım, harika olmuş"}','UTF8')
  FROM unnest(ARRAY['01920000-0000-7000-8000-0000000d0002',
                    '01920000-0000-7000-8000-0000000d0003']::uuid[]) AS t;

\set QUIET off
\echo '--> Zarf satırı sayısı (her hedef cihaz için 1 → 2 beklenir):'
SELECT count(*) AS zarf FROM habie_envelopes;
\set QUIET on

\echo ''
\echo '=============================================='
\echo ' 6. Teslim — iPhone çevrimiçi, MacBook kapalı'
\echo '=============================================='
UPDATE habie_envelopes SET delivered_at = now()
 WHERE target_device_id = '01920000-0000-7000-8000-0000000d0002';

\set QUIET off
SELECT
  count(*) FILTER (WHERE delivered_at IS NOT NULL) AS teslim_edildi,
  count(*) FILTER (WHERE delivered_at IS NULL)     AS kuyrukta_bekliyor
FROM habie_envelopes;
\set QUIET on

\echo ''
\echo '--> Sweep çalışıyor (teslim edilenleri sil):'
\set QUIET off
DELETE FROM habie_envelopes WHERE delivered_at IS NOT NULL OR expires_at < now();
\echo '--> Sweep sonrası kalan (MacBook hâlâ kapalı olduğu için 1 beklenir):'
SELECT count(*) AS kalan FROM habie_envelopes;
\set QUIET on

\echo ''
\echo '=============================================='
\echo ' 7. MacBook bağlanıyor — cursor ile çekiyor'
\echo '=============================================='
\set QUIET off
SELECT id, convert_from(payload,'UTF8') AS icerik
  FROM habie_envelopes
 WHERE target_device_id = '01920000-0000-7000-8000-0000000d0003'
   AND delivered_at IS NULL
   AND id > '00000000-0000-0000-0000-000000000000'
 ORDER BY id;
\set QUIET on

UPDATE habie_envelopes SET delivered_at = now()
 WHERE target_device_id = '01920000-0000-7000-8000-0000000d0003';
DELETE FROM habie_envelopes WHERE delivered_at IS NOT NULL OR expires_at < now();

\echo ''
\echo '=============================================='
\echo ' 8. ASIL İDDİA: sunucuda arşiv kalmadı'
\echo '=============================================='
\set QUIET off
SELECT count(*) AS kalan_zarf,
       pg_size_pretty(pg_total_relation_size('habie_envelopes')) AS tablo_boyutu
  FROM habie_envelopes;

\echo ''
\echo '--> Dizin duruyor (kim kimle), içerik yok:'
SELECT
 (SELECT count(*) FROM habie_users)         AS kullanici,
 (SELECT count(*) FROM habie_devices)       AS cihaz,
 (SELECT count(*) FROM habie_conversations) AS sohbet,
 (SELECT count(*) FROM habie_envelopes)     AS mesaj_icerigi;
\set QUIET on

\echo ''
\echo '=============================================='
\echo ' 9. Şirketten ayrılma senaryosu'
\echo '=============================================='
UPDATE habie_identities SET revoked_at = now()
 WHERE app_id='projelio' AND external_user_id='usr_9930';

-- Workspace sohbeti kişiselleşir, kişi bağlantısı korunur
UPDATE habie_conversations SET workspace_id = NULL
 WHERE id = '01920000-0000-7000-8000-0000000c0001';

\set QUIET off
\echo '--> Zeynep''in Projelio erişimi iptal, ama Habie hesabı ve kişileri duruyor:'
SELECT u.username,
       (SELECT count(*) FROM habie_identities i
         WHERE i.habie_user_id=u.id AND i.revoked_at IS NULL) AS aktif_uygulama,
       (SELECT count(*) FROM habie_contacts c
         WHERE c.habie_user_id=u.id AND c.state='accepted')   AS kisiler
  FROM habie_users u WHERE u.username='zeynepa';

\echo '--> Sohbet kişiselleşti (workspace_id NULL = Lio erişemez):'
SELECT id, type, workspace_id FROM habie_conversations;
\set QUIET on

ROLLBACK;

\echo ''
\echo '=============================================='
\echo ' TEST BİTTİ — tüm değişiklikler geri alındı'
\echo '=============================================='
