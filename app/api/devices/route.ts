import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SAMPLE_INTERVAL_SEC } from '@/lib/sensor'

export async function GET() {
  try {
    const devices = await prisma.devices.findMany({
      where: { is_active: true },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        device_name: true,
        location: true,
        is_active: true,
        inlet_distance_cm: true,
        filter_installed_at: true,
      },
    })

    const data = await Promise.all(devices.map(async d => {
      const [last, runningLogs] = await Promise.all([
        prisma.sensor_logs.findFirst({
          where: { device_id: d.id },
          orderBy: { recorded_at: 'desc' },
          select: { recorded_at: true },
        }),
        // Jam operasi filter ≈ jumlah log saat kipas menyala × interval kirim
        d.filter_installed_at
          ? prisma.sensor_logs.count({
              where: { device_id: d.id, fan_duty_percent: { gt: 0 }, recorded_at: { gte: d.filter_installed_at } },
            })
          : Promise.resolve(null),
      ])

      return {
        ...d,
        last_seen_at: last?.recorded_at ?? null,
        filter_runtime_hours: runningLogs === null
          ? null
          : Number((runningLogs * SAMPLE_INTERVAL_SEC / 3600).toFixed(2)),
      }
    }))

    return NextResponse.json({ data })
  } catch (err) {
    console.error('[devices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
