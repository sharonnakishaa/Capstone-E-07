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
6. Akun Pengelola Lab untuk uji yang butuh login (E-07–E-09, G-03–G-07, M): `npm run user:add -- --email=<email> --name="<nama>"`. Simpan password yang ditampilkan.

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
| A-11 | Pemanasan sensor | Hentikan simulator, tunggu sampai OFFLINE, lalu jalankan lagi `npm run simulate`. Amati 45 detik pertama. | Banner bertuliskan **"AMAN — Pemanasan Sensor"** dengan penjelasan ±45 detik dan kipas belum aktif. Kartu TVOC menulis "Pemanasan sensor · nilai mentah", Baseline TVOC "— pemanasan", garis ambang tidak digambar (legend: "Ambang menunggu baseline"). Setelah ±45 detik, semuanya kembali normal dan garis ambang muncul. | | |

## B. Kartu metrik

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| B-01 | Kartu TVOC | Bandingkan kartu TVOC dengan baris terbaru di terminal simulator. | Angka besar = TVOC **Kalman** (dibulatkan). Teks kecil "Mentah: … ppb" = TVOC mentah. | | |
| B-02 | Bar dan ambang TVOC | Perhatikan bar TVOC dan nilai "Baseline TVOC" di Statistik Sesi. | Ada dua penanda ambang di **baseline + 207** dan **baseline + 359** ppb. Teks bawah: "Ambang: <baseline+207> / <baseline+359> ppb". Warna bar mengikuti status (hijau, kuning, atau merah). | | |
| B-03 | Kartu Debu Outlet | Bandingkan dengan nilai `debu` di terminal simulator. | Nilai µg/m³ sesuai, dan "Rata-rata 30 data" tampil. Teks bawah: "Batas filter: 25 µg/m³". | | |
| B-04 | Kartu Suhu | Bandingkan dengan data terbaru di halaman log. | Nilai °C sesuai (1 desimal). | | |
| B-05 | Kartu Kelembapan | Bandingkan dengan data terbaru di halaman log. | Nilai % sesuai (1 desimal). | | |
| B-06 | Indikator tren | Amati badge persentase di tiap kartu selama beberapa pembaruan. | Badge menunjukkan perubahan terhadap data sebelumnya. Kenaikan TVOC dan debu ditandai merah. | | |
| B-07 | Pembaruan otomatis | Amati kartu tanpa memuat ulang halaman. | Nilai berubah tiap ±5 detik. | | |

## C. Grafik tren TVOC

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| C-01 | Dua garis | Amati grafik. | Ada garis tebal (TVOC Kalman) dan garis tipis pudar (TVOC mentah). Garis Kalman lebih halus daripada garis mentah. | | |
| C-02 | Legend | Amati legend di atas grafik. | Ada 4 item: TVOC Kalman, TVOC mentah, Waspada (<baseline+207> ppb), Berbahaya (<baseline+359> ppb). | | |
| C-03 | Garis ambang | Amati garis putus-putus. | Garis kuning di baseline + 207 ppb dan garis merah di baseline + 359 ppb, sesuai sumbu Y. Saat TVOC Kalman melewati garis merah, status di banner BERBAHAYA (selisih ±1 data karena pembulatan). | | |
| C-04 | Jumlah data | Amati sumbu X. | Grafik berisi 30 data terakhir (±2,5 menit), dan titik terbaru berada di ujung kanan. | | |
| C-05 | Tooltip | Arahkan kursor (atau sentuh, di ponsel) ke beberapa titik grafik. | Garis bantu vertikal dan tooltip muncul berisi jam (WIB), nilai Kalman, nilai mentah, dan status. Tooltip hilang saat kursor keluar dari grafik. | | |
| C-06 | Skala otomatis | Jalankan simulator `spike` (TVOC > 1.000 ppb). | Sumbu Y menyesuaikan nilai tertinggi, dan garis tidak terpotong. | | |

## D. Statistik sesi

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| D-01 | TVOC tertinggi, terendah, dan rata-rata | Bandingkan dengan 30 data terakhir di halaman log (kolom TVOC Kalman). | Nilai maksimum, minimum, dan rata-rata sesuai (dibulatkan). | | |
| D-02 | Baseline TVOC | Bandingkan dengan nilai `base` di terminal simulator. | Nilai baseline (ppb) sama. Selama pemanasan tampil "— pemanasan". | | |
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
| E-07 | Catat penggantian filter | Masuk sebagai Pengelola Lab. Klik **Filter diganti…**, biarkan waktu default (sekarang), lalu klik **Simpan**. | Form tertutup dan muncul pesan hijau "Penggantian filter tercatat". Jam operasi filter kembali ke ±0 jam, dan tanggal pemasangan berubah ke waktu sekarang dengan keterangan "dicatat oleh <nama>". Nilainya tetap sama setelah halaman dimuat ulang. | | |
| E-08 | Catat penggantian mundur | Klik **Filter diganti…**, isi waktu 1 jam yang lalu, lalu klik **Simpan**. | Jam operasi filter menjadi ±1 jam (kalau simulator berjalan selama satu jam itu). | | |
| E-09 | Validasi waktu filter | Klik **Filter diganti…**, ubah waktu ke besok (ketik manual kalau pemilih tanggal membatasi), lalu klik **Simpan**. | Muncul pesan merah "installed_at tidak boleh di masa depan", dan data tidak berubah. Tombol **Batal** menutup form tanpa menyimpan. | | |

## F. Tabel log di dashboard

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| F-01 | Kolom tabel | Amati header tabel. | Kolomnya: #, Waktu, TVOC Kalman, TVOC Mentah, Suhu, RH, Debu, **Status Fuzzy**, Kipas (duty %, tanpa label level). Tidak ada teks "AI" maupun "eCO₂". | | |
| F-02 | Isi tabel | Bandingkan 5 baris dengan halaman log. | 5 record terbaru, urut dari yang terbaru, dengan badge status berwarna. | | |
| F-03 | Tautan ke log | Klik "Lihat Semua Data →". | Halaman log terbuka. | | |
| F-04 | Ganti perangkat | Kalau ada > 1 device, ganti pilihan di dropdown topbar. | Semua kartu, grafik, statistik, info perangkat, dan tabel berganti ke data device terpilih. | | |

## G. Halaman log dan ekspor Excel

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| G-01 | Kolom halaman log | Buka `/logs.html`. | Kolomnya: waktu, TVOC mentah, TVOC Kalman, baseline, suhu, RH, debu outlet, status fuzzy (badge), duty %, RPM. Tidak ada kolom level. | | |
| G-02 | Pagination | Klik halaman 2, halaman terakhir, lalu tombol ‹ dan ›. | 50 baris per halaman. Info "Menampilkan X–Y dari Z" sesuai, dan tombol nonaktif di halaman pertama dan terakhir. | | |
| G-03 | Ekspor hari ini | Masuk sebagai Pengelola Lab. Biarkan tanggal default (hari ini), lalu klik **Ekspor Excel (.xlsx)**. | File `epen-meja-1-<tanggal>-<tanggal>.xlsx` terunduh, dan muncul pesan "N baris diekspor". | | |
| G-04 | Isi dan tampilan Excel | Buka file di Microsoft Excel. | Sheet bernama sesuai alat. Baris judul tebal, teks putih, latar biru tua, dan tetap terlihat saat di-scroll (freeze). Border hanya di area tabel: sel kosong di dalam tabel tetap berborder, sedangkan sel di bawah baris terakhir dan di kanan kolom RPM tanpa border. Kolom Waktu (WIB) berupa tanggal (bisa difilter per tanggal), dan kolom angka bisa langsung dijumlah dengan `=SUM()`. Data urut dari waktu terlama. | | |
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
| H-05 | Isi email | Isi `ALERT_EMAIL_TO` dengan email penguji, lalu ulangi H-01. | Subject `[EPEN <STATUS>] TVOC <n> ppb — Epen #1`. Isi email memuat TVOC Kalman dan mentah, baseline, status fuzzy, duty, RPM, debu outlet, suhu, kelembapan, jarak inlet, dan tabel ambang yang dihitung dari baseline (baseline + 207 / + 359). Tidak ada teks eCO₂ maupun level fuzzy. | | |

Perintah untuk H-04 (PowerShell 7). Simpan payload BERBAHAYA dengan MAC alat hasil seed (`24:6F:28:00:00:01`) di `payload.json`:

```json
{"mac_address":"24:6F:28:00:00:01","tvoc_raw_ppb":620,"tvoc_kalman_ppb":540,"tvoc_baseline_ppb":90,"eco2_ppm":960,"temperature_celsius":28.4,"humidity_percent":60.2,"dust_outlet_ugm3":30.1,"air_status":"BERBAHAYA","fan_duty_percent":100,"fan_rpm":3290}
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
| I-04 | MAC tidak terdaftar | POST dengan `mac_address: "24:6F:28:FF:FF:FF"`. | `404 MAC belum terdaftar atau alat tidak aktif` (bukan 500), dan log server mencatat MAC tersebut. | | |
| I-05 | Payload valid (MAC) | POST payload contoh dari README (`mac_address` alat hasil seed). | `201` dengan `{ success: true, id, air_status }`, dan data muncul di dashboard alat yang benar. | | |
| I-06 | Format MAC | POST dengan `mac_address: "246F28ABCDEF"`, lalu dengan `mac_address` **dan** `device_id` sekaligus. | Keduanya `400`: "harus format MAC seperti 24:6F:28:AB:CD:EF" dan "kirim salah satu saja". MAC huruf kecil (`24:6f:28:00:00:01`) tetap diterima `201`. | | |
| I-07 | Firmware lama | POST dengan `device_id` (UUID hasil seed) dan `fuzzy_level: "MED"`. | `201`. `fuzzy_level` diabaikan tanpa error. | | |
| I-08 | Daftarkan alat | `npm run device:add -- --mac=24:6F:28:FF:FF:FF --name="Epen Uji"`, lalu ulangi I-04. | Script mencetak MAC dan device_id. POST yang tadinya `404` sekarang `201`, dan alat "Epen Uji" muncul di Ringkasan Lab. | | |

## J. Tampilan

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| J-01 | Tema gelap | Klik tombol tema di topbar. | Semua komponen berganti ke tema gelap, termasuk grafik, legend, banner, dan badge. Pilihan tema tersimpan setelah halaman dimuat ulang. | | |
| J-02 | Tema di halaman log | Buka `/logs.html` setelah memilih tema gelap. | Halaman log memakai tema yang sama. | | |
| J-03 | Tablet (≤ 1100 px) | Ubah lebar jendela ke ±1000 px. | Kartu metrik jadi 2 kolom, dan grafik serta statistik bertumpuk. | | |
| J-04 | Ponsel 375 px | DevTools → *device toolbar* → iPhone SE. | Kartu 1 kolom dan topbar terlipat. Tidak ada scroll horizontal di halaman; tabel bisa digeser di dalam kartunya sendiri. | | |
| J-05 | Halaman log 375 px | Ulangi J-04 di `/logs.html`. | Form ekspor tersusun rapi, tombol Ekspor selebar layar, dan tabel bisa digeser di dalam kartu. | | |

## K. Retensi data

Uji ini memakai `--days=0` supaya data hasil seed langsung diproses. **Data mentah selain jam berjalan akan terhapus.** Jalankan hanya di database dummy, lalu `npm run db:seed` untuk memulihkan data.

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| K-01 | Dry-run | `npm run db:retention -- --dry-run --days=0` | Menampilkan batas waktu, jumlah log, dan jumlah ringkasan per jam. Jumlah baris di `sensor_logs` tidak berubah (cek di Prisma Studio). | | |
| K-02 | Ringkas dan hapus | Catat jam operasi filter di dashboard, lalu jalankan `npm run db:retention -- --days=0`. | Script melaporkan N ringkasan ditulis dan M log dihapus, dengan angka yang sama seperti K-01. Di Prisma Studio, `sensor_hourly` berisi N baris dan `sensor_logs` hanya berisi data jam berjalan. | | |
| K-03 | Jam operasi filter tetap | Muat ulang dashboard setelah K-02. | Jam operasi filter sama dengan sebelum K-02 (selisih ≤ 1 jam). | | |
| K-04 | Dijalankan ulang | Jalankan lagi `npm run db:retention -- --days=0` dalam jam yang sama. | Muncul "Tidak ada data yang melewati masa retensi", dan tidak ada ringkasan ganda. | | |

## L. Ringkasan Lab (banyak alat)

Prasyarat: `npm run db:seed -- --devices=4`, lalu `npm run simulate -- --all --scenario=normal,spike,offline,normal`.

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| L-01 | Halaman utama | Buka `http://localhost:3000/`. | Dialihkan ke `/lab.html`, dan tampil 4 kartu: Epen Meja 1 sampai 4. | | |
| L-02 | Isi kartu | Bandingkan satu kartu dengan baris terbaru di terminal simulator untuk alat yang sama. | Status, TVOC Kalman (besar), TVOC mentah, duty kipas, RPM, serta debu outlet sesuai. | | |
| L-03 | Urutan kartu | Amati urutan kartu selama beberapa menit. | Kartu BERBAHAYA selalu paling atas, diikuti WASPADA, OFFLINE, lalu AMAN. Status yang sama diurutkan menurut nama (Meja 2 sebelum Meja 10). | | |
| L-04 | Ringkasan atas | Hitung kartu per status. | Pill BERBAHAYA/WASPADA/AMAN/OFFLINE menunjukkan jumlah yang sama. Judul menyebut status terburuk, misalnya "1 dari 4 alat BERBAHAYA". | | |
| L-05 | Judul tab | Amati judul tab browser saat ada alat BERBAHAYA. | Judul tab diawali "(1 BERBAHAYA)". | | |
| L-06 | OFFLINE per alat | Tunggu fase offline alat dengan skenario `offline`. | Hanya kartu alat itu yang berubah jadi OFFLINE (pudar, "Data terakhir … lalu"). Kartu lain tidak terpengaruh. | | |
| L-07 | Periksa filter | Tunggu ±3 menit pada alat dengan skenario `spike`. | Kartu alat itu menampilkan chip "⚠ Periksa filter". | | |
| L-08 | Buka detail | Klik salah satu kartu. | Dashboard detail terbuka untuk alat yang diklik (nama di dropdown sesuai), dan URL berisi `?device=<id>`. | | |
| L-09 | Navigasi | Dari dashboard detail, buka "Lihat Semua Data", lalu kembali dengan "Dashboard", lalu "‹ Ringkasan Lab". | Halaman log dan dashboard tetap menampilkan alat yang sama, dan tombol terakhir kembali ke Ringkasan Lab. | | |
| L-10 | Banyak lokasi | Di Prisma Studio, ubah `location` salah satu device menjadi lokasi lain. | Kartu dikelompokkan per lokasi dengan judul grup dan jumlah alat. | | |
| L-11 | Tampilan 375 px | DevTools → iPhone SE. | Kartu tersusun satu kolom tanpa scroll horizontal. | | |
| L-12 | Pemanasan di kartu | Ulangi langkah A-11 sambil melihat Ringkasan Lab. | Kartu alat itu menulis "Pemanasan sensor" di bawah nilai TVOC selama ±45 detik pertama. | | |

## M. Login Pengelola Lab

| ID | Komponen | Langkah | Hasil yang diharapkan | Hasil | Catatan |
|---|---|---|---|---|---|
| M-01 | Akses tanpa login | Dalam keadaan belum masuk, buka Ringkasan Lab, dashboard detail, dan halaman log. | Ketiga halaman tampil normal. Di topbar ada tombol **Masuk**. | | |
| M-02 | Aksi terkunci | Masih tanpa login, lihat panel Info Perangkat dan bagian Ekspor Excel di halaman log. | Di Info Perangkat tertulis "Masuk untuk mencatat penggantian filter" (bukan tombol "Filter diganti…"). Di halaman log tertulis "Ekspor Excel hanya untuk Pengelola Lab", dan form ekspor tidak tampil. | | |
| M-03 | Password salah | Klik **Masuk**, isi email benar dan password salah. | Muncul pesan merah "Email atau password salah", kolom password dikosongkan, dan pengguna tetap di halaman login. | | |
| M-04 | Email tidak terdaftar | Isi email yang tidak terdaftar. | Pesan yang sama persis dengan M-03, tanpa memberi tahu apakah emailnya terdaftar. | | |
| M-05 | Login berhasil | Dari halaman log, klik **Masuk**, lalu isi email dan password yang benar. | Kembali ke halaman log yang sama (device yang sama). Nama pengguna dan tombol **Keluar** tampil di topbar, dan form Ekspor Excel muncul. | | |
| M-06 | Sesi bertahan | Pindah ke Ringkasan Lab dan dashboard detail, lalu tutup dan buka lagi browser. | Tetap dalam keadaan masuk di semua halaman. Tombol "Filter diganti…" tersedia. | | |
| M-07 | Logout | Klik **Keluar**. | Halaman dimuat ulang dalam keadaan belum masuk, dan aksi kembali terkunci seperti M-02. | | |
| M-08 | API terlindungi | Tanpa login, jalankan `curl "http://localhost:3000/api/sensor?format=xlsx&device_id=<uuid>"`. | `401 {"error":"Silakan masuk terlebih dahulu"}`. Hal yang sama berlaku untuk `POST /api/devices/<uuid>/filter`. | | |
| M-09 | Cabut akses | Masuk dengan akun A, lalu hapus akun A di Prisma Studio, lalu coba catat penggantian filter. | Ditolak dengan pesan "Silakan masuk terlebih dahulu". Widget kembali menampilkan **Masuk** setelah halaman dimuat ulang. | | |

---

## Ringkasan hasil

| Bagian | Jumlah uji | Lulus | Gagal | Tidak diuji |
|---|---|---|---|---|
| A. Status koneksi dan banner | 11 | | | |
| B. Kartu metrik | 7 | | | |
| C. Grafik tren TVOC | 6 | | | |
| D. Statistik sesi | 4 | | | |
| E. Info perangkat | 9 | | | |
| F. Tabel log di dashboard | 4 | | | |
| G. Halaman log dan ekspor Excel | 7 | | | |
| H. Notifikasi email | 5 | | | |
| I. Validasi API | 8 | | | |
| J. Tampilan | 5 | | | |
| K. Retensi data | 4 | | | |
| L. Ringkasan Lab | 12 | | | |
| M. Login Pengelola Lab | 9 | | | |
| **Total** | **91** | | | |
