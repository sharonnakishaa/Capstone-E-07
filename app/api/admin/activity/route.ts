import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth'

const PAGE_SIZE = 30

/**
 * Riwayat aktivitas pengelola, terbaru dulu. Paginasi kursor: ?before=<id> dari `next_before`
 * respons sebelumnya (stabil walau ada aktivitas baru masuk di antara dua klik "Muat lebih banyak").
 */
export async function GET(req: NextRequest) {
  const user = await requireUser(req, ['pengelola'])
  if (user instanceof NextResponse) return user

  const before = new URL(req.url).searchParams.get('before')
  if (before !== null && !/^\d+$/.test(before)) {
    return NextResponse.json({ error: 'before harus id angka' }, { status: 400 })
  }

  try {
    const rows = await prisma.activity_logs.findMany({
      where: before ? { id: { lt: BigInt(before) } } : undefined,
      orderBy: { id: 'desc' },
      take: PAGE_SIZE + 1,
    })
    const page = rows.slice(0, PAGE_SIZE)
    return NextResponse.json({
      data: page.map(r => ({ ...r, id: r.id.toString() })),
      next_before: rows.length > PAGE_SIZE ? page[page.length - 1].id.toString() : null,
    })
  } catch (err) {
    console.error('[admin/activity]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
