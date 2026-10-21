import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { OUTLET_DUST } from '@/lib/sensor'

interface OverviewRow {
  id: string
  device_name: string
  location: string
  log_id: string | null
  tvoc_raw_ppb: number | null
  tvoc_kalman_ppb: number | null
  tvoc_baseline_ppb: number | null
  temperature_celsius: number | null
  humidity_percent: number | null
  dust_outlet_ugm3: number | null
  air_status: string | null
  fan_duty_percent: number | null
  fan_rpm: number | null
  recorded_at: Date | null
  dust_outlet_avg_ugm3: number | null
  dust_samples: number
}

/**
 * Status terkini semua device aktif dalam satu query — dipakai halaman Ringkasan Lab.
 * LATERAL + LIMIT memakai index (device_id, recorded_at), jadi tidak memindai seluruh sensor_logs.
 */
export async function GET() {
  try {
    const rows = await prisma.$queryRaw<OverviewRow[]>`
      SELECT d.id::text, d.device_name, d.location,
             l.id::text AS log_id, l.tvoc_raw_ppb, l.tvoc_kalman_ppb, l.tvoc_baseline_ppb,
             l.temperature_celsius, l.humidity_percent, l.dust_outlet_ugm3,
             l.air_status, l.fan_duty_percent, l.fan_rpm, l.recorded_at,
             dd.dust_outlet_avg_ugm3, dd.dust_samples
      FROM devices d
      LEFT JOIN LATERAL (
        SELECT * FROM sensor_logs s
        WHERE s.device_id = d.id
        ORDER BY s.recorded_at DESC
        LIMIT 1
      ) l ON true
      LEFT JOIN LATERAL (
        SELECT AVG(t.dust_outlet_ugm3) AS dust_outlet_avg_ugm3,
               COUNT(t.dust_outlet_ugm3)::int AS dust_samples
        FROM (
          SELECT dust_outlet_ugm3 FROM sensor_logs s
          WHERE s.device_id = d.id
          ORDER BY s.recorded_at DESC
          LIMIT ${OUTLET_DUST.window}
        ) t
      ) dd ON true
      WHERE d.is_active
      ORDER BY d.created_at`

    const data = rows.map(r => ({
      id: r.id,
      device_name: r.device_name,
      location: r.location,
      latest: r.log_id === null ? null : {
        id: r.log_id,
        tvoc_raw_ppb: r.tvoc_raw_ppb,
        tvoc_kalman_ppb: r.tvoc_kalman_ppb,
        tvoc_baseline_ppb: r.tvoc_baseline_ppb,
        temperature_celsius: r.temperature_celsius,
        humidity_percent: r.humidity_percent,
        dust_outlet_ugm3: r.dust_outlet_ugm3,
        air_status: r.air_status,
        fan_duty_percent: r.fan_duty_percent,
        fan_rpm: r.fan_rpm,
        recorded_at: r.recorded_at,
      },
      dust_outlet_avg_ugm3: r.dust_outlet_avg_ugm3,
      dust_samples: r.dust_samples,
    }))

    return NextResponse.json({ data, server_time: new Date() })
  } catch (err) {
    console.error('[overview]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
