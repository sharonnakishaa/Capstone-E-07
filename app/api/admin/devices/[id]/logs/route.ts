import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { parseRange } from '@/lib/range'
import { isUuid } from '@/lib/validation'

// Menghapus ratusan ribu baris bisa butuh beberapa detik
export const maxDuration = 60

/**
 * Filter log mentah + ringkasan per jam untuk satu alat dan rentang from/to (inklusif).
 * Ringkasan per jam ikut supaya grafik tren dan jam operasi filter tidak memakai data yang sudah dibuang.
 * Ringkasan dipilih berdasarkan awal jamnya (hour_start); rentang dari halaman log selalu sehari penuh WIB,
 * yang jatuh tepat di batas jam.
 */
async function resolve(req: NextRequest, params: Promise<{ id: string }>) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'id device harus UUID' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const range = parseRange(searchParams.get('from'), searchParams.get('to'))
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 })

  const device = await prisma.devices.findUnique({ where: { id }, select: { id: true, device_name: true } })
  if (!device) return NextResponse.json({ error: 'Device tidak ditemukan', device_id: id }, { status: 404 })

  const logsWhere: Prisma.sensor_logsWhereInput = { device_id: id, ...(range.filter && { recorded_at: range.filter }) }
  const hourlyWhere: Prisma.sensor_hourlyWhereInput = { device_id: id, ...(range.filter && { hour_start: range.filter }) }
  return { user, device, range, logsWhere, hourlyWhere }
}

/** Pratinjau: berapa baris yang akan terhapus. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await resolve(req, params)
    if (ctx instanceof NextResponse) return ctx

    const [logs, hourly, bounds] = await Promise.all([
      prisma.sensor_logs.count({ where: ctx.logsWhere }),
      prisma.sensor_hourly.count({ where: ctx.hourlyWhere }),
      prisma.sensor_logs.aggregate({ where: ctx.logsWhere, _min: { recorded_at: true }, _max: { recorded_at: true } }),
    ])
    return NextResponse.json({
      device_name: ctx.device.device_name,
      logs,
      hourly,
      first_at: bounds._min.recorded_at,
      last_at:  bounds._max.recorded_at,
    })
  } catch (err) {
    console.error('[admin/devices/logs GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Hapus permanen. Body wajib { confirm_name } yang sama persis dengan nama alat,
 * supaya request yang salah alamat (alat lain, tab lama) tidak bisa menghapus data.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const ctx = await resolve(req, params)
    if (ctx instanceof NextResponse) return ctx

    if (confirmName !== ctx.device.device_name) {
      return NextResponse.json(
        { error: `Konfirmasi tidak cocok. Ketik nama alat persis: ${ctx.device.device_name}` },
        { status: 400 }
      )
    }

    const [logs, hourly] = await prisma.$transaction([
      prisma.sensor_logs.deleteMany({ where: ctx.logsWhere }),
      prisma.sensor_hourly.deleteMany({ where: ctx.hourlyWhere }),
    ])

    // Jejak audit di log server (Vercel → Logs): siapa menghapus apa
    const iso = (d: Date | null) => (d ? d.toISOString() : '-')
    console.info(
      `[admin/devices/logs DELETE] ${ctx.user.email} menghapus ${logs.count} log + ${hourly.count} ringkasan jam ` +
      `"${ctx.device.device_name}" (${ctx.device.id}) rentang ${iso(ctx.range.from)} s/d ${iso(ctx.range.to)}`
    )
    return NextResponse.json({ deleted_logs: logs.count, deleted_hourly: hourly.count })
  } catch (err) {
    console.error('[admin/devices/logs DELETE]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
