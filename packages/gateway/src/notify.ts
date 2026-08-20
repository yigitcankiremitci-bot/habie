import { q } from './db.js';
import * as hub from './hub.js';

/**
 * Bir kullanıcının TÜM aktif cihazlarına anlık olay gönderir.
 *
 * Zarf teslimi kalıcı kuyruk üzerinden gider (çevrimdışıysa bekler).
 * Buradaki olaylar ise anlıktır ve kaybolabilir — kişi isteği, teslim/okundu
 * bilgisi gibi. Cihaz bağlı değilse alamaz, ama zaten açıldığında `reload()`
 * her şeyi sunucudan tazeleyecek.
 */
export async function notifyUser(
  userId: string,
  payload: unknown,
  exceptDeviceId?: string
): Promise<number> {
  const devices = await q<{ id: string }>(
    `SELECT id FROM habie_devices WHERE habie_user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );

  let delivered = 0;
  for (const d of devices) {
    if (d.id === exceptDeviceId) continue;
    if (hub.push(d.id, payload)) delivered++;
  }
  return delivered;
}
