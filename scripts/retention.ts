// Retensi data: ringkas sensor_logs yang lebih tua dari RAW_RETENTION_DAYS ke sensor_hourly, lalu hapus.
// Ringkas dan hapus berjalan dalam satu transaksi, jadi tidak ada data yang hilang tanpa ringkasan.
// Aman dijalankan berulang kali.
//
//   npm run db:retention -- --dry-run     # hanya tampilkan apa yang akan diproses
//   npm run db:retention                  # jalankan dengan RAW_RETENTION_DAYS dari lib/sensor.ts
//   npm run db:retention -- --days=0      # untuk pengujian: ringkas semua jam yang sudah lewat

import { PrismaClient } from '@prisma/client'
import { RAW_RETENTION_DAYS } from '../lib/sensor'

const HOUR_MS = 3_600_000
const prisma  = new PrismaClient()

function parseArgs() {
  const args   = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const daysArg = args.find(a => a.startsWith('--days='))?.split('=')[1]

  let days = RAW_RETENTION_DAYS
  if (daysArg !== undefined) {
    if (!/^\d+$/.test(daysArg)) throw new Error('--days harus bilangan bulat ≥ 0')
    days = Number(daysArg)
  }
  return { dryRun, days }
}

const fmtWib = (d: Date | null) =>
  d ? new Date(d.getTime() + 7 * HOUR_MS).toISOString().slice(0, 16).replace('T', ' ') + ' WIB' : '—'

async function main() {
  const { dryRun, days } = parseArgs()

  // Dibulatkan ke awal jam supaya hanya jam yang lengkap yang diringkas.
  const cutoff = new Date(Math.floor((Date.now() - days * 24 * HOUR_MS) / HOUR_MS) * HOUR_MS)
  const cutoffIso = cutoff.toISOString()

  const [stats] = await prisma.$queryRaw<{ row_count: number; hours: number; oldest: Date | null; newest: Date | null }[]>`
    SELECT COUNT(*)::int AS row_count,
           COUNT(DISTINCT (device_id, date_trunc('hour', recorded_at AT TIME ZONE 'UTC')))::int AS hours,
           MIN(recorded_at) AS oldest,
           MAX(recorded_at) AS newest
    FROM sensor_logs
    WHERE recorded_at < ${cutoffIso}::timestamptz`

  console.log(`Retensi data mentah : ${days} hari`)
  console.log(`Batas (cutoff)      : ${fmtWib(cutoff)}`)
  console.log(`Log yang diproses   : ${stats.row_count.toLocaleString('id-ID')} baris → ${stats.hours.toLocaleString('id-ID')} ringkasan per jam`)
  console.log(`Rentang             : ${fmtWib(stats.oldest)} s.d. ${fmtWib(stats.newest)}`)

  if (stats.row_count === 0) {
    console.log('\nTidak ada data yang melewati masa retensi.')
    return
  }
  if (dryRun) {
    console.log('\n--dry-run: tidak ada perubahan pada database.')
    return
  }

  // Kalau jam yang sama sudah pernah diringkas, hasilnya digabung (jumlah ditambah, rata-rata
  // ditimbang dengan jumlah sampel). Dalam pemakaian normal ini tidak terjadi karena recorded_at
  // diisi server, tapi tetap ditangani supaya tidak ada sampel yang hilang.
  const summarize = prisma.$executeRaw`
    INSERT INTO sensor_hourly (
      device_id, hour_start, samples, fan_running_samples,
      tvoc_avg_ppb, tvoc_max_ppb, tvoc_raw_max_ppb,
      dust_outlet_avg_ugm3, dust_outlet_max_ugm3,
      temperature_avg_celsius, humidity_avg_percent,
      aman_samples, waspada_samples, berbahaya_samples
    )
    SELECT device_id,
           date_trunc('hour', recorded_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
           COUNT(*)::int,
           (COUNT(*) FILTER (WHERE fan_duty_percent > 0))::int,
           AVG(COALESCE(tvoc_kalman_ppb, tvoc_raw_ppb)),
           MAX(COALESCE(tvoc_kalman_ppb, tvoc_raw_ppb)),
           MAX(tvoc_raw_ppb),
           AVG(dust_outlet_ugm3),
           MAX(dust_outlet_ugm3),
           AVG(temperature_celsius),
           AVG(humidity_percent),
           (COUNT(*) FILTER (WHERE air_status = 'AMAN'))::int,
           (COUNT(*) FILTER (WHERE air_status = 'WASPADA'))::int,
           (COUNT(*) FILTER (WHERE air_status = 'BERBAHAYA'))::int
    FROM sensor_logs
    WHERE recorded_at < ${cutoffIso}::timestamptz
    GROUP BY 1, 2
    ON CONFLICT (device_id, hour_start) DO UPDATE SET
      tvoc_avg_ppb            = (sensor_hourly.tvoc_avg_ppb * sensor_hourly.samples + EXCLUDED.tvoc_avg_ppb * EXCLUDED.samples)
                                / (sensor_hourly.samples + EXCLUDED.samples),
      temperature_avg_celsius = (sensor_hourly.temperature_avg_celsius * sensor_hourly.samples + EXCLUDED.temperature_avg_celsius * EXCLUDED.samples)
                                / (sensor_hourly.samples + EXCLUDED.samples),
      humidity_avg_percent    = (sensor_hourly.humidity_avg_percent * sensor_hourly.samples + EXCLUDED.humidity_avg_percent * EXCLUDED.samples)
                                / (sensor_hourly.samples + EXCLUDED.samples),
      dust_outlet_avg_ugm3    = COALESCE(
                                  (sensor_hourly.dust_outlet_avg_ugm3 * sensor_hourly.samples + EXCLUDED.dust_outlet_avg_ugm3 * EXCLUDED.samples)
                                  / (sensor_hourly.samples + EXCLUDED.samples),
                                  sensor_hourly.dust_outlet_avg_ugm3, EXCLUDED.dust_outlet_avg_ugm3),
      tvoc_max_ppb            = GREATEST(sensor_hourly.tvoc_max_ppb, EXCLUDED.tvoc_max_ppb),
      tvoc_raw_max_ppb        = GREATEST(sensor_hourly.tvoc_raw_max_ppb, EXCLUDED.tvoc_raw_max_ppb),
      dust_outlet_max_ugm3    = GREATEST(sensor_hourly.dust_outlet_max_ugm3, EXCLUDED.dust_outlet_max_ugm3),
      samples                 = sensor_hourly.samples + EXCLUDED.samples,
      fan_running_samples     = sensor_hourly.fan_running_samples + EXCLUDED.fan_running_samples,
      aman_samples            = sensor_hourly.aman_samples + EXCLUDED.aman_samples,
      waspada_samples         = sensor_hourly.waspada_samples + EXCLUDED.waspada_samples,
      berbahaya_samples       = sensor_hourly.berbahaya_samples + EXCLUDED.berbahaya_samples`

  const purge = prisma.$executeRaw`DELETE FROM sensor_logs WHERE recorded_at < ${cutoffIso}::timestamptz`

  const started = Date.now()
  const [summarized, deleted] = await prisma.$transaction([summarize, purge])

  console.log(`\nSelesai dalam ${((Date.now() - started) / 1000).toFixed(1)} detik:`)
  console.log(`  ${summarized.toLocaleString('id-ID')} ringkasan per jam ditulis ke sensor_hourly`)
  console.log(`  ${deleted.toLocaleString('id-ID')} log mentah dihapus dari sensor_logs`)
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
