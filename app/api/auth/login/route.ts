import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { setSessionCookie } from '@/lib/auth'
import { hashPassword, verifyPassword } from '@/lib/password'

// Jeda saat login gagal, untuk memperlambat tebakan password berulang
const FAIL_DELAY_MS = 600
// Hash pembanding supaya waktu respons sama, baik email terdaftar maupun tidak
const DUMMY_HASH = hashPassword('dummy-password-for-timing')

const fail = async () => {
  await new Promise(r => setTimeout(r, FAIL_DELAY_MS))
  return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown }
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return NextResponse.json({ error: 'Email dan password wajib diisi' }, { status: 400 })
  }

  try {
    const user = await prisma.users.findUnique({ where: { email: email.trim().toLowerCase() } })
    const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH)
    if (!user || !ok) return fail()

    await prisma.users.update({ where: { id: user.id }, data: { last_login: new Date() } })

    const res = NextResponse.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    })
    setSessionCookie(res, user.id)
    return res
  } catch (err) {
    console.error('[auth/login]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
