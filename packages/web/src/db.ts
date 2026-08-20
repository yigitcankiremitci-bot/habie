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
 * Kalıcı depolama talebi. WebKit bunu sezgisel veriyor; en güçlü sinyal
 * sitenin Ana Ekrana eklenmiş olması. Bu yüzden dönen değeri UI'da göster —
 * false ise kullanıcıyı PWA kurulumuna ve yedeklemeye yönlendir.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota, pct: quota ? usage / quota : 0 };
}
