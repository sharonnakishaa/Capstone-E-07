// Satu sumber konfigurasi untuk status udara dan ambang referensi.
// Status sebenarnya ditentukan oleh fuzzy di ESP32 — server hanya menyimpan dan menampilkan.

export const AIR_STATUSES = ['AMAN', 'WASPADA', 'BERBAHAYA'] as const
export type StatusLabel = typeof AIR_STATUSES[number]

export const STATUS_META: Record<StatusLabel, {
  label: string
  headline: string   // judul banner dashboard
  emoji: string
  color: string      // aksen (ikon, garis, badge tema gelap)
  text_light: string // teks di latar terang, termasuk email
  description: string
}> = {
  AMAN: {
    label: 'Aman', headline: 'Kualitas Udara Baik', emoji: '🟢', color: '#22C55E', text_light: '#15803D',
    description: 'Kadar TVOC rendah. Ekstraktor bekerja normal.',
  },
  WASPADA: {
    label: 'Waspada', headline: 'Asap Solder Terdeteksi', emoji: '🟠', color: '#F59E0B', text_light: '#B45309',
    description: 'Asap solder terdeteksi. Pastikan inlet dekat titik solder dan menghadap sumber asap.',
  },
  BERBAHAYA: {
    label: 'Berbahaya', headline: 'Kadar Asap Tinggi', emoji: '🔴', color: '#EF4444', text_light: '#DC2626',
    description: 'Kadar TVOC tinggi! Jeda menyolder, periksa posisi alat dan kondisi filter.',
  },
}

// Ambang status fuzzy di firmware, dihitung di ATAS baseline udara bersih tiap alat.
// Garis ambang di grafik = tvoc_baseline_ppb + nilai ini. Samakan dengan firmware (epen_config.h)
// kalau fungsi keanggotaan fuzzy-nya berubah. Nilai firmware: 206,97 dan 359,48 ppb (dibulatkan;
// selisih < 1 ppb tidak terlihat di grafik).
export const TVOC_THRESHOLD_ABOVE_BASELINE_PPB = {
  waspada:   207,
  berbahaya: 359,
}

// Tingkat keluaran fuzzy Sugeno di firmware (EPEN_PWM_*). Duty yang dikirim berupa rata-rata
// terbobot dari tingkat ini, jadi nilainya kontinu (mis. 55%), bukan hanya salah satu tingkat.
export const FAN_DUTY_LEVELS_PERCENT = [0, 30, 50, 75, 100]

// Lama fase pemanasan SGP30 + perekaman baseline setelah alat menyala.
// Selama fase ini tvoc_kalman_ppb dan tvoc_baseline_ppb dikirim null.
export const SENSOR_WARMUP_SEC = 45

// Rata-rata debu outlet yang tampil di dashboard dihitung dari N data terakhir.
export const OUTLET_DUST = {
  window: 30,
}

// Data mentah (per 5 detik) yang lebih tua dari ini diringkas per jam ke sensor_hourly lalu dihapus.
// Dijalankan oleh `npm run db:retention`. Menurunkan angka ini aman; data yang sudah dihapus tidak bisa kembali.
export const RAW_RETENTION_DAYS = 60

export const SAMPLE_INTERVAL_SEC = 5
export const OFFLINE_AFTER_MS    = 15_000
export const ALERT_COOLDOWN_MS   = 15 * 60 * 1000

export function isAirStatus(v: unknown): v is StatusLabel {
  return typeof v === 'string' && (AIR_STATUSES as readonly string[]).includes(v)
}

export function shouldNotify(status: StatusLabel): boolean {
  return status === 'WASPADA' || status === 'BERBAHAYA'
}

/** Ambang absolut (ppb) untuk satu alat; null kalau baseline belum diketahui (fase pemanasan). */
export function tvocThresholds(baselinePpb: number | null) {
  if (baselinePpb === null) return null
  return {
    waspada:   baselinePpb + TVOC_THRESHOLD_ABOVE_BASELINE_PPB.waspada,
    berbahaya: baselinePpb + TVOC_THRESHOLD_ABOVE_BASELINE_PPB.berbahaya,
  }
}

/** Konfigurasi yang dikirim ke frontend lewat GET /api/config. */
export function getPublicConfig() {
  return {
    statuses:                          STATUS_META,
    tvoc_threshold_above_baseline_ppb: TVOC_THRESHOLD_ABOVE_BASELINE_PPB,
    fan_duty_levels_percent:           FAN_DUTY_LEVELS_PERCENT,
    sensor_warmup_sec:                 SENSOR_WARMUP_SEC,
    outlet_dust:                       OUTLET_DUST,
    poll_interval_ms:                  SAMPLE_INTERVAL_SEC * 1000,
    offline_after_ms:                  OFFLINE_AFTER_MS,
  }
}
