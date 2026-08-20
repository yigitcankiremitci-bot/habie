/**
 * Bildirim ve kalıcı depolama kurulumu.
 *
 * İkisini aynı dosyada topladım çünkü aynı ön şarta bağlılar: iOS'ta hem
 * Web Push hem kalıcı depolama, sitenin ANA EKRANA EKLENMİŞ olmasını istiyor.
 * Kullanıcıya iki ayrı sorun gibi göstermenin anlamı yok.
 */

export type SetupState = {
  /** IndexedDB kalıcı mı — tarayıcı veriyi kendiliğinden silmeyecek mi */
  persisted: boolean;
  /** Bildirim izni verildi mi */
  notifications: NotificationPermission | 'unsupported';
  /** Ana ekrandan / uygulama penceresinden mi açıldı */
  installed: boolean;
  /** Güvenli bağlam (https veya localhost) — ikisi de bunu şart koşuyor */
  secure: boolean;
  ios: boolean;
  /** Push aboneliği sunucuya kayıtlı mı */
  subscribed: boolean;
};

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true;

export async function readSetup(): Promise<SetupState> {
  return {
    persisted: (await navigator.storage?.persisted?.()) ?? false,
    notifications: 'Notification' in window ? Notification.permission : 'unsupported',
    installed: isInstalled(),
    secure: window.isSecureContext,
    ios: isIOS(),
    subscribed: Boolean(
      (await navigator.serviceWorker?.getRegistration?.())?.pushManager &&
      (await (await navigator.serviceWorker?.getRegistration?.())?.pushManager?.getSubscription?.())
    ),
  };
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (e) {
    console.warn('[habie] service worker kaydedilemedi', e);
    return null;
  }
}

/**
 * Kalıcı depolama iste.
 *
 * Chrome sezgisel karar veriyor (kurulu PWA, yüksek etkileşim); Safari
 * ana ekrana eklenmiş uygulamalara veriyor. Reddedilirse yapılacak tek şey
 * kullanıcıyı kuruluma yönlendirmek — bu yüzden false dönmesi bir hata değil.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  try { return await navigator.storage.persist(); } catch { return false; }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * Bildirimleri aç: izin iste → push aboneliği kur → sunucuya kaydet.
 *
 * DİKKAT: izin isteği KULLANICI HAREKETİNDEN çağrılmalı (düğme tıklaması).
 * Sayfa açılışında çağrılırsa Safari sessizce reddeder.
 */
export async function enableNotifications(
  vapidPublicKey: string,
  saveSubscription: (sub: PushSubscriptionJSON) => Promise<void>
): Promise<{ ok: boolean; reason?: string }> {
  if (!('Notification' in window)) return { ok: false, reason: 'Bu tarayıcı bildirimleri desteklemiyor.' };
  if (!window.isSecureContext) return { ok: false, reason: 'Bildirimler yalnızca HTTPS üzerinde çalışır.' };

  if (isIOS() && !isInstalled()) {
    return { ok: false, reason: 'iPhone\'da bildirim için önce ana ekrana eklemen gerekiyor.' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      reason: permission === 'denied'
        ? 'Bildirim izni reddedilmiş. Tarayıcı ayarlarından açman gerekiyor.'
        : 'Bildirim izni verilmedi.',
    };
  }

  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!reg) return { ok: false, reason: 'Service worker kaydedilemedi.' };
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  }));

  await saveSubscription(sub.toJSON());
  return { ok: true };
}
