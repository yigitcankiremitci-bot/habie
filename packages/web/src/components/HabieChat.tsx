import React, { useEffect, useRef, useState } from 'react';
import { useHabie } from '../HabieProvider';

const C = ['#0f766e', '#7c3aed', '#c2410c', '#0369a1', '#be123c', '#4d7c0f'];
const col = (s: string) => C[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % C.length];
const ini = (s: string) => s.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

const TICK = { pending: '🕓', sent: '✓', delivered: '✓✓', read: '✓✓' } as const;

export function HabieChat() {
  const {
    ready, online, me, needsUsername, persistent,
    conversations, contacts, messages, transport, reload,
  } = useHabie();

  // TÜM hook'lar erken return'lerden ÖNCE — React kuralları gereği
  const [cur, setCur] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<any>(null);
  const [uname, setUname] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [warnHidden, setWarnHidden] = useState(false);

  const msgsRef = useRef<HTMLDivElement | null>(null);
  const conv = conversations.find(c => c.id === cur);
  const msgs = cur ? (messages[cur] ?? []) : [];

  // Yeni mesajda en alta kay
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cur, msgs.length, msgs.at(-1)?.state]);

  // Sohbeti açtığımda / yeni mesaj gelince karşı tarafa "okudum" de
  useEffect(() => {
    if (!conv || conv.type === 'agent' || !me) return;
    const unreadFromThem = msgs.some(m => m.mine === 0);
    if (!unreadFromThem) return;
    for (const p of conv.participants) {
      if (p.id !== me.id) transport.markRead(conv.id, p.id);
    }
  }, [conv?.id, msgs.length, me?.id]);

  if (!ready) return <div style={S.center}>Habie bağlanıyor…</div>;

  if (needsUsername) {
    return (
      <div style={S.center}>
        <div style={{ maxWidth: 320 }}>
          <h3 style={{ margin: '0 0 6px' }}>Kullanıcı adı seç</h3>
          <p style={{ color: '#667781', fontSize: 13, marginTop: 0 }}>
            Seni bu adla bulacaklar. 3–20 karakter, küçük harf/rakam/alt çizgi.
          </p>
          <input style={S.input} value={uname} autoFocus
                 onChange={e => setUname(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && saveUsername()}
                 placeholder="ornek_kullanici" />
          <button style={{ ...S.btn, width: '100%', marginTop: 8 }} onClick={saveUsername}>Devam</button>
        </div>
      </div>
    );
  }

  const incoming = contacts.filter(c => c.state === 'pending_in');
  const outgoing = contacts.filter(c => c.state === 'pending_out');
  const showWarn = !persistent && !warnHidden;

  async function saveUsername() {
    try {
      await transport.setUsername(uname.trim().toLowerCase());
      location.reload();
    } catch (e: any) {
      setNotice(e.message);
    }
  }

  async function search(v: string) {
    setQ(v);
    const u = v.trim().replace(/^@/, '');
    setFound(u.length >= 3 ? (await transport.lookup(u)).found : null);
  }

  async function send() {
    if (!draft.trim() || !conv) return;
    const text = draft.trim();
    setDraft('');
    await transport.send({ conversationId: conv.id }, text);
  }

  return (
    <div style={S.wrap}>
      <aside style={S.side}>
        <div style={S.head}>
          <b>Habie</b>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: online ? '#0f766e' : '#b45309' }}>
            {online ? '● çevrimiçi' : '○ bağlanıyor'}
          </span>
        </div>

        {showWarn && (
          <div style={S.warn}>
            <div style={{ flex: 1 }}>
              <b>Depolama kalıcı değil.</b> Tarayıcı, uzun süre açılmayan sitelerin
              verisini silebilir. Yayına alındığında Habie'yi ana ekrana ekleyip
              yedeklemeyi açman gerekecek.
            </div>
            <button style={S.warnX} onClick={() => setWarnHidden(true)} title="Gizle">✕</button>
          </div>
        )}

        <div style={{ padding: 8 }}>
          <input style={S.input} placeholder="@kullanıcı adı ile kişi ekle"
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

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {conversations.length === 0 && incoming.length === 0 && (
            <div style={S.hint}>Henüz sohbet yok. Yukarıdan bir kullanıcı adı aratıp kişi ekle.</div>
          )}
          {conversations.map(c => {
            const last = (messages[c.id] ?? []).at(-1);
            return (
              <div key={c.id} onClick={() => setCur(c.id)}
                   style={{ ...S.row, background: cur === c.id ? '#e6f4f1' : undefined }}>
                <div style={{ ...S.av, background: col(c.title) }}>{ini(c.title)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5, display: 'flex', gap: 6, alignItems: 'center' }}>
                    {c.title}
                    {c.pinned === 1 && <span style={{ fontSize: 10 }}>📌</span>}
                    {c.workspaceId && <span style={S.tag}>{c.workspaceId}</span>}
                  </div>
                  <div style={S.prev}>
                    {last?.mine === 1 && (
                      <span style={{ color: last.state === 'read' ? '#34b7f1' : '#8696a0' }}>
                        {TICK[last.state]}&nbsp;
                      </span>
                    )}
                    {last?.body ?? 'Henüz mesaj yok'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <main style={S.main}>
        {!conv ? (
          <div style={S.center}>
            <div style={{ textAlign: 'center', color: '#667781', maxWidth: 320 }}>
              <div style={{ fontSize: 40 }}>💬</div>
              Mesajların bu cihazda saklanır. Sunucuda arşiv tutulmaz.
            </div>
          </div>
        ) : (
          <>
            <div style={S.head}>
              <div style={{ ...S.av, background: col(conv.title), width: 36, height: 36 }}>{ini(conv.title)}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{conv.title}</div>
                <div style={{ fontSize: 12, color: '#667781' }}>
                  {conv.type === 'agent'
                    ? 'yapay zekâ ajanı'
                    : conv.participants.map(p => '@' + p.username).filter(Boolean).join(', ')}
                </div>
              </div>
            </div>

            <div style={S.msgs} ref={msgsRef}>
              {msgs.map(m => (
                <div key={m.id} style={{ ...S.b, ...(m.mine ? S.out : S.in) }}>
                  {m.body}
                  <span style={S.meta}>
                    {new Date(m.sentAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                    {m.mine === 1 && (
                      <b style={{ marginLeft: 4, color: m.state === 'read' ? '#34b7f1' : '#8696a0' }}>
                        {TICK[m.state]}
                      </b>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div style={S.composer}>
              <input style={{ ...S.input, flex: 1 }} value={draft} placeholder="Mesaj yaz"
                     onChange={e => setDraft(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && send()} />
              <button style={S.btn} onClick={send}>Gönder</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', height: '100%', fontFamily: 'system-ui, sans-serif', background: '#fff', color: '#111b21' },
  side: { width: 340, borderRight: '1px solid #e3e7ea', display: 'flex', flexDirection: 'column', minWidth: 0 },
  main: { flex: 1, display: 'flex', flexDirection: 'column', background: '#e9e3dc', minWidth: 0 },
  head: { display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', background: '#f7f9fa', borderBottom: '1px solid #e3e7ea' },
  center: { flex: 1, display: 'grid', placeItems: 'center', padding: 30, height: '100%' },
  warn: { display: 'flex', gap: 8, alignItems: 'flex-start', margin: '8px 10px 0', padding: 9, borderRadius: 8, background: '#fff5e0', color: '#7a5a12', fontSize: 11.5, lineHeight: 1.45, border: '1px solid #f0dfb4' },
  warnX: { border: 0, background: 'transparent', color: '#a08340', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 },
  input: { padding: '9px 12px', borderRadius: 8, border: '1px solid #e3e7ea', fontSize: 14, width: '100%', outline: 'none', boxSizing: 'border-box' },
  row: { display: 'flex', gap: 11, padding: '10px 12px', cursor: 'pointer', alignItems: 'center', borderBottom: '1px solid #f0f2f4' },
  prev: { fontSize: 12.5, color: '#667781', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  av: { width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, flexShrink: 0, fontSize: 15 },
  found: { display: 'flex', gap: 10, alignItems: 'center', margin: '0 10px 8px', padding: 10, borderRadius: 9, background: '#f7f9fa', border: '1px solid #e3e7ea' },
  hint: { padding: '4px 14px 10px', fontSize: 12, color: '#667781', lineHeight: 1.5 },
  notice: { margin: '0 10px 8px', padding: '8px 10px', borderRadius: 8, background: '#e6f4f1', color: '#0f766e', fontSize: 12.5, cursor: 'pointer', lineHeight: 1.45 },
  btn: { border: 0, background: '#0f766e', color: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
  tag: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: '#dbeafe', color: '#1e40af' },
  reqBox: { margin: '0 10px 8px', padding: '8px 10px', borderRadius: 9, background: '#fff8e6', border: '1px solid #f0dfb4' },
  reqTitle: { fontSize: 11, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: '#8a6d1f', marginBottom: 6 },
  reqRow: { display: 'flex', gap: 9, alignItems: 'center', padding: '4px 0' },
  msgs: { flex: 1, overflowY: 'auto', padding: '16px 5%', display: 'flex', flexDirection: 'column', gap: 3, scrollBehavior: 'smooth' },
  b: { maxWidth: '62%', padding: '7px 10px 6px', borderRadius: 10, fontSize: 14.4, boxShadow: '0 1px 1px rgba(0,0,0,.08)', wordWrap: 'break-word', whiteSpace: 'pre-wrap' },
  in: { alignSelf: 'flex-start', background: '#fff', borderTopLeftRadius: 3 },
  out: { alignSelf: 'flex-end', background: '#d4f2e7', borderTopRightRadius: 3 },
  meta: { float: 'right', margin: '6px 0 -2px 10px', fontSize: 10.5, color: '#8696a0' },
  composer: { display: 'flex', gap: 8, padding: 12, background: '#f7f9fa', borderTop: '1px solid #e3e7ea' },
};
