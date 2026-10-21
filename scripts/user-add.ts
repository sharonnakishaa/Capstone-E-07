// Buat akun pengelola, atau reset password akun yang sudah ada.
// Password dibuat acak dan hanya dicetak sekali, supaya tidak tersimpan di riwayat terminal.
//
//   npm run user:add -- --email=aslab@ugm.ac.id --name="Nama Aslab"
//   npm run user:add -- --email=aslab@ugm.ac.id            # reset password akun yang sudah ada

import { PrismaClient } from '@prisma/client'
import { generatePassword, hashPassword } from '../lib/password'

const ROLES = ['pengelola']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  const args  = parseArgs()
  const email = (args.email ?? '').trim().toLowerCase()
  const name  = (args.name ?? '').trim()
  const role  = args.role ?? 'pengelola'

  if (!EMAIL_RE.test(email)) throw new Error('--email wajib diisi dengan alamat email yang valid')
  if (!ROLES.includes(role)) throw new Error(`--role harus salah satu dari: ${ROLES.join(', ')}`)

  const password = generatePassword()
  const existing = await prisma.users.findUnique({ where: { email } })

  if (existing) {
    await prisma.users.update({
      where: { id: existing.id },
      data:  { password_hash: hashPassword(password), role, ...(name && { full_name: name }) },
    })
    console.log(`Password akun ${email} direset.`)
  } else {
    if (!name) throw new Error('--name wajib diisi untuk akun baru')
    await prisma.users.create({ data: { email, full_name: name, role, password_hash: hashPassword(password) } })
    console.log(`Akun ${email} (${name}) dibuat dengan role ${role}.`)
  }

  console.log(`\nPassword: ${password}`)
  console.log('Password ini hanya ditampilkan sekali. Kirim ke pemilik akun lewat jalur pribadi.')
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
