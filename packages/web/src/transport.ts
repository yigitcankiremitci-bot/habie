import { db, uuidv7, type Message } from './db';

export type HabieConfig = {
  gatewayUrl: string;      // https://habie.onrender.com
  assertion: string;       // host uygulamanın imzaladığı JWT
  deviceName?: string;
  /**
   * Host uygulamanın ajanı. Verilirse sohbet listesinin en üstünde sabit bir
   * satır olarak çıkar. Habie gateway'i bu akışa hiç girmez (bkz. agent.ts).
   */
  agent?: import('./agent').AgentConfig;
};

type Handler = (e: { type: string; [k: string]: any }) => void;

/**
 * Gateway ile konuşan tek katman. Dışarıya sadece olay yayar;
 * kalıcılık ve UI bunun üstünde durur.
 */
export class Transport {
  private ws?: WebSocket;
  private token?: string;
  private handlers = new Set<Handler>();
  private retry = 0;
  private closed = false;
  /** Açık olan sohbet — gelen mesaj buraya aitse okunmamış sayılmaz. */
  private activeId: string | null = null;

  constructor(private cfg: HabieConfig) {}

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  private emit(e: any) {
    this.handlers.forEach(h => h(e));
  }

  private async api(path: string, init: RequestInit = {}) {
    const r = await fetch(`${this.cfg.gatewayUrl}/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...init.headers,
      },
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
    return r.json();
  }

  /** Host uygulamanın iddiasını Habie oturumuna çevirir. */
  async connect() {
    const deviceId = await db.get<string | null>('deviceId', null);
    const res = await this.api('/session', {
      method: 'POST',
      body: JSON.stringify({
        assertion: this.cfg.assertion,
        deviceId,
        deviceName: this.cfg.deviceName ?? navigator.userAgent.slice(0, 60),
        platform: 'web',
      }),
    });

    this.token = res.token;
    await db.set('deviceId', res.deviceId);
    await db.set('me', res.user);
    this.emit({ type: 'session', ...res });

    this.openSocket();
    void this.drainOutbox();
    return res;
  }

  private openSocket() {
    if (this.closed) return;

    /**
     * gatewayUrl göreli olabilir ('/habie-api' — geliştirmede Vite proxy'si).
     * WebSocket mutlak URL ister, o yüzden sayfanın origin'iyle tamamlıyoruz.
     */
    const base = this.cfg.gatewayUrl.startsWith('/')
      ? location.origin.replace(/^http/, 'ws') + this.cfg.gatewayUrl
      : this.cfg.gatewayUrl.replace(/^http/, 'ws');

    this.ws = new WebSocket(`${base}/ws?token=${this.token}`);

    this.ws.onopen = () => {
      this.retry = 0;
      this.emit({ type: 'online' });
      void this.drainOutbox();
    };

    this.ws.onmessage = async (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'envelope') {
        await this.ingest(m.envelope);
        this.ws?.send(JSON.stringify({ type: 'ack', ids: [m.envelope.id] }));
      } else if (m.type === 'receipt') {
        await this.applyReceipt(m);
      } else {
        this.emit(m);
      }
    };

    this.ws.onclose = () => {
      this.emit({ type: 'offline' });
      if (this.closed) return;
      // Üstel geri çekilme, 30 sn tavan
      const wait = Math.min(30_000, 800 * 2 ** this.retry++);
      setTimeout(() => this.openSocket(), wait);
    };
  }

  /** Gelen zarfı yerel depoya yaz. Tekilleştirme id üzerinden — tekrar teslim zararsız. */
  setActive(conversationId: string | null) {
    this.activeId = conversationId;
  }

  private async ingest(env: any) {
    const me = await db.get<any>('me', null);
    const msg: Message = {
      id: env.id,
      conversationId: env.conversationId,
      senderId: env.senderId,
      body: env.body,
      sentAt: env.sentAt,
      state: 'delivered',
      mine: env.senderId === me?.id ? 1 : 0,
    };
    // Aynı zarf iki kez gelebilir (WS + catchUp) — tekrar sayma
    const known = await db.messages.get(env.id);
    await db.messages.put(msg);

    const patch: any = { lastMessageAt: env.sentAt };
    if (!known && msg.mine === 0 && env.conversationId !== this.activeId) {
      const c = await db.conversations.get(env.conversationId);
      patch.unread = (c?.unread ?? 0) + 1;
    }
    await db.conversations.update(env.conversationId, patch);

    this.emit({ type: 'message', message: msg });
  }

  /**
   * Teslim / okundu makbuzları — kendi mesajlarımın durumunu günceller.
   * pending → sent → delivered → read
   */
  private async applyReceipt(m: any) {
    if (m.kind === 'delivered' && m.id) {
      const msg = await db.messages.get(m.id);
      // 'read', 'delivered'ın üstünde — geri düşürme
      if (msg && msg.mine === 1 && msg.state !== 'read') {
        await db.messages.update(m.id, { state: 'delivered' });
      }
    }

    if (m.kind === 'read' && m.conversationId) {
      const rows = await db.messages.where('conversationId').equals(m.conversationId).toArray();
      await Promise.all(
        rows.filter(x => x.mine === 1 && x.state !== 'read')
            .map(x => db.messages.update(x.id, { state: 'read' }))
      );
    }

    this.emit({ type: 'receipt', kind: m.kind, conversationId: m.conversationId });
  }

  /** Sohbeti açtığımda karşı tarafa "okudum" de. */
  markRead(conversationId: string, toUserId: string) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'read', conversationId, toUserId }));
    }
  }

  /** Çevrimdışı yakalandıysa cursor'dan sonrasını çek. */
  async catchUp() {
    const cursor = await db.get('cursor', '00000000-0000-0000-0000-000000000000');
    const { envelopes } = await this.api(`/envelopes?after=${cursor}`);
    for (const e of envelopes) await this.ingest(e);
    if (envelopes.length) {
      await this.api('/envelopes/ack', {
        method: 'POST',
        body: JSON.stringify({ ids: envelopes.map((e: any) => e.id) }),
      });
      await db.set('cursor', envelopes[envelopes.length - 1].id);
    }
  }

  /**
   * Gönderim: ÖNCE yerel yaz (UI anında güncellensin), sonra kuyruğa koy.
   * Ağ yoksa outbox'ta bekler, bağlantı gelince drainOutbox gönderir.
   */
  async send(target: { conversationId?: string; toUserId?: string }, body: string) {
    const clientId = uuidv7();   // v4 DEĞİL: sıralama id'ye dayanıyor
    const me = await db.get<any>('me', null);

    const local: Message = {
      id: clientId,
      conversationId: target.conversationId ?? `pending:${target.toUserId}`,
      senderId: me?.id ?? 'me',
      body,
      sentAt: new Date().toISOString(),
      state: 'pending',
      mine: 1,
    };
    await db.messages.put(local);
    this.emit({ type: 'message', message: local });

    await db.outbox.put({ clientId, ...target, body, attempts: 0, nextRetryAt: 0 });
    void this.drainOutbox();
    return local;
  }

  private draining = false;
  private async drainOutbox() {
    if (this.draining || !this.token) return;
    this.draining = true;
    try {
      const items = await db.outbox.toArray();
      for (const it of items) {
        if (it.nextRetryAt > Date.now()) continue;
        try {
          const res = await this.api('/messages', {
            method: 'POST',
            body: JSON.stringify({
              conversationId: it.conversationId,
              toUserId: it.toUserId,
              body: it.body,
              clientId: it.clientId,
            }),
          });
          // Geçici yerel kaydı sunucunun verdiği gerçek id ile değiştir
          await db.messages.delete(it.clientId);
          await db.messages.put({
            id: res.id,
            conversationId: res.conversationId,
            senderId: (await db.get<any>('me', null))?.id,
            body: it.body,
            sentAt: new Date().toISOString(),
            state: res.delivered > 0 ? 'delivered' : 'sent',
            mine: 1,
          });
          await db.outbox.delete(it.clientId);
          this.emit({ type: 'sent', clientId: it.clientId, id: res.id, conversationId: res.conversationId });
        } catch {
          await db.outbox.update(it.clientId, {
            attempts: it.attempts + 1,
            nextRetryAt: Date.now() + Math.min(60_000, 1000 * 2 ** it.attempts),
          });
        }
      }
    } finally {
      this.draining = false;
    }
  }

  pushKey = () => this.api('/push/key');
  savePushSubscription = (subscription: PushSubscriptionJSON) =>
    this.api('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
  removePushSubscription = () =>
    this.api('/push/unsubscribe', { method: 'POST' });

  setUsername = (username: string) =>
    this.api('/username', { method: 'POST', body: JSON.stringify({ username }) });
  lookup = (username: string) =>
    this.api(`/users/lookup?username=${encodeURIComponent(username)}`);
  addContact = (userId: string) =>
    this.api('/contacts', { method: 'POST', body: JSON.stringify({ userId }) });
  acceptContact = (userId: string) =>
    this.api('/contacts/accept', { method: 'POST', body: JSON.stringify({ userId }) });
  contacts = () => this.api('/contacts');
  conversations = () => this.api('/conversations');
  me = () => this.api('/me');

  disconnect() {
    this.closed = true;
    this.ws?.close();
  }
}
