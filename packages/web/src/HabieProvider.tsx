import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Transport, type HabieConfig } from './transport';
import { db, requestPersistence, type Contact, type Conversation, type Message } from './db';

type Ctx = {
  transport: Transport;
  ready: boolean;
  online: boolean;
  me: { id: string; username: string | null; displayName: string } | null;
  needsUsername: boolean;
  persistent: boolean;
  conversations: Conversation[];
  contacts: Contact[];
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
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  const [me, setMe] = useState<Ctx['me']>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [persistent, setPersistent] = useState(false);
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

    const list: Conversation[] = rows.map((c: any) => {
      const others = (c.participants ?? []).filter((p: any) => p.id !== meNow?.id);
      return {
        id: c.id,
        type: c.type,
        appId: c.app_id ?? undefined,
        workspaceId: c.workspace_id,
        participants: c.participants ?? [],
        title: c.title ?? (others.map((o: any) => o.displayName).join(', ') || 'Sohbet'),
        unread: 0,
        pinned: c.type === 'agent' ? 1 : 0,
      };
    });
    await db.conversations.bulkPut(list);
    setConversations(list.sort((a, b) => b.pinned - a.pinned));

    const byConv: Record<string, Message[]> = {};
    for (const c of list) {
      byConv[c.id] = await db.messages.where('conversationId').equals(c.id).sortBy('id');
    }
    setMessages(byConv);
  }

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
      setPersistent(await requestPersistence());
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
    <HabieCtx.Provider value={{ transport, ready, online, me, needsUsername, persistent, conversations, contacts, messages, reload }}>
      {children}
    </HabieCtx.Provider>
  );
}
