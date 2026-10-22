import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { isUuid, parseDeviceInput } from '@/lib/validation'

/**
 * Ubah alat: nama, lokasi, MAC (mis. memperbaiki salah ketik), jarak inlet, atau aktif/nonaktif.
 * Alat tidak bisa dihapus dari UI — nonaktifkan saja, karena menghapus ikut menghapus semua datanya.
 */
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
