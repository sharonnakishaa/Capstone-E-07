import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SAMPLE_INTERVAL_SEC } from '@/lib/sensor'
import { isUuid } from '@/lib/validation'

const ALLOWED_DAYS = [7, 30, 90]
const DAY_MS = 86_400_000
const WIB_OFFSET_MS = 7 * 3_600_000

interface DayRow {
  day: string               // YYYY-MM-DD (WIB)
  samples: number
  running: number
  tvoc_sum: number | null
  tvoc_max: number | null
  dust_sum: number | null
  dust_n: number
  dust_max: number | null
  temp_sum: number | null
  rh_sum: number | null
  temp_n: number            // data yang punya nilai suhu (SHT31 bisa gagal baca)
  rh_n: number
  aman: number
  waspada: number
  berbahaya: number
}

const hoursOf = (samples: number) => Number((samples * SAMPLE_INTERVAL_SEC / 3600).toFixed(2))
const round1  = (v: number | null) => (v === null ? null : Number(v.toFixed(1)))

/** "YYYY-MM-DD" hari ini dalam WIB, digeser `offsetDays` hari. */
function wibDate(offsetDays = 0): string {
  return new Date(Date.now() + WIB_OFFSET_MS + offsetDays * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Tren harian satu alat (dipakai halaman Tren). Hari dihitung dalam WIB.
 * Data ≤ masa retensi diambil dari sensor_logs, yang lebih lama dari sensor_hourly (hasil retensi),
 * lalu digabung per hari — jadi rentang 90 hari tetap utuh walaupun melewati batas retensi.
 * Rata-rata ditimbang dengan jumlah sampel. Durasi = jumlah sampel × interval kirim (5 detik).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const deviceId = searchParams.get('device_id')
  const days = Number(searchParams.get('days') ?? 7)

  if (!isUuid(deviceId)) return NextResponse.json({ error: 'device_id harus UUID' }, { status: 400 })
  if (!ALLOWED_DAYS.includes(days)) {
    return NextResponse.json({ error: `days harus salah satu dari ${ALLOWED_DAYS.join(', ')}` }, { status: 400 })
  }

  const firstDay = wibDate(-(days - 1))
  const fromIso  = `${firstDay}T00:00:00+07:00`

  try {
    const device = await prisma.devices.findUnique({
      where: { id: deviceId },
      select: { id: true, device_name: true, location: true },
    })
    if (!device) return NextResponse.json({ error: 'Device tidak ditemukan', device_id: deviceId }, { status: 404 })

    const rows = await prisma.$queryRaw<DayRow[]>`
      WITH raw AS (
        SELECT (recorded_at AT TIME ZONE 'Asia/Jakarta')::date AS day,
               COUNT(*)                                            AS samples,
               COUNT(*) FILTER (WHERE fan_duty_percent > 0)        AS running,
               SUM(COALESCE(tvoc_kalman_ppb, tvoc_raw_ppb))        AS tvoc_sum,
               MAX(COALESCE(tvoc_kalman_ppb, tvoc_raw_ppb))        AS tvoc_max,
               SUM(dust_outlet_ugm3)                               AS dust_sum,
               COUNT(dust_outlet_ugm3)                             AS dust_n,
               MAX(dust_outlet_ugm3)                               AS dust_max,
               SUM(temperature_celsius)                            AS temp_sum,
               SUM(humidity_percent)                               AS rh_sum,
               COUNT(temperature_celsius)                          AS temp_n,
               COUNT(humidity_percent)                             AS rh_n,
               COUNT(*) FILTER (WHERE air_status = 'AMAN')         AS aman,
               COUNT(*) FILTER (WHERE air_status = 'WASPADA')      AS waspada,
               COUNT(*) FILTER (WHERE air_status = 'BERBAHAYA')    AS berbahaya
        FROM sensor_logs
        WHERE device_id = ${deviceId}::uuid AND recorded_at >= ${fromIso}::timestamptz
        GROUP BY 1
      ),
      hourly AS (
        SELECT (hour_start AT TIME ZONE 'Asia/Jakarta')::date AS day,
               SUM(samples)                                       AS samples,
               SUM(fan_running_samples)                           AS running,
               SUM(tvoc_avg_ppb * samples)                        AS tvoc_sum,
               MAX(tvoc_max_ppb)                                  AS tvoc_max,
               -- Ringkasan per jam tidak menyimpan jumlah sampel debu; pakai jumlah sampel jam itu
               SUM(dust_outlet_avg_ugm3 * samples)                AS dust_sum,
               SUM(samples) FILTER (WHERE dust_outlet_avg_ugm3 IS NOT NULL) AS dust_n,
               MAX(dust_outlet_max_ugm3)                          AS dust_max,
               SUM(temperature_avg_celsius * samples)             AS temp_sum,
               SUM(humidity_avg_percent * samples)                AS rh_sum,
               SUM(samples) FILTER (WHERE temperature_avg_celsius IS NOT NULL) AS temp_n,
               SUM(samples) FILTER (WHERE humidity_avg_percent IS NOT NULL)    AS rh_n,
               SUM(aman_samples)                                  AS aman,
               SUM(waspada_samples)                               AS waspada,
               SUM(berbahaya_samples)                             AS berbahaya
        FROM sensor_hourly
        WHERE device_id = ${deviceId}::uuid AND hour_start >= ${fromIso}::timestamptz
        GROUP BY 1
      )
      SELECT to_char(day, 'YYYY-MM-DD')            AS day,
             SUM(samples)::int                     AS samples,
             SUM(running)::int                     AS running,
             SUM(tvoc_sum)::float8                 AS tvoc_sum,
             MAX(tvoc_max)::float8                 AS tvoc_max,
             SUM(dust_sum)::float8                 AS dust_sum,
             COALESCE(SUM(dust_n), 0)::int         AS dust_n,
             MAX(dust_max)::float8                 AS dust_max,
             SUM(temp_sum)::float8                 AS temp_sum,
             SUM(rh_sum)::float8                   AS rh_sum,
             COALESCE(SUM(temp_n), 0)::int         AS temp_n,
             COALESCE(SUM(rh_n), 0)::int           AS rh_n,
             SUM(aman)::int                        AS aman,
             SUM(waspada)::int                     AS waspada,
             SUM(berbahaya)::int                   AS berbahaya
      FROM (SELECT * FROM raw UNION ALL SELECT * FROM hourly) u
      GROUP BY day
      ORDER BY day`

    const byDay = new Map(rows.map(r => [r.day, r]))

    // Semua hari dalam rentang tetap muncul; hari tanpa data bernilai 0/null supaya grafik menampilkan celah
    const data = Array.from({ length: days }, (_, i) => {
      const date = wibDate(-(days - 1) + i)
      const r = byDay.get(date)
      if (!r || r.samples === 0) {
        return {
          date, active_hours: 0, fan_hours: 0,
          status_hours: { AMAN: 0, WASPADA: 0, BERBAHAYA: 0 },
          tvoc_avg_ppb: null, tvoc_max_ppb: null, dust_avg_ugm3: null, dust_max_ugm3: null,
          temperature_avg_celsius: null, humidity_avg_percent: null,
        }
      }
      return {
        date,
        active_hours: hoursOf(r.samples),
        fan_hours:    hoursOf(r.running),
        status_hours: { AMAN: hoursOf(r.aman), WASPADA: hoursOf(r.waspada), BERBAHAYA: hoursOf(r.berbahaya) },
        tvoc_avg_ppb:            round1(r.tvoc_sum === null ? null : r.tvoc_sum / r.samples),
        tvoc_max_ppb:            round1(r.tvoc_max),
        dust_avg_ugm3:           round1(r.dust_n > 0 && r.dust_sum !== null ? r.dust_sum / r.dust_n : null),
        dust_max_ugm3:           round1(r.dust_max),
        temperature_avg_celsius: round1(r.temp_n > 0 && r.temp_sum !== null ? r.temp_sum / r.temp_n : null),
        humidity_avg_percent:    round1(r.rh_n > 0 && r.rh_sum !== null ? r.rh_sum / r.rh_n : null),
      }
    })

    // Ringkasan periode
    const sum = (f: (d: typeof data[number]) => number) => Number(data.reduce((a, d) => a + f(d), 0).toFixed(2))
    const totalSamples = rows.reduce((a, r) => a + r.samples, 0)
    const tvocSum = rows.reduce((a, r) => a + (r.tvoc_sum ?? 0), 0)
    const worst = data.reduce<typeof data[number] | null>(
      (best, d) => (d.status_hours.BERBAHAYA > (best?.status_hours.BERBAHAYA ?? 0) ? d : best), null)

    return NextResponse.json({
      device,
      days,
      from: firstDay,
      to: wibDate(0),
      data,
      summary: {
        active_hours:    sum(d => d.active_hours),
        fan_hours:       sum(d => d.fan_hours),
        waspada_hours:   sum(d => d.status_hours.WASPADA),
        berbahaya_hours: sum(d => d.status_hours.BERBAHAYA),
        days_with_data:  data.filter(d => d.active_hours > 0).length,
        tvoc_avg_ppb:    totalSamples ? round1(tvocSum / totalSamples) : null,
        worst_day:       worst ? { date: worst.date, berbahaya_hours: worst.status_hours.BERBAHAYA } : null,
      },
    })
  } catch (err) {
    console.error('[trends]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
