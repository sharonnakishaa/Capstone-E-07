import { prisma } from './prisma'
import { SAMPLE_INTERVAL_SEC } from './sensor'

/**
 * Perkiraan jam operasi filter: jumlah log saat kipas menyala sejak filter dipasang × interval kirim.
 * Mengembalikan null kalau waktu pemasangan filter belum dicatat.
 */
export async function filterRuntimeHours(deviceId: string, installedAt: Date | null): Promise<number | null> {
  if (!installedAt) return null
  const runningLogs = await prisma.sensor_logs.count({
    where: { device_id: deviceId, fan_duty_percent: { gt: 0 }, recorded_at: { gte: installedAt } },
  })
  return Number((runningLogs * SAMPLE_INTERVAL_SEC / 3600).toFixed(2))
}
