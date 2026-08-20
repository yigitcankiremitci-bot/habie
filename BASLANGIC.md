# Habie — Adım 0 ve 1

**Neon yolu** — makinene Docker veya Postgres kurmuyorsun. Veritabanı baştan
Neon'da, yerelde de ona bağlanıyorsun.

Bu dosya iki şeyi kapsıyor: **yerelde çalıştırmak** (Adım 0) ve **GitHub'a
itmek** (Adım 1). Render + Netlify [DEPLOY.md](./DEPLOY.md)'de.

Her adımın sonunda **✅ Kontrol** var. O geçmeden ilerleme — sonraki adımda
çıkan hatanın kaynağını bulmak çok daha zor.

---

# ADIM 0 — Yerelde çalıştır

## 0.1 · Gereksinimler ✅ tamam

```
node -v        v24.18.0    ✓
git --version  2.39.5      ✓
docker         gerekmiyor  ✓
```

Node 24, gereken 22'nin üstünde. Docker'a ihtiyaç yok — Neon kullanacağız.

---

## 0.2 · Aç ve bağımlılıkları kur (3 dk)

```bash
tar -xzf habie-prototip.tar.gz
cd habie
npm install
```

⚠️ **Benim test edemediğim tek adım bu.** Sandbox'ta npm registry kapalı
olduğu için `npm install`'ı çalıştıramadım. Hata çıkarsa çıktıyı olduğu gibi
bana at.

✅ **Kontrol:**

```bash
ls node_modules/express node_modules/pg node_modules/ws node_modules/dexie >/dev/null \
  && echo "bağımlılıklar tamam"
```

---

## 0.3 · Neon projesini kur (8 dk)

### 0.3.1 · Proje aç

1. <https://console.neon.tech> → GitHub ile giriş yap
2. **New Project**
3. Ayarlar:

| Alan | Değer |
|---|---|
| Project name | `habie` |
| Postgres version | **16** |
| Region | **AWS eu-central-1 (Frankfurt)** |

> Frankfurt'u seç: Render'ı da oraya kuracağız, ikisi arasındaki gecikme
> 1-2 ms'e düşecek. Senin Mac'inden Frankfurt'a ~50-60 ms olacak, bu yerel
> geliştirme için sorun değil.

4. **Create project**

### 0.3.2 · Geliştirme dalı aç

Neon'un dallanma özelliği tam bu iş için var: canlı veriye dokunmadan
geliştirme yaparsın.

1. Sol menüden **Branches** → **New Branch**
2. **Name:** `dev`
3. **Parent:** `main`
4. **Create**

Artık iki ortamın var:

| Dal | Kim kullanır |
|---|---|
| `main` | Render (canlı) — Adım 3'te |
| `dev` | Senin Mac'in (yerel geliştirme) — şimdi |

### 0.3.3 · Bağlantı dizesini al

1. **Branches** → **dev** dalını seç
2. **Connection string** kutusunda:
   - **Pooled connection** işaretli olsun (adres `-pooler` içermeli)
   - Rolü `neondb_owner` bırak
3. Kopyala

Şuna benzeyecek:

```
postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-name-a1b2c3-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

✅ **Kontrol:** dizede şu üçü var mı — `-pooler`, `eu-central-1`,
`sslmode=require`. Üçü de yoksa yanlış kutudan kopyalamışsın.

---

## 0.4 · `.env` dosyasını doldur (7 dk)

```bash
cp .env.example .env
```

Şimdi dört değer gireceksin. **Tek tek** git.

### 0.4.1 · Veritabanı

`.env` içinde şu satırı bul, başındaki `#` işaretini kaldır ve Neon
dizesini yapıştır:

```
DATABASE_URL=postgresql://neondb_owner:npg_XXXX@ep-...-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

### 0.4.2 · Birinci secret — `SESSION_SECRET`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Çıkan satırı kopyala. `.env` içinde:

```
SESSION_SECRET=BURAYA_BIRINCI_DEGER
```

`BURAYA_BIRINCI_DEGER` yerine yapıştır. Sonuç:

```
SESSION_SECRET=k3Jx9_pQm2vRt7NwZaB4cD-eF1gHiJkL8mN0oP2qR3s
```

### 0.4.3 · İkinci ve üçüncü secret — `APP_SECRETS`

Komutu **iki kez daha** çalıştır:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`.env` içinde şu satırı bul:

```
APP_SECRETS={"projelio":"BURAYA_IKINCI_DEGER","stokla":"BURAYA_UCUNCU_DEGER"}
```

İki değeri yerlerine yaz. **Tek satırda kalsın**, bölme:

```
APP_SECRETS={"projelio":"aB1cD2eF3gH...","stokla":"xY9zW8vU7tS..."}
```

### Bu değerler ne işe yarıyor

| Değer | Kim kullanır | Ne yapar |
|---|---|---|
| `SESSION_SECRET` | Sadece gateway | Oturum token'ını imzalar |
| `APP_SECRETS.projelio` | Host backend **imzalar**, gateway **doğrular** | "Bu benim kullanıcım" iddiasını güvenceye alır |
| `APP_SECRETS.stokla` | Aynısı, ikinci uygulama | Uygulamalar birbirinin adına konuşamaz |

Son ikisi Render ve Netlify'da da **birebir aynı** olacak. Farklı olurlarsa
`token geçersiz` alırsın — canlıda en sık yapılan hata bu. Şimdi bir yere
kaydet, Adım 3 ve 4'te lazım olacak.

✅ **Kontrol:**

```bash
node -e "
const L=require('fs').readFileSync('.env','utf8').split('\n');
const g=k=>{const l=L.find(x=>x.startsWith(k+'='));return l?l.slice(k.length+1).trim():''};
const db=g('DATABASE_URL'), ss=g('SESSION_SECRET');
let ap; try{ap=JSON.parse(g('APP_SECRETS'))}catch{}
const ok=[
  ['DATABASE_URL', db.includes('neon.tech') && db.includes('sslmode=require')],
  ['SESSION_SECRET', ss.length>20 && !ss.includes('BURAYA')],
  ['APP_SECRETS', ap && Object.keys(ap).length===2 && !Object.values(ap).some(v=>v.includes('BURAYA'))],
];
for(const [k,v] of ok) console.log((v?'  ✓ ':'  ✗ ')+k);
process.exit(ok.every(x=>x[1])?0:1);
"
```

Üçü de `✓` olmalı.

---

## 0.5 · Portları kontrol et (2 dk)

Makinende üç uygulama daha çalışıyor, bu yüzden önemli.

```bash
npm run ports
```

Beklenen:

```
.env okundu
DATABASE_URL tanımlı → uzak veritabanı, yerel Postgres portu atlanıyor

  ✓  8791   Gateway + WebSocket    boş
  ✓  5199   Vite arayüz            boş
  ✓  5198   Token sunucusu         boş

Tüm portlar boş. Devam edebilirsin.
```

`✗ DOLU` çıkarsa `.env` içindeki ilgili satırı değiştir — **40000–60000**
aralığından bir sayı seç, o bölge neredeyse hiç kullanılmaz:

```
HABIE_GATEWAY_PORT=48791
```

Sonra `npm run ports` komutunu tekrar çalıştır.

> 5432, 5173, 3000, 8080 bilerek kullanılmadı — hepsi çok yaygın.
> Portlar tek yerden (`.env`) okunuyor, kodda sabit port yok.

---

## 0.6 · Şemayı kur ve doğrula (3 dk)

```bash
npm run test:db
```

Bu komut Neon'daki `dev` dalına şemayı kurar, sonra mimarinin baş iddiasını
test eder. **psql gerektirmez** — Node üzerinden çalışır. Tüm yazma işlemleri
tek transaction içinde döner ve sonunda geri alınır.

✅ **Kontrol:** çıktının sonu:

```
5 · ASIL İDDİA — sunucuda arşiv kalmadı
────────────────────────────────────────────────────────────────────────
  ✓ sunucuda kalan mesaj içeriği                       0
  ✓ dizin duruyor — kullanıcı                          3
  ✓ dizin duruyor — cihaz                              3
  ✓ dizin duruyor — sohbet                             1

════════════════════════════════════════════════════════════════════════
TÜM TESTLER GEÇTİ  (16/16) — veritabanına kalıcı yazma yapılmadı
════════════════════════════════════════════════════════════════════════
```

Yani: teslim edilen mesajlar sunucudan silindi, dizin (kim kimle) kaldı,
**mesaj içeriği kalmadı.**

> İlk çalıştırmada 2-3 saniye bekleyebilir — Neon compute'u askıdan
> uyanıyor. Normal.

<details>
<summary>Hata alırsan</summary>

| Mesaj | Sebep |
|---|---|
| `DATABASE_URL bulunamadı` | `.env` içinde satırın başındaki `#` kalmış |
| `authentication failed` | Bağlantı dizesini eksik kopyalamışsın |
| `ENOTFOUND` | İnternet yok, ya da adres bozuk |
| `self signed certificate` | `sslmode=require` eksik |
</details>

---

## 0.7 · Üç servisi başlat (2 dk)

```bash
npm run dev
```

Tek komut üçünü birden başlatır, çıktıları renkli önekle ayırır:

```
gateway │ [db] şema hazır
gateway │ [db] 2 uygulama secret'ı güncellendi
gateway │ [habie-gateway] :8791 · ortam=development
token   │ [token-server] :5198  (host uygulama backend'i taklidi)
web     │ ➜  Local:   http://localhost:5199/
```

<details>
<summary>Ayrı terminallerde çalıştırmak (hata ayıklarken daha rahat)</summary>

```bash
npm run dev:gateway    # terminal 1
npm run dev:token      # terminal 2
npm run dev:demo       # terminal 3
```
</details>

✅ **Kontrol** — yeni terminalde (portları kendi `.env`'ine göre değiştir):

```bash
curl http://localhost:8791/health
# {"ok":true,"db":"up","ws":0}

curl "http://localhost:5198/habie-token?as=0"
# {"assertion":"eyJhbGciOiJIUzI1NiIs...","persona":{"name":"Ayşe Yılmaz",...}}
```

`db:"down"` görürsen `DATABASE_URL` yanlış — gateway loglarına bak.

---

## 0.8 · Arayüzü test et (5 dk)

**İki farklı tarayıcı** aç. Aynı tarayıcının iki sekmesi **olmaz** —
IndexedDB paylaşılır, ikisi aynı cihaz sanılır.

| Pencere | Adres |
|---|---|
| Safari (veya Chrome) | `http://localhost:5199/?as=0` → Ayşe |
| Chrome gizli pencere (veya Firefox) | `http://localhost:5199/?as=1` → Zeynep |

Sırayla:

1. Her iki pencerede kullanıcı adı seç — `ayse` ve `zeynep`
2. Ayşe'nin penceresinde arama kutusuna `zeynep` yaz → **Ekle** çıkmalı → tıkla
3. Zeynep'in penceresini **yenile** → sohbet listesinde Ayşe görünmeli
4. Ayşe'den mesaj at → Zeynep'te **anında** düşmeli
5. Zeynep'in penceresini **kapat**, Ayşe'den iki mesaj daha at
6. Zeynep'i tekrar aç → kapalıyken atılan iki mesaj kuyruktan gelmeli

✅ **Kontrol** — kuyruğun boşaldığını gör:

```bash
curl http://localhost:8791/v1/stats
```

Mesajlaşırken `envelopes_pending` artar, teslim sonrası **0** olur. En geç
60 saniyede `envelopes_total` da 0'a düşer (sweep). `users`, `devices`,
`conversations` yerinde kalır.

**Adım 0 bitti.** Sorun varsa buradan öteye gitme — canlıda aynı sorun üç
kat zor teşhis edilir.

---

# ADIM 1 — GitHub'a it

## 1.1 · Git deposu başlat (2 dk)

Hâlâ `habie` klasöründeyken:

```bash
git init -b main
git add .
git status --short
```

✅ **Kontrol** — listede şunlar **OLMAMALI**:

- `.env` ← secret'ların ve Neon parolan burada!
- `node_modules/`
- `packages/demo/dist/`

Kesin kontrol:

```bash
git check-ignore .env node_modules
# ikisini de yazdırmalı
```

Yazdırmıyorsa **dur ve haber ver.**

---

## 1.2 · İlk commit (1 dk)

```bash
git commit -m "Habie prototip — Faz 0 dikey dilim"
```

✅ **Kontrol:**

```bash
git ls-files | wc -l                 # 38 dosya
git ls-files | grep -c '^\.env$'     # 0 olmalı
```

---

## 1.3 · GitHub'da boş depo aç (3 dk)

1. <https://github.com/new>
2. **Repository name:** `habie`
3. **Private** seç
4. Aşağıdaki üçünü de **işaretleme**:
   - ❌ Add a README file
   - ❌ Add .gitignore
   - ❌ Choose a license

   > Birini işaretlersen depo boş olmaz, `git push` reddedilir ve
   > `git pull --rebase origin main` ile düzeltmen gerekir.

5. **Create repository**

---

## 1.4 · İt (2 dk)

```bash
git remote add origin https://github.com/<kullanici-adin>/habie.git
git push -u origin main
```

<details>
<summary>Parola sorarsa</summary>

GitHub parola kabul etmiyor. En kolayı:

```bash
brew install gh      # yoksa
gh auth login
git push -u origin main
```

Alternatif: <https://github.com/settings/tokens> → *Generate new token
(classic)* → `repo` yetkisi → token'ı parola yerine yapıştır.
</details>

✅ **Kontrol:** GitHub'da depoda `packages/`, `netlify.toml`, `render.yaml`
görünmeli. **`.env` görünmemeli** — görünüyorsa hemen haber ver, hem
secret'ları hem Neon parolasını yenilememiz gerekir.

---

## Sırada ne var

[DEPLOY.md](./DEPLOY.md) → **Adım 3 (Render)**. Adım 2'yi (Neon) zaten
yaptın; orada `main` dalının bağlantı dizesini kullanacaksın — burada
kullandığın `dev` dalını değil.

`.env` dosyandaki `SESSION_SECRET` ve `APP_SECRETS` değerlerini yanında tut.

---

## Port özeti

| Servis | Varsayılan | `.env` değişkeni |
|---|---|---|
| Gateway + WebSocket | 8791 | `HABIE_GATEWAY_PORT` |
| Vite arayüz | 5199 | `HABIE_WEB_PORT` |
| Token sunucusu | 5198 | `HABIE_TOKEN_PORT` |

Veritabanı Neon'da olduğu için yerel Postgres portu yok. Canlıda bu
portların hiçbiri kullanılmaz — Render ve Netlify kendi portlarını atar.
