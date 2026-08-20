import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// package.json'da "type": "module" olduğu için config ESM olarak yükleniyor —
// __dirname burada tanımlı değil.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

export default defineConfig(({ mode }) => {
  // Depo kökündeki .env'i oku (VITE_ öneki olmayanlar dahil)
  const env = loadEnv(mode, ROOT, '');
  const gateway = env.VITE_GATEWAY ?? `http://localhost:${env.HABIE_GATEWAY_PORT ?? 8791}`;
  const projelio = env.VITE_PROJELIO_API ?? 'https://projelio-backend.onrender.com';

  return {
    plugins: [react()],
    envDir: ROOT,
    resolve: {
      alias: { '@habie/web': resolve(HERE, '../web/src/index.ts') },
    },
    define: {
      // Yerelde de üretimde de aynı değişken adı kullanılsın
      'import.meta.env.VITE_GATEWAY': JSON.stringify(gateway),
    },
    server: {
      // Alias hedefi demo klasörünün dışında — Vite'ın dosya erişimine izin ver
      fs: { allow: [ROOT] },
      /**
       * Telefondan test edebilmek için LAN'a aç.
       * Terminalde "Network: http://192.168.x.x:5199" satırı çıkar.
       */
      host: true,
      port: Number(env.HABIE_WEB_PORT ?? 5199),
      // Port doluysa SESSİZCE başka porta kaymasın — hata versin.
      strictPort: true,
      proxy: {
        // Netlify Function'ın yerel karşılığı (netlify dev kullanmadan)
        '/api': `http://localhost:${env.HABIE_TOKEN_PORT ?? 5198}`,

        /**
         * Projelio API'si — yalnızca geliştirmede.
         *
         * Doğrudan çağırsaydık tarayıcı CORS reddederdi ("Failed to fetch"),
         * çünkü Projelio'nun CORS_ORIGINS listesinde localhost yok — ve olmamalı.
         * Proxy sayesinde istek tarayıcı açısından aynı origin'den gidiyor.
         * Üretimde bu yol kullanılmaz; VITE_PROJELIO_API devreye girer.
         */
        /**
         * Habie gateway — WebSocket dahil.
         *
         * Telefondan bakarken `localhost` telefonun KENDİSİNİ gösterir, Mac'i
         * değil. Gateway'i de Vite üzerinden geçirince istemci göreli yol
         * kullanıyor ve her cihazda doğru yere gidiyor.
         */
        '/habie-api': {
          target: gateway,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/habie-api/, ''),
        },

        '/projelio-api': {
          target: projelio,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/projelio-api/, ''),
        },
      },
    },
  };
});
