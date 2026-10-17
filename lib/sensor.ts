// Satu sumber konfigurasi untuk status udara, level fuzzy, dan ambang referensi.
// Status sebenarnya ditentukan oleh fuzzy di ESP32 — server hanya menyimpan dan menampilkan.

export const AIR_STATUSES = ['AMAN', 'WASPADA', 'BERBAHAYA'] as const
export type StatusLabel = typeof AIR_STATUSES[number]

export const FUZZY_LEVELS = ['MIN', 'LOW', 'MED', 'FAST'] as const
export type FuzzyLevel = typeof FUZZY_LEVELS[number]

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

export const FUZZY_LEVEL_META: Record<FuzzyLevel, { label: string; duty_percent: number }> = {
  MIN:  { label: 'Minimum', duty_percent: 25 },
  LOW:  { label: 'Rendah',  duty_percent: 60 },
  MED:  { label: 'Sedang',  duty_percent: 85 },
  FAST: { label: 'Cepat',   duty_percent: 100 },
}

// Ambang TVOC (Kalman) untuk garis referensi grafik dan panduan email.
// Samakan dengan fungsi keanggotaan fuzzy di firmware.
export const TVOC_REFERENCE_PPB = {
  waspada:   250,
  berbahaya: 400,
}

// Peringatan filter: rata-rata debu outlet pada N data terakhir melebihi ambang ini.
// Setel ulang setelah kalibrasi GP2Y di alat sebenarnya.
export const OUTLET_DUST = {
  warn_ugm3: 25,
  window:    30,
}

export const SAMPLE_INTERVAL_SEC = 5
export const OFFLINE_AFTER_MS    = 15_000
export const ALERT_COOLDOWN_MS   = 15 * 60 * 1000

export function isAirStatus(v: unknown): v is StatusLabel {
  return typeof v === 'string' && (AIR_STATUSES as readonly string[]).includes(v)
}

export function isFuzzyLevel(v: unknown): v is FuzzyLevel {
  return typeof v === 'string' && (FUZZY_LEVELS as readonly string[]).includes(v)
}

export function shouldNotify(status: StatusLabel): boolean {
  return status === 'WASPADA' || status === 'BERBAHAYA'
}

/** Konfigurasi yang dikirim ke frontend lewat GET /api/config. */
export function getPublicConfig() {
  return {
    statuses:           STATUS_META,
    fuzzy_levels:       FUZZY_LEVEL_META,
    tvoc_reference_ppb: TVOC_REFERENCE_PPB,
    outlet_dust:        OUTLET_DUST,
    poll_interval_ms:   SAMPLE_INTERVAL_SEC * 1000,
    offline_after_ms:   OFFLINE_AFTER_MS,
  }
}
