// Simulator ESP32: mengirim POST /api/sensor setiap 5 detik, untuk satu atau beberapa device.
//
//   npm run simulate                                   # skenario normal, device aktif pertama
//   npm run simulate -- --scenario=spike
//   npm run simulate -- --scenario=offline --device=<uuid> --url=http://localhost:3000
//   npm run simulate -- --all                          # semua device aktif, masing-masing ESP32 virtual
//   npm run simulate -- --all --scenario=normal,spike  # skenario dibagi bergiliran ke tiap device
//   npm run simulate -- --device=<uuid1>,<uuid2>
//
// Skenario:
//   normal  — siklus menyolder biasa, puncak sesekali masuk WASPADA/BERBAHAYA
//   spike   — asap jauh lebih pekat dan sering, filter lebih bocor (debu outlet naik)
//   offline — seperti normal, tapi tiap 60 detik berhenti mengirim selama 30 detik

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { DeviceSimulator, Scenario, TICK_SEC } from './lib/simulation'

const OFFLINE_CYCLE = { onlineSec: 60, offlineSec: 30 }
const SCENARIOS: Scenario[] = ['normal', 'spike', 'offline']

interface Target {
  id: string
  mac: string
  label: string
}

function parseArgs(): Record<string, string> {
  return Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => {
        const [key, ...rest] = a.slice(2).split('=')
        return [key, rest.join('=')]
      })
  )
}

async function resolveTargets(args: Record<string, string>): Promise<Target[]> {
  const ids = args.device ? args.device.split(',').map(s => s.trim()).filter(Boolean) : []
  const all = 'all' in args

  // Nama device diambil dari database supaya log mudah dibaca; kalau gagal, pakai potongan UUID.
  const prisma = new PrismaClient()
  try {
    if (ids.length) {
      const found = await prisma.devices.findMany({ where: { id: { in: ids } }, select: { id: true, device_name: true, mac_address: true } })
      const missing = ids.filter(id => !found.some(d => d.id === id))
      if (missing.length) throw new Error(`Device tidak ditemukan: ${missing.join(', ')}`)
      return ids.map(id => {
        const d = found.find(x => x.id === id)!
        return { id, mac: d.mac_address, label: d.device_name }
      })
    }

    const devices = await prisma.devices.findMany({ where: { is_active: true }, orderBy: { created_at: 'asc' } })
    if (!devices.length) throw new Error('Tidak ada device aktif. Jalankan `npm run db:seed` dulu atau pakai --device=<uuid>.')
    if (!all) console.log(`--device tidak diisi, memakai device aktif pertama: ${devices[0].device_name}`)
    return (all ? devices : devices.slice(0, 1)).map(d => ({ id: d.id, mac: d.mac_address, label: d.device_name }))
  } finally {
    await prisma.$disconnect()
  }
}

const fmtTime = (d: Date) => d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })

async function main() {
  const args      = parseArgs()
  const scenarios = (args.scenario || 'normal').split(',').map(s => s.trim()) as Scenario[]
  const baseUrl   = (args.url || 'http://localhost:3000').replace(/\/$/, '')
  const apiKey    = process.env.API_KEY

  const unknown = scenarios.filter(s => !SCENARIOS.includes(s))
  if (unknown.length) {
    throw new Error(`Skenario tidak dikenal: "${unknown.join(', ')}". Pilihan: ${SCENARIOS.join(', ')}`)
  }
  if (!apiKey) throw new Error('API_KEY belum diisi di .env')

  const targets  = await resolveTargets(args)
  const endpoint = `${baseUrl}/api/sensor`
  const multi    = targets.length > 1
  const labelW   = Math.max(...targets.map(t => t.label.length))

  console.log(`Simulator ESP32 → ${endpoint}  (Ctrl+C untuk berhenti)`)
  targets.forEach((t, i) => console.log(`  ${t.label.padEnd(labelW)}  ${t.mac}  skenario "${scenarios[i % scenarios.length]}"`))
  console.log('')

  const cycleSec = OFFLINE_CYCLE.onlineSec + OFFLINE_CYCLE.offlineSec

  targets.forEach((target, i) => {
    const scenario = scenarios[i % scenarios.length]
    const sim      = new DeviceSimulator(scenario)
    const prefix   = multi ? `[${target.label.padEnd(labelW)}]  ` : ''
    // Waktu mulai digeser antar device supaya request tidak datang bersamaan.
    const startMs  = Date.now() + Math.round(i * TICK_SEC * 1000 / targets.length)
    let tick = 0

    const loop = async () => {
      const now = new Date()
      const r   = sim.step(now)
      const silent = scenario === 'offline' && (tick * TICK_SEC) % cycleSec >= OFFLINE_CYCLE.onlineSec

      const line = prefix + [
        fmtTime(now),
        `raw ${String(r.tvoc_raw_ppb).padStart(4)}`,
        r.tvoc_kalman_ppb === null
          ? 'kalman      —  (pemanasan)'
          : `kalman ${r.tvoc_kalman_ppb.toFixed(1).padStart(6)}  base ${String(r.tvoc_baseline_ppb).padStart(3)}`,
        r.air_status.padEnd(9),
        `duty ${String(r.fan_duty_percent).padStart(3)}%`,
        `${String(r.fan_rpm).padStart(4)} rpm`,
        `debu ${r.dust_outlet_ugm3.toFixed(1).padStart(5)}`,
      ].join('  ')

      if (silent) {
        console.log(`${line}  ⏸ offline (tidak mengirim)`)
      } else {
        try {
          const res = await fetch(endpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
            // Identitas lewat MAC address, sama seperti firmware
            body:    JSON.stringify({ mac_address: target.mac, ...r }),
          })
          const suffix = res.ok ? '' : `  ${await res.text()}`
          console.log(`${line}  → ${res.status}${suffix}`)
        } catch (err) {
          console.log(`${line}  ✗ gagal terhubung (${(err as Error).message})`)
        }
      }

      tick++
      // Jadwal dikoreksi terhadap waktu mulai supaya interval tidak bergeser.
      setTimeout(loop, Math.max(0, startMs + tick * TICK_SEC * 1000 - Date.now()))
    }

    setTimeout(loop, Math.max(0, startMs - Date.now()))
  })
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
