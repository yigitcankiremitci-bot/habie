import { q } from './db.js';
import { notifyUser } from './notify.js';

/**
 * Zarfları teslim edildi olarak işaretler ve GÖNDERENE haber verir.
 *
 * Hem WebSocket hem REST ack'i buraya düşer — teslim bildirimi tek yerden
 * gitsin diye. Bildirim, satır sweep tarafından silinmeden ÖNCE gönderilir;
 * gönderenin kimliği yalnızca burada elimizde.
 */
export async function ackEnvelopes(deviceId: string, ids: string[]): Promise<number> {
  if (!ids?.length) return 0;

  const rows = await q<{ id: string; conversation_id: string; sender_user_id: string }>(
    `UPDATE habie_envelopes SET delivered_at = now()
      WHERE target_device_id = $1 AND id = ANY($2::uuid[]) AND delivered_at IS NULL
      RETURNING id, conversation_id, sender_user_id`,
    [deviceId, ids]
  );

  for (const r of rows) {
    await notifyUser(r.sender_user_id, {
      type: 'receipt',
      kind: 'delivered',
      id: r.id,
      conversationId: r.conversation_id,
    });
  }

  return rows.length;
}
