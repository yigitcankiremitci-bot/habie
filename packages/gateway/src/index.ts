// BU IMPORT EN ÜSTTE KALMALI. env.js, import edildiği anda .env'i yüklüyor;
// ESM import'ları modül gövdesinden önce sırayla değerlendirdiği için
// db.js'ten önce gelmesi process.env'in dolu olmasını garanti ediyor.
import { gatewayPort } from './env.js';

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { router } from './routes.js';
import { migrate, syncAppSecrets, sweep, q, getPool } from './db.js';
import { verifySession } from './auth.js';
import * as hub from './hub.js';
import { notifyUser } from './notify.js';
import { ackEnvelopes } from './ack.js';

const PORT = gatewayPort();
const PROD = process.env.NODE_ENV === 'production';

if (PROD && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET tanımlı değil — üretimde zorunlu');
}

/**
 * CORS: üretimde açık uçlu bırakılamaz. ALLOWED_ORIGINS virgülle ayrılmış liste.
 * Örn: https://habie-demo.netlify.app,https://projelio.app
 */
const allowed = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',').map(s => s.trim()).filter(Boolean);

const app = express();
app.use(cors({
  origin(origin, cb) {
    if (!PROD) return cb(null, true);              // geliştirmede serbest
    if (!origin) return cb(null, true);            // sunucu-sunucu / curl
    if (allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS reddedildi: ${origin}`));
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use('/v1', router);

app.get('/health', async (_r, res) => {
  try {
    await q('SELECT 1');
    res.json({ ok: true, db: 'up', ws: hub.onlineCount() });
  } catch (e: any) {
    res.status(503).json({ ok: false, db: 'down', error: e.message });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
  const token = new URL(req.url ?? '', 'http://x').searchParams.get('token');
  let s;
  try {
    s = verifySession(token ?? '');
  } catch {
    return ws.close(4001, 'token gecersiz');
  }

  hub.attach(s.did, ws);
  await q('UPDATE habie_devices SET last_seen_at = now() WHERE id = $1', [s.did]).catch(() => {});
  ws.send(JSON.stringify({ type: 'ready', deviceId: s.did }));

  // Bağlantı kurulur kurulmaz bekleyen zarfları boşalt
  try {
    const pending = await q(
      `SELECT id, payload FROM habie_envelopes
        WHERE target_device_id = $1 AND delivered_at IS NULL ORDER BY id LIMIT 500`,
      [s.did]
    );
    for (const p of pending) {
      ws.send(JSON.stringify({
        type: 'envelope',
        envelope: { id: p.id, ...JSON.parse(Buffer.from(p.payload).toString('utf8')) },
      }));
    }
  } catch (e: any) {
    console.warn('[ws] bekleyen zarflar okunamadı:', e.message);
  }

  ws.on('message', async (raw) => {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === 'ack' && Array.isArray(m.ids)) {
      await ackEnvelopes(s!.did, m.ids).catch(e => console.warn('[ws] ack yazılamadı:', e.message));
    }

    // Okundu bilgisi: zarf çoktan silinmiş olabileceği için gönderenin kimliğini
    // istemci veriyor — o bilgi zaten yerel mesajın içinde duruyor.
    if (m.type === 'read' && m.conversationId && m.toUserId) {
      await notifyUser(m.toUserId, {
        type: 'receipt', kind: 'read', conversationId: m.conversationId,
      }).catch(() => {});
    }

    if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
  });

  ws.on('error', () => {});
  ws.on('close', () => hub.detach(s!.did, ws));
});

/**
 * Ara sunucular boştaki WebSocket'i 60 sn civarında kapatır (Render dahil).
 * 30 sn'de bir ping ile bağlantıyı canlı tutuyoruz.
 */
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.ping();
  }
}, 30_000);

try {
  await migrate();
  await syncAppSecrets();
} catch (e: any) {
  console.error('\n✗ Veritabanına bağlanılamadı.\n');
  console.error(e.message);
  if (/ECONNREFUSED/.test(e.message ?? '')) {
    console.error('\n  DATABASE_URL okunamamış olabilir — .env depo kökünde mi?');
  }
  process.exit(1);
}

setInterval(async () => {
  try {
    const n = await sweep();
    if (n) console.log(`[sweep] ${n} zarf silindi`);
  } catch (e: any) {
    console.warn('[sweep] atlandı:', e.message);
  }
}, 60_000);

server.listen(PORT, () => {
  console.log(`[habie-gateway] :${PORT} · ortam=${PROD ? 'production' : 'development'}`);
  if (PROD) console.log(`[habie-gateway] izinli origin: ${allowed.join(', ') || '(hiçbiri!)'}`);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    console.log(`[habie-gateway] ${sig} — kapanıyor`);
    server.close();
    await getPool().end().catch(() => {});
    process.exit(0);
  });
}
