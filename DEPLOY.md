# Habie — canlıya alma rehberi

[BASLANGIC.md](./BASLANGIC.md)'yi tamamladıysan buradasın. Kalan süre ~20 dakika.

```
✅ Neon  →  Render (gateway)  →  Netlify (frontend)  →  halkayı kapat  →  test
```

Sıra önemli — her adım bir sonrakinin ihtiyacı olan değeri üretiyor.

---

## Adım 0 ve 1 ✅ (BASLANGIC.md'de yapıldı)

- **Adım 0:** secret'lar üretildi, `.env` dolduruldu, yerelde çalıştı
- **Adım 1:** kod GitHub'a itildi

`.env` dosyandaki `SESSION_SECRET` ve `APP_SECRETS` değerlerini yanında tut —
Render ve Netlify panellerinde **birebir aynılarını** gireceksin.

---

## Adım 2 — Neon ✅ (BASLANGIC.md 0.3'te yapıldı)

Projeyi ve iki dalı zaten oluşturdun:

| Dal | Kim kullanır |
|---|---|
| `main` | **Render (canlı)** — bu adımda kullanacağın |
| `dev` | Yerel geliştirme — Adım 0'da kullandığın |

Render için **`main` dalının** pooled connection string'ini al:

1. <https://console.neon.tech> → `habie` projesi
2. **Branches** → **main**
3. **Connection string** → **Pooled connection** → kopyala

> Dikkat: `dev` dalının dizesini Render'a verme. İki ortamın ayrı kalması
> tam olarak dallanmanın amacı.

⚠️ **Ücretsiz katman:** Neon 5 dakika boştan sonra compute'u askıya alır.
İlk istek 1-3 sn gecikir. Gateway'de tekrar deneme mantığı var, testte
"ilk mesaj yavaş geldi" görürsen sebebi bu.

---

## Adım 3 — Render (10 dk)

1. <https://dashboard.render.com> → **New** → **Web Service**
2. GitHub deposunu bağla, `habie` reposunu seç
3. Ayarlar:

| Alan | Değer |
|---|---|
| Name | `habie-gateway` |
| Region | **Frankfurt** (Neon ile aynı) |
| Branch | `main` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm --workspace @habie/gateway run start` |
| Health Check Path | `/health` |
| Instance Type | **Starter ($7)** |

> **Free planı seçme.** 15 dakika trafik olmayınca servis uyur, WebSocket
> kopar ve mesajlar gelmez — tam da test etmek istediğin şey bozulur.
> Sadece hızlı bir bakış atacaksan free iş görür ama "mesaj gelmiyor"
> davranışını buna yorma.

4. **Environment** sekmesinde:

```
NODE_ENV        = production
DATABASE_URL    = <Neon pooled connection string>
SESSION_SECRET  = <Adım 0'daki değer>
APP_SECRETS     = {"projelio":"...","stokla":"..."}
ALLOWED_ORIGINS = https://ORNEK.netlify.app     ← Adım 4'ten sonra dolduracağız
```

`ALLOWED_ORIGINS`'i şimdilik boş bırakabilirsin, Adım 5'te döneceğiz.

5. **Create Web Service** → build'i bekle

✅ **Kontrol:**

```bash
curl https://habie-gateway.onrender.com/health
# {"ok":true,"db":"up","ws":0}
```

`db: "down"` görürsen `DATABASE_URL` yanlış. Render **Logs** sekmesine bak.

---

## Adım 4 — Netlify (8 dk)

1. <https://app.netlify.com> → **Add new site** → **Import an existing project**
2. GitHub → `habie` reposu
3. Build ayarları `netlify.toml`'dan otomatik gelir. Gelmezse:

| Alan | Değer |
|---|---|
| Build command | `npm install && npm --workspace @habie/demo run build` |
| Publish directory | `packages/demo/dist` |
| Functions directory | `netlify/functions` |

4. **Site configuration → Environment variables**:

```
APP_SECRETS  = {"projelio":"...","stokla":"..."}   ← Render'dakiyle AYNI
VITE_GATEWAY = https://habie-gateway.onrender.com
```

> `VITE_GATEWAY` build sırasında koda gömülür. Sonradan değiştirirsen
> **yeniden deploy** etmen gerekir, sadece env'i güncellemek yetmez.

5. Deploy → site adresini not al (`https://xxx.netlify.app`)

✅ **Kontrol:**

```bash
curl "https://<site>.netlify.app/api/habie-token?as=0"
# {"assertion":"eyJhbGciOi...","persona":{"name":"Ayşe Yılmaz","appId":"projelio"}}
```

`APP_SECRETS içinde "projelio" yok` hatası alırsan Netlify env değişkenini
girdikten sonra yeniden deploy etmedin demektir.

---

## Adım 5 — Halkayı kapat (2 dk)

Render → **Environment** → `ALLOWED_ORIGINS` değerini Netlify adresinle
güncelle (sonda **slash olmasın**):

```
ALLOWED_ORIGINS = https://harika-habie-123.netlify.app
```

Render otomatik yeniden başlar.

✅ **Kontrol:** Render loglarında şu satır:

```
[habie-gateway] izinli origin: https://harika-habie-123.netlify.app
```

---

## Adım 6 — Canlı test

İki **farklı tarayıcı** aç (aynı tarayıcının iki sekmesi olmaz —
IndexedDB paylaşılır, ikisi aynı cihaz sanılır). Chrome + Firefox, ya da
normal pencere + gizli pencere.

| Pencere | Adres |
|---|---|
| A | `https://<site>.netlify.app/?as=0` → Ayşe |
| B | `https://<site>.netlify.app/?as=1` → Zeynep |

Sıra:

1. Her iki pencerede kullanıcı adı seç (`ayse`, `zeynep`)
2. A'da arama kutusuna `zeynep` yaz → **Ekle**
3. B'de sayfayı yenile → istek görünür → kabul et
4. A'dan mesaj at → B'de **anında** düşmeli
5. B'yi kapat, A'dan iki mesaj daha at
6. B'yi aç → kapalıyken atılan mesajlar kuyruktan gelmeli

### Kuyruğun gerçekten boşaldığını doğrula

```bash
curl https://habie-gateway.onrender.com/v1/stats
```

Mesajlaşma sırasında `envelopes_pending` artar, teslim sonrası **0**'a döner.
En geç 60 saniye içinde `envelopes_total` da 0 olur (sweep). Dizin
(`users`, `devices`, `conversations`) yerinde kalır.

**Mimarinin baş iddiası tam olarak bu ekranda kanıtlanıyor.**

---

## Sık çıkan hatalar

| Belirti | Sebep |
|---|---|
| `CORS reddedildi` | `ALLOWED_ORIGINS` yanlış veya sonunda `/` var |
| `token geçersiz` | Render ve Netlify'daki `APP_SECRETS` farklı |
| WS bağlanıp hemen kopuyor | Render **free** planı — uyuyor |
| İlk mesaj 2-3 sn gecikiyor | Neon askıdan uyanıyor, normal |
| `db: "down"` | `DATABASE_URL` yanlış veya `sslmode=require` eksik |
| Function 404 | `netlify/functions` dizini deploy'a girmemiş |
| İki sekme aynı kişi görünüyor | Aynı tarayıcı — IndexedDB paylaşılıyor |

---

## Maliyet

| Servis | Aylık |
|---|---|
| Neon — Free | $0 |
| Render — Starter | $7 |
| Netlify — Free | $0 |
| **Toplam** | **$7** |

Neon Free 0.5 GB depolama veriyor; bu şema arşiv tutmadığı için fazlasıyla
yeterli. Render Starter'ı zorunlu kılan tek şey WebSocket'in uyumaması.
