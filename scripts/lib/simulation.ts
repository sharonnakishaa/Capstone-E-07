// Simulator ESP32 Epen untuk scripts/simulate.ts dan scripts/seed.ts.
//
// Terdiri dari dua bagian:
//   1. PORT FIRMWARE — salinan langsung logika firmware (epen_core.c, epen_kalman.c, epen_fuzzy.c,
//      epen_config.h, dan send_to_dashboard() di Epen.ino). Berjalan per 1 detik seperti firmware,
//      jadi status, Kalman, baseline, dan duty kipas sama persis dengan alat sungguhan untuk
//      masukan yang sama. Kalau firmware berubah, samakan bagian ini.
//   2. MODEL LINGKUNGAN — "dunia" yang dibaca sensor: suhu ruangan, panas solder, asap, debu.
//      Ini perkiraan, bukan hasil pengukuran.

import { StatusLabel as AirStatus, SAMPLE_INTERVAL_SEC } from '../../lib/sensor'

export type Scenario = 'normal' | 'spike' | 'offline'

/** Interval kirim ke server (detik). Firmware menghitung tiap 1 detik dan mengirim tiap 5 detik. */
export const TICK_SEC = SAMPLE_INTERVAL_SEC

// ═══ 1. PORT FIRMWARE ═══════════════════════════════════════════════════════

/** Salinan epen_config.h. */
export const FW = {
  DT_S:           1,
  WARMUP_S:       15,       // SGP30 menahan keluaran 0
  BASELINE_S:     30,       // lama perekaman baseline
  PPB_TO_MGM3:    0.002295, // 56,1 / 24,45 / 1000
  DT_ON_C:        0.5,      // u = 1 bila (T - T_base) >= 0,5 °C
  CSS:            1.54,     // mg/m³, konsentrasi tunak saat menyolder
  TAU_UP_S:       73,
  TAU_DOWN_S:     37,
  Q:              0.001,
  R:              0.0034,
  X0:             0,
  P0:             0.01,
  HORIZON_STEPS:  5,
  LAMBDA_UP:      1.0,      // bobot ramalan pada masukan fuzzy, hanya saat u = 1
  FZ_X_A:         0.3,      // x_hat: Bersih / Sedang / Kotor
  FZ_X_C:         1.0,
  FZ_D_A:        -0.05,     // delta: Turun / Stabil / Naik
  FZ_D_C:         0.05,
  PWM: { MIN: 0, LOW: 30, MED: 50, HIGH: 75, MAX: 100 },
}

type Phase = 'WARMUP' | 'BASELINE' | 'RUN'

/** epen_kalman.c — Kalman 1-state, x = konsentrasi di atas baseline (mg/m³). */
class FirmwareKalman {
  x = FW.X0
  P = FW.P0
  x5 = FW.X0

  step(z: number, u: 0 | 1): number {
    const tau = u ? FW.TAU_UP_S : FW.TAU_DOWN_S
    const a   = FW.DT_S / tau
    const tgt = u ? FW.CSS : 0

    // prediksi
    const xPred = this.x + a * (tgt - this.x)
    const pPred = (1 - a) * (1 - a) * this.P + FW.Q

    // koreksi
    const K = pPred / (pPred + FW.R)
    this.x = xPred + K * (z - xPred)
    this.P = (1 - K) * pPred

    // ramalan 5 detik: persamaan prediksi diulang tanpa koreksi, u tetap
    let xf = this.x
    for (let i = 0; i < FW.HORIZON_STEPS; i++) xf = xf + a * (tgt - xf)
    this.x5 = xf

    return this.x
  }
}

/** epen_fuzzy.c — bahu-segitiga-bahu dengan titik tengah b = (a + c) / 2; jumlah ketiganya = 1. */
function threeClasses(v: number, a: number, c: number): [number, number, number] {
  const b = 0.5 * (a + c)
  if (v <= a)  return [1, 0, 0]
  if (v < b)   return [(b - v) / (b - a), (v - a) / (b - a), 0]
  if (v === b) return [0, 1, 0]
  if (v < c)   return [0, (c - v) / (c - b), (v - b) / (c - b)]
  return [0, 0, 1]
}

/** epen_fuzzy.c — Sugeno orde-nol, 9 aturan, AND = MIN, rata-rata terbobot. */
export function fuzzyPwm(xHat: number, delta: number): number {
  const P = FW.PWM
  // baris: Bersih, Sedang, Kotor; kolom: Turun, Stabil, Naik
  const RULE = [
    [P.MIN,  P.MIN, P.MED ],
    [P.LOW,  P.MED, P.HIGH],
    [P.HIGH, P.MAX, P.MAX ],
  ]
  const mx = threeClasses(xHat, FW.FZ_X_A, FW.FZ_X_C)
  const md = threeClasses(delta, FW.FZ_D_A, FW.FZ_D_C)
  let num = 0, den = 0
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const w = Math.min(mx[i], md[j])
      num += w * RULE[i][j]
      den += w
    }
  }
  return den < 1e-6 ? P.MAX : num / den
}

/** epen_fuzzy.c — kelas udara dari x_hat (keanggotaan terbesar; seri → kelas lebih tinggi). */
export function airClass(xHat: number): 0 | 1 | 2 {
  const m = threeClasses(xHat, FW.FZ_X_A, FW.FZ_X_C)
  let k: 0 | 1 | 2 = 0
  if (m[1] >= m[k]) k = 1
  if (m[2] >= m[k]) k = 2
  return k
}

const AIR_CLASS_STATUS: AirStatus[] = ['AMAN', 'WASPADA', 'BERBAHAYA']

interface CoreOutput {
  phase: Phase
  u: 0 | 1
  xHat: number
  delta: number
  pwm: number
}

/** epen_core.c — fase pemanasan → baseline → jalan, pemicu suhu, dan masukan fuzzy. */
export class FirmwareCore {
  phase: Phase = 'WARMUP'
  tick = 0
  cBasePpb = 0
  tBaseC = 0
  private sumTvoc = 0
  private sumT = 0
  private nBase = 0
  private kf = new FirmwareKalman()

  step(tvocPpb: number, tempC: number): CoreOutput {
    const out: CoreOutput = { phase: this.phase, u: 0, xHat: 0, delta: 0, pwm: 0 }
    this.tick++

    if (this.phase === 'WARMUP') {
      if (this.tick >= FW.WARMUP_S) this.phase = 'BASELINE'
      out.phase = this.phase
      return out
    }

    if (this.phase === 'BASELINE') {
      // Suhu naik jauh di atas rata-rata sementara → penyolderan sudah dimulai: ulangi rekaman
      if (this.nBase > 0 && tempC - this.sumT / this.nBase >= FW.DT_ON_C) {
        this.sumTvoc = this.sumT = 0
        this.nBase = 0
      }
      this.sumTvoc += tvocPpb
      this.sumT    += tempC
      this.nBase++
      if (this.nBase >= FW.BASELINE_S) {
        this.cBasePpb = this.sumTvoc / this.nBase
        this.tBaseC   = this.sumT / this.nBase
        this.phase = 'RUN'
      }
      out.phase = this.phase
      return out
    }

    // RUN
    const u: 0 | 1 = tempC - this.tBaseC >= FW.DT_ON_C ? 1 : 0
    const z = Math.max(0, (tvocPpb - this.cBasePpb) * FW.PPB_TO_MGM3) // di bawah baseline = bersih
    this.kf.step(z, u)

    out.u = u
    out.xHat = this.kf.x
    out.delta = this.kf.x5 - this.kf.x
    const xFuzzy = out.xHat + (u ? FW.LAMBDA_UP * out.delta : 0) // bobot ramalan, hanya saat menyolder
    out.pwm = fuzzyPwm(xFuzzy, out.delta)
    return out
  }
}

// ═══ 2. MODEL LINGKUNGAN ════════════════════════════════════════════════════

export const FAN_MAX_RPM = 3300

interface ScenarioProfile {
  idleSec:    [number, number] // jeda antar sesi menyolder
  solderSec:  [number, number] // lama satu sesi menyolder
  peakPpb:    [number, number] // puncak TVOC asap di atas latar ruangan (tanpa kipas)
  filterLeak: number           // fraksi partikel yang lolos HEPA (memengaruhi debu outlet)
}

const PROFILES: Record<Scenario, ScenarioProfile> = {
  normal:  { idleSec: [60, 180], solderSec: [40, 120], peakPpb: [200, 700],  filterLeak: 0.02 },
  spike:   { idleSec: [20, 60],  solderSec: [60, 150], peakPpb: [700, 1300], filterLeak: 0.06 },
  offline: { idleSec: [60, 180], solderSec: [40, 120], peakPpb: [200, 700],  filterLeak: 0.02 },
}

const ENV = {
  ROOM_TEMP_C:        26.5,
  ROOM_TEMP_DAILY_C:  0.3,       // lab ber-AC: suhu ruangan hampir stabil sepanjang hari
  SOLDER_HEAT_C:      1.0,       // kenaikan suhu di sensor saat solder di dekat inlet
  HEAT_TAU_UP_S:      10,
  HEAT_TAU_DOWN_S:    45,
  SMOKE_DELAY_S:      [8, 20] as [number, number], // asap baru terbaca beberapa detik setelah solder mulai panas
  SMOKE_TAU_UP_S:     40,
  FAN_CAPTURE:        0.4,       // kipas 100 % mengurangi konsentrasi di sensor hingga 40 %
  RPM_TAU_S:          3,
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

// ─── Simulator perangkat ─────────────────────────────────────────────────────

/** Payload yang dikirim firmware (Epen.ino → send_to_dashboard), tanpa identitas alat. */
export interface Reading {
  tvoc_raw_ppb: number
  tvoc_kalman_ppb: number | null   // null selama pemanasan/baseline
  tvoc_baseline_ppb: number | null // null selama pemanasan/baseline
  eco2_ppm: number
  temperature_celsius: number
  humidity_percent: number
  dust_outlet_ugm3: number
  air_status: AirStatus
  fan_duty_percent: number
  fan_rpm: number
}

export class DeviceSimulator {
  private profile: ScenarioProfile
  private core = new FirmwareCore()
  private elapsedSec = 0

  // keadaan lingkungan
  private soldering = false
  private phaseLeftSec: number
  private solderAgeSec = 0
  private smokeDelaySec = 0
  private peak = 0
  private fume = 0                        // TVOC dari asap di atas latar ruangan (ppb)
  private heat = 0                        // panas solder yang terbaca SHT31 (°C)
  private room = rand(50, 90)             // TVOC latar ruangan (ppb), bergeser pelan
  private roomTempOffset = gauss(0.1)
  private pwm = 0                         // keluaran fuzzy detik terakhir
  private rpm = 0
  private last: { tvoc: number; temp: number; out: CoreOutput } | null = null

  constructor(scenario: Scenario) {
    this.profile = PROFILES[scenario]
    // Sesi menyolder pertama baru dimulai setelah pemanasan + baseline (45 s) — seperti instruksi di Serial Monitor
    this.phaseLeftSec = FW.WARMUP_S + FW.BASELINE_S + rand(...this.profile.idleSec)
  }

  /** Maju TICK_SEC detik (firmware berjalan per 1 detik) dan kembalikan payload pada waktu `at`. */
  step(at: Date): Reading {
    for (let i = TICK_SEC - 1; i >= 0; i--) this.second(new Date(at.getTime() - i * 1000))
    return this.payload(at)
  }

  /** Satu detik: lingkungan bergerak, sensor dibaca, epen_step() dijalankan. */
  private second(at: Date) {
    this.elapsedSec++
    this.advanceSession()

    // Panas solder naik cepat begitu solder dekat inlet, turun pelan setelah selesai
    const heatTgt = this.soldering ? ENV.SOLDER_HEAT_C : 0
    this.heat += (heatTgt - this.heat) / (this.soldering ? ENV.HEAT_TAU_UP_S : ENV.HEAT_TAU_DOWN_S)

    // Asap baru muncul beberapa detik setelah solder mulai; kipas menyedot sebagian (makin kencang makin turun),
    // dan saat berhenti asap hilang lebih cepat kalau kipas kencang
    const smoking = this.soldering && this.solderAgeSec >= this.smokeDelaySec
    const fumeTgt = smoking ? this.peak * (1 - ENV.FAN_CAPTURE * this.pwm / 100) : 0
    const tauDown = 90 - 60 * this.pwm / 100
    this.fume += (fumeTgt - this.fume) / (smoking ? ENV.SMOKE_TAU_UP_S : tauDown)
    this.room = clamp(this.room + gauss(0.7), 40, 110)

    // Suhu ruangan (lab ber-AC: variasi harian kecil) + panas solder
    const hourWib = ((at.getTime() / 3_600_000) + 7) % 24
    this.roomTempOffset = clamp(this.roomTempOffset + gauss(0.005), -0.15, 0.15)
    const temp = ENV.ROOM_TEMP_C + ENV.ROOM_TEMP_DAILY_C * Math.sin(2 * Math.PI * (hourWib - 9) / 24)
      + this.roomTempOffset + this.heat + gauss(0.03)

    // SGP30 mengeluarkan 0 selama pemanasan
    const trueTvoc = this.room + this.fume
    const tvoc = this.elapsedSec <= FW.WARMUP_S ? 0 : Math.max(0, Math.round(trueTvoc + gauss(8 + trueTvoc * 0.06)))

    const out = this.core.step(tvoc, temp)
    this.pwm = out.pwm

    // RPM mengikuti duty dengan sedikit inersia
    this.rpm += (FAN_MAX_RPM * this.pwm / 100 - this.rpm) / ENV.RPM_TAU_S
    this.last = { tvoc, temp, out }
  }

  /** Epen.ino → send_to_dashboard(): ubah keluaran kontrol detik terakhir menjadi payload. */
  private payload(at: Date): Reading {
    const { tvoc, temp, out } = this.last!
    const run = out.phase === 'RUN'
    const humidity = 64 - (temp - ENV.ROOM_TEMP_C) * 2.5 + gauss(0.4)
    const eco2 = Math.max(400, 400 + tvoc * 0.9 + gauss(15))
    const dust = Math.max(0, 6 + (15 + this.fume * 0.8) * this.profile.filterLeak + gauss(2.5))
    void at

    return {
      tvoc_raw_ppb:        Math.round(tvoc),
      tvoc_kalman_ppb:     run ? Math.round(this.core.cBasePpb + out.xHat / FW.PPB_TO_MGM3) : null,
      tvoc_baseline_ppb:   run ? Math.round(this.core.cBasePpb) : null,
      eco2_ppm:            Math.round(eco2),
      temperature_celsius: round(temp, 1),
      humidity_percent:    round(clamp(humidity, 0, 100), 1),
      dust_outlet_ugm3:    round(dust, 1),
      air_status:          run ? AIR_CLASS_STATUS[airClass(out.xHat)] : 'AMAN',
      fan_duty_percent:    Math.round(out.pwm),
      fan_rpm:             this.rpm < 50 ? 0 : Math.max(0, Math.round(this.rpm * (1 + gauss(0.01)))),
    }
  }

  private advanceSession() {
    this.solderAgeSec++
    if (--this.phaseLeftSec > 0) return
    this.soldering = !this.soldering
    this.solderAgeSec = 0
    if (this.soldering) {
      this.peak = rand(...this.profile.peakPpb)
      this.smokeDelaySec = rand(...ENV.SMOKE_DELAY_S)
      this.phaseLeftSec = rand(...this.profile.solderSec)
    } else {
      this.phaseLeftSec = rand(...this.profile.idleSec)
    }
  }
}
