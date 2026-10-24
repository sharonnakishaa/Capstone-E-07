import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import type { SessionUser } from './auth'

// Riwayat aksi pengelola, disimpan di database karena log runtime Vercel Hobby cepat hilang.
export type ActivityAction =
  | 'user.create' | 'user.rename' | 'user.activate' | 'user.deactivate' | 'user.reset_password'
  | 'user.change_password'
  | 'device.create' | 'device.update' | 'device.activate' | 'device.deactivate' | 'device.delete'
  | 'device.ignore_mac' | 'device.filter_replaced'
  | 'logs.delete'
  | 'login.unblock'

/**
 * Catat satu aksi. Tidak pernah melempar error: aksinya sendiri sudah berhasil,
 * jadi gagal mencatat riwayat cukup ditulis ke log server, bukan membatalkan respons.
 */
export async function logActivity(
  actor: Pick<SessionUser, 'id' | 'email' | 'full_name'>,
  action: ActivityAction,
  target: string | null,
  detail?: Prisma.InputJsonObject,
) {
  try {
    await prisma.activity_logs.create({
      data: { actor_id: actor.id, actor_email: actor.email, actor_name: actor.full_name, action, target, detail },
    })
  } catch (err) {
    console.error('[activity] gagal mencatat', action, target, err)
  }
}
