import Dexie, { type Table } from 'dexie';

/**
 * İstemci deposu.
 *
 * DİKKAT — bu bir ÖNBELLEK, kaynak değil.
 * Safari, 7 gün etkileşim görmeyen sitelerin IndexedDB'sini siler ve tüm
 * tarayıcılarda IndexedDB disk baskısı altında tahliye edilebilir.
 * Kaynak, kullanıcının kendi Drive/OneDrive yedeğidir (bkz. backup.ts).
 */

export interface Message {
  id: string;                 // UUIDv7 — sıralama bedava
  conversationId: string;
  senderId: string;
  body: string;
  sentAt: string;
  state: 'pending' | 'sent' | 'delivered' | 'read';
  mine: 0 | 1;                // Dexie boolean indeksleyemez
  /**
   * Yalnızca ajan sohbetlerinde kullanılıyor: onay bekleyen bir araç çağrısı.
   * İndekslenmiyor, bu yüzden Dexie şema sürümü artırmaya gerek yok.
   */
  pending?: {
    actionId: string;
    toolName: string;
    summary: string;
    resolved?: 'confirmed' | 'cancelled';
  };
}

export interface Conversation {
  id: string;
  type: 'dm' | 'group' | 'agent';
  title: string;
  appId?: string;
  workspaceId?: string | null;
  participants: { id: string; username: string; displayName: string }[];
  lastMessageAt?: string;
  unread: number;
  pinned: 0 | 1;
}

export interface Contact {
  id: string;
  username: string;
  displayName: string;
  state: 'pending_out' | 'pending_in' | 'accepted' | 'blocked';
}

export interface OutboxItem {
  clientId: string;
  conversationId?: string;
  toUserId?: string;
  body: string;
  attempts: number;
  nextRetryAt: number;
}

export class HabieDB extends Dexie {
  messages!: Table<Message, string>;
  conversations!: Table<Conversation, string>;
  contacts!: Table<Contact, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<{ key: string; value: any }, string>;

  constructor(namespace = 'habie') {
    super(namespace);
    this.version(1).stores({
      messages: 'id, conversationId, [conversationId+id], sentAt, state',
      conversations: 'id, type, workspaceId, lastMessageAt, pinned',
      contacts: 'id, username, state',
      outbox: 'clientId, nextRetryAt',
      meta: 'key',
    });
  }

  async get<T>(key: string, fallback: T): Promise<T> {
    return (await this.meta.get(key))?.value ?? fallback;
  }
  async set(key: string, value: any) {
    await this.meta.put({ key, value });
  }
}

export const db = new HabieDB();

/**
 * İstemci tarafı UUIDv7 — ilk 48 bit zaman damgası.
 *
 * crypto.randomUUID() KULLANMA: mesajlar Dexie'de `sortBy('id')` ile
 * sıralanıyor, rastgele v4 kimlikler sohbeti karıştırır. v7 leksikografik
 * sıralamayı kronolojik sıralamaya eşitliyor ve sunucunun ürettiği
 * kimliklerle aynı biçimde.
 */
export function uuidv7(): string {
  const ts = Date.now();
  const b = crypto.getRandomValues(new Uint8Array(16));

  b[0] = (ts / 2 ** 40) & 0xff;
  b[1] = (ts / 2 ** 32) & 0xff;
  b[2] = (ts / 2 ** 24) & 0xff;
  b[3] = (ts / 2 ** 16) & 0xff;
  b[4] = (ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;

  b[6] = (b[6] & 0x0f) | 0x70; // sürüm 7
  b[8] = (b[8] & 0x3f) | 0x80; // varyant

  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota, pct: quota ? usage / quota : 0 };
}
