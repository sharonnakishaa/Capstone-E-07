# EPEN — Dashboard Monitoring Fume Extractor

Dashboard monitoring untuk **Epen**, alat *fume extractor* asap solder di lab DTETI UGM (Capstone E-07).

ESP32 pada alat membaca sensor, menyaring nilai TVOC dengan **Kalman filter**, lalu menentukan status udara dan kecepatan kipas dengan **fuzzy logic**. Hasilnya dikirim ke server ini. Server **tidak menghitung status sendiri**: server hanya menyimpan, menampilkan, dan mengirim notifikasi email.

### Desain alat (ringkas)

| Komponen | Keterangan |
|---|---|
| Sensor gas | SGP30: TVOC (ppb) dan eCO₂ (ppm) |
| Sensor suhu/RH | SHT31 |
| Sensor debu | GP2Y, dipasang di **outlet** untuk memantau apakah filter masih efektif |
| Kipas | PWM 4-pin dengan tacho (data RPM) |
| Susunan filter | Inlet → HEPA → kipas → karbon aktif → outlet |
| Posisi inlet | Disarankan **5 cm** dari titik solder, menghadap sumber asap |

## Fitur

**Ringkasan Lab (`/lab.html`, halaman utama)**
- Satu kartu per Epen: status fuzzy, TVOC Kalman dan mentah, duty kipas, RPM, debu outlet, serta umur data terakhir. Alat yang baru menyala ditandai "Pemanasan sensor".
- Kartu diurutkan dari yang paling perlu ditangani: BERBAHAYA → WASPADA → OFFLINE → AMAN. Kalau lokasinya lebih dari satu, kartu dikelompokkan per lokasi.
- Ringkasan jumlah alat per status di bagian atas, dan judul tab browser ikut menampilkan jumlah alat BERBAHAYA/WASPADA.
- Penanda "Periksa filter" kalau rata-rata debu outlet melebihi batas.
- Klik kartu untuk membuka dashboard detail alat tersebut. Halaman ini bisa dibuka tanpa login, misalnya di monitor lab.

**Dashboard detail (`/index.html?device=<id>`)**
- Banner status fuzzy terkini (AMAN / WASPADA / BERBAHAYA) sesuai `air_status` yang dikirim ESP32.
- Indikator koneksi: **TERHUBUNG** kalau umur data terakhir ≤ 15 detik (dihitung terhadap `server_time`), **OFFLINE** kalau lebih lama, lengkap dengan banner "Tidak ada data dari perangkat".
- Kartu TVOC (nilai Kalman, dengan nilai mentah sebagai pembanding), debu outlet, suhu, dan kelembapan.
- Grafik tren TVOC dengan dua garis (Kalman dan mentah), garis ambang referensi, dan tooltip saat kursor diarahkan ke grafik.
- Statistik sesi: TVOC tertinggi, terendah, dan rata-rata, baseline TVOC, duty kipas, serta RPM kipas.
- Panel Info Perangkat: jarak inlet yang direkomendasikan, jam operasi filter (bisa direset Pengelola Lab lewat tombol **Filter diganti…**, beserta nama pencatatnya), panduan penggunaan, dan peringatan kalau rata-rata debu outlet melebihi batas.
- Ambang, label, warna, dan interval diambil dari `/api/config`, tidak di-hardcode di frontend.
- Tema terang/gelap dan tampilan responsif sampai lebar 375 px.

**Halaman log (`/logs.html`)**
- Semua data sensor dengan pagination 50 baris per halaman.
- Ekspor Excel (`.xlsx`) berdasarkan rentang tanggal (WIB), maksimal 50.000 baris, dengan baris judul berwarna dan dibekukan. Khusus Pengelola Lab.

**Login Pengelola Lab (`/login.html`)**
- Semua halaman pemantauan bisa dibuka **tanpa login**.
- Login hanya dibutuhkan untuk aksi yang mengubah atau mengunduh data: **mencatat penggantian filter**, **ekspor Excel**, dan **Kelola Alat**. Lihat [Login dan akun](#login-dan-akun).

**Kelola Alat (`/devices.html`, khusus Pengelola Lab)**
- Daftarkan alat dari panel **Alat baru terdeteksi** (MAC yang mengirim data tapi belum terdaftar) tanpa mengetik MAC.
- Tambah, ubah, serta aktifkan/nonaktifkan alat. Lihat [Mendaftarkan alat](#mendaftarkan-alat).

**Backend**
- Validasi payload ESP32: tipe, rentang, dan enum. Semua field yang salah dilaporkan sekaligus.
- Notifikasi email dengan cooldown 15 menit dan pengecualian eskalasi WASPADA → BERBAHAYA. Klaim alert dilakukan secara atomic supaya email tidak terkirim ganda.
- Simulator ESP32 dan seed data untuk pengujian tanpa hardware.

## Stack

- **Next.js 16** (App Router). Route Handlers ada di `app/api/*`.
- **Prisma** + **PostgreSQL** (Supabase).
- **Nodemailer** untuk notifikasi email.
- Frontend berupa HTML/CSS/JS murni di `public/lab.html`, `public/index.html`, dan `public/logs.html`. Grafiknya SVG buatan sendiri, tanpa library chart. Halaman mengambil data baru dengan polling tiap 5 detik.

## Menjalankan secara lokal

Kebutuhan: Node.js 20+ dan database PostgreSQL (Supabase).

```bash
npm install                 # juga menjalankan `prisma generate`
cp .env.example .env        # lalu isi nilainya, lihat tabel di bawah
npx prisma db push          # sinkronkan skema ke database
npm run db:seed             # 1 user, 1 device, ±3 jam data historis (--devices=N untuk N alat)
npm run dev                 # http://localhost:3000
npm run simulate            # terminal lain: kirim data seperti ESP32 tiap 5 detik (--all untuk semua alat)
```

| Script | Fungsi |
|---|---|
| `npm run dev` | Server development |
| `npm run build` | `prisma generate` lalu `next build` |
| `npm start` | Menjalankan hasil build |
| `npm run db:push` | Sinkronkan `prisma/schema.prisma` ke database |
| `npm run db:studio` | Membuka Prisma Studio di http://localhost:5555 |
| `npm run db:generate` | Generate ulang Prisma Client |
| `npm run db:seed` | Isi data awal untuk pengujian |
| `npm run simulate` | Jalankan simulator ESP32 |
| `npm run db:retention` | Ringkas data mentah lama per jam lalu hapus (lihat [Retensi data](#retensi-data)) |
| `npm run user:add` | Buat akun Pengelola Lab atau reset password (lihat [Login dan akun](#login-dan-akun)) |
| `npm run device:add` | Daftarkan alat lewat terminal (cadangan untuk halaman Kelola Alat, lihat [Mendaftarkan alat](#mendaftarkan-alat)) |

Halaman:
- `/` → dialihkan ke `/lab.html` (Ringkasan Lab)
- `/index.html?device=<id>` → dashboard detail satu alat (tanpa `?device=`, yang dibuka adalah alat pertama)
- `/logs.html?device=<id>` → log data lengkap satu alat

> **Windows: `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`** saat `npm run build` atau `npm install`. Artinya file engine Prisma sedang dipakai proses lain. Hentikan dulu `npm run dev`, `npm run simulate`, dan Prisma Studio, lalu ulangi perintahnya.

## Seed data

```bash
npm run db:seed                   # 1 alat
npm run db:seed -- --devices=4    # 4 alat (maksimal 20)
```

Seed membuat:
- user `admin@epen.local` dengan role `pengelola`. Kalau akun ini belum ada, password-nya dibuat acak dan **hanya ditampilkan sekali** di terminal. Kalau sudah ada, password tidak diubah.
- device `Epen Meja 1` … `Epen Meja N` di `Lab DTETI` dengan `inlet_distance_cm = 5`. MAC address-nya `24:6F:28:00:00:01`, `…:02`, dan seterusnya.
- ±2.160 log per alat (3 jam × interval 5 detik) yang berakhir di waktu sekarang. `filter_installed_at` diisi dengan waktu awal data.

Di akhir, seed mencetak `device_id` setiap alat dan perintah simulator yang siap disalin. Seed aman dijalankan ulang: user dan device di-upsert, log dan ringkasan lama milik device itu dihapus, dan `last_alert_at` direset supaya alur email bisa diuji dari awal. Alat hasil seed sebelumnya yang tidak termasuk N dinonaktifkan, jadi tidak muncul di Ringkasan Lab.

> **Perhatian:** lokal dan Production memakai database Supabase yang sama. Seed juga mengubah data yang terlihat di `capstone-e-07.vercel.app`.

## Mendaftarkan alat

Firmware mengirim `mac_address` (format `24:6F:28:AB:CD:EF`, tercetak di Serial Monitor) sebagai identitas, jadi firmware semua alat bisa identik. Setiap MAC harus didaftarkan dulu.

**Lewat UI — halaman Kelola Alat (`/devices.html`, khusus Pengelola Lab)**

Setelah login, buka tautan **Kelola Alat** (ikon roda gigi) di topbar.

1. Nyalakan alat yang belum terdaftar. Data darinya ditolak `404`, tapi MAC-nya tercatat dan muncul di panel **Alat baru terdeteksi** dalam ±5–10 detik, dengan titik hijau kalau alat sedang mengirim data.
2. Klik **Daftarkan**. MAC terisi otomatis di form, jadi cukup isi nama (lokasi default `Lab DTETI`, jarak inlet default 5 cm).
3. Klik **Daftarkan alat**. Kiriman berikutnya dari alat itu langsung diterima dan alatnya muncul di Ringkasan Lab.

Di halaman yang sama:
- **Tambah alat manual:** isi MAC dari Serial Monitor kalau alatnya belum dinyalakan.
- **Ubah:** nama, lokasi, jarak inlet, atau MAC (misalnya memperbaiki salah ketik).
- **Nonaktifkan / Aktifkan:** alat nonaktif tidak tampil di Ringkasan Lab dan datanya ditolak, tapi data lamanya tetap tersimpan. Pakai ini untuk alat dummy hasil seed. **Alat tidak bisa dihapus dari UI**, karena menghapus alat ikut menghapus semua datanya.
- **Abaikan:** menghapus MAC dari daftar "Alat baru terdeteksi" (misalnya alat uji milik orang lain). Kalau alat itu masih mengirim data, MAC-nya akan muncul lagi.

**Lewat terminal (cadangan)**

```bash
npm run device:add -- --mac=24:6F:28:AB:CD:EF --name="Epen Meja 1"
npm run device:add -- --mac=24:6F:28:AB:CD:EF --name="Epen Meja 1" --location="Lab DTETI" --inlet=5
```

Kalau MAC sudah terdaftar, script memperbarui nama, lokasi, dan jarak inlet, lalu mengaktifkan kembali alatnya.

## Simulator ESP32

Hardware belum tersambung, jadi pengujian memakai simulator yang mengirim `POST /api/sensor` tiap 5 detik dengan payload sesuai [API Contract](#api-contract).

```bash
npm run simulate                                     # skenario normal, device aktif pertama
npm run simulate -- --scenario=spike
npm run simulate -- --scenario=offline --device=<uuid> --url=http://localhost:3000
npm run simulate -- --all                                    # semua alat aktif
npm run simulate -- --all --scenario=normal,spike,offline    # skenario dibagi bergiliran ke tiap alat
```

| Opsi | Default | Keterangan |
|---|---|---|
| `--scenario` | `normal` | `normal`, `spike`, atau `offline`. Bisa beberapa, dipisah koma, dan dibagikan bergiliran ke tiap alat. |
| `--device` | device aktif pertama di database | UUID device tujuan. Bisa beberapa, dipisah koma. |
| `--all` | — | Jalankan satu ESP32 virtual untuk setiap device aktif. |
| `--url` | `http://localhost:3000` | Alamat server, misalnya `https://capstone-e-07.vercel.app` |

Dengan beberapa alat, setiap baris log diberi awalan nama alat, dan waktu kirim antaralat digeser supaya request tidak datang bersamaan.

`API_KEY` dibaca dari `.env`.

| Skenario | Perilaku | Dipakai untuk menguji |
|---|---|---|
| `normal` | Siklus menyolder biasa, sesekali masuk WASPADA/BERBAHAYA. Debu outlet rendah (±8 µg/m³). | Tampilan normal, grafik, statistik |
| `spike` | Asap jauh lebih pekat dan sering, sebagian besar BERBAHAYA. Filter dibuat lebih bocor (debu outlet ±33 µg/m³). | Banner merah, email alert dan eskalasi, peringatan filter |
| `offline` | Seperti `normal`, tapi tiap 60 detik berhenti mengirim selama 30 detik. | Indikator TERHUBUNG/OFFLINE |

Cara kerja model ada di `scripts/lib/simulation.ts`:
- **TVOC mentah** naik saat menyolder, lalu turun saat jeda. Kecepatan turunnya bergantung pada duty kipas. Noise-nya Gaussian.
- **TVOC Kalman** dihitung dengan Kalman 1D (`KALMAN_PARAMS`: Q = 25, R = 400).
- **Fase pemanasan 45 detik** seperti firmware: TVOC mentah 0 selama 15 detik (SGP30), lalu baseline direkam 30 detik. Selama itu Kalman dan baseline `null`, status AMAN, kipas mati.
- **Status dan duty** meniru firmware: status dari Kalman di atas baseline (≥ 207 ppb WASPADA, ≥ 359 ppb BERBAHAYA, dari `lib/sensor.ts`), dan duty kontinu 0–100 % hasil interpolasi tingkat 0/30/50/75/100 %.
- **Identitas lewat `mac_address`**, sama seperti firmware.
- **RPM** mengikuti duty dengan sedikit inersia. Suhu mengikuti siklus harian, dan debu outlet berasal dari partikel yang lolos HEPA.

## Login dan akun

Hanya ada satu role, **`pengelola`** (aslab, PIC alat, atau tim Epen). Pengunjung tanpa login tetap bisa melihat Ringkasan Lab, dashboard detail, dan halaman log.

| Aksi | Tanpa login | Pengelola Lab |
|---|---|---|
| Ringkasan Lab, dashboard detail, halaman log | ✅ | ✅ |
| Catat penggantian filter | ❌ | ✅ |
| Kelola Alat (daftarkan, ubah, nonaktifkan) | ❌ | ✅ |
| Ekspor Excel | ❌ | ✅ |

Belum ada halaman pendaftaran atau manajemen akun. Akun dibuat lewat script:

```bash
npm run user:add -- --email=aslab@ugm.ac.id --name="Nama Aslab"   # akun baru
npm run user:add -- --email=aslab@ugm.ac.id                       # reset password akun yang ada
```

Password dibuat acak, **hanya ditampilkan sekali**, dan tidak perlu diketik di terminal, jadi tidak tersimpan di riwayat shell. Kirim ke pemilik akun lewat jalur pribadi. Untuk mencabut akses, hapus user-nya di Prisma Studio. Sesi yang sudah ada langsung tidak berlaku, karena setiap aksi yang dilindungi mengecek user di database.

Cara kerja sesi:
- Setelah login, browser menyimpan cookie `epen_session` (`HttpOnly`, `SameSite=Lax`, `Secure` di Production) yang berlaku **7 hari**.
- Isi cookie ditandatangani HMAC-SHA256 dengan `SESSION_SECRET`, jadi tidak bisa dipalsukan. Mengganti `SESSION_SECRET` membuat semua sesi yang ada tidak berlaku.
- Password disimpan sebagai hash scrypt (modul `crypto` bawaan Node, tanpa dependency tambahan).
- Login yang gagal dijeda ±0,6 detik untuk memperlambat tebakan password. Pembatasan jumlah percobaan (rate limit) belum ada.

## Retensi data

Data mentah dikirim tiap 5 detik, yaitu 17.280 baris per hari per device kalau alat menyala terus. Supaya database tidak penuh, data mentah yang lebih tua dari **60 hari** (`RAW_RETENTION_DAYS` di `lib/sensor.ts`) diringkas per jam ke tabel `sensor_hourly`, lalu dihapus dari `sensor_logs`. Logikanya ada di `lib/retention.ts` dan dipakai bersama oleh cron dan script manual.

**Otomatis (Production): Vercel Cron**

`vercel.json` menjadwalkan `GET /api/cron/retention` **setiap hari pukul 19.00 UTC (02.00 WIB)**, saat lab sepi.

- Endpoint hanya berjalan kalau header `Authorization: Bearer <CRON_SECRET>` cocok. Vercel mengirim header ini otomatis kalau env `CRON_SECRET` diset di project. Tanpa `CRON_SECRET`, endpoint menolak berjalan (`500`) dan mencatatnya di log.
- Hasilnya tercatat di log Vercel, misalnya `[cron/retention] 17280 log < … → 24 ringkasan, 17280 dihapus (850 ms)`. Riwayat eksekusi ada di *Vercel → Project → Settings → Cron Jobs*.
- Cek manual tanpa mengubah data:
  ```bash
  curl -H "Authorization: Bearer <CRON_SECRET>" "https://capstone-e-07.vercel.app/api/cron/retention?dry_run=1"
  ```
- Di paket Vercel Hobby, cron boleh berjalan maksimal sekali sehari dan waktunya bisa meleset dalam rentang jam yang sama. Itu cukup untuk retensi.

**Manual**

```bash
npm run db:retention -- --dry-run     # lihat apa yang akan diproses, tanpa mengubah database
npm run db:retention                  # jalankan
npm run db:retention -- --days=0      # khusus pengujian: ringkas semua jam yang sudah lewat
```

- Ringkas dan hapus dijalankan dalam **satu transaksi**. Kalau salah satu gagal, tidak ada yang berubah.
- Hanya jam yang **lengkap** yang diproses, karena batasnya dibulatkan ke awal jam.
- Script **aman dijalankan berulang kali**. Kalau jam yang sama sudah pernah diringkas, hasilnya digabung, bukan diduplikasi.
- Isi setiap baris ringkasan: jumlah sampel, sampel saat kipas menyala, rata-rata dan maksimum TVOC (Kalman, atau mentah kalau Kalman kosong), maksimum TVOC mentah, rata-rata dan maksimum debu outlet, rata-rata suhu dan RH, serta jumlah sampel per status.
- `filter_runtime_hours` menjumlahkan sampel kipas menyala dari log mentah **dan** dari ringkasan per jam, jadi jam operasi filter tetap benar setelah data mentah dihapus.
- Ekspor Excel dan halaman log hanya membaca data mentah. Ekspor setiap sesi uji penting segera setelah selesai.

## Struktur folder

```
app/
  api/
    config/route.ts     GET /api/config — konfigurasi untuk frontend
    overview/route.ts   GET /api/overview — status terkini semua alat (Ringkasan Lab)
    devices/route.ts    GET /api/devices — daftar device + info filter
    devices/[id]/filter/route.ts
                        POST — catat penggantian filter
    sensor/route.ts     GET/POST /api/sensor — data sensor, ekspor Excel, alert email
    admin/devices/...   GET/POST/PATCH — Kelola Alat (khusus pengelola)
    admin/unregistered-macs/[mac]
                        DELETE — abaikan MAC dari "alat baru terdeteksi"
    cron/retention/route.ts
                        GET — retensi data harian (Vercel Cron, dilindungi CRON_SECRET)
  layout.tsx, page.tsx  Root layout; "/" dialihkan ke /lab.html
lib/
  sensor.ts             Satu sumber konfigurasi: status, ambang relatif baseline, interval
  validation.ts         Validasi payload POST dari ESP32
  devices.ts            Perhitungan jam operasi filter
  retention.ts          Retensi data (dipakai cron dan script db:retention)
  auth.ts               Sesi login (cookie bertanda tangan) dan pengecekan role
  password.ts           Hash dan verifikasi password (scrypt)
  email.ts              Template dan pengiriman email peringatan
  prisma.ts             Instance Prisma Client
prisma/
  schema.prisma         Skema database (users, devices, sensor_logs, sensor_hourly, unregistered_macs)
public/
  lab.html              Ringkasan Lab — semua alat dalam satu layar (halaman utama)
  index.html            Dashboard detail satu alat (HTML/CSS/JS murni, grafik SVG)
  logs.html             Halaman log + ekspor Excel
  devices.html          Kelola Alat — daftarkan, ubah, nonaktifkan alat (khusus pengelola)
  auth.js               Widget Masuk/Keluar + tautan Kelola Alat untuk semua halaman
scripts/
  lib/simulation.ts     Model fisik: siklus menyolder, Kalman 1D, pola fuzzy
  seed.ts               Seed user, device, dan data historis
  simulate.ts           Simulator ESP32
  retention.ts          Jalankan retensi data secara manual
  user-add.ts           Buat akun Pengelola Lab / reset password
  device-add.ts         Daftarkan alat berdasarkan MAC address
docs/
  TESTING.md            Checklist uji manual fungsional dashboard
vercel.json             Jadwal Vercel Cron (retensi data harian)
```

## Pengujian

Checklist uji manual, yaitu matriks uji fungsional dashboard, ada di [`docs/TESTING.md`](docs/TESTING.md).

## Variabel environment

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string Supabase dalam *transaction mode* (port 6543, `?pgbouncer=true`). Dipakai saat aplikasi berjalan. |
| `DIRECT_URL` | ✅ | Connection string *direct* (port 5432). Dipakai Prisma untuk `db push` atau migrasi. |
| `API_KEY` | ✅ | Kunci rahasia yang harus dikirim ESP32 di header `x-api-key`. |
| `SESSION_SECRET` | ✅ | Kunci penandatangan cookie login, minimal 32 karakter acak. Buat dengan `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Tanpa variabel ini, login dan aksi Pengelola gagal, tapi halaman pemantauan tetap jalan. |
| `CRON_SECRET` | ✅** | Kunci untuk Vercel Cron retensi data harian, minimal 32 karakter acak (buat dengan perintah yang sama). Vercel mengirimnya otomatis sebagai `Authorization: Bearer …`. |
| `SMTP_HOST` | ✅* | Host SMTP, misalnya `smtp.gmail.com`. |
| `SMTP_PORT` | | Default `587`. |
| `SMTP_SECURE` | | `true` untuk port 465, selain itu `false`. |
| `SMTP_USER` | ✅* | Username SMTP, juga dipakai sebagai alamat pengirim. |
| `SMTP_PASS` | ✅* | Password SMTP (untuk Gmail, pakai *App Password*). |
| `ALERT_EMAIL_TO` | | Penerima notifikasi, dipisah koma. Kalau kosong, email tidak dikirim. |
| `PORT` | | Port server, default `3000`. |

\* Wajib kalau notifikasi email ingin diaktifkan.

\*\* Wajib di Production (Vercel). Tidak perlu untuk pengembangan lokal kecuali ingin menguji endpoint cron.

---

## API Contract

> **Status:** kontrak ini adalah **draf** dan masih harus dikonfirmasi ke tim firmware. Kontrak ini menjadi acuan implementasi backend.

Semua body dan respons memakai JSON (`Content-Type: application/json`), kecuali ekspor Excel. Waktu dalam respons JSON memakai ISO 8601 UTC, misalnya `2026-10-16T03:12:45.000Z`. Waktu pembacaan (`recorded_at`) diisi oleh **server** saat data diterima, jadi ESP32 tidak perlu mengirim timestamp.

### `POST /api/sensor` — kirim data dari ESP32

ESP32 mengirim satu pembacaan setiap **5 detik** lewat **HTTPS** (`WiFiClientSecure`; HTTP biasa di-redirect 308 dan tidak diikuti untuk POST). Kontrak ini sudah disepakati dengan tim firmware.

**Header**

| Header | Nilai |
|---|---|
| `Content-Type` | `application/json` |
| `x-api-key` | Nilai `API_KEY` (wajib) |

**Body**

```json
{
  "mac_address": "24:6F:28:AB:CD:EF",
  "tvoc_raw_ppb": 412,
  "tvoc_kalman_ppb": 286,
  "tvoc_baseline_ppb": 95,
  "eco2_ppm": 640,
  "temperature_celsius": 27.4,
  "humidity_percent": 63.1,
  "dust_outlet_ugm3": null,
  "air_status": "WASPADA",
  "fan_duty_percent": 83,
  "fan_rpm": 2610
}
```

| Field | Tipe | Wajib | Aturan validasi | Keterangan |
|---|---|---|---|---|
| `mac_address` | string | ✅* | Format `24:6F:28:AB:CD:EF` (huruf kecil dinormalisasi ke huruf besar). Harus terdaftar dan aktif. | Identitas alat. Firmware semua alat bisa identik. Daftarkan dengan `npm run device:add`. |
| `device_id` | string (UUID) | ✅* | Harus terdaftar dan `is_active = true` | Alternatif `mac_address` (dipakai kode lama). |
| `tvoc_raw_ppb` | number | ✅ | Finite, ≥ 0 | TVOC mentah dari SGP30. Bernilai 0 selama 15 detik pertama (pemanasan SGP30). |
| `tvoc_kalman_ppb` | number \| null | | Finite, ≥ 0 | TVOC Kalman **absolut** (= baseline + estimasi). `null` selama pemanasan. |
| `tvoc_baseline_ppb` | number \| null | | Finite, ≥ 0 | Baseline udara bersih yang direkam saat alat menyala. `null` selama pemanasan. Dipakai untuk garis ambang. |
| `eco2_ppm` | number | ✅ | Finite, ≥ 0 | eCO₂ dari SGP30, disimpan sebagai data pelengkap |
| `temperature_celsius` | number | ✅ | Finite | Suhu dari SHT31 |
| `humidity_percent` | number | ✅ | Finite, 0–100 | Kelembapan relatif dari SHT31 |
| `dust_outlet_ugm3` | number \| null | | Finite, ≥ 0 | Kepadatan debu di **outlet** (GP2Y). Sementara dikirim `null` oleh firmware. |
| `air_status` | string | ✅ | `AMAN` \| `WASPADA` \| `BERBAHAYA` | Keluaran fuzzy di ESP32, disimpan apa adanya. `AMAN` selama pemanasan. |
| `fan_duty_percent` | number | ✅ | Finite, **0–100** (persen, **bukan** 0–255) | Duty kipas hasil fuzzy Sugeno (rata-rata terbobot, kontinu). 0 selama pemanasan. |
| `fan_rpm` | integer \| null | | Bilangan bulat ≥ 0 | Putaran kipas dari sinyal tacho |

\* Kirim **tepat satu** dari `mac_address` atau `device_id`. Mengirim keduanya ditolak `400`.

- Field opsional boleh dihilangkan atau diisi `null`. Field yang tidak dikenal diabaikan, misalnya `fuzzy_level` dari firmware lama.
- **Fase pemanasan (±45 detik setelah alat menyala):** SGP30 pemanasan 15 detik, lalu baseline direkam 30 detik. Selama fase ini firmware mengirim `tvoc_kalman_ppb` dan `tvoc_baseline_ppb` = `null`, `air_status` = `AMAN`, dan kipas mati. Dashboard menampilkan keterangan **"Pemanasan sensor"**.
- **Ambang status di firmware relatif terhadap baseline:** WASPADA mulai **baseline + 207 ppb**, BERBAHAYA mulai **baseline + 359 ppb** (`TVOC_THRESHOLD_ABOVE_BASELINE_PPB` di `lib/sensor.ts`, samakan dengan `epen_config.h`). Server tidak menghitung status. Ambang ini hanya dipakai untuk garis referensi grafik.
- **Tingkat keluaran fuzzy:** 0 / 30 / 50 / 75 / 100 %. Karena keluarannya rata-rata terbobot, duty yang dikirim bisa bernilai di antaranya (misalnya 55 %). Tidak ada lagi label level.

**Respons sukses — `201 Created`**

```json
{
  "success": true,
  "id": "10482",
  "air_status": "WASPADA"
}
```

`id` dikirim sebagai string karena kolomnya `BigInt`.

**Respons error**

Semua error memakai bentuk `{ "error": string, ... }`.

| Kode | Kapan terjadi | Contoh body |
|---|---|---|
| `400` | Body bukan JSON valid | `{ "error": "Body bukan JSON valid" }` |
| `400` | Validasi gagal: field wajib kosong, tipe salah, di luar rentang, atau enum tidak valid | lihat contoh di bawah |
| `401` | Header `x-api-key` tidak ada atau salah | `{ "error": "Unauthorized" }` |
| `404` | `mac_address` belum terdaftar atau alat nonaktif. MAC yang belum terdaftar muncul di **Kelola Alat → Alat baru terdeteksi**. | `{ "error": "MAC belum terdaftar atau alat tidak aktif", "mac_address": "24:6F:28:AB:CD:EF" }` |
| `404` | `device_id` tidak terdaftar atau perangkat nonaktif | `{ "error": "Device tidak ditemukan atau tidak aktif", "device_id": "..." }` |
| `500` | Kesalahan server atau database | `{ "error": "Internal server error" }` |

Contoh `400` karena validasi gagal. Semua field yang salah dilaporkan sekaligus:

```json
{
  "error": "Validasi gagal",
  "details": [
    { "field": "humidity_percent", "message": "harus angka 0–100" },
    { "field": "air_status", "message": "harus salah satu dari AMAN, WASPADA, BERBAHAYA" }
  ]
}
```

Contoh request:

```bash
curl -X POST http://localhost:3000/api/sensor \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"mac_address":"24:6F:28:00:00:01","tvoc_raw_ppb":412,"tvoc_kalman_ppb":286,"tvoc_baseline_ppb":95,"eco2_ppm":640,"temperature_celsius":27.4,"humidity_percent":63.1,"dust_outlet_ugm3":null,"air_status":"WASPADA","fan_duty_percent":83,"fan_rpm":2610}'
```

**Notifikasi email**

Setiap POST yang berhasil disimpan bisa memicu email peringatan ke `ALERT_EMAIL_TO`. Email dikirim kalau `air_status` bernilai `WASPADA` atau `BERBAHAYA` **dan** salah satu kondisi berikut terpenuhi:

1. perangkat belum pernah mengirim alert (`last_alert_at` masih null), **atau**
2. alert terakhir sudah lewat **≥ 15 menit**, **atau**
3. status naik dari `WASPADA` ke `BERBAHAYA` (eskalasi tetap dikirim walaupun masih dalam masa cooldown).

Pengecekan dan pembaruan `last_alert_at` / `last_alert_status` dilakukan secara atomic dengan satu `updateMany`, jadi request yang datang bersamaan tidak mengirim email ganda. Gagal mengirim email **tidak** membuat request gagal; respons tetap `201`.

Format subject: `[EPEN BERBAHAYA] TVOC 412 ppb — <nama device>`

---

### `GET /api/sensor` — ambil data sensor

Endpoint ini punya tiga mode, ditentukan oleh query parameter.

| Query | Mode | Dipakai oleh |
|---|---|---|
| `device_id`, `limit` (default 30, maks 100) | Terbaru | Dashboard |
| `device_id`, `page` (≥ 1, 50 baris per halaman) | Pagination | Halaman log |
| `format=xlsx`, `device_id`, `from`, `to` | Ekspor Excel | Tombol Ekspor Excel |

Data diurutkan dari `recorded_at` terbaru ke terlama, kecuali pada mode ekspor.

**Objek log**

```json
{
  "id": "10482",
  "device_id": "uuid-perangkat",
  "tvoc_raw_ppb": 412,
  "tvoc_kalman_ppb": 286,
  "tvoc_baseline_ppb": 95,
  "eco2_ppm": 640,
  "temperature_celsius": 27.4,
  "humidity_percent": 63.1,
  "dust_outlet_ugm3": 18.5,
  "air_status": "WASPADA",
  "fan_duty_percent": 83,
  "fan_rpm": 2610,
  "recorded_at": "2026-10-16T03:12:45.000Z"
}
```

**Mode terbaru — `200 OK`**

```json
{
  "data": [ /* objek log */ ],
  "server_time": "2026-10-16T03:12:47.120Z"
}
```

`server_time` dipakai dashboard untuk menghitung umur data terakhir. Status dianggap **TERHUBUNG** kalau umur data ≤ 15 detik, selain itu **OFFLINE**.

**Mode pagination — `200 OK`**

```json
{
  "data": [ /* maks 50 objek log */ ],
  "page": 1,
  "total": 2160,
  "totalPages": 44,
  "server_time": "2026-10-16T03:12:47.120Z"
}
```

**Mode ekspor Excel — `200 OK`**

`GET /api/sensor?format=xlsx&device_id=<uuid>&from=2026-10-16T00:00:00%2B07:00&to=2026-10-16T23:59:59%2B07:00`

- `from` dan `to` berupa ISO 8601. `device_id` wajib. `format` selain `xlsx` ditolak dengan `400`.
- Header respons:
  - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition: attachment; filename="epen-<nama-alat>-<YYYYMMDD>-<YYYYMMDD>.xlsx"`, misalnya `epen-meja-1-20261021-20261021.xlsx`
  - `X-Row-Count: <jumlah baris data>`
- Satu sheet bernama sesuai nama alat. Baris diurutkan dari waktu terlama ke terbaru.
- Format tampilan: baris judul tebal dengan teks putih di latar biru tua (`#1F3864`), baris judul dibekukan (*freeze*), dan border tipis hanya di area tabel (baris judul dan baris data). Di luar tabel tidak ada border.
- Waktu disimpan sebagai **tanggal Excel asli** dalam **WIB**, dan angka sebagai **angka asli** (bukan teks), jadi data bisa langsung diurutkan, difilter, dan dihitung. Excel menampilkan pemisah desimal sesuai pengaturan bahasa komputer.
- Maksimal **50.000 baris** (dengan interval 5 detik, setara ±69 jam data). Kalau rentang yang diminta berisi lebih dari itu, server **tidak memotong data**. Server menolak request dengan `400` supaya pengguna mempersempit rentang tanggalnya:
  ```json
  { "error": "Rentang terlalu besar: 61.240 baris (maks 50.000). Persempit rentang tanggal.", "row_count": 61240 }
  ```
- **Wajib login sebagai Pengelola Lab.** Mode terbaru dan pagination tetap publik.

| Kolom | Isi | Format |
|---|---|---|
| Waktu (WIB) | `recorded_at` + 7 jam | `yyyy-mm-dd hh:mm:ss` |
| TVOC Mentah (ppb) | `tvoc_raw_ppb` | `0` |
| TVOC Kalman (ppb) | `tvoc_kalman_ppb` | `0.0` |
| Baseline TVOC (ppb) | `tvoc_baseline_ppb` | `0` |
| eCO₂ (ppm) | `eco2_ppm` | `0` |
| Suhu (°C) | `temperature_celsius` | `0.0` |
| RH (%) | `humidity_percent` | `0.0` |
| Debu Outlet (µg/m³) | `dust_outlet_ugm3` | `0.0` |
| Status Fuzzy | `air_status` | teks |
| Duty (%) | `fan_duty_percent` | `0` |
| RPM | `fan_rpm` | `0` |

Nilai `null` ditulis sebagai sel kosong. Karena berada di dalam tabel, sel itu tetap berborder supaya garis tabel tidak bolong.

**Error**

| Kode | Kapan terjadi |
|---|---|
| `400` | Parameter tidak valid, misalnya `page` bukan angka, `from`/`to` bukan tanggal, atau `device_id` tidak ada di mode ekspor |
| `400` | Mode ekspor: hasil lebih dari 50.000 baris (respons menyertakan `row_count`) |
| `401` | Mode ekspor tanpa login |
| `404` | Mode ekspor: `device_id` tidak terdaftar |
| `500` | Kesalahan server atau database |

---

### `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`

| Endpoint | Body | Respons |
|---|---|---|
| `POST /api/auth/login` | `{ "email": "...", "password": "..." }` | `200 { user: { id, email, full_name, role } }` dan cookie `epen_session`. `401` kalau email/password salah (pesannya sama untuk keduanya), `400` kalau body tidak lengkap. |
| `POST /api/auth/logout` | — | `200 { success: true }`, cookie dihapus. |
| `GET /api/auth/me` | — | `200 { user: {...} }` kalau login, atau `200 { user: null }`. |

---

### Kelola Alat — `/api/admin/*` (khusus pengelola)

Semua endpoint di bawah ini wajib login sebagai Pengelola Lab (`401` tanpa login).

| Endpoint | Body | Respons |
|---|---|---|
| `GET /api/admin/devices` | — | `200 { devices: [...], unregistered: [...], server_time }`. `devices` berisi semua alat, aktif maupun nonaktif, beserta `mac_address` dan `last_seen_at`. `unregistered` berisi MAC yang mengirim data tapi belum terdaftar (`first_seen_at`, `last_seen_at`, `attempts`), maksimal 50, terbaru dulu. |
| `POST /api/admin/devices` | `{ mac_address, device_name, location?, inlet_distance_cm? }` | `201 { device }`. MAC dihapus dari daftar `unregistered`. `409` kalau MAC sudah terdaftar, `400` kalau validasi gagal. |
| `PATCH /api/admin/devices/:id` | Sebagian dari `{ mac_address, device_name, location, inlet_distance_cm, is_active }` | `200 { device }`. `409` kalau MAC dipakai alat lain, `404` kalau alat tidak ada. |
| `DELETE /api/admin/unregistered-macs/:mac` | — | `200 { success, deleted }`. MAC dihapus dari daftar "alat baru terdeteksi". |

Aturan validasi: MAC berformat `24:6F:28:AB:CD:EF` (huruf kecil dinormalisasi), nama dan lokasi 1–60 karakter, jarak inlet > 0 dan ≤ 100 cm. Tidak ada endpoint hapus alat; nonaktifkan dengan `PATCH { "is_active": false }`.

MAC dicatat ke `unregistered_macs` oleh `POST /api/sensor` setiap kali alat yang belum terdaftar mengirim data (`404`). Alat yang terdaftar tapi nonaktif **tidak** dicatat di sini.

---

### `GET /api/overview` — status terkini semua alat

Dipakai halaman Ringkasan Lab. Satu request mengembalikan log terakhir setiap device aktif beserta rata-rata debu outlet dari `outlet_dust.window` data terakhir. Semua dihitung dalam satu query yang memakai index `(device_id, recorded_at)`.

**`200 OK`**

```json
{
  "data": [
    {
      "id": "uuid-perangkat",
      "device_name": "Epen Meja 3",
      "location": "Lab DTETI",
      "latest": {
        "id": "10482",
        "tvoc_raw_ppb": 640,
        "tvoc_kalman_ppb": 512.8,
        "tvoc_baseline_ppb": 88,
        "temperature_celsius": 28.1,
        "humidity_percent": 60.2,
        "dust_outlet_ugm3": 31.4,
        "air_status": "BERBAHAYA",
        "fan_duty_percent": 100,
        "fan_rpm": 3290,
        "recorded_at": "2026-10-18T03:12:45.000Z"
      },
      "dust_outlet_avg_ugm3": 33.5,
      "dust_samples": 30
    }
  ],
  "server_time": "2026-10-18T03:12:47.120Z"
}
```

- `latest` bernilai `null` kalau device belum pernah mengirim data.
- Status OFFLINE ditentukan di frontend: `server_time − latest.recorded_at > offline_after_ms`.

---

### `GET /api/devices` — daftar perangkat aktif

**`200 OK`**

```json
{
  "data": [
    {
      "id": "uuid-perangkat",
      "device_name": "Epen #1",
      "location": "Lab DTETI",
      "is_active": true,
      "inlet_distance_cm": 5,
      "filter_installed_at": "2026-10-01T02:00:00.000Z",
      "last_seen_at": "2026-10-16T03:12:45.000Z",
      "filter_runtime_hours": 37.4
    }
  ]
}
```

| Field | Keterangan |
|---|---|
| `inlet_distance_cm` | Jarak inlet yang direkomendasikan dari titik solder (default 5) |
| `filter_installed_at` | Waktu filter terakhir dipasang. `null` kalau belum dicatat. |
| `last_seen_at` | `recorded_at` dari log terakhir. `null` kalau belum ada data. |
| `filter_runtime_hours` | Perkiraan jam operasi filter: jumlah sampel dengan `fan_duty_percent > 0` sejak `filter_installed_at` (dari log mentah ditambah ringkasan per jam), dikali 5 detik, dibagi 3600. Nilainya `null` kalau `filter_installed_at` kosong. |

---

### `POST /api/devices/:id/filter` — catat penggantian filter

Endpoint ini dipanggil dari tombol **Filter diganti…** di panel Info Perangkat. Endpoint mengisi `filter_installed_at`, sehingga `filter_runtime_hours` dihitung ulang dari waktu tersebut.

**Body (opsional)**

```json
{ "installed_at": "2026-10-17T08:00:00+07:00" }
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `installed_at` | string (ISO 8601) | | Waktu filter dipasang. Kalau kosong, server memakai waktu sekarang. Tidak boleh di masa depan (toleransi 1 menit). |

**`200 OK`**

```json
{
  "success": true,
  "data": {
    "id": "uuid-perangkat",
    "filter_installed_at": "2026-10-17T01:00:00.000Z",
    "filter_runtime_hours": 0
  }
}
```

| Kode | Kapan terjadi |
|---|---|
| `400` | `id` bukan UUID, body bukan JSON valid, atau `installed_at` bukan tanggal / di masa depan |
| `401` | Belum login atau sesi sudah berakhir |
| `403` | Akun tidak punya role `pengelola` |
| `404` | Device tidak ditemukan atau tidak aktif |
| `500` | Kesalahan server atau database |

> **Wajib login sebagai Pengelola Lab** (cookie `epen_session`). User yang mencatat disimpan di `filter_installed_by`, dan namanya muncul sebagai `filter_installed_by_name` di respons ini dan di `GET /api/devices`.

---

### `GET /api/config` — konfigurasi tampilan (opsional)

Endpoint ini mengembalikan konfigurasi dari `lib/sensor.ts` supaya frontend tidak meng-hardcode ambang dan label.

```json
{
  "statuses": {
    "AMAN":      { "label": "Aman",      "headline": "Kualitas Udara Baik",    "emoji": "🟢", "color": "#22C55E", "text_light": "#15803D", "description": "..." },
    "WASPADA":   { "label": "Waspada",   "headline": "Asap Solder Terdeteksi", "emoji": "🟠", "color": "#F59E0B", "text_light": "#B45309", "description": "..." },
    "BERBAHAYA": { "label": "Berbahaya", "headline": "Kadar Asap Tinggi",      "emoji": "🔴", "color": "#EF4444", "text_light": "#DC2626", "description": "..." }
  },
  "tvoc_threshold_above_baseline_ppb": { "waspada": 207, "berbahaya": 359 },
  "fan_duty_levels_percent": [0, 30, 50, 75, 100],
  "sensor_warmup_sec": 45,
  "outlet_dust": { "warn_ugm3": 25, "window": 30 },
  "poll_interval_ms": 5000,
  "offline_after_ms": 15000
}
```

`color` dipakai untuk aksen (ikon, garis, badge di tema gelap). `text_light` dipakai untuk teks di latar terang, termasuk email, supaya kontrasnya cukup.

`outlet_dust`: dashboard menampilkan peringatan filter kalau rata-rata `dust_outlet_ugm3` pada `window` data terakhir melebihi `warn_ugm3`.

`tvoc_threshold_above_baseline_ppb` dipakai untuk garis referensi grafik: garis digambar di `tvoc_baseline_ppb` + nilai ini, per alat. Kalau baseline belum ada (pemanasan), garis tidak digambar. Nilainya harus sama dengan fungsi keanggotaan fuzzy di firmware. Status yang tampil tetap berasal dari `air_status` yang dikirim ESP32.

`fan_duty_levels_percent` adalah tingkat keluaran fuzzy Sugeno firmware, hanya sebagai referensi. `sensor_warmup_sec` dipakai untuk teks "Pemanasan sensor".
