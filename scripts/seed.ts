// Seed database: 1 user, 1 device, dan ±3 jam data historis (interval 5 detik).
// Menjalankan ulang aman: user & device di-upsert, log lama milik device ini dihapus dulu.
//
//   npm run db:seed

import { randomBytes, scryptSync } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { DeviceSimulator, TICK_SEC } from './lib/simulation'

const HISTORY_HOURS = 3
const BATCH_SIZE    = 1000

const USER = {
  email:     'admin@epen.local',
  full_name: 'Admin EPEN',
  password:  'epen123', // hanya untuk data dummy
}

const DEVICE = {
  device_name: 'Epen #1',
  location:    'Lab DTETI',
  mac_address: '24:6F:28:00:00:01',
}

const prisma = new PrismaClient()

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`
}

async function main() {
  const ticks   = Math.floor(HISTORY_HOURS * 3600 / TICK_SEC)
  const startMs = Date.now() - ticks * TICK_SEC * 1000

  const user = await prisma.users.upsert({
    where:  { email: USER.email },
    update: {},
    create: { email: USER.email, full_name: USER.full_name, password_hash: hashPassword(USER.password) },
  })

  // Filter dianggap baru dipasang di awal data historis.
  const device = await prisma.devices.upsert({
    where:  { mac_address: DEVICE.mac_address },
    update: { is_active: true, filter_installed_at: new Date(startMs), last_alert_at: null, last_alert_status: null },
    create: { ...DEVICE, registered_by: user.id, filter_installed_at: new Date(startMs), inlet_distance_cm: 5 },
  })

  const { count: deleted } = await prisma.sensor_logs.deleteMany({ where: { device_id: device.id } })
  if (deleted) console.log(`Menghapus ${deleted} log lama milik device ini`)

  const sim  = new DeviceSimulator('normal')
  const rows = Array.from({ length: ticks }, (_, i) => {
    const recorded_at = new Date(startMs + i * TICK_SEC * 1000)
    return { device_id: device.id, ...sim.step(recorded_at), recorded_at }
  })

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await prisma.sensor_logs.createMany({ data: rows.slice(i, i + BATCH_SIZE) })
    process.stdout.write(`\rMengisi sensor_logs: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`)
  }
  process.stdout.write('\n')

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.air_status] = (acc[r.air_status] ?? 0) + 1
    return acc
  }, {})

  console.log(`\nUser   : ${user.email}`)
  console.log(`Device : ${device.device_name} — ${device.location}`)
  console.log(`Status : ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  console.log(`\ndevice_id = ${device.id}`)
  console.log(`\nJalankan simulator:\n  npm run simulate -- --device=${device.id}`)
}

main()
  .catch(err => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
