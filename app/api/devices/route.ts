import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { filterRuntimeHours } from '@/lib/devices'

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
      const [last, filter_runtime_hours] = await Promise.all([
        prisma.sensor_logs.findFirst({
          where: { device_id: d.id },
          orderBy: { recorded_at: 'desc' },
          select: { recorded_at: true },
        }),
        filterRuntimeHours(d.id, d.filter_installed_at),
      ])

      return {
        ...d,
        last_seen_at: last?.recorded_at ?? null,
        filter_runtime_hours,
      }
    }))

    return NextResponse.json({ data })
  } catch (err) {
    console.error('[devices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
