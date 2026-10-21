import { NextRequest, NextResponse, after } from 'next/server'
import type { Prisma, sensor_logs } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { ALERT_COOLDOWN_MS, shouldNotify } from '@/lib/sensor'
import { isUuid, parseSensorPayload } from '@/lib/validation'
import { sendWarningEmail } from '@/lib/email'

const PAGE_SIZE      = 50
const DEFAULT_LIMIT  = 30
const MAX_LIMIT      = 100
const CSV_MAX_ROWS   = 50_000
const WIB_OFFSET_MS  = 7 * 3600 * 1000

const CSV_COLUMNS = [
  'tvoc_raw_ppb', 'tvoc_kalman_ppb', 'eco2_ppm', 'temperature_celsius', 'humidity_percent',
  'dust_outlet_ugm3', 'air_status', 'fuzzy_level', 'fan_duty_percent', 'fan_rpm',
] as const

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

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 })
const serverError = (err: unknown) => {
  console.error('[sensor]', err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** Bilangan bulat positif dari query string; null kalau tidak valid. */
function parsePositiveInt(v: string): number | null {
  return /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : null
}

/** "2026-10-16 10:12:45" dalam WIB (UTC+7, tanpa DST). */
function toWib(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ')
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const device_id = searchParams.get('device_id')
  const pageParam = searchParams.get('page')

  if (device_id !== null && !isUuid(device_id)) return badRequest('device_id harus UUID')

  try {
    // Ekspor CSV wajib login; mode lain (dashboard, halaman log) tetap publik
    if (searchParams.get('format') === 'csv') {
      const user = await requireUser(req, ['pengelola'])
      if (user instanceof NextResponse) return user
      return await exportCsv(device_id, searchParams.get('from'), searchParams.get('to'))
    }

    const where = device_id ? { device_id } : undefined

    // Mode pagination — dipakai halaman logs
    if (pageParam !== null) {
      const page = parsePositiveInt(pageParam)
      if (page === null) return badRequest('page harus bilangan bulat ≥ 1')

      const [logs, total] = await Promise.all([
        prisma.sensor_logs.findMany({
          where,
          orderBy: { recorded_at: 'desc' },
          take: PAGE_SIZE,
          skip: (page - 1) * PAGE_SIZE,
        }),
        prisma.sensor_logs.count({ where }),
      ])

      return NextResponse.json({
        data: logs.map(mapLog),
        page,
        total,
        totalPages: Math.ceil(total / PAGE_SIZE),
        server_time: new Date(),
      })
    }

    // Mode terbaru — dipakai dashboard
    const limitParam = searchParams.get('limit')
    const limit = limitParam === null ? DEFAULT_LIMIT : parsePositiveInt(limitParam)
    if (limit === null) return badRequest(`limit harus bilangan bulat 1–${MAX_LIMIT}`)

    const logs = await prisma.sensor_logs.findMany({
      where,
      orderBy: { recorded_at: 'desc' },
      take: Math.min(limit, MAX_LIMIT),
    })

    return NextResponse.json({ data: logs.map(mapLog), server_time: new Date() })
  } catch (err) {
    return serverError(err)
  }
}

async function exportCsv(device_id: string | null, fromParam: string | null, toParam: string | null) {
  if (!device_id) return badRequest('device_id wajib diisi untuk ekspor CSV')

  const from = fromParam ? new Date(fromParam) : null
  const to   = toParam   ? new Date(toParam)   : null
  if (from && isNaN(from.getTime())) return badRequest('from harus tanggal ISO 8601')
  if (to   && isNaN(to.getTime()))   return badRequest('to harus tanggal ISO 8601')
  if (from && to && from > to)       return badRequest('from tidak boleh setelah to')

  const where: Prisma.sensor_logsWhereInput = {
    device_id,
    ...(from || to ? { recorded_at: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
  }

  const row_count = await prisma.sensor_logs.count({ where })
  if (row_count > CSV_MAX_ROWS) {
    return NextResponse.json(
      {
        error: `Rentang terlalu besar: ${row_count.toLocaleString('id-ID')} baris (maks ${CSV_MAX_ROWS.toLocaleString('id-ID')}). Persempit rentang tanggal.`,
        row_count,
      },
      { status: 400 }
    )
  }

  const logs = await prisma.sensor_logs.findMany({
    where,
    orderBy: { recorded_at: 'asc' },
    take: CSV_MAX_ROWS,
  })

  const lines = [
    ['recorded_at_wib', ...CSV_COLUMNS].join(','),
    ...logs.map(log => [toWib(log.recorded_at), ...CSV_COLUMNS.map(c => log[c])].map(csvCell).join(',')),
  ]

  const datePart = (d: Date | null) => (d ? toWib(d).slice(0, 10).replace(/-/g, '') : 'all')
  const filename = `epen-${device_id.slice(0, 8)}-${datePart(from)}-${datePart(to)}.csv`

  return new NextResponse(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return badRequest('Body bukan JSON valid')
  }

  const parsed = parseSensorPayload(body)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Validasi gagal', details: parsed.details }, { status: 400 })
  }
  const p = parsed.data

  try {
    const device = await prisma.devices.findUnique({ where: { id: p.device_id } })
    if (!device || !device.is_active) {
      return NextResponse.json(
        { error: 'Device tidak ditemukan atau tidak aktif', device_id: p.device_id },
        { status: 404 }
      )
    }

    // Status berasal dari fuzzy di ESP32 — disimpan apa adanya
    const log = await prisma.sensor_logs.create({ data: p })

    if (shouldNotify(p.air_status)) {
      // Klaim slot alert secara atomic: kondisi cooldown/eskalasi ada di WHERE,
      // jadi dari beberapa request bersamaan hanya satu yang mendapat count === 1.
      const now = new Date()
      const { count } = await prisma.devices.updateMany({
        where: {
          id: device.id,
          OR: [
            { last_alert_at: null },
            { last_alert_at: { lte: new Date(now.getTime() - ALERT_COOLDOWN_MS) } },
            ...(p.air_status === 'BERBAHAYA' ? [{ last_alert_status: 'WASPADA' }] : []),
          ],
        },
        data: { last_alert_at: now, last_alert_status: p.air_status },
      })

      if (count === 1) {
        // Dikirim setelah respons selesai supaya ESP32 tidak menunggu SMTP.
        after(async () => {
          try {
            await sendWarningEmail({
              ...p,
              device_name: device.device_name,
              location: device.location,
              inlet_distance_cm: device.inlet_distance_cm,
              timestamp: log.recorded_at,
            })
          } catch (emailErr) {
            console.error('[sensor] Gagal kirim email:', emailErr)
          }
        })
      }
    }

    return NextResponse.json(
      { success: true, id: log.id.toString(), air_status: log.air_status },
      { status: 201 }
    )
  } catch (err) {
    return serverError(err)
  }
}
