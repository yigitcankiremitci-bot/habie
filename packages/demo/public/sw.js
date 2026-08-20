/* Habie Service Worker — bildirimler ve PWA kurulumu için.
 *
 * Bu dosya derlenmiyor, olduğu gibi sunuluyor. Sade tutuldu:
 * önbellekleme yok, sadece push + tıklama davranışı.
 */

const VERSION = 'habie-sw-1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Habie', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Habie';
  const options = {
    body: data.body || '',
    // tag: aynı sohbetten gelen bildirimler üst üste yığılmaz, sonuncusu kalır
    tag: data.tag || data.conversationId || 'habie',
    renotify: true,
    data: { conversationId: data.conversationId ?? null },
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    // iOS'ta yok sayılıyor ama Android'de mesaj bildirimi gibi davranmasını sağlıyor
    vibrate: [80, 40, 80],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Bildirime dokununca: uygulama zaten açıksa o sekmeye odaklan ve hangi
 * sohbetin açılacağını söyle; açık değilse yeni pencere aç.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const convId = event.notification.data?.conversationId;

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of all) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'habie:open-conversation', conversationId: convId });
        return;
      }
    }

    const url = convId ? `/?c=${encodeURIComponent(convId)}` : '/';
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
