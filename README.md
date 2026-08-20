# Habie — prototip (Faz 0 dikey dilim)

Yerel-öncelikli, modüler mesajlaşma katmanı. Bu depo mimari dokümanındaki
Faz 0'ın çalışan bir dikey dilimidir: kimlik federasyonu → kişi ekleme →
mesaj teslimi → ack → transit temizliği.

> **Buradan başla:** [BASLANGIC.md](./BASLANGIC.md) — yerelde çalıştırma ve GitHub'a itme, adım adım.
> Sonra: [DEPLOY.md](./DEPLOY.md) — Neon + Render + Netlify.

## Kurulum

```bash
npm install
cp .env.example .env        # DATABASE_URL + secret'ları doldur (BASLANGIC.md 0.3-0.4)
npm run ports               # portlar boş mu
npm run test:db             # şemayı kurar + doğrular
npm run dev                 # gateway :8791 · token :5198 · arayüz :5199
```

Veritabanı Neon'da; yerel Postgres veya Docker gerekmiyor. Portların hepsi
`.env` üzerinden değiştirilebilir.

İki kullanıcı arasında mesajlaşmayı görmek için iki sekme aç:

- <http://localhost:5199/?as=0> → Ayşe (Projelio)
- <http://localhost:5199/?as=1> → Zeynep (Projelio)

**İki farklı tarayıcı** kullan — aynı tarayıcının iki sekmesi IndexedDB'yi
paylaşır ve ikisi aynı cihaz sanılır.

Ayşe'de `@` ile Zeynep'in kullanıcı adını ara → Ekle → Zeynep kabul etsin →
mesajlaşma başlar. Bir sekmeyi kapatıp mesaj atarsan, açıldığında kuyruktan
çektiğini görürsün.

## Ne kanıtlanıyor

`npm run test:db` — mimarinin baş iddiasını gerçek Postgres üzerinde doğrular:

```
 kalan_zarf | tablo_boyutu
------------+--------------
          0 | 48 kB

 kullanici | cihaz | sohbet | mesaj_icerigi
-----------+-------+--------+---------------
         3 |     3 |      1 |             0
```

Teslim edilen mesajlar sunucudan silinir. Dizin (kim kimle, hangi cihaz)
kalır, **içerik kalmaz.** Test ayrıca şunları kontrol ediyor:

- Kimlik federasyonu: aynı kişi iki uygulamada, iki farklı veritabanında
- Gizlilik: ortak uygulaması olmayan kullanıcı aramada bulunamıyor
- Çoklu cihaz fanout: 2 cihazlı alıcıya 2 zarf satırı
- Çevrimdışı kuyruk: kapalı cihazın zarfı sweep'ten sonra da duruyor
- Şirketten ayrılma: erişim iptal, kişi bağlantısı ve sohbet duruyor

## Yapı

```
packages/
  gateway/   Node + TS. Express + ws + pg. Kimlik, kuyruk, teslim.
    migrations/001_init.sql
    test/e2e.sql            ← bağımlılıksız doğrulama
  web/       @habie/web — React + TS. Dexie, taşıma katmanı, sohbet UI.
  demo/      Sahte host uygulama. Vite. İki persona ile açılır.
```

## Bu dilimde bilerek YOK

Mimari dokümandaki sırayı takip ediyor:

| Eksik | Nerede |
|---|---|
| Drive/OneDrive yedeği | Faz 0.5 |
| QR ile cihaz ekleme | Faz 0.5 |
| Web Push + Service Worker | Faz 0 kalanı |
| Ajan sohbeti (sabit satır) | Faz 1 |
| Gruplar, dosya gönderimi | Faz 2 |
| Sesli/görüntülü arama | Faz 3 |

## Üretime taşırken

- `SESSION_SECRET` ve uygulama başına `jwt_secret` değerlerini değiştir —
  şemadaki `dev-secret-*` kayıtları sadece geliştirme içindir.
- `/v1/dev-token` ucu `NODE_ENV=production` ile kapanır. Üretimde iddiayı
  host uygulamanın kendi backend'i üretir.
- Gateway **uyumayan** bir Render instance'ı olmalı — WebSocket spin-down'ı
  kaldırmaz. Netlify Functions bu işi yapamaz.
- `sweep()` prototipte gateway içinde 60 sn'de bir dönüyor; üretimde
  pg_cron'a veya harici bir zamanlayıcıya taşı.
- `hub.ts` bellekte tutuyor. Birden fazla instance'a çıkınca Redis pub/sub
  veya NATS ile değiştir — arayüz aynı, çağıran kod değişmez.

## Bilinen sınırlar

- Zarf içeriği şu an düz JSON. `payload bytea` sütunu istemci tarafı
  şifreleme için ayrıldı, henüz doldurulmuyor.
- Okundu bilgisi (`read`) uçtan uca bağlı değil; `delivered` gerçek.
- Kullanıcı adı çakışma/rezervasyon politikası kararlaştırılmadı.
