import webpush from 'web-push';
import { q } from './db.js';

/**
 * Web Push.
 *
 * ⚠ İÇERİK NOTU — mimari dokümandan sapma, bilinçli ve geçici:
 *
 * Doküman "push yükünde içerik olmasın, sadece conversationId gitsin, istemci
 * çekip çözsün" diyordu. O kural UÇTAN UCA ŞİFRELEME devreye girdiğinde
 * zorunlu olacak, çünkü o noktada sunucu mesajı zaten okuyamıyor olacak.
 *
 * Bugün öyle değiliz: zarf yükü sunucudan düz geçiyor, dolayısıyla önizlemeyi
 * burada üretebiliyoruz. Gizlilik açısından da savunulabilir — Web Push
 * yükleri istemcinin anahtarlarıyla şifreleniyor (RFC 8291), push servisi
 * (Apple/Google) içeriği OKUYAMIYOR.
 *
 * E2EE geldiğinde burası "sadece uyandır" moduna dönecek.
 */

let ready = false;

export function initPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    console.warn('[push] VAPID anahtarları yok — bildirimler kapalı. (npm run vapid)');
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  ready = true;
  console.log('[push] VAPID hazır');
  return true;
}

export const pushEnabled = () => ready;
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY?.trim() ?? null;

export async function saveSubscription(deviceId: string, subscription: unknown) {
  await q('UPDATE habie_devices SET push_endpoint = $2 WHERE id = $1', [
    deviceId,
    JSON.stringify(subscription),
  ]);
}

export async function clearSubscription(deviceId: string) {
  await q('UPDATE habie_devices SET push_endpoint = NULL WHERE id = $1', [deviceId]);
}

export type PushPayload = {
  title: string;
  body: string;
  conversationId: string;
  tag?: string;
};

/**
 * Tek cihaza bildirim. Abonelik ölmüşse (404/410) kaydı temizler —
 * aksi halde silinmiş tarayıcı profilleri sonsuza kadar denenir.
 */
export async function sendToDevice(deviceId: string, payload: PushPayload): Promise<boolean> {
  if (!ready) return false;

  const [row] = await q<{ push_endpoint: any }>(
    'SELECT push_endpoint FROM habie_devices WHERE id = $1 AND revoked_at IS NULL',
    [deviceId]
  );
  if (!row?.push_endpoint) return false;

  try {
    await webpush.sendNotification(row.push_endpoint, JSON.stringify(payload), { TTL: 24 * 60 * 60 });
    return true;
  } catch (err: any) {
    const status = err?.statusCode;
    if (status === 404 || status === 410) {
      await clearSubscription(deviceId).catch(() => {});
      console.log(`[push] abonelik ölmüş, temizlendi: ${deviceId}`);
    } else {
      console.warn(`[push] gönderilemedi (${status ?? '?'}): ${err?.message ?? err}`);
    }
    return false;
  }
}

/** Bildirim metnini kısalt — kilit ekranında zaten kırpılıyor. */
export function preview(text: string, max = 120): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}
