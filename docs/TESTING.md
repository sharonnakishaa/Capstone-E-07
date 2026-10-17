# Checklist Uji Manual — Dashboard EPEN

Dokumen ini berisi matriks uji fungsional untuk dashboard monitoring Epen (bahan laporan C-501). Setiap baris berisi komponen yang diuji, langkah pengujian, hasil yang diharapkan, dan kolom hasil yang diisi penguji.

Karena hardware belum tersambung, data perangkat berasal dari simulator ESP32 (`scripts/simulate.ts`). Simulator mengirim payload yang sama dengan kontrak API firmware.

## Informasi pengujian

| | |
|---|---|
| Tanggal uji | |
| Penguji | |
| Versi (commit) | |
| Browser / perangkat | |
| URL | `http://localhost:3000` |

**Keterangan kolom Hasil:** ✅ Lulus · ❌ Gagal (jelaskan di kolom Catatan) · ➖ Tidak diuji

## Prasyarat

1. `.env` sudah terisi (`DATABASE_URL`, `DIRECT_URL`, `API_KEY`, SMTP). Untuk uji email tanpa mengirim email sungguhan, kosongkan `ALERT_EMAIL_TO=`. Server akan mencatat `[email] ALERT_EMAIL_TO not set — skipping` setiap kali alert lolos.
2. Skema database sudah sinkron: `npx prisma db push`.
3. Data awal tersedia: `npm run db:seed`.
4. Server berjalan di terminal 1: `npm run dev`.
5. Simulator berjalan di terminal 2 sesuai skenario pada tiap uji: `npm run simulate -- --scenario=<normal|spike|offline>`.

---

## A. Status koneksi dan banner

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| A-01 | Indikator koneksi | Jalankan simulator `normal`, lalu buka dashboard. | Pill di topbar menampilkan titik hijau berdenyut dan teks **TERHUBUNG**. | | |
| A-02 | Banner status AMAN | Tunggu sampai status di terminal simulator `AMAN`. | Banner hijau bertuliskan **AMAN — Kualitas Udara Baik** dengan ikon centang. | | |
| A-03 | Banner status WASPADA | Tunggu sampai status di terminal simulator `WASPADA`. | Banner kuning bertuliskan **WASPADA — Asap Solder Terdeteksi** dengan ikon segitiga. | | |
| A-04 | Banner status BERBAHAYA | Jalankan simulator `spike` sampai status `BERBAHAYA`. | Banner merah bertuliskan **BERBAHAYA — Kadar Asap Tinggi**. | | |
| A-05 | Status mengikuti ESP32 | Bandingkan status di banner dengan kolom status di terminal simulator pada waktu yang sama. | Status di banner sama dengan `air_status` yang dikirim simulator. Server tidak menghitung status sendiri. | | |
| A-06 | Deteksi OFFLINE | Hentikan simulator (`Ctrl+C`) dan tunggu ±20 detik. | Pill berubah jadi **OFFLINE** merah. Banner abu-abu bertuliskan **OFFLINE — Tidak ada data dari perangkat** dan menyebut umur data terakhir. | | |
| A-07 | Pulih dari OFFLINE | Jalankan lagi simulator. | Dalam ≤ 5 detik setelah data pertama masuk, pill kembali **TERHUBUNG** dan banner kembali sesuai status. | | |
| A-08 | Skenario offline berkala | Jalankan simulator `offline` selama ±3 menit. | Status berganti TERHUBUNG ↔ OFFLINE mengikuti pola kirim 60 detik / diam 30 detik. | | |
| A-09 | Waktu data terakhir | Perhatikan "Data terakhir" di kanan banner. | Jam (WIB) sama dengan baris terakhir di terminal simulator dan berubah tiap 5 detik. | | |
| A-10 | Server tidak dapat dihubungi | Hentikan `npm run dev` sementara dashboard terbuka. | Pill menampilkan **ERROR** dan banner bertuliskan "Server tidak dapat dihubungi". Dashboard pulih sendiri setelah server dinyalakan lagi. | | |

## B. Kartu metrik

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| B-01 | Kartu TVOC | Bandingkan kartu TVOC dengan baris terbaru di terminal simulator. | Angka besar = TVOC **Kalman** (dibulatkan). Teks kecil "Mentah: … ppb" = TVOC mentah. | | |
| B-02 | Bar dan ambang TVOC | Perhatikan bar TVOC. | Ada dua penanda ambang (250 dan 400 ppb). Warna bar mengikuti status (hijau, kuning, atau merah). Teks bawah: "Ambang: 250 / 400 ppb". | | |
| B-03 | Kartu Debu Outlet | Bandingkan dengan nilai `debu` di terminal simulator. | Nilai µg/m³ sesuai, dan "Rata-rata 30 data" tampil. Teks bawah: "Batas filter: 25 µg/m³". | | |
| B-04 | Kartu Suhu | Bandingkan dengan data terbaru di halaman log. | Nilai °C sesuai (1 desimal). | | |
| B-05 | Kartu Kelembapan | Bandingkan dengan data terbaru di halaman log. | Nilai % sesuai (1 desimal). | | |
| B-06 | Indikator tren | Amati badge persentase di tiap kartu selama beberapa pembaruan. | Badge menunjukkan perubahan terhadap data sebelumnya. Kenaikan TVOC dan debu ditandai merah. | | |
| B-07 | Pembaruan otomatis | Amati kartu tanpa memuat ulang halaman. | Nilai berubah tiap ±5 detik. | | |

## C. Grafik tren TVOC

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| C-01 | Dua garis | Amati grafik. | Ada garis tebal (TVOC Kalman) dan garis tipis pudar (TVOC mentah). Garis Kalman lebih halus daripada garis mentah. | | |
| C-02 | Legend | Amati legend di atas grafik. | Ada 4 item: TVOC Kalman, TVOC mentah, Waspada (250 ppb), Berbahaya (400 ppb). | | |
| C-03 | Garis ambang | Amati garis putus-putus. | Garis kuning di 250 ppb dan garis merah di 400 ppb, sesuai sumbu Y. | | |
| C-04 | Jumlah data | Amati sumbu X. | Grafik berisi 30 data terakhir (±2,5 menit), dan titik terbaru berada di ujung kanan. | | |
| C-05 | Tooltip | Arahkan kursor (atau sentuh, di ponsel) ke beberapa titik grafik. | Garis bantu vertikal dan tooltip muncul berisi jam (WIB), nilai Kalman, nilai mentah, dan status. Tooltip hilang saat kursor keluar dari grafik. | | |
| C-06 | Skala otomatis | Jalankan simulator `spike` (TVOC > 1.000 ppb). | Sumbu Y menyesuaikan nilai tertinggi, dan garis tidak terpotong. | | |

## D. Statistik sesi

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| D-01 | TVOC tertinggi, terendah, dan rata-rata | Bandingkan dengan 30 data terakhir di halaman log (kolom TVOC Kalman). | Nilai maksimum, minimum, dan rata-rata sesuai (dibulatkan). | | |
| D-02 | Level fuzzy | Bandingkan dengan kolom level di terminal simulator. | Tampil kode dan label level, misalnya `MED Sedang`. | | |
| D-03 | Duty cycle kipas | Bandingkan dengan `fan_duty_percent` terbaru. | Nilai dalam persen 0–100 (25 / 60 / 85 / 100), bukan 0–255. | | |
| D-04 | Putaran kipas | Bandingkan dengan nilai `rpm` di terminal simulator. | Nilai RPM sesuai. | | |

## E. Info perangkat

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| E-01 | Jarak inlet | Amati panel Info Perangkat. | Menampilkan **5 cm** (nilai `inlet_distance_cm` device). Panduan juga menyebut ±5 cm. | | |
| E-02 | Jam operasi filter | Bandingkan dengan `filter_runtime_hours` di `GET /api/devices`. | Nilai jam sesuai, disertai tanggal pemasangan filter (WIB). | | |
| E-03 | Data terakhir | Amati item "Data Terakhir". | Menampilkan umur data (misalnya "3 detik lalu") dan tanggal-jam WIB. | | |
| E-04 | Panduan penggunaan | Baca panduan. | Ada 3 poin: posisi alat di samping titik solder, inlet menghadap sumber asap, dan susunan filter HEPA → kipas → karbon aktif. | | |
| E-05 | Status filter normal | Jalankan simulator `normal` selama ≥ 3 menit. | Kotak status berwarna netral/hijau: "Filter bekerja baik" dengan rata-rata < 25 µg/m³. | | |
| E-06 | Peringatan filter | Jalankan simulator `spike` selama ≥ 3 menit. | Kotak berubah kuning: "Debu outlet naik — periksa filter" dengan rata-rata > 25 µg/m³. | | |

## F. Tabel log di dashboard

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| F-01 | Kolom tabel | Amati header tabel. | Kolomnya: #, Waktu, TVOC Kalman, TVOC Mentah, Suhu, RH, Debu, **Status Fuzzy**, Kipas. Tidak ada teks "AI" maupun "eCO₂". | | |
| F-02 | Isi tabel | Bandingkan 5 baris dengan halaman log. | 5 record terbaru, urut dari yang terbaru, dengan badge status berwarna. | | |
| F-03 | Tautan ke log | Klik "Lihat Semua Data →". | Halaman log terbuka. | | |
| F-04 | Ganti perangkat | Kalau ada > 1 device, ganti pilihan di dropdown topbar. | Semua kartu, grafik, statistik, info perangkat, dan tabel berganti ke data device terpilih. | | |

## G. Halaman log dan ekspor CSV

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| G-01 | Kolom halaman log | Buka `/logs.html`. | Kolomnya: waktu, TVOC mentah, TVOC Kalman, suhu, RH, debu outlet, status fuzzy (badge), level, duty %, RPM. | | |
| G-02 | Pagination | Klik halaman 2, halaman terakhir, lalu tombol ‹ dan ›. | 50 baris per halaman. Info "Menampilkan X–Y dari Z" sesuai, dan tombol nonaktif di halaman pertama dan terakhir. | | |
| G-03 | Ekspor hari ini | Biarkan tanggal default (hari ini), lalu klik **Ekspor CSV**. | File `epen-<id>-<tanggal>-<tanggal>.csv` terunduh, dan muncul pesan "N baris diekspor". | | |
| G-04 | Isi CSV | Buka file CSV di editor teks atau spreadsheet. | Baris pertama adalah header. Kolom `recorded_at_wib` berisi waktu WIB, dan data urut dari waktu terlama. | | |
| G-05 | Rentang terbalik | Isi "Dari" = besok dan "Sampai" = hari ini, lalu klik Ekspor. | Muncul pesan merah "Tanggal "Dari" tidak boleh setelah tanggal "Sampai"", dan tidak ada file yang terunduh. | | |
| G-06 | Rentang tanpa data | Pilih tanggal sebelum data seed ada. | Muncul pesan "Tidak ada data pada rentang ini", dan file hanya berisi header. | | |
| G-07 | Batas 50.000 baris | Pilih rentang yang berisi > 50.000 data (± 69 jam data terus-menerus). | Muncul pesan merah dari server "Rentang terlalu besar: … baris (maks 50.000)", dan tidak ada file yang terunduh. | | |

## H. Notifikasi email

Jalankan `npm run db:seed` sebelum H-01 supaya `last_alert_at` kembali kosong.

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| H-01 | Alert pertama | Jalankan simulator `spike`. | Saat status pertama kali WASPADA atau BERBAHAYA, log server mencatat satu alert (atau email masuk kalau `ALERT_EMAIL_TO` diisi). | | |
| H-02 | Cooldown 15 menit | Biarkan simulator `spike` berjalan ±5 menit. | Tidak ada alert tambahan walaupun status tetap WASPADA/BERBAHAYA. | | |
| H-03 | Eskalasi | Ulangi seed. Jalankan `normal` sampai alert pertama berstatus WASPADA, lalu ganti ke `spike`. | Satu alert tambahan terkirim saat status naik ke BERBAHAYA, walaupun masih dalam masa cooldown. | | |
| H-04 | Request bersamaan | Ulangi seed, lalu kirim 5 POST BERBAHAYA sekaligus (lihat perintah di bawah tabel). | Kelima request mendapat `201`, tapi alert hanya tercatat **satu kali**. | | |
| H-05 | Isi email | Isi `ALERT_EMAIL_TO` dengan email penguji, lalu ulangi H-01. | Subject `[EPEN <STATUS>] TVOC <n> ppb — Epen #1`. Isi email memuat TVOC Kalman dan mentah, status dan level fuzzy, duty, RPM, debu outlet, suhu, kelembapan, dan jarak inlet. Tidak ada teks eCO₂. | | |

Perintah untuk H-04 (PowerShell 7). Simpan payload BERBAHAYA dengan `device_id` hasil seed di `payload.json`:

```json
{"device_id":"<uuid>","tvoc_raw_ppb":620,"tvoc_kalman_ppb":540,"eco2_ppm":960,"temperature_celsius":28.4,"humidity_percent":60.2,"dust_outlet_ugm3":30.1,"air_status":"BERBAHAYA","fuzzy_level":"FAST","fan_duty_percent":100,"fan_rpm":3290}
```

```powershell
1..5 | ForEach-Object -Parallel { curl.exe -s -X POST http://localhost:3000/api/sensor -H "Content-Type: application/json" -H "x-api-key: <API_KEY>" -d "@payload.json" }
```

## I. Validasi API

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| I-01 | Tanpa API key | POST `/api/sensor` tanpa header `x-api-key`. | `401 Unauthorized`. | | |
| I-02 | Body bukan JSON | POST dengan body teks biasa. | `400 Body bukan JSON valid`. | | |
| I-03 | Field tidak valid | POST dengan `humidity_percent: 120`, `fan_duty_percent: 255`, `air_status: "BAHAYA"`. | `400 Validasi gagal`, dan ketiga field disebutkan di `details`. | | |
| I-04 | Device tidak terdaftar | POST dengan `device_id` UUID acak. | `404 Device tidak ditemukan atau tidak aktif` (bukan 500). | | |
| I-05 | Payload valid | POST payload contoh dari README dengan `device_id` hasil seed. | `201` dengan `{ success: true, id, air_status }`, dan data muncul di dashboard. | | |

## J. Tampilan

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| J-01 | Tema gelap | Klik tombol tema di topbar. | Semua komponen berganti ke tema gelap, termasuk grafik, legend, banner, dan badge. Pilihan tema tersimpan setelah halaman dimuat ulang. | | |
| J-02 | Tema di halaman log | Buka `/logs.html` setelah memilih tema gelap. | Halaman log memakai tema yang sama. | | |
| J-03 | Tablet (≤ 1100 px) | Ubah lebar jendela ke ±1000 px. | Kartu metrik jadi 2 kolom, dan grafik serta statistik bertumpuk. | | |
| J-04 | Ponsel 375 px | DevTools → *device toolbar* → iPhone SE. | Kartu 1 kolom dan topbar terlipat. Tidak ada scroll horizontal di halaman; tabel bisa digeser di dalam kartunya sendiri. | | |
| J-05 | Halaman log 375 px | Ulangi J-04 di `/logs.html`. | Form ekspor tersusun rapi, tombol Ekspor selebar layar, dan tabel bisa digeser di dalam kartu. | | |

---

## Ringkasan hasil

| Bagian | Jumlah uji | Lulus | Gagal | Tidak diuji |
|---|---|---|---|---|
| A. Status koneksi dan banner | 10 | | | |
| B. Kartu metrik | 7 | | | |
| C. Grafik tren TVOC | 6 | | | |
| D. Statistik sesi | 4 | | | |
| E. Info perangkat | 6 | | | |
| F. Tabel log di dashboard | 4 | | | |
| G. Halaman log dan ekspor CSV | 7 | | | |
| H. Notifikasi email | 5 | | | |
| I. Validasi API | 5 | | | |
| J. Tampilan | 5 | | | |
| **Total** | **59** | | | |
