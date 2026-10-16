import { NextRequest, NextResponse } from 'next/server'
import type { sensor_logs } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { StatusLabel } from '@/lib/sensor'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const device_id  = searchParams.get('device_id')
  const pageParam  = searchParams.get('page')

  const where = device_id ? { device_id } : undefined

  const mapLog = (log: sensor_logs) => ({
    id: log.id.toString(),
    device_id: log.device_id,
    tvoc_raw_ppb: log.tvoc_raw_ppb,
    tvoc_kalman_ppb: log.tvoc_kalman_ppb,
    eco2_ppm: log.eco2_ppm,
    temperature_celsius: log.temperature_celsius,
    humidity_percent: log.humidity_percent,
    dust_outlet_ugm3: log.dust_outlet_ugm3,
    air_status: log.air_status,
    fuzzy_level: log.fuzzy_level,
    fan_duty_percent: log.fan_duty_percent,
    fan_rpm: log.fan_rpm,
    recorded_at: log.recorded_at,
  })

  // Mode pagination — dipakai halaman logs
  if (pageParam !== null) {
    const page  = Math.max(1, Number(pageParam))
    const limit = 50
    const skip  = (page - 1) * limit

    const [logs, total] = await Promise.all([
      prisma.sensor_logs.findMany({
        where,
        orderBy: { recorded_at: 'desc' },
        take: limit,
        skip,
      }),
      prisma.sensor_logs.count({ where }),
    ])

    return NextResponse.json({
      data: logs.map(mapLog),
      page,
      total,
      totalPages: Math.ceil(total / limit),
    })
  }

  // Mode default — dipakai dashboard (limit max 100)
  const limit = Math.min(Number(searchParams.get('limit') ?? 30), 100)
  const logs  = await prisma.sensor_logs.findMany({
    where,
    orderBy: { recorded_at: 'desc' },
    take: limit,
  })

  return NextResponse.json({ data: logs.map(mapLog) })
}

interface SensorPayload {
  device_id: string
  tvoc_raw_ppb: number
  tvoc_kalman_ppb?: number | null
  eco2_ppm: number
  temperature_celsius: number
  humidity_percent: number
  dust_outlet_ugm3?: number | null
  air_status: StatusLabel
  fuzzy_level?: string | null
  fan_duty_percent: number
  fan_rpm?: number | null
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: SensorPayload

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const {
    device_id, tvoc_raw_ppb, tvoc_kalman_ppb, eco2_ppm, temperature_celsius, humidity_percent,
    dust_outlet_ugm3, air_status, fuzzy_level, fan_duty_percent, fan_rpm,
  } = body

  // Validasi lengkap (tipe, rentang, enum) menyusul di Tahap 4
  if (!device_id || tvoc_raw_ppb == null || eco2_ppm == null || temperature_celsius == null || humidity_percent == null || fan_duty_percent == null || !air_status) {
    return NextResponse.json(
      { error: 'Field wajib tidak lengkap: device_id, tvoc_raw_ppb, eco2_ppm, temperature_celsius, humidity_percent, fan_duty_percent, air_status' },
      { status: 400 }
    )
  }

  // Status berasal dari fuzzy di ESP32 — disimpan apa adanya
  const log = await prisma.sensor_logs.create({
    data: {
      device_id,
      tvoc_raw_ppb,
      tvoc_kalman_ppb: tvoc_kalman_ppb ?? null,
      eco2_ppm,
      temperature_celsius,
      humidity_percent,
      dust_outlet_ugm3: dust_outlet_ugm3 ?? null,
      air_status,
      fuzzy_level: fuzzy_level ?? null,
      fan_duty_percent,
      fan_rpm: fan_rpm ?? null,
    },
  })

  // TODO(Tahap 4): notifikasi email dengan cooldown atomic via devices.last_alert_at.
  // Sementara dinonaktifkan — logika lama bergantung pada tabel air_quality_predictions.

  return NextResponse.json({ success: true, id: log.id.toString(), air_status }, { status: 201 })
}
