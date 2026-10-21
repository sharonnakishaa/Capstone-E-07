// Seed database: 1 user, N device, dan ±3 jam data historis per device (interval 5 detik).
// Menjalankan ulang aman: user & device di-upsert, log dan ringkasan lama milik device ini dihapus dulu.
// Device seed yang tidak termasuk N (dari seed sebelumnya) dinonaktifkan.
//
//   npm run db:seed                  # 1 device
//   npm run db:seed -- --devices=4   # 4 device: Epen Meja 1 … Epen Meja 4

import { PrismaClient } from '@prisma/client'
import { generatePassword, hashPassword } from '../lib/password'
import { DeviceSimulator, TICK_SEC } from './lib/simulation'

const HISTORY_HOURS = 3
const BATCH_SIZE    = 1000
const MAX_DEVICES   = 20

// Password akun seed dibuat acak dan hanya dicetak saat akun pertama kali dibuat.
// Repo ini publik dan database dipakai bersama dengan Production, jadi jangan pakai password tetap.
const USER = {
  email:     'admin@epen.local',
  full_name: 'Admin EPEN',
}

const LOCATION   = 'Lab DTETI'
const MAC_PREFIX = '24:6F:28:00:00:' // penanda device hasil seed

const prisma = new PrismaClient()

function parseDeviceCount(): number {
  const arg = process.argv.slice(2).find(a => a.startsWith('--devices='))?.split('=')[1]
  if (arg === undefined) return 1
  const n = Number(arg)
  if (!/^\d+$/.test(arg) || n < 1 || n > MAX_DEVICES) {
    throw new Error(`--devices harus bilangan bulat 1–${MAX_DEVICES}`)
  }
  return n
}

async function main() {
  const deviceCount = parseDeviceCount()
  const ticks   = Math.floor(HISTORY_HOURS * 3600 / TICK_SEC)
  const startMs = Date.now() - ticks * TICK_SEC * 1000

  let newPassword: string | null = null
  let user = await prisma.users.findUnique({ where: { email: USER.email } })
  if (!user) {
    newPassword = generatePassword()
    user = await prisma.users.create({
      data: { email: USER.email, full_name: USER.full_name, password_hash: hashPassword(newPassword) },
    })
  }

  const macs = Array.from({ length: deviceCount }, (_, i) => MAC_PREFIX + (i + 1).toString(16).toUpperCase().padStart(2, '0'))

  const { count: deactivated } = await prisma.devices.updateMany({
    where: { mac_address: { startsWith: MAC_PREFIX, notIn: macs }, is_active: true },
    data:  { is_active: false },
  })
  if (deactivated) console.log(`Menonaktifkan ${deactivated} device seed lama`)

  const summary: { name: string; id: string; counts: Record<string, number> }[] = []

  for (const [i, mac_address] of macs.entries()) {
    const device_name = `Epen Meja ${i + 1}`

    // Filter dianggap baru dipasang di awal data historis.
    const device = await prisma.devices.upsert({
      where:  { mac_address },
      update: { device_name, location: LOCATION, is_active: true, filter_installed_at: new Date(startMs), last_alert_at: null, last_alert_status: null },
      create: { device_name, location: LOCATION, mac_address, registered_by: user.id, filter_installed_at: new Date(startMs), inlet_distance_cm: 5 },
    })

    await Promise.all([
      prisma.sensor_logs.deleteMany({ where: { device_id: device.id } }),
      prisma.sensor_hourly.deleteMany({ where: { device_id: device.id } }),
    ])

    const sim  = new DeviceSimulator('normal')
    const rows = Array.from({ length: ticks }, (_, t) => {
      const recorded_at = new Date(startMs + t * TICK_SEC * 1000)
      return { device_id: device.id, ...sim.step(recorded_at), recorded_at }
    })

    for (let b = 0; b < rows.length; b += BATCH_SIZE) {
      await prisma.sensor_logs.createMany({ data: rows.slice(b, b + BATCH_SIZE) })
      process.stdout.write(`\r${device_name}: ${Math.min(b + BATCH_SIZE, rows.length)}/${rows.length} log`)
    }
    process.stdout.write('\n')

    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.air_status] = (acc[r.air_status] ?? 0) + 1
      return acc
    }, {})
    summary.push({ name: device_name, id: device.id, counts })
  }

  console.log(`\nUser : ${user.email}`)
  console.log(newPassword
    ? `       password: ${newPassword}   (hanya ditampilkan sekali — simpan sekarang)`
    : `       password tidak diubah (reset dengan: npm run user:add -- --email=${user.email})`)
  for (const s of summary) {
    console.log(`\n${s.name} — ${LOCATION}`)
    console.log(`  device_id = ${s.id}`)
    console.log(`  status    : ${Object.entries(s.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  console.log(deviceCount === 1
    ? `\nJalankan simulator:\n  npm run simulate -- --device=${summary[0].id}`
    : `\nJalankan simulator untuk semua device:\n  npm run simulate -- --all`)
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
