import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

/** User yang sedang login, atau { user: null }. Dipakai frontend untuk menampilkan tombol masuk/keluar. */
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ user: await getSessionUser(req) })
  } catch (err) {
    console.error('[auth/me]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
