// Simulator ESP32: mengirim POST /api/sensor setiap 5 detik.
//
//   npm run simulate                                   # skenario normal, device aktif pertama
//   npm run simulate -- --scenario=spike
//   npm run simulate -- --scenario=offline --device=<uuid> --url=http://localhost:3000
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

async function resolveDeviceId(fromArg?: string): Promise<string> {
  if (fromArg) return fromArg

  const prisma = new PrismaClient()
  try {
    const device = await prisma.devices.findFirst({ where: { is_active: true }, orderBy: { created_at: 'asc' } })
    if (!device) throw new Error('Tidak ada device aktif. Jalankan `npm run db:seed` dulu atau pakai --device=<uuid>.')
    console.log(`--device tidak diisi, memakai device aktif pertama: ${device.device_name}`)
    return device.id
  } finally {
    await prisma.$disconnect()
  }
}

const fmtTime = (d: Date) => d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false })

async function main() {
  const args     = parseArgs()
  const scenario = (args.scenario || 'normal') as Scenario
  const baseUrl  = (args.url || 'http://localhost:3000').replace(/\/$/, '')
  const apiKey   = process.env.API_KEY

  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`Skenario tidak dikenal: "${scenario}". Pilihan: ${SCENARIOS.join(', ')}`)
  }
  if (!apiKey) throw new Error('API_KEY belum diisi di .env')

  const deviceId = await resolveDeviceId(args.device)
  const endpoint = `${baseUrl}/api/sensor`
  const sim      = new DeviceSimulator(scenario)

  console.log(`Simulator ESP32 — skenario "${scenario}" → ${endpoint}`)
  console.log(`device_id ${deviceId}  (Ctrl+C untuk berhenti)\n`)

  const cycleSec = OFFLINE_CYCLE.onlineSec + OFFLINE_CYCLE.offlineSec
  const startMs  = Date.now()
  let tick = 0

  const loop = async () => {
    const now = new Date()
    const r   = sim.step(now)
    const silent = scenario === 'offline' && (tick * TICK_SEC) % cycleSec >= OFFLINE_CYCLE.onlineSec

    const line = [
      fmtTime(now),
      `raw ${String(r.tvoc_raw_ppb).padStart(4)}`,
      `kalman ${r.tvoc_kalman_ppb.toFixed(1).padStart(6)}`,
      r.air_status.padEnd(9),
      r.fuzzy_level.padEnd(4),
      `${String(r.fan_duty_percent).padStart(3)}%`,
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
          body:    JSON.stringify({ device_id: deviceId, ...r }),
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

  await loop()
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
