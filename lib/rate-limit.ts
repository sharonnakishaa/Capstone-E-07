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

/** Dipanggil cron harian: buang catatan yang sudah tidak relevan. */
export async function purgeOldLoginFailures(): Promise<number> {
  const { count } = await prisma.login_failures.deleteMany({
    where: { created_at: { lt: new Date(Date.now() - LOGIN_LIMIT.keepFailuresMs) } },
  })
  return count
}
