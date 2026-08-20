import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Havuz TEMBEL oluşturuluyor.
 *
 * Modül seviyesinde oluşturulsaydı, .env yüklenmeden önce process.env okunurdu
 * (ESM import'ları gövdeden önce değerlendirilir). Böylece yükleme sırası ne
 * olursa olsun doğru değer okunuyor.
 */
let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (_pool) return _pool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL tanımlı değil.\n' +
      '  Depo kökündeki .env dosyasına Neon bağlantı dizeni ekle:\n' +
      '  DATABASE_URL=postgresql://...@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require'
    );
  }

  const needsSsl = /neon\.tech/.test(url) || /sslmode=require/.test(url) || process.env.PGSSL === 'require';

  _pool = new pg.Pool({
    connectionString: url,
    // Neon TLS zorunlu. sslmode=require dizede olsa bile node-postgres'e ayrıca söylemek gerekiyor.
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PG_POOL_MAX ?? 8),
    // Neon ücretsiz katman 5 dk boştan sonra compute'u askıya alır ve boştaki
    // bağlantıları düşürür. Havuzu ondan önce kendimiz boşaltıyoruz.
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 15_000,
  });

  /**
   * KRİTİK: bu handler olmadan Neon askıya alındığında boştaki bağlantı düşer,
   * pg 'error' olayı yayar ve Node yakalanmamış istisnayla ÇÖKER.
   * Render'da bu "servis rastgele yeniden başlıyor" olarak görünür.
   */
  _pool.on('error', (err) => {
    console.warn('[db] boştaki bağlantı düştü (Neon askıya almış olabilir):', err.message);
  });

  return _pool;
}

export async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  // Neon uyanırken ilk sorgu bağlantı hatası verebilir — bir kez tekrar dene.
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await getPool().query(text, params);
      return r.rows as T[];
    } catch (e: any) {
      const retriable = /ECONNRESET|Connection terminated|timeout|ENOTFOUND/i.test(e.message);
      if (!retriable || attempt >= 1) throw e;
      console.warn('[db] tekrar deneniyor:', e.message);
      await new Promise(r => setTimeout(r, 1200));
    }
  }
}

export async function migrate() {
  const sql = readFileSync(join(__dirname, '../migrations/001_init.sql'), 'utf8');
  await getPool().query(sql);
  console.log('[db] şema hazır');
}

/**
 * Uygulama secret'ları SQL'de değil ortam değişkeninde durur.
 * APP_SECRETS='{"projelio":"...","stokla":"..."}'
 */
export async function syncAppSecrets() {
  const raw = process.env.APP_SECRETS;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('APP_SECRETS tanımlı değil — üretimde zorunlu');
    }
    return;
  }
  const secrets = JSON.parse(raw) as Record<string, string>;
  for (const [appId, secret] of Object.entries(secrets)) {
    await q(
      `INSERT INTO habie_apps (id, name, jwt_secret)
       VALUES ($1, initcap($1), $2)
       ON CONFLICT (id) DO UPDATE SET jwt_secret = EXCLUDED.jwt_secret`,
      [appId, secret]
    );
  }
  console.log(`[db] ${Object.keys(secrets).length} uygulama secret'ı güncellendi`);
}

/** Transit temizliği. Üretimde pg_cron'a taşınabilir. */
export async function sweep(): Promise<number> {
  const r = await getPool().query(
    `DELETE FROM habie_envelopes
      WHERE delivered_at IS NOT NULL OR expires_at < now()`
  );
  return r.rowCount ?? 0;
}
