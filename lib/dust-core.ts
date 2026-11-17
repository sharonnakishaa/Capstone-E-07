// Kenaikan debu outlet di atas "nilai diam" — bagian murni (tanpa basis data), supaya bisa diuji
// tanpa DATABASE_URL (scripts/check-dust.ts). Query ke basis data ada di lib/dust.ts.
//
// Kenapa perlu: firmware mengirim debu ABSOLUT, (Vo − 0,236 V) / 5 V per mg/m³ × 1000. Tegangan udara
// bersih GP2Y1014AU0F berbeda tiap unit (datasheet 0–1,5 V); pada alat ini Vo saat diam ±0,50 V, jadi
// nilai absolut selalu memuat offset ±52 µg/m³. OLED alat menampilkan debu relatif terhadap udara
// ruangan; dashboard memperkirakan hal yang sama dari data yang tersimpan. Data mentah tidak diubah.
//
// Nilai diam sampel pada waktu t dihitung dari sampel alat yang sama di jendela (t − 10 menit, t]:
//   1. ≥ 12 sampel debu dengan duty kipas ≤ 30 %  → median sampel tersebut
//   2. selain itu, ≥ 6 sampel debu                → persentil ke-20 semua sampel debu di jendela
//   3. selain itu                                 → null
// Kenaikan = max(0, debu − nilai diam).

export const DUST_RISE = {
  window_ms:     10 * 60 * 1000, // panjang jendela nilai diam
  idle_duty_max: 30,             // duty kipas (%) yang dianggap diam / tidak menyolder
  min_idle:      12,             // minimal sampel diam untuk memakai median
  min_all:       6,              // minimal sampel debu untuk cadangan persentil
  fallback_pct:  0.2,            // persentil cadangan
}

export interface DustSample {
  id: bigint | string
  device_id: string
  recorded_at: Date
  dust_outlet_ugm3: number | null
  fan_duty_percent: number
}

export interface DustRise {
  dust_idle_ugm3: number | null
  dust_rise_ugm3: number | null
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** Persentil dengan interpolasi linear, sama dengan percentile_cont di PostgreSQL. `sorted` urut naik, tidak kosong. */
export function percentileCont(sorted: number[], p: number): number {
  const pos = p * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Nilai diam dari isi satu jendela; null kalau datanya belum cukup. */
export function dustIdleBaseline(window: DustSample[]): number | null {
  const idle: number[] = []
  const all: number[] = []
  for (const s of window) {
    if (s.dust_outlet_ugm3 === null) continue
    all.push(s.dust_outlet_ugm3)
    if (s.fan_duty_percent <= DUST_RISE.idle_duty_max) idle.push(s.dust_outlet_ugm3)
  }
  if (idle.length >= DUST_RISE.min_idle) return percentileCont(idle.sort((a, b) => a - b), 0.5)
  if (all.length >= DUST_RISE.min_all) return percentileCont(all.sort((a, b) => a - b), DUST_RISE.fallback_pct)
  return null
}

export function dustRiseOf(dust: number | null, idle: number | null): DustRise {
  return {
    dust_idle_ugm3: idle === null ? null : round1(idle),
    dust_rise_ugm3: dust === null || idle === null ? null : round1(Math.max(0, dust - idle)),
  }
}

/**
 * Kenaikan debu untuk setiap sampel di `targets`. `context` = sampel lain (biasanya 10 menit sebelum
 * sampel tertua) supaya jendela sampel tertua tetap penuh. Sampel yang sama boleh muncul di keduanya.
 * Kunci hasil = String(id).
 */
export function computeDustRise(targets: DustSample[], context: DustSample[] = []): Map<string, DustRise> {
  const result = new Map<string, DustRise>()
  if (targets.length === 0) return result

  const wanted = new Set(targets.map(s => String(s.id)))

  // Kelompokkan per alat, buang duplikat id
  const byDevice = new Map<string, Map<string, DustSample>>()
  for (const s of [...context, ...targets]) {
    let m = byDevice.get(s.device_id)
    if (!m) byDevice.set(s.device_id, (m = new Map()))
    m.set(String(s.id), s)
  }

  for (const samples of byDevice.values()) {
    const sorted = [...samples.values()].sort((a, b) => a.recorded_at.getTime() - b.recorded_at.getTime())
    const times = sorted.map(s => s.recorded_at.getTime())

    // Dua penunjuk: jendela (t − window_ms, t] = sorted[lo .. hi-1]. hi ikut maju melewati sampel
    // lain yang waktunya sama persis dengan t, karena batas atas jendela inklusif.
    let lo = 0
    let hi = 0
    for (let i = 0; i < sorted.length; i++) {
      const key = String(sorted[i].id)
      if (!wanted.has(key)) continue
      const t = times[i]
      while (hi < sorted.length && times[hi] <= t) hi++
      while (times[lo] <= t - DUST_RISE.window_ms) lo++
      const idle = dustIdleBaseline(sorted.slice(lo, hi))
      result.set(key, dustRiseOf(sorted[i].dust_outlet_ugm3, idle))
    }
  }
  return result
}
