import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { setSessionCookie } from '@/lib/auth'
import { hashPassword, verifyPassword } from '@/lib/password'
import { LOGIN_LIMIT, checkLoginLimit, clearLoginFailures, clientIp, recordLoginFailure } from '@/lib/rate-limit'

// Jeda saat login gagal, untuk memperlambat tebakan password berulang
const FAIL_DELAY_MS = 600
// Hash pembanding supaya waktu respons sama, baik email terdaftar maupun tidak
const DUMMY_HASH = hashPassword('dummy-password-for-timing')

const fmtWait = (sec: number) => (sec < 60 ? `${sec} detik` : `${Math.ceil(sec / 60)} menit`)

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const { email: rawEmail, password } = (body ?? {}) as { email?: unknown; password?: unknown }
  if (typeof rawEmail !== 'string' || typeof password !== 'string' || !rawEmail.trim() || !password) {
    return NextResponse.json({ error: 'Email dan password wajib diisi' }, { status: 400 })
  }
  const email = rawEmail.trim().toLowerCase()
  const ip = clientIp(req)

  try {
    // Saat terkunci, password tidak diperiksa sama sekali (jadi tebakan tidak bisa diteruskan)
    const limit = await checkLoginLimit(ip, email)
    if (limit.blocked) {
      return NextResponse.json(
        {
          error: `Terlalu banyak percobaan masuk yang gagal. Coba lagi dalam ${fmtWait(limit.retryAfterSec)}.`,
          retry_after_sec: limit.retryAfterSec,
        },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
      )
    }

    const user = await prisma.users.findUnique({ where: { email } })
    const ok = verifyPassword(password, user?.password_hash ?? DUMMY_HASH)

    if (!user || !ok) {
      await recordLoginFailure(ip, email)
      await new Promise(r => setTimeout(r, FAIL_DELAY_MS))
      // Pesan sama untuk email salah maupun password salah; sisa percobaan baru disebut saat hampir habis
      const left = Math.min(limit.ipLeft, limit.emailLeft) - 1
      const warn = left <= LOGIN_LIMIT.warnWhenLeft
        ? left > 0
          ? ` Sisa ${left} percobaan sebelum dikunci ${LOGIN_LIMIT.windowMs / 60000} menit.`
          : ` Percobaan berikutnya dikunci ${LOGIN_LIMIT.windowMs / 60000} menit.`
        : ''
      return NextResponse.json({ error: `Email atau password salah.${warn}` }, { status: 401 })
    }

    // Disebut hanya setelah password benar, supaya status akun tidak bisa ditebak orang lain
    if (!user.is_active) {
      return NextResponse.json(
        { error: 'Akun ini dinonaktifkan. Minta Pengelola Lab lain mengaktifkannya di halaman Kelola Akun.' },
        { status: 403 }
      )
    }

    await Promise.all([
      prisma.users.update({ where: { id: user.id }, data: { last_login: new Date() } }),
      clearLoginFailures(email),
    ])

    const res = NextResponse.json({
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    })
    setSessionCookie(res, user.id, user.session_version)
    return res
  } catch (err) {
    console.error('[auth/login]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
