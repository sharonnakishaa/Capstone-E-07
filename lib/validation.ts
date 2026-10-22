import { StatusLabel, isAirStatus, AIR_STATUSES } from './sensor'

export interface FieldError {
  field: string
  message: string
}

/** Identitas alat: UUID dari tabel devices, atau MAC address ESP32 (disarankan untuk firmware). */
export type DeviceRef = { device_id: string } | { mac_address: string }

/** Data sensor yang disimpan ke sensor_logs (tanpa identitas alat). */
export interface SensorReading {
  tvoc_raw_ppb: number
  tvoc_kalman_ppb: number | null
  tvoc_baseline_ppb: number | null
  eco2_ppm: number
  temperature_celsius: number | null // null kalau SHT31 gagal dibaca
  humidity_percent: number | null
  dust_outlet_ugm3: number | null
  air_status: StatusLabel
  fan_duty_percent: number
  fan_rpm: number | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAC_RE  = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/
const INT4_MAX = 2_147_483_647

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** MAC dalam format kanonik "24:6F:28:AB:CD:EF" (huruf besar, titik dua), atau null kalau tidak valid. */
export function normalizeMac(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const mac = v.trim().toUpperCase()
  return MAC_RE.test(mac) ? mac : null
}

interface NumberRule {
  min?: number
  max?: number
  integer?: boolean
}

function describe(rule: NumberRule): string {
  const kind = rule.integer ? 'bilangan bulat' : 'angka'
  if (rule.min !== undefined && rule.max !== undefined) return `harus ${kind} ${rule.min}–${rule.max}`
  if (rule.min !== undefined) return `harus ${kind} ≥ ${rule.min}`
  return `harus ${kind} finite`
}

function checkNumber(v: unknown, rule: NumberRule): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false
  if (rule.integer && !Number.isInteger(v)) return false
  if (rule.min !== undefined && v < rule.min) return false
  if (rule.max !== undefined && v > rule.max) return false
  return true
}

/**
 * Validasi payload POST /api/sensor. Semua field yang salah dilaporkan sekaligus.
 * Field yang tidak dikenal diabaikan (mis. fuzzy_level dari firmware lama).
 */
export function parseSensorPayload(body: unknown):
  | { ok: true; device: DeviceRef; data: SensorReading }
  | { ok: false; details: FieldError[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, details: [{ field: '(body)', message: 'harus objek JSON' }] }
  }
  const b = body as Record<string, unknown>
  const details: FieldError[] = []
  const has = (field: string) => b[field] !== undefined && b[field] !== null

  const required = (field: string, rule: NumberRule) => {
    if (!has(field)) details.push({ field, message: 'wajib diisi' })
    else if (!checkNumber(b[field], rule)) details.push({ field, message: describe(rule) })
  }
  const optional = (field: string, rule: NumberRule) => {
    if (has(field) && !checkNumber(b[field], rule)) {
      details.push({ field, message: `${describe(rule)} atau null` })
    }
  }

  // Identitas: tepat satu dari mac_address atau device_id
  let device: DeviceRef | null = null
  if (has('mac_address') && has('device_id')) {
    details.push({ field: 'mac_address', message: 'kirim salah satu saja: mac_address atau device_id' })
  } else if (has('mac_address')) {
    const mac = normalizeMac(b.mac_address)
    if (mac) device = { mac_address: mac }
    else details.push({ field: 'mac_address', message: 'harus format MAC seperti 24:6F:28:AB:CD:EF' })
  } else if (has('device_id')) {
    if (isUuid(b.device_id)) device = { device_id: b.device_id }
    else details.push({ field: 'device_id', message: 'harus UUID' })
  } else {
    details.push({ field: 'mac_address', message: 'wajib diisi (atau device_id)' })
  }

  required('tvoc_raw_ppb',        { min: 0 })
  optional('tvoc_kalman_ppb',     { min: 0 })
  optional('tvoc_baseline_ppb',   { min: 0 })
  required('eco2_ppm',            { min: 0 })
  // Opsional: kalau SHT31 gagal dibaca, data TVOC & status tetap disimpan
  optional('temperature_celsius', {})
  optional('humidity_percent',    { min: 0, max: 100 })
  optional('dust_outlet_ugm3',    { min: 0 })
  required('fan_duty_percent',    { min: 0, max: 100 })
  optional('fan_rpm',             { min: 0, max: INT4_MAX, integer: true })

  if (!has('air_status')) {
    details.push({ field: 'air_status', message: 'wajib diisi' })
  } else if (!isAirStatus(b.air_status)) {
    details.push({ field: 'air_status', message: `harus salah satu dari ${AIR_STATUSES.join(', ')}` })
  }

  if (details.length || !device) return { ok: false, details }

  const num = (field: string) => (has(field) ? (b[field] as number) : null)

  return {
    ok: true,
    device,
    data: {
      tvoc_raw_ppb:        b.tvoc_raw_ppb as number,
      tvoc_kalman_ppb:     num('tvoc_kalman_ppb'),
      tvoc_baseline_ppb:   num('tvoc_baseline_ppb'),
      eco2_ppm:            b.eco2_ppm as number,
      temperature_celsius: num('temperature_celsius'),
      humidity_percent:    num('humidity_percent'),
      dust_outlet_ugm3:    num('dust_outlet_ugm3'),
      air_status:          b.air_status as StatusLabel,
      fan_duty_percent:    b.fan_duty_percent as number,
      fan_rpm:             num('fan_rpm'),
    },
  }
}

// ─── Input kelola alat (halaman Kelola Alat) ────────────────────────────────

export interface DeviceInput {
  mac_address?: string
  device_name?: string
  location?: string
  inlet_distance_cm?: number
  is_active?: boolean
}

const TEXT_MAX = 60

/**
 * Validasi input tambah/edit alat. `partial = true` untuk edit (semua field opsional);
 * saat tambah, mac_address dan device_name wajib.
 */
export function parseDeviceInput(body: unknown, partial: boolean):
  | { ok: true; data: DeviceInput }
  | { ok: false; details: FieldError[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, details: [{ field: '(body)', message: 'harus objek JSON' }] }
  }
  const b = body as Record<string, unknown>
  const details: FieldError[] = []
  const data: DeviceInput = {}
  const given = (f: string) => b[f] !== undefined

  if (given('mac_address') || !partial) {
    const mac = normalizeMac(b.mac_address)
    if (mac) data.mac_address = mac
    else details.push({ field: 'mac_address', message: 'harus format MAC seperti 24:6F:28:AB:CD:EF' })
  }

  for (const field of ['device_name', 'location'] as const) {
    if (!given(field) && (partial || field === 'location')) continue
    const v = typeof b[field] === 'string' ? (b[field] as string).trim() : ''
    if (!v) details.push({ field, message: 'wajib diisi' })
    else if (v.length > TEXT_MAX) details.push({ field, message: `maksimal ${TEXT_MAX} karakter` })
    else data[field] = v
  }

  if (given('inlet_distance_cm')) {
    const v = b.inlet_distance_cm
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100) data.inlet_distance_cm = v
    else details.push({ field: 'inlet_distance_cm', message: 'harus angka > 0 dan ≤ 100 (cm)' })
  }

  if (given('is_active')) {
    if (typeof b.is_active === 'boolean') data.is_active = b.is_active
    else details.push({ field: 'is_active', message: 'harus true atau false' })
  }

  if (details.length) return { ok: false, details }
  if (partial && Object.keys(data).length === 0) {
    return { ok: false, details: [{ field: '(body)', message: 'tidak ada field yang diubah' }] }
  }
  return { ok: true, data }
}
