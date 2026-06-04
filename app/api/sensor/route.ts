import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStatusLabel, getConfidences, shouldNotify } from '@/lib/sensor'
import { sendWarningEmail } from '@/lib/email'

interface SensorPayload {
  device_id: string
  tvoc_pb: number
  eco2_ppm: number
  temperature_celsius: number
  humidity_percent: number
  fan_duty_cycle: number
  dust_density_ugm3?: number
}

const NOTIF_COOLDOWN_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  let body: SensorPayload

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const { device_id, tvoc_pb, eco2_ppm, temperature_celsius, humidity_percent, fan_duty_cycle, dust_density_ugm3 } = body

  if (!device_id || eco2_ppm == null || tvoc_pb == null || temperature_celsius == null || humidity_percent == null || fan_duty_cycle == null) {
    return NextResponse.json(
      { error: 'Field wajib tidak lengkap: device_id, tvoc_pb, eco2_ppm, temperature_celsius, humidity_percent, fan_duty_cycle' },
      { status: 400 }
    )
  }

  const status = getStatusLabel(eco2_ppm)
  const confidences = getConfidences(status)

  // Simpan data sensor
  const log = await prisma.sensor_logs.create({
    data: {
      device_id,
      tvoc_pb,
      eco2_ppm,
      temperature_celsius,
      humidity_percent,
      fan_duty_cycle,
      dust_density_ugm3: dust_density_ugm3 ?? null,
    },
  })

  // Simpan prediksi kualitas udara
  await prisma.air_quality_predictions.create({
    data: {
      sensor_log_id: log.id,
      status_label: status,
      ...confidences,
    },
  })

  // Kirim email jika BERISIKO atau BERBAHAYA
  if (shouldNotify(status)) {
    const recentNotif = await prisma.air_quality_predictions.findFirst({
      where: {
        sensor_log: { device_id },
        status_label: { in: ['BERISIKO', 'BERBAHAYA'] },
        predicted_at: { gte: new Date(Date.now() - NOTIF_COOLDOWN_MS) },
      },
      orderBy: { predicted_at: 'desc' },
    })

    // Jika record ini sendiri — skip, cari yang sebelumnya
    const isFirstAlert = !recentNotif || recentNotif.id === log.id

    if (isFirstAlert) {
      try {
        await sendWarningEmail({
          device_id,
          eco2_ppm,
          tvoc_pb,
          temperature_celsius,
          humidity_percent,
          status,
          timestamp: log.recorded_at,
        })
      } catch (emailErr) {
        console.error('[sensor] Gagal kirim email:', emailErr)
      }
    }
  }

  return NextResponse.json({ success: true, id: log.id.toString(), status }, { status: 201 })
}
