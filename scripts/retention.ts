// Jalankan retensi data secara manual (logikanya di lib/retention.ts, sama dengan cron harian).
// Di Production retensi berjalan otomatis lewat Vercel Cron → GET /api/cron/retention.
//
//   npm run db:retention -- --dry-run     # hanya tampilkan apa yang akan diproses
//   npm run db:retention                  # jalankan dengan RAW_RETENTION_DAYS dari lib/sensor.ts
//   npm run db:retention -- --days=0      # untuk pengujian: ringkas semua jam yang sudah lewat

import { prisma } from '../lib/prisma'
import { RAW_RETENTION_DAYS } from '../lib/sensor'
import { runRetention } from '../lib/retention'

const HOUR_MS = 3_600_000

function parseArgs() {
  const args    = process.argv.slice(2)
  const dryRun  = args.includes('--dry-run')
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
  const r = await runRetention(parseArgs())

  console.log(`Retensi data mentah : ${r.days} hari`)
  console.log(`Batas (cutoff)      : ${fmtWib(r.cutoff)}`)
  console.log(`Log yang diproses   : ${r.row_count.toLocaleString('id-ID')} baris → ${r.hours.toLocaleString('id-ID')} ringkasan per jam`)
  console.log(`Rentang             : ${fmtWib(r.oldest)} s.d. ${fmtWib(r.newest)}`)

  if (r.row_count === 0) {
    console.log('\nTidak ada data yang melewati masa retensi.')
  } else if (r.dry_run) {
    console.log('\n--dry-run: tidak ada perubahan pada database.')
  } else {
    console.log(`\nSelesai dalam ${(r.duration_ms / 1000).toFixed(1)} detik:`)
    console.log(`  ${r.summarized.toLocaleString('id-ID')} ringkasan per jam ditulis ke sensor_hourly`)
    console.log(`  ${r.deleted.toLocaleString('id-ID')} log mentah dihapus dari sensor_logs`)
  }
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
