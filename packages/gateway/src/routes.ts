import { Router, type Request, type Response, type NextFunction } from 'express';
import { q } from './db.js';
import { uuidv7 } from './uuid7.js';
import { verifyAssertion, resolveUser, registerDevice, signSession, verifySession, type Session } from './auth.js';
import * as hub from './hub.js';
import { notifyUser } from './notify.js';
import { ackEnvelopes } from './ack.js';

export const router = Router();

declare global {
  namespace Express {
    interface Request { session?: Session }
  }
}

function auth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'token yok' });
  try {
    req.session = verifySession(h.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'token geçersiz' });
  }
}

/* ------------------------------------------------------------------ */
/* Oturum — host uygulamanın iddiasını Habie kimliğine çevirir          */
/* ------------------------------------------------------------------ */
router.post('/session', async (req, res) => {
  try {
    const { assertion, deviceId, deviceName, platform } = req.body ?? {};
    const a = await verifyAssertion(assertion);
    const user = await resolveUser(a);

    if (user.revoked_at) {
      return res.status(403).json({ error: 'bu uygulamadaki erişim iptal edilmiş' });
    }

    const did = await registerDevice(
      user.id, deviceId, deviceName ?? 'Bilinmeyen cihaz', platform ?? 'web'
    );

    res.json({
      token: signSession({ uid: user.id, did }),
      deviceId: did,
      needsUsername: !user.username,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        workspaceId: user.workspace_id,
      },
      app: { id: a.iss },
    });
  } catch (e: any) {
    res.status(401).json({ error: e.message });
  }
});

router.post('/username', auth, async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: '3-20 karakter, küçük harf/rakam/alt çizgi' });
  }
  try {
    await q('UPDATE habie_users SET username = $2 WHERE id = $1', [req.session!.uid, username]);
    res.json({ username });
  } catch {
    res.status(409).json({ error: 'bu kullanıcı adı alınmış' });
  }
});

router.get('/me', auth, async (req, res) => {
  const [u] = await q('SELECT id, username, display_name FROM habie_users WHERE id = $1', [req.session!.uid]);
  const apps = await q(
    `SELECT a.id, a.name, a.agent_name, i.workspace_id
       FROM habie_identities i JOIN habie_apps a ON a.id = i.app_id
      WHERE i.habie_user_id = $1 AND i.revoked_at IS NULL`,
    [req.session!.uid]
  );
  const devices = await q(
    `SELECT id, name, platform, last_seen_at FROM habie_devices
      WHERE habie_user_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
    [req.session!.uid]
  );
  res.json({ user: u, apps, devices: devices.map(d => ({ ...d, online: hub.isOnline(d.id) })) });
});

/* ------------------------------------------------------------------ */
/* Kişi arama — YALNIZCA TAM EŞLEŞME                                    */
/* Ön ek araması bilerek yok: aksi halde tüm kullanıcı listesi kazınır. */
/* ------------------------------------------------------------------ */
router.get('/users/lookup', auth, async (req, res) => {
  const username = String(req.query.username ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return res.json({ found: null });

  const [u] = await q(
    `SELECT id, username, display_name, discoverable FROM habie_users WHERE username = $1`,
    [username]
  );
  if (!u || u.id === req.session!.uid || u.discoverable === 'nobody') {
    return res.json({ found: null });
  }

  // discoverable = 'apps' → yalnızca ortak uygulaması olanlar bulabilir
  if (u.discoverable === 'apps') {
    const [shared] = await q(
      `SELECT 1 FROM habie_identities a
         JOIN habie_identities b ON a.app_id = b.app_id
        WHERE a.habie_user_id = $1 AND b.habie_user_id = $2 LIMIT 1`,
      [req.session!.uid, u.id]
    );
    if (!shared) return res.json({ found: null });
  }

  res.json({ found: { id: u.id, username: u.username, displayName: u.display_name } });
});

router.get('/contacts', auth, async (req, res) => {
  const rows = await q(
    `SELECT c.contact_user_id AS id, c.state, u.username, u.display_name
       FROM habie_contacts c JOIN habie_users u ON u.id = c.contact_user_id
      WHERE c.habie_user_id = $1 ORDER BY u.display_name`,
    [req.session!.uid]
  );
  res.json({ contacts: rows });
});

router.post('/contacts', auth, async (req, res) => {
  const me = req.session!.uid;
  const target = String(req.body?.userId ?? '');
  if (!target || target === me) return res.status(400).json({ error: 'geçersiz hedef' });

  // Karşı taraf bana zaten istek göndermişse → çift taraflı kabul
  const [incoming] = await q(
    `SELECT 1 FROM habie_contacts WHERE habie_user_id = $1 AND contact_user_id = $2 AND state = 'pending_out'`,
    [target, me]
  );
  const mine = incoming ? 'accepted' : 'pending_out';
  const theirs = incoming ? 'accepted' : 'pending_in';

  await q(
    `INSERT INTO habie_contacts (habie_user_id, contact_user_id, state) VALUES ($1,$2,$3)
     ON CONFLICT (habie_user_id, contact_user_id) DO UPDATE SET state = EXCLUDED.state`,
    [me, target, mine]
  );
  await q(
    `INSERT INTO habie_contacts (habie_user_id, contact_user_id, state) VALUES ($1,$2,$3)
     ON CONFLICT (habie_user_id, contact_user_id) DO NOTHING`,
    [target, me, theirs]
  );

  // Karşılıklı kabul oluştuysa sohbeti hemen aç — aksi halde ilk mesajı
  // atacak bir yer olmaz ve kişi hiçbir listede görünmez.
  let conversationId: string | null = null;
  if (mine === 'accepted') conversationId = await dmFor(me, target);

  // Karşı taraf sayfayı yenilemeden görsün
  await notifyUser(target, { type: 'contacts', reason: mine === 'accepted' ? 'accepted' : 'request' });

  res.json({ state: mine, conversationId });
});

router.post('/contacts/accept', auth, async (req, res) => {
  const me = req.session!.uid;
  const other = String(req.body?.userId ?? '');
  await q(`UPDATE habie_contacts SET state='accepted' WHERE habie_user_id=$1 AND contact_user_id=$2`, [me, other]);
  await q(`UPDATE habie_contacts SET state='accepted' WHERE habie_user_id=$1 AND contact_user_id=$2`, [other, me]);
  const conversationId = await dmFor(me, other);
  await notifyUser(other, { type: 'contacts', reason: 'accepted' });
  res.json({ ok: true, conversationId });
});

/* ------------------------------------------------------------------ */
/* Sohbetler                                                           */
/* ------------------------------------------------------------------ */
router.get('/conversations', auth, async (req, res) => {
  const rows = await q(
    `SELECT c.id, c.type, c.title, c.workspace_id, c.app_id,
            COALESCE(json_agg(json_build_object(
              'id', u.id, 'username', u.username, 'displayName', u.display_name
            )) FILTER (WHERE u.id IS NOT NULL), '[]') AS participants
       FROM habie_conversations c
       JOIN habie_participants p  ON p.conversation_id = c.id AND p.habie_user_id = $1 AND p.left_at IS NULL
       LEFT JOIN habie_participants p2 ON p2.conversation_id = c.id AND p2.left_at IS NULL
       LEFT JOIN habie_users u ON u.id = p2.habie_user_id
      GROUP BY c.id ORDER BY c.created_at DESC`,
    [req.session!.uid]
  );
  res.json({ conversations: rows });
});

/** Kullanıcının aktif workspace'i (varsa). Sohbeti şirket bağlamına etiketlemek için. */
async function workspaceOf(userId: string): Promise<string | null> {
  const [r] = await q(
    `SELECT workspace_id FROM habie_identities
      WHERE habie_user_id = $1 AND revoked_at IS NULL AND workspace_id IS NOT NULL LIMIT 1`,
    [userId]
  );
  return r?.workspace_id ?? null;
}

/** İki kişi arasındaki DM'i bul ya da oluştur. */
async function dmFor(a: string, b: string) {
  return ensureDm(a, b, await workspaceOf(a));
}

/** DM'i bul ya da oluştur. Kişi kabul edilmiş olmalı. */
async function ensureDm(me: string, other: string, workspaceId: string | null) {
  const [found] = await q(
    `SELECT c.id FROM habie_conversations c
       JOIN habie_participants a ON a.conversation_id = c.id AND a.habie_user_id = $1
       JOIN habie_participants b ON b.conversation_id = c.id AND b.habie_user_id = $2
      WHERE c.type = 'dm' LIMIT 1`,
    [me, other]
  );
  if (found) return found.id as string;

  const id = uuidv7();
  await q(`INSERT INTO habie_conversations (id, type, workspace_id) VALUES ($1,'dm',$2)`, [id, workspaceId]);
  await q(
    `INSERT INTO habie_participants (conversation_id, habie_user_id) VALUES ($1,$2),($1,$3)`,
    [id, me, other]
  );
  return id;
}

/* ------------------------------------------------------------------ */
/* Mesaj gönderimi → her hedef CİHAZ için bir zarf satırı               */
/* ------------------------------------------------------------------ */
router.post('/messages', auth, async (req, res) => {
  const { uid, did } = req.session!;
  const { toUserId, conversationId, body, clientId } = req.body ?? {};

  let convId: string = conversationId;
  if (!convId && toUserId) {
    const [ok] = await q(
      `SELECT 1 FROM habie_contacts WHERE habie_user_id=$1 AND contact_user_id=$2 AND state='accepted'`,
      [uid, toUserId]
    );
    if (!ok) return res.status(403).json({ error: 'kişi henüz kabul edilmemiş' });
    convId = await dmFor(uid, toUserId);
  }
  if (!convId) return res.status(400).json({ error: 'hedef yok' });

  // Alıcıların TÜM aktif cihazları — kendi cihazlarım dahil (çoklu cihaz senkronu)
  const targets = await q<{ id: string; habie_user_id: string }>(
    `SELECT d.id, d.habie_user_id
       FROM habie_participants p
       JOIN habie_devices d ON d.habie_user_id = p.habie_user_id AND d.revoked_at IS NULL
      WHERE p.conversation_id = $1 AND p.left_at IS NULL AND d.id <> $2`,
    [convId, did]
  );

  const envelopeId = uuidv7();
  const payload = Buffer.from(JSON.stringify({
    id: envelopeId, conversationId: convId, senderId: uid, body, sentAt: new Date().toISOString(),
  }), 'utf8');

  if (targets.length) {
    // Tek INSERT ile toplu yazım — grup fanout'unda N sorgu atmamak için
    await q(
      `INSERT INTO habie_envelopes (id, conversation_id, sender_user_id, sender_device_id, target_device_id, payload)
       SELECT $1, $2, $3, $4, t, $6 FROM unnest($5::uuid[]) AS t`,
      [envelopeId, convId, uid, did, targets.map(t => t.id), payload]
    );
  }

  let online = 0;
  for (const t of targets) {
    if (hub.push(t.id, { type: 'envelope', envelope: { id: envelopeId, conversationId: convId, senderId: uid, body, sentAt: new Date().toISOString() } })) {
      online++;
    }
    // else → burada Web Push "uyan" sinyali gönderilir (içerik YOK, sadece conversationId)
  }

  res.json({ id: envelopeId, clientId, conversationId: convId, targets: targets.length, delivered: online });
});

/** Yeniden bağlanma: cursor'dan sonrasını çek. UUIDv7 sayesinde sıralama kronolojik. */
router.get('/envelopes', auth, async (req, res) => {
  const after = String(req.query.after ?? '00000000-0000-0000-0000-000000000000');
  const rows = await q(
    `SELECT id, conversation_id, sender_user_id, payload, created_at
       FROM habie_envelopes
      WHERE target_device_id = $1 AND delivered_at IS NULL AND id > $2
      ORDER BY id LIMIT 500`,
    [req.session!.did, after]
  );
  res.json({
    envelopes: rows.map(r => ({
      id: r.id,
      ...JSON.parse(Buffer.from(r.payload).toString('utf8')),
    })),
  });
});

/** Ack → satır işaretlenir, sweep siler. Sunucuda arşiv kalmaz. */
router.post('/envelopes/ack', auth, async (req, res) => {
  const ids: string[] = req.body?.ids ?? [];
  res.json({ acked: await ackEnvelopes(req.session!.did, ids) });
});

/* ------------------------------------------------------------------ */
/* SADECE GELİŞTİRME — host uygulamanın backend'ini taklit eder.        */
/* Üretimde bu iddiayı Projelio'nun kendi sunucusu üretir; bu uç kapalı.*/
/* ------------------------------------------------------------------ */
router.post('/dev-token', async (req, res) => {
  if (process.env.NODE_ENV === 'production') return res.status(404).end();
  const { appId = 'projelio', userId, name, workspaceId } = req.body ?? {};
  const [app] = await q<{ jwt_secret: string }>('SELECT jwt_secret FROM habie_apps WHERE id = $1', [appId]);
  if (!app) return res.status(404).json({ error: 'uygulama yok' });

  const jwt = (await import('jsonwebtoken')).default;
  res.json({
    assertion: jwt.sign(
      { iss: appId, sub: userId, name, workspace_id: workspaceId ?? null, role: 'member' },
      app.jwt_secret,
      { expiresIn: '5m' }
    ),
  });
});

/** Gözlemlenebilirlik: kuyruğun gerçekten boş kaldığını görmek için. */
router.get('/stats', async (_req, res) => {
  const [s] = await q(
    `SELECT
       (SELECT count(*) FROM habie_users)                                  AS users,
       (SELECT count(*) FROM habie_devices WHERE revoked_at IS NULL)       AS devices,
       (SELECT count(*) FROM habie_conversations)                          AS conversations,
       (SELECT count(*) FROM habie_envelopes)                              AS envelopes_total,
       (SELECT count(*) FROM habie_envelopes WHERE delivered_at IS NULL)   AS envelopes_pending,
       pg_size_pretty(pg_total_relation_size('habie_envelopes'))           AS envelopes_size`
  );
  res.json({ ...s, wsConnections: hub.onlineCount() });
});
