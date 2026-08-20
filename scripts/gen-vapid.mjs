/**
 * VAPID anahtar çifti üretir — Web Push için.
 *
 * Bağımlılıksız: web-push paketinin CLI'ına gerek yok, node:crypto yeterli.
 *   npm run vapid
 *
 * Çıkan iki değeri .env'e (ve sonra Render'a) yazacaksın. Özel anahtar
 * SUNUCUDA kalır; açık anahtar tarayıcıya gider ve gizli değildir.
 *
 * Anahtarları DEĞİŞTİRİRSEN mevcut tüm push abonelikleri geçersiz olur —
 * kullanıcıların bildirimlere yeniden izin vermesi gerekir.
 */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });

// VAPID açık anahtarı = sıkıştırılmamış EC noktası: 0x04 || X || Y  (65 bayt)
const publicKeyB64 = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(pub.x, 'base64url'),
  Buffer.from(pub.y, 'base64url'),
]).toString('base64url');

// Özel anahtar = ham d değeri (32 bayt)
const privateKeyB64 = Buffer.from(priv.d, 'base64url').toString('base64url');

console.log(`
VAPID anahtarları üretildi. Aşağıdaki iki satırı .env dosyana ekle:

VAPID_PUBLIC_KEY=${publicKeyB64}
VAPID_PRIVATE_KEY=${privateKeyB64}
VAPID_SUBJECT=mailto:info@rundeer.app

Aynı üç değer Render'da da tanımlanmalı.
Özel anahtarı paylaşma — onunla senin adına bildirim gönderilebilir.
`);
