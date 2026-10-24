import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { LOGIN_LIMIT, clearLoginFailuresFor, clientIp, listLoginFailures } from '@/lib/rate-limit'
import { logActivity } from '@/lib/activity'

/**
 * Percobaan login gagal dalam jendela rate limit, per IP dan per email, beserta status kuncinya.
 * Email diberi nama akun kalau terdaftar, supaya pengelola tahu siapa yang terkunci.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  try {
    const { ips, emails } = await listLoginFailures()
    const accounts = emails.length
      ? await prisma.users.findMany({ where: { email: { in: emails.map(e => e.key) } }, select: { email: true, full_name: true } })
      : []
    const nameOf = new Map(accounts.map(a => [a.email, a.full_name]))

    return NextResponse.json({
      window_min: LOGIN_LIMIT.windowMs / 60000,
      my_ip: clientIp(req),
      ips,
      emails: emails.map(e => ({ ...e, full_name: nameOf.get(e.key) ?? null })),
      server_time: new Date(),
    })
  } catch (err) {
    console.error('[admin/login-failures]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Buka blokir satu IP atau satu email: DELETE ?ip=<ip> atau ?email=<email>. */
export async function DELETE(req: NextRequest) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  const { searchParams } = new URL(req.url)
  const ip = searchParams.get('ip')?.trim()
  const email = searchParams.get('email')?.trim().toLowerCase()
  if (!ip === !email) {
    return NextResponse.json({ error: 'Isi salah satu: ip atau email' }, { status: 400 })
  }

  try {
    const cleared = ip ? await clearLoginFailuresFor('ip', ip) : await clearLoginFailuresFor('email', email!)
    await logActivity(user, 'login.unblock', ip ?? email!, { kind: ip ? 'ip' : 'email', cleared })
    return NextResponse.json({ cleared })
  } catch (err) {
    console.error('[admin/login-failures DELETE]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
