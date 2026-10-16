// Model fisik sederhana untuk simulator ESP32 dan seed data.
// Dipakai bersama oleh scripts/seed.ts dan scripts/simulate.ts supaya pola datanya sama.

export type Scenario   = 'normal' | 'spike' | 'offline'
export type AirStatus  = 'AMAN' | 'WASPADA' | 'BERBAHAYA'
export type FuzzyLevel = 'MIN' | 'LOW' | 'MED' | 'FAST'

// ─── Konfigurasi (ubah di sini) ──────────────────────────────────────────────

export const TICK_SEC = 5

/** Ambang sementara pada TVOC Kalman. Samakan dengan fungsi keanggotaan fuzzy di firmware. */
export const STATUS_THRESHOLDS_PPB = {
  waspada:   250, // ≥ ini → WASPADA
  berbahaya: 400, // ≥ ini → BERBAHAYA
}

/** Saat AMAN: di bawah nilai ini kipas di level MIN, di atasnya LOW. */
export const LOW_LEVEL_FROM_PPB = 150

export const LEVEL_DUTY_PERCENT: Record<FuzzyLevel, number> = { MIN: 25, LOW: 60, MED: 85, FAST: 100 }

export const FAN_MAX_RPM = 3300

/** Q = noise proses, R = noise pengukuran. Q kecil → lebih halus tapi lebih lambat. */
export const KALMAN_PARAMS = { q: 25, r: 400 }

interface ScenarioProfile {
  idleSec:    [number, number] // jeda antar sesi menyolder
  solderSec:  [number, number] // lama satu sesi menyolder
  peakPpb:    [number, number] // puncak TVOC asap di atas baseline
  filterLeak: number           // fraksi partikel yang lolos HEPA (memengaruhi debu outlet)
}

const PROFILES: Record<Scenario, ScenarioProfile> = {
  normal:  { idleSec: [60, 180], solderSec: [30, 90],  peakPpb: [180, 480],  filterLeak: 0.02 },
  spike:   { idleSec: [20, 60],  solderSec: [45, 120], peakPpb: [550, 1100], filterLeak: 0.06 },
  offline: { idleSec: [60, 180], solderSec: [30, 90],  peakPpb: [180, 480],  filterLeak: 0.02 },
}

// ─── Utilitas ────────────────────────────────────────────────────────────────

const rand  = (min: number, max: number) => min + Math.random() * (max - min)
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const round = (v: number, digits = 0) => Number(v.toFixed(digits))

/** Noise Gaussian (Box–Muller). */
function gauss(sd: number): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ─── Kalman 1D ───────────────────────────────────────────────────────────────

export class Kalman1D {
  private x: number | null = null
  private p = 0

  constructor(private q: number, private r: number) {}

  update(z: number): number {
    if (this.x === null) {
      this.x = z
      this.p = this.r
      return z
    }
    const pPrior = this.p + this.q
    const k = pPrior / (pPrior + this.r)
    this.x += k * (z - this.x)
    this.p = (1 - k) * pPrior
    return this.x
  }
}

// ─── Pola fuzzy (meniru keluaran firmware) ───────────────────────────────────

export function classify(tvocKalman: number): { air_status: AirStatus; fuzzy_level: FuzzyLevel } {
  if (tvocKalman >= STATUS_THRESHOLDS_PPB.berbahaya) return { air_status: 'BERBAHAYA', fuzzy_level: 'FAST' }
  if (tvocKalman >= STATUS_THRESHOLDS_PPB.waspada)   return { air_status: 'WASPADA',   fuzzy_level: 'MED' }
  return { air_status: 'AMAN', fuzzy_level: tvocKalman >= LOW_LEVEL_FROM_PPB ? 'LOW' : 'MIN' }
}

// ─── Simulator perangkat ─────────────────────────────────────────────────────

export interface Reading {
  tvoc_raw_ppb: number
  tvoc_kalman_ppb: number
  eco2_ppm: number
  temperature_celsius: number
  humidity_percent: number
  dust_outlet_ugm3: number
  air_status: AirStatus
  fuzzy_level: FuzzyLevel
  fan_duty_percent: number
  fan_rpm: number
}

export class DeviceSimulator {
  private profile: ScenarioProfile
  private kalman = new Kalman1D(KALMAN_PARAMS.q, KALMAN_PARAMS.r)

  private soldering = false
  private phaseLeftSec: number
  private peak = 0
  private fume = 0                        // TVOC dari asap solder di atas baseline (ppb)
  private baseline = rand(50, 90)         // TVOC latar ruangan (ppb)
  private duty = LEVEL_DUTY_PERCENT.MIN
  private rpm = FAN_MAX_RPM * LEVEL_DUTY_PERCENT.MIN / 100

  constructor(scenario: Scenario) {
    this.profile = PROFILES[scenario]
    this.phaseLeftSec = rand(...this.profile.idleSec)
  }

  /** Maju satu tick (TICK_SEC) dan kembalikan pembacaan sensor pada waktu `at`. */
  step(at: Date): Reading {
    this.advancePhase()

    // Asap: naik menuju puncak saat menyolder, turun saat jeda.
    // Laju penurunan bergantung pada duty kipas (ekstraktor yang menyedot asap).
    if (this.soldering) {
      this.fume += (this.peak - this.fume) * 0.35
    } else {
      this.fume *= 1 - (0.08 + 0.25 * this.duty / 100)
    }
    this.baseline = clamp(this.baseline + gauss(1.5), 40, 110)

    const trueTvoc = this.baseline + this.fume
    const tvocRaw  = Math.max(0, trueTvoc + gauss(10 + trueTvoc * 0.08))
    const tvocKal  = this.kalman.update(tvocRaw)

    const { air_status, fuzzy_level } = classify(tvocKal)
    this.duty = LEVEL_DUTY_PERCENT[fuzzy_level]

    // Kipas tidak langsung mencapai RPM target (inersia).
    const targetRpm = FAN_MAX_RPM * this.duty / 100
    this.rpm += (targetRpm - this.rpm) * 0.6

    // Suhu harian (puncak ±15:00 WIB) + panas solder; RH berkebalikan dengan suhu.
    const hourWib    = ((at.getTime() / 3_600_000) + 7) % 24
    const fumeFrac   = clamp(this.fume / 500, 0, 1.5)
    const temp       = 26.5 + 1.5 * Math.sin(2 * Math.PI * (hourWib - 9) / 24) + 0.8 * fumeFrac + gauss(0.1)
    const humidity   = 64 - (temp - 26.5) * 2.5 + gauss(0.4)

    // eCO₂ SGP30 diturunkan dari TVOC (minimum 400 ppm).
    const eco2 = Math.max(400, 400 + tvocRaw * 0.9 + gauss(15))

    // Debu outlet: partikel asap yang lolos HEPA + latar. GP2Y cukup noisy.
    const inletDust = 15 + this.fume * 0.8
    const dust      = Math.max(0, 6 + inletDust * this.profile.filterLeak + gauss(2.5))

    return {
      tvoc_raw_ppb:        round(tvocRaw),
      tvoc_kalman_ppb:     round(tvocKal, 1),
      eco2_ppm:            round(eco2),
      temperature_celsius: round(temp, 1),
      humidity_percent:    round(clamp(humidity, 0, 100), 1),
      dust_outlet_ugm3:    round(dust, 1),
      air_status,
      fuzzy_level,
      fan_duty_percent:    this.duty,
      fan_rpm:             Math.max(0, Math.round(this.rpm * (1 + gauss(0.01)))),
    }
  }

  private advancePhase() {
    this.phaseLeftSec -= TICK_SEC
    if (this.phaseLeftSec > 0) return

    this.soldering = !this.soldering
    if (this.soldering) {
      this.peak = rand(...this.profile.peakPpb)
      this.phaseLeftSec = rand(...this.profile.solderSec)
    } else {
      this.phaseLeftSec = rand(...this.profile.idleSec)
    }
  }
}
