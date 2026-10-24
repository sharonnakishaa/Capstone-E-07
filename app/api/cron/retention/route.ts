import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runRetention } from '@/lib/retention'
import { purgeOldLoginFailures } from '@/lib/rate-limit'

// Ringkas + hapus data sehari biasanya hanya beberapa detik; batas ini untuk jaga-jaga
export const maxDuration = 60

/** Bandingkan secret tanpa membocorkan panjang/isi lewat waktu respons. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Retensi data harian, dipanggil Vercel Cron (lihat vercel.json).
 * Vercel mengirim header `Authorization: Bearer <CRON_SECRET>` kalau env CRON_SECRET diset.
 * `?dry_run=1` hanya menghitung tanpa mengubah database (untuk cek manual).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron/retention] CRON_SECRET belum diset — retensi tidak dijalankan')
    return NextResponse.json({ error: 'CRON_SECRET belum diset' }, { status: 500 })
  }
  if (!safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1'

  try {
    const result = await runRetention({ dryRun })
    // Sekalian bersihkan catatan login gagal yang sudah lewat (rate limit login)
    const login_failures_purged = dryRun ? 0 : await purgeOldLoginFailures()
    console.info(
      `[cron/retention] ${dryRun ? 'dry run: ' : ''}${result.row_count} log < ${result.cutoff.toISOString()} → ` +
      `${result.summarized} ringkasan, ${result.deleted} dihapus (${result.duration_ms} ms); ` +
      `${login_failures_purged} catatan login gagal dibersihkan`
    )
    return NextResponse.json({ success: true, ...result, login_failures_purged })
  } catch (err) {
    console.error('[cron/retention]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
