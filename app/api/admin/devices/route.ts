import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { parseDeviceInput } from '@/lib/validation'
import { logActivity } from '@/lib/activity'

const DEFAULT_LOCATION = 'Lab DTETI'
const DEFAULT_INLET_CM = 5
const UNREGISTERED_LIMIT = 50

interface DeviceRow {
  id: string
  device_name: string
  location: string
  mac_address: string
  inlet_distance_cm: number
  is_active: boolean
  last_seen_at: Date | null
}

/** Semua alat (aktif & nonaktif) + MAC yang mengirim data tapi belum terdaftar. Khusus pengelola. */
export async function GET(req: NextRequest) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  try {
    const [devices, unregistered] = await Promise.all([
      // LATERAL + LIMIT 1 memakai index (device_id, recorded_at) untuk waktu data terakhir
      prisma.$queryRaw<DeviceRow[]>`
        SELECT d.id::text, d.device_name, d.location, d.mac_address, d.inlet_distance_cm, d.is_active,
               l.recorded_at AS last_seen_at
        FROM devices d
        LEFT JOIN LATERAL (
          SELECT recorded_at FROM sensor_logs s
          WHERE s.device_id = d.id
          ORDER BY s.recorded_at DESC
          LIMIT 1
        ) l ON true
        ORDER BY d.is_active DESC, d.location, d.device_name`,
      prisma.unregistered_macs.findMany({ orderBy: { last_seen_at: 'desc' }, take: UNREGISTERED_LIMIT }),
    ])
    return NextResponse.json({ devices, unregistered, server_time: new Date() })
  } catch (err) {
    console.error('[admin/devices]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Daftarkan alat baru berdasarkan MAC. MAC itu dihapus dari daftar "alat baru terdeteksi". */
export async function POST(req: NextRequest) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const parsed = parseDeviceInput(body, false)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Validasi gagal', details: parsed.details }, { status: 400 })
  }
  const input = parsed.data
  const mac = input.mac_address!

  try {
    const existing = await prisma.devices.findUnique({ where: { mac_address: mac } })
    if (existing) {
      return NextResponse.json(
        { error: `MAC ${mac} sudah terdaftar sebagai "${existing.device_name}"`, device_id: existing.id },
        { status: 409 }
      )
    }

    const [device] = await prisma.$transaction([
      prisma.devices.create({
        data: {
          mac_address:       mac,
          device_name:       input.device_name!,
          location:          input.location ?? DEFAULT_LOCATION,
          inlet_distance_cm: input.inlet_distance_cm ?? DEFAULT_INLET_CM,
          registered_by:     user.id,
        },
      }),
      prisma.unregistered_macs.deleteMany({ where: { mac_address: mac } }),
    ])
    await logActivity(user, 'device.create', device.device_name, { mac_address: mac, location: device.location })
    return NextResponse.json({ device }, { status: 201 })
  } catch (err) {
    // Dua pengelola mendaftarkan MAC yang sama bersamaan
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: `MAC ${mac} sudah terdaftar` }, { status: 409 })
    }
    console.error('[admin/devices POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
