import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { generatePassword, hashPassword } from '@/lib/password'
import { isUuid, parseUserInput } from '@/lib/validation'
import { USER_SELECT } from '@/lib/users'

/**
 * Ubah akun lain: nama, aktif/nonaktif, atau reset password (password acak baru, dikembalikan sekali).
 * Akun tidak bisa dihapus dari UI — menghapus user ikut menghapus alat yang ia daftarkan beserta semua lognya.
 * Menonaktifkan dan reset password menaikkan session_version, jadi semua sesi akun itu langsung berakhir.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser(req, ['pengelola'])
  if (actor instanceof NextResponse) return actor

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'id akun harus UUID' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON valid' }, { status: 400 })
  }

  const parsed = parseUserInput(body, true)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Validasi gagal', details: parsed.details }, { status: 400 })
  }
  const { full_name, is_active, reset_password } = parsed.data

  // Akun sendiri: nama boleh diubah, tapi nonaktif/reset harus lewat akun lain (atau Ganti password)
  if (id === actor.id && is_active === false) {
    return NextResponse.json({ error: 'Tidak bisa menonaktifkan akun sendiri' }, { status: 400 })
  }
  if (id === actor.id && reset_password) {
    return NextResponse.json({ error: 'Untuk akun sendiri, pakai Ganti password' }, { status: 400 })
  }

  const password = reset_password ? generatePassword() : null
  const endSessions = reset_password || is_active === false

  try {
    // Serializable: dua pengelola yang saling menonaktifkan bersamaan tidak boleh menyisakan nol akun aktif.
    // Salah satu transaksi akan gagal (P2034) dan diminta mencoba lagi.
    const user = await prisma.$transaction(async tx => {
      const me = await tx.users.findUnique({ where: { id: actor.id }, select: { is_active: true } })
      if (!me?.is_active) throw new ActorInactive()
      return tx.users.update({
        where: { id },
        data: {
          ...(full_name !== undefined && { full_name }),
          ...(is_active !== undefined && { is_active }),
          ...(password && { password_hash: hashPassword(password) }),
          ...(endSessions && { session_version: { increment: 1 } }),
        },
        select: USER_SELECT,
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    return NextResponse.json({ user, ...(password && { password }) })
  } catch (err) {
    if (err instanceof ActorInactive) {
      return NextResponse.json({ error: 'Akun Anda baru saja dinonaktifkan' }, { status: 403 })
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return NextResponse.json({ error: 'Akun tidak ditemukan', user_id: id }, { status: 404 })
      if (err.code === 'P2034') return NextResponse.json({ error: 'Akun sedang diubah pengelola lain. Coba lagi.' }, { status: 409 })
    }
    console.error('[admin/users PATCH]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

class ActorInactive extends Error {}
