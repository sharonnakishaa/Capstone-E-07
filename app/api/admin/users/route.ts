import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { generatePassword, hashPassword } from '@/lib/password'
import { parseUserInput } from '@/lib/validation'
import { USER_SELECT } from '@/lib/users'
import { logActivity } from '@/lib/activity'

/** Semua akun (aktif & nonaktif), tanpa hash password. Khusus pengelola. */
export async function GET(req: NextRequest) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  try {
    const users = await prisma.users.findMany({
      select: USER_SELECT,
      orderBy: [{ is_active: 'desc' }, { full_name: 'asc' }],
    })
    return NextResponse.json({ users, me: user.id, server_time: new Date() })
  } catch (err) {
    console.error('[admin/users]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Buat akun pengelola baru. Password dibuat acak oleh server dan hanya dikembalikan
 * di respons ini, supaya tidak ada password yang dipilih/diketik oleh pembuat akun.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const parsed = parseUserInput(body, false)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Validasi gagal', details: parsed.details }, { status: 400 })
  }
  const email = parsed.data.email!

  try {
    const password = generatePassword()
    const created = await prisma.users.create({
      data: {
        email, full_name: parsed.data.full_name!, role: 'pengelola',
        password_hash: hashPassword(password), must_change_password: true,
      },
      select: USER_SELECT,
    })
    await logActivity(user, 'user.create', created.email, { full_name: created.full_name })
    return NextResponse.json({ user: created, password }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: `Email ${email} sudah punya akun` }, { status: 409 })
    }
    console.error('[admin/users POST]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
