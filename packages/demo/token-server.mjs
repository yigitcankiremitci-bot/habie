/**
 * Yerel token sunucusu — netlify/functions/habie-token.mts'in birebir karşılığı.
 *
 * Üretimde bu iş Netlify Function'da (yani host uygulamanın backend'inde) olur.
 * Yerelde Netlify CLI kurmaya gerek kalmasın diye aynı mantığı burada çalıştırıyoruz.
 * Vite, /api isteklerini bu porta proxy'ler — böylece yerel ve canlı davranış aynı.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

function parseValue(raw) {
  let v = raw.trim();
  // Tırnaklıysa: tırnak içi değerdir, sonrasındaki her şey yorumdur
  if ((v.startsWith('"') && v.length > 1) || (v.startsWith("'") && v.length > 1)) {
    const quote = v[0];
    const end = v.indexOf(quote, 1);
    if (end > 0) return v.slice(1, end);
  }
  // Tırnaksızsa: boşluk + # sonrası satır sonu yorumudur
  const c = v.search(/\s#/);
  return (c >= 0 ? v.slice(0, c) : v).trim();
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Kökteki .env'i yükle (bağımlılıksız)
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    const k = t.slice(0, eq).trim();
    if (process.env[k] === undefined) process.env[k] = parseValue(t.slice(eq + 1));
  }
}

const PORT = Number(process.env.HABIE_TOKEN_PORT ?? 5198);

const PERSONAS = {
  '0': { appId: 'projelio', sub: 'usr_8812', name: 'Ayşe Yılmaz',   workspaceId: 'org_acme' },
  '1': { appId: 'projelio', sub: 'usr_9930', name: 'Zeynep Arslan', workspaceId: 'org_acme' },
  '2': { appId: 'stokla',   sub: 'u-441',    name: 'Ahmet Korkmaz', workspaceId: null },
};

let secrets;
try {
  secrets = JSON.parse(process.env.APP_SECRETS ?? '{}');
} catch {
  console.error('✗ APP_SECRETS geçerli JSON değil. .env dosyasını kontrol et.');
  console.error('  Beklenen biçim (tek satır):');
  console.error('  APP_SECRETS={"projelio":"deger1","stokla":"deger2"}');
  process.exit(1);
}

if (!secrets.projelio) {
  console.error('✗ APP_SECRETS içinde "projelio" anahtarı yok. .env dosyasını doldur.');
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');

  if (!url.pathname.endsWith('/habie-token')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'bulunamadı' }));
  }

  const p = PERSONAS[url.searchParams.get('as') ?? '0'] ?? PERSONAS['0'];
  const secret = secrets[p.appId];

  if (!secret) {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: `APP_SECRETS içinde "${p.appId}" yok` }));
  }

  const assertion = jwt.sign(
    { iss: p.appId, sub: p.sub, name: p.name, workspace_id: p.workspaceId, role: 'member' },
    secret,
    { expiresIn: '5m' }
  );

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ assertion, persona: { name: p.name, appId: p.appId } }));
}).listen(PORT, () => {
  console.log(`[token-server] :${PORT}  (host uygulama backend'i taklidi)`);
});
