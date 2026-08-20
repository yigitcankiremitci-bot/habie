import React, { useCallback, useEffect, useState } from 'react';
import { HabieProvider, HabieChat, type AgentConfig } from '@habie/web';

/**
 * Geliştirmede gateway de Vite proxy'sinden geçiyor — böylece telefondan
 * bakarken de doğru yere gidiyor (localhost telefonun kendisi olurdu).
 */
const GATEWAY = import.meta.env.DEV
  ? '/habie-api'
  : (import.meta.env.VITE_GATEWAY ?? 'http://localhost:8791');
const TOKEN_URL = import.meta.env.VITE_TOKEN_URL ?? '/api/habie-token';
/**
 * Geliştirmede Vite proxy'si üzerinden gidiyoruz (CORS'a takılmamak için),
 * üretimde doğrudan Projelio API'sine. Ajan çağrıları da aynı tabanı kullanır.
 */
const PROJELIO_API = import.meta.env.DEV
  ? '/projelio-api'
  : (import.meta.env.VITE_PROJELIO_API ?? 'https://projelio-backend.onrender.com');

const TOKEN_KEY = 'projelio_token';
/** Ajan jetonu 30 dk ömürlü — dolmadan önce tazele. */
const REFRESH_MS = 20 * 60 * 1000;

type Session = {
  assertion: string;
  agent?: AgentConfig;
  label: string;
  mode: 'projelio' | 'demo';
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  /**
   * Gerçek Projelio oturumu.
   *
   * /habie/session tek çağrıda iki jeton döner: Habie'nin kimlik iddiası ve
   * Lio ile konuşmak için kısa ömürlü bir Projelio jetonu.
   */
  const loadProjelio = useCallback(async (token: string): Promise<Session> => {
    const r = await fetch(`${PROJELIO_API}/habie/session`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.message ?? `Projelio oturumu alınamadı (${r.status})`);

    return {
      assertion: d.assertion,
      label: `${d.user.name} · Projelio`,
      mode: 'projelio',
      agent: {
        id: d.agent.id,
        name: d.agent.name,
        baseUrl: PROJELIO_API,
        chatPath: d.agent.chatPath,
        confirmPath: d.agent.confirmPath,
        token: d.agent.token,
      },
    };
  }, []);

  // Açılışta saklı Projelio jetonu varsa onunla devam et
  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) { setBusy(false); return; }
    loadProjelio(saved)
      .then(setSession)
      .catch(e => { localStorage.removeItem(TOKEN_KEY); setErr(e.message); })
      .finally(() => setBusy(false));
  }, [loadProjelio]);

  // Ajan jetonunu süresi dolmadan tazele
  useEffect(() => {
    if (session?.mode !== 'projelio') return;
    const t = setInterval(() => {
      const saved = localStorage.getItem(TOKEN_KEY);
      if (saved) loadProjelio(saved).then(setSession).catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [session?.mode, loadProjelio]);

  async function login(email: string, password: string) {
    setErr(null); setBusy(true);
    try {
      const r = await fetch(`${PROJELIO_API}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.message ?? 'Giriş başarısız');

      // Projelio /auth/login → { token }  (auth.service.ts signToken)
      const token = d.token ?? d.accessToken ?? d.access_token;
      if (!token) throw new Error('Yanıtta jeton bulunamadı — /auth/login biçimi beklenenden farklı.');

      localStorage.setItem(TOKEN_KEY, token);
      setSession(await loadProjelio(token));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function demoPersona(as: number) {
    setErr(null); setBusy(true);
    try {
      const r = await fetch(`${TOKEN_URL}?as=${as}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? 'Demo oturumu alınamadı');
      setSession({ assertion: d.assertion, label: `${d.persona.name} · demo`, mode: 'demo' });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  }

  if (busy && !session) return <Center>Yükleniyor…</Center>;
  if (!session) return <SignIn onLogin={login} onDemo={demoPersona} err={err} />;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>
      <div style={bar}>
        <b>{session.mode === 'projelio' ? 'Projelio' : 'Demo'}</b>
        <span style={{ opacity: .7 }}>{session.label}</span>
        {session.agent && <span style={pill}>{session.agent.name} bağlı</span>}
        <button style={link} onClick={signOut}>çıkış</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <HabieProvider
          config={{
            gatewayUrl: GATEWAY,
            assertion: session.assertion,
            deviceName: `${session.label} — tarayıcı`,
            agent: session.agent,
          }}
        >
          <HabieChat />
        </HabieProvider>
      </div>
    </div>
  );
}

function SignIn({ onLogin, onDemo, err }: {
  onLogin: (e: string, p: string) => void;
  onDemo: (as: number) => void;
  err: string | null;
}) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');

  return (
    <Center>
      <div style={{ width: 320 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 20 }}>Habie</h2>
        <p style={{ color: '#667781', fontSize: 13, marginTop: 0 }}>
          Lio ile konuşmak için Projelio hesabınla gir.
        </p>

        <input style={inp} placeholder="e-posta" value={email} autoComplete="username"
               onChange={e => setEmail(e.target.value)} />
        <input style={{ ...inp, marginTop: 8 }} placeholder="parola" type="password"
               value={pw} autoComplete="current-password"
               onChange={e => setPw(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && onLogin(email, pw)} />

        <button style={{ ...btn, width: '100%', marginTop: 10 }} onClick={() => onLogin(email, pw)}>
          Projelio ile gir
        </button>

        {err && <div style={errBox}>{err}</div>}

        <div style={sep}>veya mesajlaşmayı denemek için</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['Ayşe', 'Zeynep', 'Ahmet'].map((n, i) => (
            <button key={i} style={{ ...btn, ...ghost, flex: 1, fontSize: 12.5, padding: '8px 4px' }}
                    onClick={() => onDemo(i)}>{n}</button>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: '#8696a0', marginTop: 8, lineHeight: 1.5 }}>
          Demo kullanıcılarında Lio yok — mesajlaşmayı iki tarayıcıda test etmek için.
        </div>
      </div>
    </Center>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <div style={{ height: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', background: '#f0f2f5' }}>
    {children}
  </div>
);

const bar: React.CSSProperties = { padding: '8px 14px', background: '#111b21', color: '#fff', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center' };
const pill: React.CSSProperties = { marginLeft: 'auto', fontSize: 11, background: '#0f766e', padding: '2px 8px', borderRadius: 20 };
const link: React.CSSProperties = { background: 'none', border: 0, color: '#8696a0', cursor: 'pointer', fontSize: 12 };
const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d8dde1', fontSize: 14, boxSizing: 'border-box', outline: 'none' };
const btn: React.CSSProperties = { border: 0, background: '#0f766e', color: '#fff', borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
const ghost: React.CSSProperties = { background: '#e3e7ea', color: '#41525d' };
const errBox: React.CSSProperties = { marginTop: 10, padding: '9px 11px', borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 12.5, lineHeight: 1.45 };
const sep: React.CSSProperties = { margin: '18px 0 8px', fontSize: 11.5, color: '#8696a0', textAlign: 'center' };
