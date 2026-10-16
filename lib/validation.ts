import { FuzzyLevel, StatusLabel, isAirStatus, isFuzzyLevel, AIR_STATUSES, FUZZY_LEVELS } from './sensor'

export interface FieldError {
  field: string
  message: string
}

export interface SensorPayload {
  device_id: string
  tvoc_raw_ppb: number
  tvoc_kalman_ppb: number | null
  eco2_ppm: number
  temperature_celsius: number
  humidity_percent: number
  dust_outlet_ugm3: number | null
  air_status: StatusLabel
  fuzzy_level: FuzzyLevel | null
  fan_duty_percent: number
  fan_rpm: number | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INT4_MAX = 2_147_483_647

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
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

/** Validasi payload POST /api/sensor. Semua field yang salah dilaporkan sekaligus. */
export function parseSensorPayload(body: unknown):
  | { ok: true; data: SensorPayload }
  | { ok: false; details: FieldError[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, details: [{ field: '(body)', message: 'harus objek JSON' }] }
  }
  const b = body as Record<string, unknown>
  const details: FieldError[] = []

  const required = (field: string, rule: NumberRule) => {
    if (b[field] === undefined || b[field] === null) details.push({ field, message: 'wajib diisi' })
    else if (!checkNumber(b[field], rule)) details.push({ field, message: describe(rule) })
  }
  const optional = (field: string, rule: NumberRule) => {
    if (b[field] !== undefined && b[field] !== null && !checkNumber(b[field], rule)) {
      details.push({ field, message: `${describe(rule)} atau null` })
    }
  }

  if (b.device_id === undefined || b.device_id === null) details.push({ field: 'device_id', message: 'wajib diisi' })
  else if (!isUuid(b.device_id)) details.push({ field: 'device_id', message: 'harus UUID' })

  required('tvoc_raw_ppb',        { min: 0 })
  optional('tvoc_kalman_ppb',     { min: 0 })
  required('eco2_ppm',            { min: 0 })
  required('temperature_celsius', {})
  required('humidity_percent',    { min: 0, max: 100 })
  optional('dust_outlet_ugm3',    { min: 0 })
  required('fan_duty_percent',    { min: 0, max: 100 })
  optional('fan_rpm',             { min: 0, max: INT4_MAX, integer: true })

  if (b.air_status === undefined || b.air_status === null) {
    details.push({ field: 'air_status', message: 'wajib diisi' })
  } else if (!isAirStatus(b.air_status)) {
    details.push({ field: 'air_status', message: `harus salah satu dari ${AIR_STATUSES.join(', ')}` })
  }

  if (b.fuzzy_level !== undefined && b.fuzzy_level !== null && !isFuzzyLevel(b.fuzzy_level)) {
    details.push({ field: 'fuzzy_level', message: `harus salah satu dari ${FUZZY_LEVELS.join(', ')} atau null` })
  }

  if (details.length) return { ok: false, details }

  return {
    ok: true,
    data: {
      device_id:           b.device_id as string,
      tvoc_raw_ppb:        b.tvoc_raw_ppb as number,
      tvoc_kalman_ppb:     (b.tvoc_kalman_ppb as number | undefined) ?? null,
      eco2_ppm:            b.eco2_ppm as number,
      temperature_celsius: b.temperature_celsius as number,
      humidity_percent:    b.humidity_percent as number,
      dust_outlet_ugm3:    (b.dust_outlet_ugm3 as number | undefined) ?? null,
      air_status:          b.air_status as StatusLabel,
      fuzzy_level:         (b.fuzzy_level as FuzzyLevel | undefined) ?? null,
      fan_duty_percent:    b.fan_duty_percent as number,
      fan_rpm:             (b.fan_rpm as number | undefined) ?? null,
    },
  }
}
