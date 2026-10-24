import type { Prisma } from '@prisma/client'

/** Kolom akun yang boleh dikirim ke halaman Kelola Akun (tanpa hash password & versi sesi). */
export const USER_SELECT = {
  id: true, email: true, full_name: true, role: true, is_active: true, last_login: true, created_at: true,
} satisfies Prisma.usersSelect
