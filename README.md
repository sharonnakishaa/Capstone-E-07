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

## Stack

- **Next.js 16** (App Router). Route Handlers ada di `app/api/*`.
- **Prisma** + **PostgreSQL** (Supabase).
- **Nodemailer** untuk notifikasi email.
- Frontend berupa HTML/CSS/JS murni di `public/index.html` dan `public/logs.html`. Grafiknya SVG buatan sendiri, tanpa library chart. Dashboard mengambil data baru dengan polling tiap 5 detik.

## Menjalankan secara lokal

Kebutuhan: Node.js 20+ dan database PostgreSQL (Supabase).

```bash
npm install                 # juga menjalankan `prisma generate`
cp .env.example .env        # lalu isi nilainya, lihat tabel di bawah
npx prisma db push          # sinkronkan skema ke database
npm run dev                 # http://localhost:3000
```

| Script | Fungsi |
|---|---|
| `npm run dev` | Server development |
| `npm run build` | `prisma generate` lalu `next build` |
| `npm start` | Menjalankan hasil build |
| `npm run db:push` | Sinkronkan `prisma/schema.prisma` ke database |
| `npm run db:studio` | Membuka Prisma Studio |
| `npm run db:generate` | Generate ulang Prisma Client |

Halaman:
- `/` → dialihkan ke `/index.html` (dashboard)
- `/logs.html` → log data lengkap

## Variabel environment

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string Supabase dalam *transaction mode* (port 6543, `?pgbouncer=true`). Dipakai saat aplikasi berjalan. |
| `DIRECT_URL` | ✅ | Connection string *direct* (port 5432). Dipakai Prisma untuk `db push` atau migrasi. |
| `API_KEY` | ✅ | Kunci rahasia yang harus dikirim ESP32 di header `x-api-key`. |
| `SMTP_HOST` | ✅* | Host SMTP, misalnya `smtp.gmail.com`. |
| `SMTP_PORT` | | Default `587`. |
| `SMTP_SECURE` | | `true` untuk port 465, selain itu `false`. |
| `SMTP_USER` | ✅* | Username SMTP, juga dipakai sebagai alamat pengirim. |
| `SMTP_PASS` | ✅* | Password SMTP (untuk Gmail, pakai *App Password*). |
| `ALERT_EMAIL_TO` | | Penerima notifikasi, dipisah koma. Kalau kosong, email tidak dikirim. |
| `PORT` | | Port server, default `3000`. |

\* Wajib kalau notifikasi email ingin diaktifkan.

---

## API Contract

> **Status:** kontrak ini adalah **draf** dan masih harus dikonfirmasi ke tim firmware. Kontrak ini menjadi acuan implementasi backend.

Semua body dan respons memakai JSON (`Content-Type: application/json`), kecuali ekspor CSV. Waktu dalam respons JSON memakai ISO 8601 UTC, misalnya `2026-10-16T03:12:45.000Z`. Waktu pembacaan (`recorded_at`) diisi oleh **server** saat data diterima, jadi ESP32 tidak perlu mengirim timestamp.

### `POST /api/sensor` — kirim data dari ESP32

ESP32 mengirim satu pembacaan setiap **5 detik**.

**Header**

| Header | Nilai |
|---|---|
| `Content-Type` | `application/json` |
| `x-api-key` | Nilai `API_KEY` (wajib) |

**Body**

```json
{
  "device_id": "uuid-perangkat",
  "tvoc_raw_ppb": 412,
  "tvoc_kalman_ppb": 286,
  "eco2_ppm": 640,
  "temperature_celsius": 27.4,
  "humidity_percent": 63.1,
  "dust_outlet_ugm3": 18.5,
  "air_status": "WASPADA",
  "fuzzy_level": "MED",
  "fan_duty_percent": 85,
  "fan_rpm": 2810
}
```

| Field | Tipe | Wajib | Aturan validasi | Keterangan |
|---|---|---|---|---|
| `device_id` | string (UUID) | ✅ | Harus terdaftar di tabel `devices` dan `is_active = true` | ID perangkat |
| `tvoc_raw_ppb` | number | ✅ | Finite, ≥ 0 | TVOC mentah dari SGP30 |
| `tvoc_kalman_ppb` | number \| null | | Finite, ≥ 0 | TVOC setelah Kalman filter, menjadi input fuzzy |
| `eco2_ppm` | number | ✅ | Finite, ≥ 0 | eCO₂ dari SGP30, disimpan sebagai data pelengkap |
| `temperature_celsius` | number | ✅ | Finite | Suhu dari SHT31 |
| `humidity_percent` | number | ✅ | Finite, 0–100 | Kelembapan relatif dari SHT31 |
| `dust_outlet_ugm3` | number \| null | | Finite, ≥ 0 | Kepadatan debu di **outlet** (GP2Y) |
| `air_status` | string | ✅ | `AMAN` \| `WASPADA` \| `BERBAHAYA` | Keluaran fuzzy di ESP32, disimpan apa adanya |
| `fuzzy_level` | string \| null | | `MIN` \| `LOW` \| `MED` \| `FAST` | Level kecepatan kipas hasil fuzzy |
| `fan_duty_percent` | number | ✅ | Finite, **0–100** (persen, **bukan** 0–255) | Duty cycle PWM kipas |
| `fan_rpm` | integer \| null | | Bilangan bulat ≥ 0 | Putaran kipas dari sinyal tacho |

Referensi level fuzzy (duty nominal). Server tidak memaksa `fan_duty_percent` sama dengan nilai nominal ini.

| `fuzzy_level` | Duty nominal |
|---|---|
| `MIN` | 25 % |
| `LOW` | 60 % |
| `MED` | 85 % |
| `FAST` | 100 % |

Field opsional boleh dihilangkan atau diisi `null`.

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
  -d '{"device_id":"<uuid>","tvoc_raw_ppb":412,"tvoc_kalman_ppb":286,"eco2_ppm":640,"temperature_celsius":27.4,"humidity_percent":63.1,"dust_outlet_ugm3":18.5,"air_status":"WASPADA","fuzzy_level":"MED","fan_duty_percent":85,"fan_rpm":2810}'
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
| `format=csv`, `device_id`, `from`, `to` | Ekspor CSV | Tombol Ekspor CSV |

Data diurutkan dari `recorded_at` terbaru ke terlama, kecuali pada mode CSV.

**Objek log**

```json
{
  "id": "10482",
  "device_id": "uuid-perangkat",
  "tvoc_raw_ppb": 412,
  "tvoc_kalman_ppb": 286,
  "eco2_ppm": 640,
  "temperature_celsius": 27.4,
  "humidity_percent": 63.1,
  "dust_outlet_ugm3": 18.5,
  "air_status": "WASPADA",
  "fuzzy_level": "MED",
  "fan_duty_percent": 85,
  "fan_rpm": 2810,
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

**Mode CSV — `200 OK`**

`GET /api/sensor?format=csv&device_id=<uuid>&from=2026-10-16T00:00:00%2B07:00&to=2026-10-16T23:59:59%2B07:00`

- `from` dan `to` berupa ISO 8601. `device_id` wajib.
- Header respons:
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="epen-<device>-<from>-<to>.csv"`
- Baris diurutkan dari waktu terlama ke terbaru.
- Maksimal **50.000 baris** (dengan interval 5 detik, setara ±69 jam data). Kalau rentang yang diminta berisi lebih dari itu, server **tidak memotong data**. Server menolak request dengan `400` supaya pengguna mempersempit rentang tanggalnya:
  ```json
  { "error": "Rentang terlalu besar: 61.240 baris (maks 50.000). Persempit rentang tanggal.", "row_count": 61240 }
  ```
- Kolom waktu ditulis dalam **WIB (Asia/Jakarta)**.

```csv
recorded_at_wib,tvoc_raw_ppb,tvoc_kalman_ppb,eco2_ppm,temperature_celsius,humidity_percent,dust_outlet_ugm3,air_status,fuzzy_level,fan_duty_percent,fan_rpm
2026-10-16 10:12:45,412,286,640,27.4,63.1,18.5,WASPADA,MED,85,2810
```

**Error**

| Kode | Kapan terjadi |
|---|---|
| `400` | Parameter tidak valid, misalnya `page` bukan angka, `from`/`to` bukan tanggal, atau `device_id` tidak ada di mode CSV |
| `400` | Mode CSV: hasil lebih dari 50.000 baris (respons menyertakan `row_count`) |
| `500` | Kesalahan server atau database |

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
| `filter_runtime_hours` | Perkiraan jam operasi filter: jumlah log dengan `fan_duty_percent > 0` sejak `filter_installed_at`, dikali 5 detik, dibagi 3600. Nilainya `null` kalau `filter_installed_at` kosong. |

---

### `GET /api/config` — konfigurasi tampilan (opsional)

Endpoint ini mengembalikan konfigurasi dari `lib/sensor.ts` supaya frontend tidak meng-hardcode ambang dan label.

```json
{
  "statuses": {
    "AMAN":      { "label": "Aman",      "color": "#22C55E", "text_light": "#15803D", "description": "..." },
    "WASPADA":   { "label": "Waspada",   "color": "#F59E0B", "text_light": "#B45309", "description": "..." },
    "BERBAHAYA": { "label": "Berbahaya", "color": "#EF4444", "text_light": "#DC2626", "description": "..." }
  },
  "fuzzy_levels": {
    "MIN":  { "label": "Minimum", "duty_percent": 25 },
    "LOW":  { "label": "Rendah",  "duty_percent": 60 },
    "MED":  { "label": "Sedang",  "duty_percent": 85 },
    "FAST": { "label": "Cepat",   "duty_percent": 100 }
  },
  "tvoc_reference_ppb": { "waspada": 250, "berbahaya": 400 },
  "poll_interval_ms": 5000,
  "offline_after_ms": 15000
}
```

`color` dipakai untuk aksen (ikon, garis, badge di tema gelap). `text_light` dipakai untuk teks di latar terang, termasuk email, supaya kontrasnya cukup.

`tvoc_reference_ppb` hanya dipakai untuk garis referensi grafik. Nilainya harus disamakan dengan fungsi keanggotaan fuzzy di firmware. Status yang tampil tetap berasal dari `air_status` yang dikirim ESP32.
