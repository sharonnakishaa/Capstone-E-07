import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'

// Sesi berupa cookie yang ditandatangani HMAC-SHA256 dengan SESSION_SECRET (tanpa tabel sesi).
// Isi cookie: base64url(JSON { uid, v, exp, la }) + "." + tanda tangan.
// Setiap aksi yang dilindungi tetap mengecek user di database: akun nonaktif, atau cookie yang
// versinya (v) sudah tertinggal dari users.session_version (setelah ganti/reset password), langsung ditolak.
//
// Dua batas waktu:
// - exp: maksimal 7 hari sejak login, tidak diperpanjang.
// - la (last activity): sesi berakhir setelah SESSION_IDLE_SEC tanpa aktivitas, karena dashboard dipakai
//   di komputer lab bersama. auth.js mengirim ping ke /api/auth/me saat ada klik/ketik/scroll, dan
//   hanya route itu yang memperbarui la (lihat touchSession), supaya tidak ada dua Set-Cookie yang bentrok.

export const SESSION_COOKIE = 'epen_session'
export const SESSION_TTL_SEC = 7 * 24 * 3600
export const SESSION_IDLE_SEC = 30 * 60
// Kelonggaran untuk jeda antar-ping dari browser (ping paling sering sekali per menit)
const IDLE_GRACE_SEC = 2 * 60
// la cukup diperbarui kalau sudah lebih tua dari ini, supaya cookie tidak ditulis ulang di setiap request
const TOUCH_AFTER_SEC = 60

export type Role = 'pengelola'

export interface SessionUser {
  id: string
  email: string
  full_name: string
  role: string
  must_change_password: boolean
}

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET belum diset atau kurang dari 32 karakter')
  return s
}

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

const nowSec = () => Math.floor(Date.now() / 1000)

interface SessionToken {
  uid: string
  v: number
  exp: number // detik unix
  la: number  // detik unix, aktivitas terakhir
}

/** Token baru; `exp` dipertahankan saat memperbarui aktivitas, dibuat baru saat login/ganti password. */
export function createSessionToken(userId: string, version: number, exp = nowSec() + SESSION_TTL_SEC): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, v: version, exp, la: nowSec() })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** Isi token yang valid, belum kedaluwarsa, dan belum melewati batas tidak aktif; null kalau tidak valid. */
function readSessionToken(token: string | undefined): SessionToken | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null

  const expected = Buffer.from(sign(payload))
  const actual   = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  try {
    // Cookie lama tanpa v dianggap versi 0, dan tanpa la dianggap baru aktif (diperbarui di ping berikutnya),
    // jadi deploy ini tidak mengeluarkan semua orang
    const { uid, v = 0, exp, la = nowSec() } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (typeof uid !== 'string' || typeof v !== 'number' || typeof exp !== 'number' || typeof la !== 'number') return null
    const now = nowSec()
    if (exp < now) return null
    if (now - la > SESSION_IDLE_SEC + IDLE_GRACE_SEC) return null
    return { uid, v, exp, la }
  } catch {
    return null
  }
}

/** User + isi token dari cookie request. Dipakai /api/auth/me untuk memperbarui aktivitas. */
export async function readSession(req: NextRequest): Promise<{ user: SessionUser; token: SessionToken } | null> {
  const token = readSessionToken(req.cookies.get(SESSION_COOKIE)?.value)
  if (!token) return null
  const user = await findSessionUser(token)
  return user ? { user, token } : null
}

export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  return (await readSession(req))?.user ?? null
}

async function findSessionUser(token: SessionToken): Promise<SessionUser | null> {
  const user = await prisma.users.findUnique({
    where: { id: token.uid },
    select: {
      id: true, email: true, full_name: true, role: true, must_change_password: true,
      is_active: true, session_version: true,
    },
  })
  if (!user || !user.is_active || user.session_version !== token.v) return null
  return { id: user.id, email: user.email, full_name: user.full_name, role: user.role, must_change_password: user.must_change_password }
}

/**
 * Pastikan request berasal dari user yang login (dan punya salah satu role, kalau diisi).
 * Mengembalikan user, atau NextResponse 401/403 yang langsung bisa dikembalikan route.
 * Akun dengan password sementara ditolak 403 (code "must_change_password"), kecuali route
 * mengizinkannya lewat `allowPendingPassword` — hanya dipakai route ganti password.
 */
export async function requireUser(
  req: NextRequest,
  roles?: Role[],
  { allowPendingPassword = false }: { allowPendingPassword?: boolean } = {},
): Promise<SessionUser | NextResponse> {
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
  if (user.must_change_password && !allowPendingPassword) {
    return NextResponse.json(
      { error: 'Ganti password sementara Anda terlebih dahulu', code: 'must_change_password' },
      { status: 403 }
    )
  }
  return user
}

export function setSessionCookie(res: NextResponse, userId: string, version: number, exp = nowSec() + SESSION_TTL_SEC) {
  res.cookies.set(SESSION_COOKIE, createSessionToken(userId, version, exp), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   Math.max(0, exp - nowSec()),
  })
}

/** Perbarui waktu aktivitas terakhir (la) tanpa memperpanjang batas 7 hari. Hanya dipanggil /api/auth/me. */
export function touchSession(res: NextResponse, token: SessionToken) {
  if (nowSec() - token.la >= TOUCH_AFTER_SEC) setSessionCookie(res, token.uid, token.v, token.exp)
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
}
