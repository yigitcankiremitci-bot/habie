import jwt from 'jsonwebtoken';
import { q } from './db.js';
import { uuidv7 } from './uuid7.js';

const SESSION_SECRET = process.env.SESSION_SECRET ?? 'dev-habie-session-secret';

export type Assertion = {
  iss: string;           // app_id — hangi uygulama iddia ediyor
  sub: string;           // o uygulamadaki kullanıcı id'si
  name?: string;
  avatar?: string;
  workspace_id?: string;
  role?: string;
};

export type Session = {
  uid: string;           // habie_user_id
  did: string;           // device_id
};

/**
 * Kimlik federasyonunun kalbi.
 *
 * Host uygulama kendi secret'ı ile "bu benim kullanıcım X" diye imzalı bir iddia üretir.
 * Gateway iddiayı doğrular ve kendi kimlik tablosunda eşler.
 *
 * Sonuç: iki uygulama iki farklı veritabanında (Supabase / Neon) olabilir,
 * hiçbirini taşımaya gerek yok. Yeni uygulama eklemek = habie_apps'e bir satır.
 */
export async function verifyAssertion(token: string): Promise<Assertion> {
  const decoded = jwt.decode(token) as any;
  if (!decoded?.iss) throw new Error('iddia içinde iss yok');

  const [app] = await q<{ jwt_secret: string }>(
    'SELECT jwt_secret FROM habie_apps WHERE id = $1',
    [decoded.iss]
  );
  if (!app) throw new Error(`bilinmeyen uygulama: ${decoded.iss}`);

  return jwt.verify(token, app.jwt_secret) as Assertion;
}

export async function resolveUser(a: Assertion) {
  const [existing] = await q(
    `SELECT u.*, i.workspace_id, i.revoked_at
       FROM habie_identities i
       JOIN habie_users u ON u.id = i.habie_user_id
      WHERE i.app_id = $1 AND i.external_user_id = $2`,
    [a.iss, a.sub]
  );

  if (existing) {
    // workspace/rol her oturumda tazelenir — şirket değişiklikleri buradan akar
    await q(
      `UPDATE habie_identities SET workspace_id = $3, role = $4
        WHERE app_id = $1 AND external_user_id = $2`,
      [a.iss, a.sub, a.workspace_id ?? null, a.role ?? null]
    );
    return existing;
  }

  const id = uuidv7();
  const [user] = await q(
    `INSERT INTO habie_users (id, display_name, avatar_url)
     VALUES ($1, $2, $3) RETURNING *`,
    [id, a.name ?? null, a.avatar ?? null]
  );
  await q(
    `INSERT INTO habie_identities (app_id, external_user_id, habie_user_id, workspace_id, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [a.iss, a.sub, id, a.workspace_id ?? null, a.role ?? null]
  );
  return { ...user, workspace_id: a.workspace_id ?? null, revoked_at: null };
}

export async function registerDevice(uid: string, deviceId: string | undefined, name: string, platform: string) {
  if (deviceId) {
    const [d] = await q(
      `UPDATE habie_devices SET last_seen_at = now()
        WHERE id = $1 AND habie_user_id = $2 AND revoked_at IS NULL RETURNING id`,
      [deviceId, uid]
    );
    if (d) return d.id as string;
  }
  const id = uuidv7();
  await q(
    `INSERT INTO habie_devices (id, habie_user_id, name, platform, last_seen_at)
     VALUES ($1, $2, $3, $4, now())`,
    [id, uid, name, platform]
  );
  return id;
}

export const signSession = (s: Session) =>
  jwt.sign(s, SESSION_SECRET, { expiresIn: '30d' });

export const verifySession = (t: string) =>
  jwt.verify(t, SESSION_SECRET) as Session;
