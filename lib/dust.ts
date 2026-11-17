// Kenaikan debu outlet: bagian yang mengambil data dari basis data.
// Algoritma dan konstanta ada di lib/dust-core.ts (diekspor ulang dari sini).

import { prisma } from '@/lib/prisma'
import { DUST_RISE, computeDustRise, type DustRise, type DustSample } from '@/lib/dust-core'

export * from '@/lib/dust-core'

const SAMPLE_SELECT = {
  id: true, device_id: true, recorded_at: true, dust_outlet_ugm3: true, fan_duty_percent: true,
} as const

/** Sampel satu alat di rentang (from, to]. */
function samplesBetween(device_id: string, from: Date, to: Date): Promise<DustSample[]> {
  return prisma.sensor_logs.findMany({
    where: { device_id, recorded_at: { gt: from, lte: to } },
    select: SAMPLE_SELECT,
  })
}

/**
 * Kenaikan debu untuk sekumpulan log (dashboard, halaman log, ekspor). Per alat diambil sampel
 * 10 menit sebelum log tertuanya sebagai konteks, jadi log tertua pun punya jendela penuh.
 * Log satu alat di dalam `logs` dianggap berurutan tanpa celah (hasil satu query urut waktu).
 */
export async function dustRiseForLogs(logs: DustSample[]): Promise<Map<string, DustRise>> {
  if (logs.length === 0) return new Map()

  const oldest = new Map<string, number>()
  for (const l of logs) {
    const t = l.recorded_at.getTime()
    const cur = oldest.get(l.device_id)
    if (cur === undefined || t < cur) oldest.set(l.device_id, t)
  }

  const context = await Promise.all(
    [...oldest].map(([device_id, t]) =>
      samplesBetween(device_id, new Date(t - DUST_RISE.window_ms), new Date(t))),
  )
  return computeDustRise(logs, context.flat())
}

/** Kenaikan debu untuk satu sampel terbaru (Ringkasan Lab): ambil jendela (t − 10 menit, t] alat itu. */
export async function dustRiseForLatest(sample: DustSample): Promise<DustRise> {
  const t = sample.recorded_at
  const window = await samplesBetween(sample.device_id, new Date(t.getTime() - DUST_RISE.window_ms), t)
  return computeDustRise([sample], window).get(String(sample.id)) ?? { dust_idle_ugm3: null, dust_rise_ugm3: null }
}
