import React, { useEffect, useState } from 'react';
import { HabieProvider, HabieChat } from '@habie/web';

/**
 * Sahte host uygulaması (Projelio / Stokla yerine geçiyor).
 *
 * İddiayı KENDİ backend'inden alır — Netlify Function'dan.
 * Uygulamanın secret'ı tarayıcıya hiç inmez.
 */
const GATEWAY = import.meta.env.VITE_GATEWAY ?? 'http://localhost:8787';
const TOKEN_URL = import.meta.env.VITE_TOKEN_URL ?? '/api/habie-token';

const NAMES = ['Ayşe', 'Zeynep', 'Ahmet'];

export default function App() {
  const idx = new URLSearchParams(location.search).get('as') ?? '0';
  const [assertion, setAssertion] = useState<string | null>(null);
  const [persona, setPersona] = useState<{ name: string; appId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${TOKEN_URL}?as=${idx}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? r.statusText);
        return d;
      })
      .then(d => { setAssertion(d.assertion); setPersona(d.persona); })
      .catch(e => setErr(e.message));
  }, [idx]);

  if (err) return <Box><b style={{ color: '#b91c1c' }}>Oturum alınamadı</b><br />{err}</Box>;
  if (!assertion) return <Box>Host uygulama oturumu alınıyor…</Box>;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ padding: '8px 14px', background: '#111b21', color: '#fff', fontSize: 13, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <b>{persona?.appId === 'stokla' ? 'Stokla' : 'Projelio'}</b>
        <span style={{ opacity: .7 }}>giriş: {persona?.name}</span>
        <span style={{ marginLeft: 'auto', opacity: .55, fontSize: 12 }}>
          kullanıcı değiştir:
          {NAMES.map((n, i) => (
            <a key={i} href={`?as=${i}`} style={{ color: '#2dd4bf', marginLeft: 8 }}>{n}</a>
          ))}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <HabieProvider config={{ gatewayUrl: GATEWAY, assertion, deviceName: `${persona?.name} — tarayıcı` }}>
          <HabieChat />
        </HabieProvider>
      </div>
    </div>
  );
}

const Box = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>{children}</div>
);
