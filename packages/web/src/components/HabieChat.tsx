import React, { useEffect, useRef, useState } from 'react';
import { useHabie } from '../HabieProvider';
import { db, uuidv7, type Message } from '../db';

const C = ['#0f766e', '#7c3aed', '#c2410c', '#0369a1', '#be123c', '#4d7c0f'];
const col = (s: string) => C[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % C.length];
const ini = (s: string) => s.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

const TICK = { pending: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓' } as const;

/** Geniş ekran eşiği. Altında tek panel, üstünde iki panel. */
const WIDE = '(min-width: 900px)';

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function HabieChat() {
  const {
    ready, online, me, needsUsername,
    setup, refreshSetup, turnOnNotifications, setActive,
    conversations, contacts, messages, transport, agent, logoUrl, reload,
  } = useHabie();

  // TÜM hook'lar erken return'lerden ÖNCE — React kuralları gereği
  const [cur, setCur] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any>(null);
  const [uname, setUname] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [warnHidden, setWarnHidden] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixMsg, setFixMsg] = useState<string | null>(null);

  const wide = useMedia(WIDE);
  /** Geniş ekranda sabit panel açık mı. */
  const [sidebar, setSidebar] = useState(true);
  /** Dar ekranda sohbetin üstüne binen liste açık mı. */
  const [drawer, setDrawer] = useState(false);

  const msgsRef = useRef<HTMLDivElement | null>(null);
  const conv = conversations.find(c => c.id === cur);
  const msgs = cur ? (messages[cur] ?? []) : [];

  // Yeni mesajda en alta kay
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cur, msgs.length, msgs.at(-1)?.state, thinking]);

  // Sohbeti açtığımda / yeni mesaj gelince karşı tarafa "okudum" de
  useEffect(() => {
    if (!conv || conv.type === 'agent' || !me) return;
    if (!msgs.some(m => m.mine === 0)) return;
    for (const p of conv.participants) {
      if (p.id !== me.id) transport.markRead(conv.id, p.id);
    }
  }, [conv?.id, msgs.length, me?.id]);

  // Aktif sohbeti bildir — okunmamış sayacı buna göre çalışıyor
  useEffect(() => { void setActive(cur); }, [cur]);

  // Bildirime dokununca service worker hangi sohbetin açılacağını yolluyor
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => {
      if (e.data?.type === 'habie:open-conversation' && e.data.conversationId) {
        setCur(e.data.conversationId);
      }
    };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, []);

  // Uygulamaya geri dönünce kurulum durumunu tazele (izin ayarlardan değişmiş olabilir)
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') void refreshSetup(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // Dar ekranda sohbet seçilince üste binen liste kapansın
  useEffect(() => { if (cur) setDrawer(false); }, [cur]);

  // Ekran genişleyince üste binen listeyi bırak, sabit panele dön
  useEffect(() => { if (wide) setDrawer(false); }, [wide]);

  if (!ready) return <div style={S.center}>Habie bağlanıyor…</div>;

  if (needsUsername) {
    return (
      <div style={S.center}>
        <div style={{ maxWidth: 320, width: '100%' }}>
          <h3 style={{ margin: '0 0 6px' }}>Kullanıcı adı seç</h3>
          <p style={{ color: '#667781', fontSize: 13, marginTop: 0 }}>
            Seni bu adla bulacaklar. 3–20 karakter, küçük harf/rakam/alt çizgi.
          </p>
          <input style={S.input} className="habie-input" value={uname} autoFocus
                 onChange={e => setUname(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && saveUsername()}
                 placeholder="ornek_kullanici" />
          <button style={{ ...S.btn, width: '100%', marginTop: 8 }} onClick={saveUsername}>Devam</button>
          {notice && <div style={S.notice}>{notice}</div>}
        </div>
      </div>
    );
  }

  const incoming = contacts.filter(c => c.state === 'pending_in');
  const outgoing = contacts.filter(c => c.state === 'pending_out');
  const setupOk = Boolean(setup?.persisted) && setup?.notifications === 'granted';
  const showWarn = Boolean(setup) && !setupOk && !warnHidden;

  /** Yapılabilecek her şeyi tek dokunuşta dene, kalanı kullanıcıya anlat. */
  async function fixSetup() {
    setFixing(true); setFixMsg(null);
    try {
      const { requestPersistence } = await import('../push');
      await requestPersistence();
      const r = await turnOnNotifications();
      await refreshSetup();
      const s2 = await (await import('../push')).readSetup();

      if (s2.persisted && s2.notifications === 'granted') {
        setFixMsg('✓ Hazır — depolama kalıcı, bildirimler açık.');
      } else if (!r.ok) {
        setFixMsg(r.reason ?? 'Tamamlanamadı.');
      } else if (!s2.persisted) {
        setFixMsg(s2.installed
          ? 'Bildirimler açıldı. Kalıcı depolama için biraz kullanım gerekiyor; tarayıcı kısa sürede verecek.'
          : 'Bildirimler açıldı. Kalıcı depolama için uygulamayı ana ekrana ekle.');
      }
    } catch (e: any) {
      setFixMsg(e?.message ?? 'Beklenmeyen hata.');
    } finally {
      setFixing(false);
    }
  }

  /* Dar ekran: sohbet seçiliyse yalnızca sohbet, değilse yalnızca liste.
     Geniş ekran: liste sabit panel, açılıp kapanabiliyor. */
  const listVisible = wide ? sidebar : !cur;
  const chatVisible = wide ? true : Boolean(cur);

  async function saveUsername() {
    try {
      await transport.setUsername(uname.trim().toLowerCase());
      location.reload();
    } catch (e: any) { setNotice(e.message); }
  }

  async function search(v: string) {
    setQ(v);
    const u = v.trim().replace(/^@/, '');
    setFound(u.length >= 3 ? (await transport.lookup(u)).found : null);
  }

  async function send() {
    if (!draft.trim() || !conv || thinking) return;
    const text = draft.trim();
    setDraft('');
    if (conv.type === 'agent') return sendToAgent(conv.id, text);
    await transport.send({ conversationId: conv.id }, text);
  }

  /** Ajan mesajları Habie kuyruğundan geçmez — doğrudan host uygulamaya gider. */
  async function sendToAgent(convId: string, text: string) {
    if (!agent) return;
    await db.messages.put({
      id: uuidv7(), conversationId: convId, senderId: me?.id ?? 'me',
      body: text, sentAt: new Date().toISOString(), state: 'read', mine: 1,
    });
    await reload();
    setThinking(true);
    try {
      await storeReply(convId, await agent.chat(text));
    } catch (e: any) {
      await storeReply(convId, { kind: 'message', text: `⚠ ${e.message}` });
    } finally {
      setThinking(false);
      await reload();
    }
  }

  async function storeReply(convId: string, reply: any) {
    const base = {
      id: uuidv7(), conversationId: convId, senderId: 'agent',
      sentAt: new Date().toISOString(), state: 'read' as const, mine: 0 as const,
    };
    if (reply.kind === 'confirmation') {
      await db.messages.put({
        ...base,
        body: reply.text || reply.summary,
        pending: { actionId: reply.actionId, toolName: reply.toolName, summary: reply.summary },
      });
    } else {
      await db.messages.put({ ...base, body: reply.text || '(boş yanıt)' });
    }
  }

  /** Kritik araç onayı — host uygulama bunu 10 dakika bekletiyor, sonra düşürüyor. */
  async function resolvePending(m: Message, confirmed: boolean) {
    if (!agent || !m.pending || m.pending.resolved) return;
    await db.messages.update(m.id, {
      pending: { ...m.pending, resolved: confirmed ? 'confirmed' : 'cancelled' },
    });
    await reload();
    setThinking(true);
    try {
      await storeReply(m.conversationId, await agent.confirm(m.pending.actionId, confirmed));
    } catch (e: any) {
      await storeReply(m.conversationId, { kind: 'message', text: `⚠ ${e.message}` });
    } finally {
      setThinking(false);
      await reload();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Kişi listesi paneli — hem sabit panelde hem çekmecede aynı içerik    */
  /* ------------------------------------------------------------------ */
  const listPanel = (
    <>
      <div style={S.head}>
        {!wide && cur && (
          <button style={S.iconBtn} onClick={() => setDrawer(false)} title="Kapat">✕</button>
        )}
        {logoUrl && <img src={logoUrl} alt="" style={S.logoSm} />}
        <b>Habie</b>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: online ? '#0f766e' : '#b45309' }}>
          {online ? '● çevrimiçi' : '○ bağlanıyor'}
        </span>
        {wide && (
          <button style={S.iconBtn} onClick={() => setSidebar(false)} title="Paneli gizle">⟨</button>
        )}
      </div>

      {showWarn && setup && (
        <div style={S.warn}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <b style={{ flex: 1 }}>Kurulum tamamlanmadı</b>
              <button style={S.warnX} onClick={() => setWarnHidden(true)} title="Gizle">✕</button>
            </div>

            <ul style={S.checkList}>
              <li>{setup.persisted ? '✓' : '○'} Kalıcı depolama — tarayıcı mesajlarını silmesin</li>
              <li>
                {setup.notifications === 'granted' ? '✓' : '○'} Bildirimler
                {setup.notifications === 'denied' && ' (reddedilmiş)'}
              </li>
            </ul>

            {!setup.secure && (
              <div style={S.warnNote}>
                Bu adres güvenli bağlam değil (HTTP). İkisi de yalnızca HTTPS'te
                çalışır — canlı adresten dene.
              </div>
            )}

            {setup.ios && !setup.installed && (
              <div style={S.warnNote}>
                <b>iPhone'da:</b> Safari'de paylaş düğmesi <b>􀈂</b> → <b>Ana Ekrana Ekle</b>.
                Sonra uygulamayı ana ekrandan açıp bu düğmeye bas.
              </div>
            )}

            {setup.notifications === 'denied' && (
              <div style={S.warnNote}>
                İzin daha önce reddedilmiş; tarayıcı ayarlarından bu siteye
                bildirim izni vermen gerekiyor.
              </div>
            )}

            {fixMsg && <div style={S.warnNote}>{fixMsg}</div>}

            {setup.secure && !(setup.ios && !setup.installed) && (
              <button style={{ ...S.btn, marginTop: 8, padding: '7px 12px', fontSize: 12.5 }}
                      disabled={fixing} onClick={fixSetup}>
                {fixing ? 'Ayarlanıyor…' : 'Düzelt'}
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ padding: 8 }}>
        <input style={S.input} className="habie-input" placeholder="@kullanıcı adı ile kişi ekle"
               value={q} onChange={e => search(e.target.value)} />
      </div>

      {found && (
        <div style={S.found}>
          <div style={{ ...S.av, background: col(found.displayName) }}>{ini(found.displayName)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{found.displayName}</div>
            <div style={{ fontSize: 12, color: '#667781' }}>@{found.username}</div>
          </div>
          <button style={S.btn} onClick={async () => {
            const r = await transport.addContact(found.id);
            const name = found.displayName;
            setQ(''); setFound(null);
            await reload();
            if (r.conversationId) setCur(r.conversationId);
            else setNotice(`${name} adlı kişiye istek gönderildi.`);
          }}>Ekle</button>
        </div>
      )}

      {notice && <div style={S.notice} onClick={() => setNotice(null)}>{notice}</div>}

      {outgoing.length > 0 && (
        <div style={S.hint}>Yanıt bekleyen: {outgoing.map(c => '@' + c.username).join(', ')}</div>
      )}

      {q.length >= 3 && !found && (
        <div style={S.hint}>
          @{q} bulunamadı. Kullanıcı adı <b>tam</b> yazılmalı — kısmi arama,
          listenin kazınmasını önlemek için kapalı.
        </div>
      )}

      {incoming.length > 0 && (
        <div style={S.reqBox}>
          <div style={S.reqTitle}>Gelen istekler</div>
          {incoming.map(c => (
            <div key={c.id} style={S.reqRow}>
              <div style={{ ...S.av, background: col(c.displayName), width: 34, height: 34, fontSize: 12 }}>
                {ini(c.displayName)}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.displayName}</div>
                <div style={{ fontSize: 11.5, color: '#667781' }}>@{c.username}</div>
              </div>
              <button style={{ ...S.btn, padding: '5px 11px', fontSize: 12 }}
                      onClick={async () => {
                        const r = await transport.acceptContact(c.id);
                        await reload();
                        if (r.conversationId) setCur(r.conversationId);
                      }}>Kabul</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {conversations.length === 0 && incoming.length === 0 && (
          <div style={S.hint}>Henüz sohbet yok. Yukarıdan bir kullanıcı adı aratıp kişi ekle.</div>
        )}
        {conversations.map(c => {
          const last = (messages[c.id] ?? []).at(-1);
          return (
            <div key={c.id} onClick={() => setCur(c.id)}
                 style={{ ...S.row, background: cur === c.id && wide ? '#e6f4f1' : undefined }}>
              <div style={{ ...S.av, background: col(c.title) }}>{ini(c.title)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={S.rowTitle}>
                  {c.title}
                  {c.pinned === 1 && <span style={{ fontSize: 10 }}>📌</span>}
                  {c.workspaceId && <span style={S.tag}>{c.workspaceId}</span>}
                </div>
                <div style={S.prevRow}>
                  <span style={S.prev}>
                    {last?.mine === 1 && c.type !== 'agent' && (
                      <span style={{ color: last.state === 'read' ? '#34b7f1' : '#8696a0' }}>
                        {TICK[last.state]}&nbsp;
                      </span>
                    )}
                    {last?.body ?? 'Henüz mesaj yok'}
                  </span>
                  {c.unread > 0 && (
                    <span style={S.badge}>{c.unread > 99 ? '99+' : c.unread}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  /* ------------------------------------------------------------------ */
  /* Sohbet paneli                                                       */
  /* ------------------------------------------------------------------ */
  const chatPanel = !conv ? (
    <div style={S.center}>
      <div style={{ textAlign: 'center', color: '#667781', maxWidth: 320 }}>
        <div style={{ fontSize: 40 }}>💬</div>
        Mesajların bu cihazda saklanır. Sunucuda arşiv tutulmaz.
      </div>
    </div>
  ) : (
    <>
      <div style={S.head}>
        {!wide && (
          <button style={S.iconBtn} onClick={() => setCur(null)} title="Geri">‹</button>
        )}
        {!wide && (
          <button style={S.iconBtn} onClick={() => setDrawer(true)} title="Sohbetler">☰</button>
        )}
        {wide && !sidebar && (
          <button style={S.iconBtn} onClick={() => setSidebar(true)} title="Paneli göster">☰</button>
        )}
        <div style={{ ...S.av, background: col(conv.title), width: 36, height: 36, fontSize: 13 }}>
          {ini(conv.title)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={S.chatTitle}>{conv.title}</div>
          <div style={S.sub}>
            {conv.type === 'agent'
              ? `${conv.appId ?? ''} yapay zekâ ajanı`.trim()
              : conv.participants.map(p => '@' + p.username).filter(Boolean).join(', ')}
          </div>
        </div>
      </div>

      <div style={S.msgs} ref={msgsRef}>
        {msgs.map(m => (
          <div key={m.id} style={{ ...S.b, ...(m.mine ? S.out : S.in) }}>
            {m.body}

            {m.pending && (
              <div style={S.confirm}>
                <div style={S.confirmHead}>⚠ Onay gerekiyor</div>
                <div style={S.confirmBody}>{m.pending.summary}</div>
                {m.pending.resolved ? (
                  <div style={S.confirmDone}>
                    {m.pending.resolved === 'confirmed' ? '✓ Onaylandı' : '✕ Vazgeçildi'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button style={{ ...S.btn, padding: '6px 12px', fontSize: 12.5 }}
                            disabled={thinking} onClick={() => resolvePending(m, true)}>Onayla</button>
                    <button style={{ ...S.btn, ...S.btnGhost, padding: '6px 12px', fontSize: 12.5 }}
                            disabled={thinking} onClick={() => resolvePending(m, false)}>Vazgeç</button>
                  </div>
                )}
              </div>
            )}

            <span style={S.meta}>
              {new Date(m.sentAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
              {m.mine === 1 && conv.type !== 'agent' && (
                <b style={{ marginLeft: 4, color: m.state === 'read' ? '#34b7f1' : '#8696a0' }}>
                  {TICK[m.state]}
                </b>
              )}
            </span>
          </div>
        ))}

        {thinking && (
          <div style={{ ...S.b, ...S.in, display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={S.dot} />
            <span style={{ ...S.dot, animationDelay: '.2s' }} />
            <span style={{ ...S.dot, animationDelay: '.4s' }} />
          </div>
        )}
      </div>

      <div style={S.composer}>
        <input style={{ ...S.input, flex: 1 }} className="habie-input" value={draft}
               placeholder={conv.type === 'agent'
                 ? (thinking ? `${conv.title} düşünüyor…` : `${conv.title}'ya yaz`)
                 : 'Mesaj yaz'}
               disabled={thinking}
               onChange={e => setDraft(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && send()} />
        <button style={S.btn} onClick={send} disabled={thinking}>Gönder</button>
      </div>
    </>
  );

  return (
    <div style={S.wrap}>
      <style>{`
        @keyframes habieBlink{0%,60%,100%{opacity:.25;transform:translateY(0)}30%{opacity:1;transform:translateY(-3px)}}
        /* iOS Safari, 16px'ten küçük yazı tipli girişte sayfayı otomatik yakınlaştırır */
        @media (max-width: 899px){ .habie-input{ font-size:16px !important } }
      `}</style>

      {/* Geniş ekran: sabit panel. Dar ekran: sohbet yokken tam ekran liste. */}
      {listVisible && (
        <aside style={{
          ...S.side,
          width: wide ? 340 : '100%',
          borderRight: wide ? '1px solid #e3e7ea' : 'none',
        }}>
          {listPanel}
        </aside>
      )}

      {chatVisible && <main style={S.main}>{chatPanel}</main>}

      {/* Dar ekranda sohbetteyken üste binen liste — sidebar mantığı korunuyor */}
      {!wide && cur && (
        <>
          <div style={{ ...S.backdrop, ...(drawer ? S.backdropOn : null) }}
               onClick={() => setDrawer(false)} />
          <aside style={{ ...S.drawer, transform: drawer ? 'translateX(0)' : 'translateX(-100%)' }}>
            {listPanel}
          </aside>
        </>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', height: '100%', fontFamily: 'system-ui, sans-serif', background: '#fff', color: '#111b21', position: 'relative', overflow: 'hidden' },
  side: { flexShrink: 0, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#fff' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#e9e3dc', minWidth: 0 },
  head: { display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', background: '#f7f9fa', borderBottom: '1px solid #e3e7ea', flexShrink: 0 },
  chatTitle: { fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  sub: { fontSize: 12, color: '#667781', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  center: { flex: 1, display: 'grid', placeItems: 'center', padding: 24, height: '100%' },
  logoSm: { width: 26, height: 26, objectFit: 'contain', flexShrink: 0 },
  iconBtn: { border: 0, background: 'transparent', color: '#41525d', fontSize: 19, lineHeight: 1, cursor: 'pointer', padding: '2px 4px', flexShrink: 0 },
  warn: { display: 'flex', gap: 8, alignItems: 'flex-start', margin: '8px 10px 0', padding: 9, borderRadius: 8, background: '#fff5e0', color: '#7a5a12', fontSize: 11.5, lineHeight: 1.45, border: '1px solid #f0dfb4' },
  warnX: { border: 0, background: 'transparent', color: '#a08340', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid #e3e7ea', fontSize: 14, width: '100%', outline: 'none', boxSizing: 'border-box' },
  row: { display: 'flex', gap: 11, padding: '11px 12px', cursor: 'pointer', alignItems: 'center', borderBottom: '1px solid #f0f2f4' },
  rowTitle: { fontWeight: 600, fontSize: 14.5, display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  prevRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, minWidth: 0 },
  badge: { background: '#0f766e', color: '#fff', borderRadius: 11, minWidth: 20, height: 20, padding: '0 6px', fontSize: 11.5, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 },
  checkList: { margin: '6px 0 0', padding: 0, listStyle: 'none', fontSize: 11.5, lineHeight: 1.7 },
  warnNote: { marginTop: 6, fontSize: 11.5, lineHeight: 1.5, opacity: .95 },
  prev: { flex: 1, fontSize: 12.5, color: '#667781', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 },
  av: { width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, flexShrink: 0, fontSize: 15 },
  found: { display: 'flex', gap: 10, alignItems: 'center', margin: '0 10px 8px', padding: 10, borderRadius: 9, background: '#f7f9fa', border: '1px solid #e3e7ea' },
  hint: { padding: '4px 14px 10px', fontSize: 12, color: '#667781', lineHeight: 1.5 },
  notice: { margin: '0 10px 8px', padding: '8px 10px', borderRadius: 8, background: '#e6f4f1', color: '#0f766e', fontSize: 12.5, cursor: 'pointer', lineHeight: 1.45 },
  btn: { border: 0, background: '#0f766e', color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
  btnGhost: { background: '#e3e7ea', color: '#41525d' },
  tag: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: '#dbeafe', color: '#1e40af', flexShrink: 0 },
  reqBox: { margin: '0 10px 8px', padding: '8px 10px', borderRadius: 9, background: '#fff8e6', border: '1px solid #f0dfb4' },
  reqTitle: { fontSize: 11, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: '#8a6d1f', marginBottom: 6 },
  reqRow: { display: 'flex', gap: 9, alignItems: 'center', padding: '4px 0' },
  confirm: { marginTop: 8, padding: '9px 11px', borderRadius: 8, background: '#fff5e0', border: '1px solid #f0dfb4' },
  confirmHead: { fontSize: 11, fontWeight: 700, color: '#8a6d1f', letterSpacing: .3, marginBottom: 4 },
  confirmBody: { fontSize: 13, color: '#5c4a10', lineHeight: 1.45 },
  confirmDone: { fontSize: 12.5, fontWeight: 600, color: '#0f766e', marginTop: 6 },
  dot: { width: 7, height: 7, borderRadius: '50%', background: '#8696a0', display: 'inline-block', animation: 'habieBlink 1.3s infinite' },
  msgs: { flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 5%', display: 'flex', flexDirection: 'column', gap: 3 },
  b: { maxWidth: 'min(78%, 560px)', padding: '7px 10px 6px', borderRadius: 10, fontSize: 14.4, boxShadow: '0 1px 1px rgba(0,0,0,.08)', wordWrap: 'break-word', whiteSpace: 'pre-wrap' },
  in: { alignSelf: 'flex-start', background: '#fff', borderTopLeftRadius: 3 },
  out: { alignSelf: 'flex-end', background: '#d4f2e7', borderTopRightRadius: 3 },
  meta: { float: 'right', margin: '6px 0 -2px 10px', fontSize: 10.5, color: '#8696a0' },
  composer: { display: 'flex', gap: 8, padding: 10, background: '#f7f9fa', borderTop: '1px solid #e3e7ea', flexShrink: 0, paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' },
  backdrop: { position: 'absolute', inset: 0, background: 'rgba(11,20,26,.45)', opacity: 0, pointerEvents: 'none', transition: 'opacity .2s', zIndex: 5 },
  backdropOn: { opacity: 1, pointerEvents: 'auto' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 'min(86vw, 340px)', background: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '2px 0 16px rgba(11,20,26,.2)', transition: 'transform .22s ease', zIndex: 6 },
};
