/**
 * Üç servisi tek komutla başlatır: gateway + token sunucusu + arayüz.
 * Çıktılar renkli önekle ayrılır. Bağımlılık yok.
 *   npm run dev
 *
 * Ayrı ayrı çalıştırmak istersen (hata ayıklarken daha rahat):
 *   npm run dev:gateway
 *   npm run dev:token
 *   npm run dev:demo
 */
import { spawn } from 'node:child_process';

const SERVICES = [
  { name: 'gateway', color: '\x1b[36m', args: ['--workspace', '@habie/gateway', 'run', 'dev'] },
  { name: 'token  ', color: '\x1b[33m', args: ['--workspace', '@habie/demo', 'run', 'token'] },
  { name: 'web    ', color: '\x1b[35m', args: ['--workspace', '@habie/demo', 'run', 'dev'] },
];

const RESET = '\x1b[0m';
const children = [];

for (const s of SERVICES) {
  const child = spawn('npm', s.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  children.push(child);

  const prefix = `${s.color}${s.name}${RESET} │ `;
  const pipe = (stream) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) console.log(prefix + l);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on('exit', (code) => {
    if (code) console.log(`${prefix}çıkış kodu ${code}`);
  });
}

const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
