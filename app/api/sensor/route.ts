import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getEcoStatus, shouldNotify } from '@/lib/sensor'
import { sendWarningEmail } from '@/lib/email'

interface SensorPayload {
  deviceID: string
  eco2: number
  tvoc?: number
  suhu: number
  kelembaban: number
}

// Cooldown: kirim notif maks 1x per 15 menit per device
const NOTIF_COOLDOWN_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  let body: SensorPayload

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const { deviceID, eco2, tvoc, suhu, kelembaban } = body

  if (!deviceID || eco2 == null || suhu == null || kelembaban == null) {
    return NextResponse.json(
      { error: 'Field wajib tidak lengkap: deviceID, eco2, suhu, kelembaban' },
      { status: 400 }
    )
  }

  if (typeof eco2 !== 'number' || typeof suhu !== 'number' || typeof kelembaban !== 'number') {
    return NextResponse.json({ error: 'eco2, suhu, kelembaban harus berupa angka' }, { status: 400 })
  }

  const status = getEcoStatus(eco2)

  const reading = await prisma.sensorReading.create({
    data: {
      deviceId: deviceID,
      eco2,
      tvoc: tvoc ?? null,
      suhu,
      kelembaban,
      status,
    },
  })

  // Kirim email jika level BERISIKO atau BAHAYA
  if (shouldNotify(status)) {
    const recentNotif = await prisma.notificationLog.findFirst({
      where: {
        deviceId: deviceID,
        sentAt: { gte: new Date(Date.now() - NOTIF_COOLDOWN_MS) },
      },
      orderBy: { sentAt: 'desc' },
    })

    if (!recentNotif) {
      try {
        await sendWarningEmail({
          deviceId: deviceID,
          eco2,
          suhu,
          kelembaban,
          status,
          timestamp: reading.createdAt,
        })

        await prisma.notificationLog.create({
          data: { deviceId: deviceID, eco2, status },
        })
      } catch (emailErr) {
        // Gagal kirim email tidak boleh gagalkan penyimpanan data
        console.error('[sensor] Gagal kirim email:', emailErr)
      }
    }
  }

  return NextResponse.json(
    { success: true, id: reading.id, status },
    { status: 201 }
  )
}
