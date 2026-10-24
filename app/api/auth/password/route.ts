import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser, setSessionCookie } from '@/lib/auth'
import { hashPassword, verifyPassword } from '@/lib/password'
import { checkLoginLimit, clearLoginFailures, clientIp, recordLoginFailure } from '@/lib/rate-limit'
import { checkNewPassword } from '@/lib/validation'

const FAIL_DELAY_MS = 600

/**
 * Ganti password akun sendiri. Password lama salah dihitung sebagai login gagal (rate limit yang sama),
 * supaya sesi yang tertinggal di komputer lab tidak bisa dipakai menebak password.
 * Berhasil → session_version naik: sesi di perangkat lain berakhir, sesi ini diberi cookie baru.
 */
export async function POST(req: NextRequest) {
  const actor = await requireUser(req, ['pengelola'])
  if (actor instanceof NextResponse) return actor

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }
  const { current_password, new_password } = (body ?? {}) as { current_password?: unknown; new_password?: unknown }
  if (typeof current_password !== 'string' || !current_password) {
    return NextResponse.json({ error: 'Password saat ini wajib diisi' }, { status: 400 })
  }
  const pwError = checkNewPassword(new_password)
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 })
  if (new_password === current_password) {
    return NextResponse.json({ error: 'Password baru harus berbeda dari password saat ini' }, { status: 400 })
  }

  const ip = clientIp(req)
  try {
    const limit = await checkLoginLimit(ip, actor.email)
    if (limit.blocked) {
      return NextResponse.json(
        { error: `Terlalu banyak percobaan yang gagal. Coba lagi dalam ${Math.ceil(limit.retryAfterSec / 60)} menit.` },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
      )
    }

    const user = await prisma.users.findUnique({ where: { id: actor.id } })
    if (!user || !verifyPassword(current_password, user.password_hash)) {
      await recordLoginFailure(ip, actor.email)
      await new Promise(r => setTimeout(r, FAIL_DELAY_MS))
      return NextResponse.json({ error: 'Password saat ini salah' }, { status: 400 })
    }

    const [updated] = await Promise.all([
      prisma.users.update({
        where: { id: user.id },
        data: { password_hash: hashPassword(new_password as string), session_version: { increment: 1 } },
        select: { session_version: true },
      }),
      clearLoginFailures(actor.email),
    ])

    const res = NextResponse.json({ success: true })
    setSessionCookie(res, user.id, updated.session_version)
    return res
  } catch (err) {
    console.error('[auth/password]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
