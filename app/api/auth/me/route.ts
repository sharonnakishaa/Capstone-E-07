import { NextRequest, NextResponse } from 'next/server'
import { SESSION_IDLE_SEC, readSession, touchSession } from '@/lib/auth'

/**
 * User yang sedang login, atau { user: null }. Dipakai frontend untuk menampilkan tombol masuk/keluar,
 * sekaligus sebagai ping aktivitas dari auth.js: setiap panggilan memperbarui waktu aktivitas terakhir sesi.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await readSession(req)
    const res = NextResponse.json({ user: session?.user ?? null, idle_timeout_sec: SESSION_IDLE_SEC })
    if (session) touchSession(res, session.token)
    return res
  } catch (err) {
    console.error('[auth/me]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
