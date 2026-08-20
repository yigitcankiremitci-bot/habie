import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Transport, type HabieConfig } from './transport';
import { AgentClient, agentConversationId } from './agent';
import { db, type Contact, type Conversation, type Message } from './db';
import {
  requestPersistence, registerServiceWorker, readSetup, enableNotifications,
  type SetupState,
} from './push';

type Ctx = {
  transport: Transport;
  ready: boolean;
  online: boolean;
  me: { id: string; username: string | null; displayName: string } | null;
  needsUsername: boolean;
  persistent: boolean;
  /** Kalıcı depolama + bildirim durumu — kurulum panelini besliyor. */
  setup: SetupState | null;
  refreshSetup: () => Promise<void>;
  /** Bildirimleri aç. KULLANICI HAREKETİNDEN çağrılmalı. */
  turnOnNotifications: () => Promise<{ ok: boolean; reason?: string }>;
  /** Açık sohbeti bildir — okunmamış sayacı buna göre çalışıyor. */
  setActive: (conversationId: string | null) => Promise<void>;
  conversations: Conversation[];
  contacts: Contact[];
  /** Host uygulamanın ajanı (Lio). Yapılandırılmadıysa null. */
  agent: AgentClient | null;
  messages: Record<string, Message[]>;
  reload: () => Promise<void>;
};

const HabieCtx = createContext<Ctx | null>(null);
export const useHabie = () => {
  const c = useContext(HabieCtx);
  if (!c) throw new Error('useHabie, <HabieProvider> içinde çağrılmalı');
  return c;
};

export function HabieProvider({ config, children }: { config: HabieConfig; children: React.ReactNode }) {
  const transport = useMemo(() => new Transport(config), [config.gatewayUrl, config.assertion]);
  const agent = useMemo(
    () => (config.agent ? new AgentClient(config.agent) : null),
    [config.agent?.baseUrl, config.agent?.token, config.agent?.id]
  );
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [me, setMe] = useState<Ctx['me']>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const booted = useRef(false);

  async function reload() {
    const [{ conversations: rows }, { contacts: contactRows }] =
      await Promise.all([transport.conversations(), transport.contacts()]);
    const meNow = await db.get<any>('me', null);

    const cs: Contact[] = (contactRows ?? []).map((c: any) => ({
      id: c.id, username: c.username, displayName: c.display_name, state: c.state,
    }));
    await db.contacts.bulkPut(cs);
    setContacts(cs);

    // Okunmamış sayısı yalnızca istemcide tutuluyor — sunucudan gelen
    // listeyle ezmemek için önce mevcut değerleri okuyoruz.
    const prevUnread = new Map<string, number>(
      (await db.conversations.toArray()).map(c => [c.id, c.unread ?? 0])
    );

    const list: Conversation[] = rows.map((c: any) => {
      const others = (c.participants ?? []).filter((p: any) => p.id !== meNow?.id);
      return {
        id: c.id,
        type: c.type,
        appId: c.app_id ?? undefined,
        workspaceId: c.workspace_id,
        participants: c.participants ?? [],
        title: c.title ?? (others.map((o: any) => o.displayName).join(', ') || 'Sohbet'),
        unread: prevUnread.get(c.id) ?? 0,
        pinned: c.type === 'agent' ? 1 : 0,
      };
    });
    await db.conversations.bulkPut(list);

    /**
     * Ajan sohbeti sunucuda YOK — istemcide üretiliyor.
     * Habie'nin mesajlaşma alanına ait değil: zarf kuyruğundan geçmiyor,
     * geçmişi host uygulamada duruyor. Bu yüzden veritabanına yazmıyoruz.
     */
    const full = [...list];
    if (config.agent) {
      full.unshift({
        id: agentConversationId(config.agent.id),
        type: 'agent',
        appId: config.agent.id,
        workspaceId: null,
        participants: [],
        title: config.agent.name,
        unread: 0,
        pinned: 1,
      });
    }

    setConversations(full.sort((a, b) => b.pinned - a.pinned));

    const byConv: Record<string, Message[]> = {};
    for (const c of full) {
      byConv[c.id] = await db.messages.where('conversationId').equals(c.id).sortBy('id');
    }
    setMessages(byConv);
  }

  const refreshSetup = async () => setSetup(await readSetup());

  const turnOnNotifications = async () => {
    const { enabled, publicKey } = await transport.pushKey().catch(() => ({ enabled: false, publicKey: null }));
    if (!enabled || !publicKey) {
      return { ok: false, reason: 'Sunucuda bildirim anahtarları tanımlı değil (VAPID).' };
    }
    const r = await enableNotifications(publicKey, sub => transport.savePushSubscription(sub));
    await refreshSetup();
    return r;
  };

  const setActive = async (conversationId: string | null) => {
    transport.setActive(conversationId);
    if (conversationId) {
      await db.conversations.update(conversationId, { unread: 0 });
      await reload();
    }
  };

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;

    const off = transport.on(async (e) => {
      if (e.type === 'online') { setOnline(true); await transport.catchUp(); await reload(); }
      if (e.type === 'offline') setOnline(false);
      if (e.type === 'message' || e.type === 'sent') await reload();
      // Kişi isteği geldi/kabul edildi → listeyi tazele (sayfa yenilemeye gerek yok)
      if (e.type === 'contacts') await reload();
      // Teslim/okundu makbuzu → tikleri güncelle
      if (e.type === 'receipt') await reload();
    });

    (async () => {
      // Kalıcılığı ilk mesajdan ÖNCE iste — sonradan istemek çok daha az kabul görüyor
      await registerServiceWorker();
      setPersistent(await requestPersistence());
      await refreshSetup();
      const s = await transport.connect();
      setMe(s.user);
      setNeedsUsername(s.needsUsername);
      await transport.catchUp();
      await reload();
      setReady(true);
    })().catch(console.error);

    return () => { off(); transport.disconnect(); };
  }, [transport]);

  return (
    <HabieCtx.Provider value={{ transport, agent, ready, online, me, needsUsername, persistent, setup, refreshSetup, turnOnNotifications, setActive, conversations, contacts, messages, reload }}>
      {children}
    </HabieCtx.Provider>
  );
}
