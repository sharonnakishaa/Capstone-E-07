import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { normalizeMac } from '@/lib/validation'

/**
 * Abaikan MAC dari daftar "alat baru terdeteksi" (mis. alat uji milik orang lain).
 * Kalau alat itu masih mengirim data, MAC-nya akan muncul lagi.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ mac: string }> }) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  const mac = normalizeMac(decodeURIComponent((await params).mac))
  if (!mac) return NextResponse.json({ error: 'Format MAC tidak valid' }, { status: 400 })

  try {
    const { count } = await prisma.unregistered_macs.deleteMany({ where: { mac_address: mac } })
    return NextResponse.json({ success: true, deleted: count })
  } catch (err) {
    console.error('[admin/unregistered-macs DELETE]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
