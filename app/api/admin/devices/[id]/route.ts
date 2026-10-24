import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { isUuid, parseDeviceInput } from '@/lib/validation'
import { logActivity } from '@/lib/activity'

// Menghapus alat ikut menghapus semua lognya (cascade), bisa ratusan ribu baris
export const maxDuration = 60

/** Ubah alat: nama, lokasi, MAC (mis. memperbaiki salah ketik), jarak inlet, atau aktif/nonaktif. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'id device harus UUID' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const parsed = parseDeviceInput(body, true)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Validasi gagal', details: parsed.details }, { status: 400 })
  }
  const input = parsed.data

  try {
    if (input.mac_address) {
      const other = await prisma.devices.findUnique({ where: { mac_address: input.mac_address } })
      if (other && other.id !== id) {
        return NextResponse.json(
          { error: `MAC ${input.mac_address} sudah dipakai "${other.device_name}"`, device_id: other.id },
          { status: 409 }
        )
      }
    }

    const [device] = await prisma.$transaction([
      prisma.devices.update({ where: { id }, data: input }),
      // MAC yang kini terdaftar tidak perlu muncul lagi di "alat baru terdeteksi"
      ...(input.mac_address ? [prisma.unregistered_macs.deleteMany({ where: { mac_address: input.mac_address } })] : []),
    ])

    const { is_active, ...changes } = input
    if (Object.keys(changes).length) await logActivity(user, 'device.update', device.device_name, { ...changes })
    if (is_active !== undefined) await logActivity(user, is_active ? 'device.activate' : 'device.deactivate', device.device_name)
    return NextResponse.json({ device })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return NextResponse.json({ error: 'Device tidak ditemukan', device_id: id }, { status: 404 })
      if (err.code === 'P2002') return NextResponse.json({ error: `MAC ${input.mac_address} sudah terdaftar` }, { status: 409 })
    }
    console.error('[admin/devices PATCH]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Hapus alat permanen beserta semua log & ringkasan per jamnya (onDelete: Cascade).
 * Hanya untuk alat yang sudah nonaktif, dan body wajib { confirm_name } = nama alat persis.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'id device harus UUID' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }
  const confirmName = typeof (body as { confirm_name?: unknown })?.confirm_name === 'string'
    ? (body as { confirm_name: string }).confirm_name.trim()
    : ''

  try {
    const device = await prisma.devices.findUnique({
      where: { id },
      select: { id: true, device_name: true, mac_address: true, is_active: true },
    })
    if (!device) return NextResponse.json({ error: 'Device tidak ditemukan', device_id: id }, { status: 404 })
    if (device.is_active) {
      return NextResponse.json({ error: 'Nonaktifkan alat terlebih dahulu sebelum menghapusnya' }, { status: 409 })
    }
    if (confirmName !== device.device_name) {
      return NextResponse.json(
        { error: `Konfirmasi tidak cocok. Ketik nama alat persis: ${device.device_name}` },
        { status: 400 }
      )
    }

    const [logs, hourly] = await Promise.all([
      prisma.sensor_logs.count({ where: { device_id: id } }),
      prisma.sensor_hourly.count({ where: { device_id: id } }),
    ])
    // Syarat nonaktif dicek lagi di WHERE, kalau-kalau alat baru saja diaktifkan pengelola lain
    const { count } = await prisma.devices.deleteMany({ where: { id, is_active: false } })
    if (count === 0) {
      return NextResponse.json({ error: 'Alat baru saja diaktifkan atau dihapus pengelola lain. Muat ulang halaman.' }, { status: 409 })
    }

    await logActivity(user, 'device.delete', device.device_name, {
      mac_address: device.mac_address, deleted_logs: logs, deleted_hourly: hourly,
    })
    return NextResponse.json({ deleted: true, deleted_logs: logs, deleted_hourly: hourly })
  } catch (err) {
    console.error('[admin/devices DELETE]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
