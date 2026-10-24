import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { filterRuntimeHours } from '@/lib/devices'
import { isUuid } from '@/lib/validation'
import { logActivity } from '@/lib/activity'

// Toleransi selisih jam antara browser dan server
const FUTURE_TOLERANCE_MS = 60_000

/**
 * Catat penggantian filter: set devices.filter_installed_at.
 * Body opsional: { "installed_at": "<ISO 8601>" } untuk mencatat mundur. Default: waktu sekarang.
 * Wajib login sebagai pengelola; user yang mencatat disimpan di filter_installed_by.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'id device harus UUID' }, { status: 400 })

  let body: unknown = {}
  const raw = await req.text()
  if (raw.trim()) {
    try {
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
    }
  }

  const installedParam = (body as { installed_at?: unknown } | null)?.installed_at
  let installedAt = new Date()
  if (installedParam !== undefined && installedParam !== null) {
    installedAt = new Date(typeof installedParam === 'string' ? installedParam : NaN)
    if (isNaN(installedAt.getTime())) {
      return NextResponse.json({ error: 'installed_at harus tanggal ISO 8601' }, { status: 400 })
    }
    if (installedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      return NextResponse.json({ error: 'installed_at tidak boleh di masa depan' }, { status: 400 })
    }
  }

  try {
    const { count } = await prisma.devices.updateMany({
      where: { id, is_active: true },
      data: { filter_installed_at: installedAt, filter_installed_by: user.id },
    })
    if (count === 0) {
      return NextResponse.json({ error: 'Device tidak ditemukan atau tidak aktif', device_id: id }, { status: 404 })
    }

    const device = await prisma.devices.findUnique({ where: { id }, select: { device_name: true } })
    await logActivity(user, 'device.filter_replaced', device?.device_name ?? id, { installed_at: installedAt.toISOString() })

    return NextResponse.json({
      success: true,
      data: {
        id,
        filter_installed_at: installedAt,
        filter_installed_by_name: user.full_name,
        filter_runtime_hours: await filterRuntimeHours(id, installedAt),
      },
    })
  } catch (err) {
    console.error('[devices/filter]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
