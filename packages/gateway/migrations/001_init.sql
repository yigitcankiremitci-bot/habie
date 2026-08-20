-- Habie gateway — ilk şema
-- Not: burada ARŞİV YOK. Sadece dizin (kim kimle) + transit kuyruğu.

CREATE EXTENSION IF NOT EXISTS citext;

-- Host uygulamalar. Her biri kendi secret'ı ile JWT imzalar.
CREATE TABLE IF NOT EXISTS habie_apps (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  jwt_secret     text NOT NULL,
  agent_name     text,
  agent_avatar   text,
  agent_endpoint text,
  mcp_endpoint   text
);

CREATE TABLE IF NOT EXISTS habie_users (
  id           uuid PRIMARY KEY,
  username     citext UNIQUE,                 -- ilk girişte seçilir, NULL olabilir
  display_name text,
  avatar_url   text,
  discoverable text NOT NULL DEFAULT 'apps',  -- anyone | apps | nobody
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT username_fmt CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$')
);

-- Bir Habie kullanıcısı, N host uygulamasındaki N kimliğe bağlanır.
CREATE TABLE IF NOT EXISTS habie_identities (
  app_id           text NOT NULL REFERENCES habie_apps(id),
  external_user_id text NOT NULL,
  habie_user_id    uuid NOT NULL REFERENCES habie_users(id) ON DELETE CASCADE,
  workspace_id     text,
  role             text,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,               -- şirketten ayrılma
  PRIMARY KEY (app_id, external_user_id)
);
CREATE INDEX IF NOT EXISTS idx_identities_user ON habie_identities(habie_user_id);

CREATE TABLE IF NOT EXISTS habie_devices (
  id            uuid PRIMARY KEY,
  habie_user_id uuid NOT NULL REFERENCES habie_users(id) ON DELETE CASCADE,
  name          text,
  platform      text,
  push_endpoint jsonb,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON habie_devices(habie_user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS habie_contacts (
  habie_user_id   uuid NOT NULL REFERENCES habie_users(id) ON DELETE CASCADE,
  contact_user_id uuid NOT NULL REFERENCES habie_users(id) ON DELETE CASCADE,
  state           text NOT NULL,              -- pending_out | pending_in | accepted | blocked
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (habie_user_id, contact_user_id)
);

CREATE TABLE IF NOT EXISTS habie_conversations (
  id           uuid PRIMARY KEY,
  type         text NOT NULL,                 -- dm | group | agent
  app_id       text REFERENCES habie_apps(id),
  workspace_id text,                          -- NULL = kişisel
  title        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS habie_participants (
  conversation_id uuid NOT NULL REFERENCES habie_conversations(id) ON DELETE CASCADE,
  habie_user_id   uuid NOT NULL REFERENCES habie_users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member',
  joined_at       timestamptz NOT NULL DEFAULT now(),
  left_at         timestamptz,
  PRIMARY KEY (conversation_id, habie_user_id)
);
CREATE INDEX IF NOT EXISTS idx_participants_user ON habie_participants(habie_user_id) WHERE left_at IS NULL;

-- ---------------------------------------------------------------
-- TRANSİT KUYRUĞU. Teslim edilince silinir. Burası asla büyümez.
-- Boyutu kullanıcı sayısıyla değil, ÇEVRİMDIŞI cihaz sayısıyla orantılıdır.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS habie_envelopes (
  id               uuid NOT NULL,             -- UUIDv7 = MESAJ kimliği. Tüm hedef cihazlarda AYNI.
  conversation_id  uuid NOT NULL,
  sender_user_id   uuid NOT NULL,
  sender_device_id uuid,
  target_device_id uuid NOT NULL,             -- her hedef cihaz için AYRI satır
  payload          bytea NOT NULL,            -- ileride istemci tarafında şifrelenecek
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '30 days',
  delivered_at     timestamptz,
  -- Bileşik anahtar ŞART: aynı mesaj N cihaza gidince N satır olur, id'leri aynıdır.
  -- Tekil id PK olsaydı çoklu cihazlı her gönderim çakışırdı.
  -- Cursor mantığı bozulmaz: bir cihaz için id'ler yine tekil ve kronolojik sıralı.
  PRIMARY KEY (target_device_id, id)
);
CREATE INDEX IF NOT EXISTS idx_envelopes_pending
  ON habie_envelopes (target_device_id, id) WHERE delivered_at IS NULL;

CREATE TABLE IF NOT EXISTS habie_blobs (
  id           uuid PRIMARY KEY,
  storage_key  text NOT NULL,
  size_bytes   bigint,
  content_type text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

-- Uygulama kayıtları. jwt_secret DEĞERLERİ BURADA DEĞİL —
-- gateway açılışta APP_SECRETS ortam değişkeninden yazar (bkz. db.ts syncAppSecrets).
-- Buradaki satırlar yalnızca yerel geliştirme içindir ve secret'ları üzerine yazılır.
INSERT INTO habie_apps (id, name, jwt_secret) VALUES
  ('projelio', 'Projelio', 'yerel-gelistirme-projelio'),
  ('stokla',   'Stokla',   'yerel-gelistirme-stokla')
ON CONFLICT (id) DO NOTHING;
