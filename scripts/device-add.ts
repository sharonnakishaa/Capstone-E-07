// Daftarkan alat Epen berdasarkan MAC address ESP32, atau perbarui alat yang MAC-nya sudah terdaftar.
// MAC tiap alat tercetak di Serial Monitor firmware.
//
//   npm run device:add -- --mac=24:6F:28:AB:CD:EF --name="Epen Meja 1"
//   npm run device:add -- --mac=24:6F:28:AB:CD:EF --name="Epen Meja 1" --location="Lab DTETI" --inlet=5
//
// Menjalankan ulang dengan MAC yang sama memperbarui nama/lokasi dan mengaktifkan kembali alatnya.

import { PrismaClient } from '@prisma/client'
import { normalizeMac } from '../lib/validation'

const DEFAULT_LOCATION = 'Lab DTETI'
const DEFAULT_INLET_CM = 5

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

const prisma = new PrismaClient()

async function main() {
  const args     = parseArgs()
  const mac      = normalizeMac(args.mac)
  const name     = (args.name ?? '').trim()
  const location = (args.location ?? '').trim()
  const inletArg = args.inlet

  if (!mac) throw new Error('--mac wajib diisi dengan format seperti 24:6F:28:AB:CD:EF')
  const inlet = inletArg === undefined ? undefined : Number(inletArg)
  if (inlet !== undefined && !(Number.isFinite(inlet) && inlet > 0)) throw new Error('--inlet harus angka > 0 (cm)')

  const existing = await prisma.devices.findUnique({ where: { mac_address: mac } })

  const device = existing
    ? await prisma.devices.update({
        where: { id: existing.id },
        data: {
          is_active: true,
          ...(name && { device_name: name }),
          ...(location && { location }),
          ...(inlet !== undefined && { inlet_distance_cm: inlet }),
        },
      })
    : await (async () => {
        if (!name) throw new Error('--name wajib diisi untuk alat baru, misalnya --name="Epen Meja 1"')
        // registered_by wajib: pakai akun pengelola pertama
        const owner = await prisma.users.findFirst({ orderBy: { created_at: 'asc' } })
        if (!owner) throw new Error('Belum ada akun. Buat dulu dengan: npm run user:add -- --email=... --name=...')
        return prisma.devices.create({
          data: {
            device_name:       name,
            location:          location || DEFAULT_LOCATION,
            mac_address:       mac,
            inlet_distance_cm: inlet ?? DEFAULT_INLET_CM,
            registered_by:     owner.id,
          },
        })
      })()

  console.log(existing ? 'Alat diperbarui dan diaktifkan:' : 'Alat baru terdaftar:')
  console.log(`  nama      : ${device.device_name}`)
  console.log(`  lokasi    : ${device.location}`)
  console.log(`  mac       : ${device.mac_address}`)
  console.log(`  device_id : ${device.id}`)
  console.log(`  inlet     : ${device.inlet_distance_cm} cm`)
  console.log('\nFirmware cukup mengirim "mac_address" di payload; device_id tidak perlu ditanam.')
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
