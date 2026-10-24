import { NextRequest } from 'next/server'
import { prisma } from './prisma'

// Rate limit login berbasis database (bukan memori), karena di Vercel setiap request bisa
// ditangani instance serverless yang berbeda. Hanya percobaan GAGAL yang dihitung, dalam
// jendela geser: kunci terbuka sendiri begitu percobaan lama keluar dari jendela.
export const LOGIN_LIMIT = {
  windowMs:        15 * 60 * 1000,
  maxPerIp:        10, // menahan tebakan password dari satu komputer/jaringan
  maxPerEmail:     20, // menahan tebakan ke satu akun dari banyak IP
  warnWhenLeft:    3,  // mulai beri tahu sisa percobaan saat tinggal sebanyak ini
  keepFailuresMs:  24 * 60 * 60 * 1000, // catatan lebih lama dari ini dibersihkan cron
}

/** IP klien. Di Vercel, x-real-ip / x-forwarded-for diisi oleh edge Vercel (tidak bisa dipalsukan klien). */
export function clientIp(req: NextRequest): string {
  return req.headers.get('x-real-ip')
    ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? 'unknown'
}

export type LoginLimitCheck =
  | { blocked: false; ipLeft: number; emailLeft: number }
  | { blocked: true; retryAfterSec: number }

/** Cek apakah IP atau email sedang dikunci karena terlalu banyak login gagal. */
export async function checkLoginLimit(ip: string, email: string): Promise<LoginLimitCheck> {
  const since = new Date(Date.now() - LOGIN_LIMIT.windowMs)
  const [byIp, byEmail] = await Promise.all([
    prisma.login_failures.findMany({
      where: { ip, created_at: { gte: since } },
      orderBy: { created_at: 'desc' },
      take: LOGIN_LIMIT.maxPerIp,
      select: { created_at: true },
    }),
    prisma.login_failures.findMany({
      where: { email, created_at: { gte: since } },
      orderBy: { created_at: 'desc' },
      take: LOGIN_LIMIT.maxPerEmail,
      select: { created_at: true },
    }),
  ])

  // Terkunci sampai percobaan ke-N terbaru keluar dari jendela waktu
  const unlockAt: number[] = []
  if (byIp.length >= LOGIN_LIMIT.maxPerIp) unlockAt.push(byIp[byIp.length - 1].created_at.getTime() + LOGIN_LIMIT.windowMs)
  if (byEmail.length >= LOGIN_LIMIT.maxPerEmail) unlockAt.push(byEmail[byEmail.length - 1].created_at.getTime() + LOGIN_LIMIT.windowMs)

  if (unlockAt.length) {
    return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((Math.max(...unlockAt) - Date.now()) / 1000)) }
  }
  return {
    blocked: false,
    ipLeft:    LOGIN_LIMIT.maxPerIp - byIp.length,
    emailLeft: LOGIN_LIMIT.maxPerEmail - byEmail.length,
  }
}

export async function recordLoginFailure(ip: string, email: string) {
  await prisma.login_failures.create({ data: { ip, email } })
}

/** Login berhasil membuktikan pemilik akun: hapus catatan gagal untuk email itu. */
export async function clearLoginFailures(email: string) {
  await prisma.login_failures.deleteMany({ where: { email } })
}

export interface FailureGroup {
  key: string           // email atau IP
  count: number         // percobaan gagal dalam jendela
  limit: number         // batas untuk jenis ini
  last_at: Date
  blocked: boolean
  unlock_at: Date | null
}

const LIST_LIMIT = 50

/** Kelompokkan percobaan gagal dalam jendela per IP dan per email (halaman Kelola Akun). */
export async function listLoginFailures(): Promise<{ ips: FailureGroup[]; emails: FailureGroup[] }> {
  const since = new Date(Date.now() - LOGIN_LIMIT.windowMs)
  const where = { created_at: { gte: since } }
  const [byIp, byEmail] = await Promise.all([
    prisma.login_failures.groupBy({ by: ['ip'], where, _count: { _all: true }, _max: { created_at: true },
      orderBy: { _count: { ip: 'desc' } }, take: LIST_LIMIT }),
    prisma.login_failures.groupBy({ by: ['email'], where, _count: { _all: true }, _max: { created_at: true },
      orderBy: { _count: { email: 'desc' } }, take: LIST_LIMIT }),
  ])

  // Waktu buka kunci sama dengan checkLoginLimit: percobaan ke-N terbaru + panjang jendela
  async function group(field: 'ip' | 'email', key: string, count: number, last: Date, limit: number): Promise<FailureGroup> {
    let unlock_at: Date | null = null
    if (count >= limit) {
      const nth = await prisma.login_failures.findFirst({
        where: { [field]: key, ...where },
        orderBy: { created_at: 'desc' },
        skip: limit - 1,
        select: { created_at: true },
      })
      if (nth) unlock_at = new Date(nth.created_at.getTime() + LOGIN_LIMIT.windowMs)
    }
    return { key, count, limit, last_at: last, blocked: unlock_at !== null && unlock_at > new Date(), unlock_at }
  }

  const [ips, emails] = await Promise.all([
    Promise.all(byIp.map(g => group('ip', g.ip, g._count._all, g._max.created_at!, LOGIN_LIMIT.maxPerIp))),
    Promise.all(byEmail.map(g => group('email', g.email, g._count._all, g._max.created_at!, LOGIN_LIMIT.maxPerEmail))),
  ])
  return { ips, emails }
}

/** Buka blokir: hapus semua catatan gagal untuk satu IP atau satu email. */
export async function clearLoginFailuresFor(field: 'ip' | 'email', key: string): Promise<number> {
  const { count } = await prisma.login_failures.deleteMany({ where: field === 'ip' ? { ip: key } : { email: key } })
  return count
}

/** Dipanggil cron harian: buang catatan yang sudah tidak relevan. */
export async function purgeOldLoginFailures(): Promise<number> {
  const { count } = await prisma.login_failures.deleteMany({
    where: { created_at: { lt: new Date(Date.now() - LOGIN_LIMIT.keepFailuresMs) } },
  })
  return count
}
