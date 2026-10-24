import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'

// Sesi berupa cookie yang ditandatangani HMAC-SHA256 dengan SESSION_SECRET (tanpa tabel sesi).
// Isi cookie: base64url(JSON { uid, v, exp }) + "." + tanda tangan.
// Setiap aksi yang dilindungi tetap mengecek user di database: akun nonaktif, atau cookie yang
// versinya (v) sudah tertinggal dari users.session_version (setelah ganti/reset password), langsung ditolak.

export const SESSION_COOKIE = 'epen_session'
export const SESSION_TTL_SEC = 7 * 24 * 3600

export type Role = 'pengelola'

export interface SessionUser {
  id: string
  email: string
  full_name: string
  role: string
}

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET belum diset atau kurang dari 32 karakter')
  return s
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

export function createSessionToken(userId: string, version: number): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, v: version, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC }))
    .toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** User id + versi sesi dari token yang valid dan belum kedaluwarsa; null kalau tidak valid. */
function readSessionToken(token: string | undefined): { uid: string; v: number } | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = Buffer.from(sign(payload))
  const actual   = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  try {
    const { uid, v = 0, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof uid !== 'string' || typeof v !== 'number' || typeof exp !== 'number' || exp * 1000 < Date.now()) return null
    // Cookie lama tanpa v dianggap versi 0, jadi deploy ini tidak mengeluarkan semua orang
    return { uid, v }
  } catch {
    return null
  }
}

export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const token = readSessionToken(req.cookies.get(SESSION_COOKIE)?.value)
  if (!token) return null
  const user = await prisma.users.findUnique({
    where: { id: token.uid },
    select: { id: true, email: true, full_name: true, role: true, is_active: true, session_version: true },
  })
  if (!user || !user.is_active || user.session_version !== token.v) return null
  return { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
}

/**
 * Pastikan request berasal dari user yang login (dan punya salah satu role, kalau diisi).
 * Mengembalikan user, atau NextResponse 401/403 yang langsung bisa dikembalikan route.
 */
export async function requireUser(req: NextRequest, roles?: Role[]): Promise<SessionUser | NextResponse> {
  let user: SessionUser | null
  try {
    user = await getSessionUser(req)
  } catch (err) {
    console.error('[auth]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  if (!user) {
    return NextResponse.json({ error: 'Silakan masuk terlebih dahulu' }, { status: 401 })
  }
  if (roles && !roles.includes(user.role as Role)) {
    return NextResponse.json({ error: 'Akun ini tidak punya akses untuk aksi ini' }, { status: 403 })
  }
  return user
}

export function setSessionCookie(res: NextResponse, userId: string, version: number) {
  res.cookies.set(SESSION_COOKIE, createSessionToken(userId, version), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   SESSION_TTL_SEC,
  })
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
}
