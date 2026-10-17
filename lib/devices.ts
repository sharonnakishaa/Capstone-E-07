import { prisma } from './prisma'
import { SAMPLE_INTERVAL_SEC } from './sensor'

/**
 * Perkiraan jam operasi filter: jumlah sampel saat kipas menyala sejak filter dipasang × interval kirim.
 * Sampel dihitung dari log mentah (masa retensi) ditambah ringkasan per jam (data yang sudah diringkas).
 * Jam ringkasan yang dimulai sebelum filter dipasang tidak dihitung, jadi hasilnya bisa kurang ≤ 1 jam.
 * Mengembalikan null kalau waktu pemasangan filter belum dicatat.
 */
export async function filterRuntimeHours(deviceId: string, installedAt: Date | null): Promise<number | null> {
  if (!installedAt) return null
  const [rawSamples, hourly] = await Promise.all([
    prisma.sensor_logs.count({
      where: { device_id: deviceId, fan_duty_percent: { gt: 0 }, recorded_at: { gte: installedAt } },
    }),
    prisma.sensor_hourly.aggregate({
      where: { device_id: deviceId, hour_start: { gte: installedAt } },
      _sum: { fan_running_samples: true },
    }),
  ])
  const samples = rawSamples + (hourly._sum.fan_running_samples ?? 0)
  return Number((samples * SAMPLE_INTERVAL_SEC / 3600).toFixed(2))
}
