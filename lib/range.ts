import type { Prisma } from '@prisma/client'

/**
 * Rentang waktu dari query `from`/`to` (ISO 8601, inklusif, boleh salah satu atau keduanya kosong).
 * Dipakai halaman log (pagination), ekspor Excel, dan hapus data, supaya ketiganya membaca rentang yang sama.
 */
export function parseRange(fromParam: string | null, toParam: string | null):
  | { ok: true; from: Date | null; to: Date | null; filter: Prisma.DateTimeFilter | undefined }
  | { ok: false; error: string } {
  const from = fromParam ? new Date(fromParam) : null
  const to   = toParam   ? new Date(toParam)   : null
  if (from && isNaN(from.getTime())) return { ok: false, error: 'from harus tanggal ISO 8601' }
  if (to   && isNaN(to.getTime()))   return { ok: false, error: 'to harus tanggal ISO 8601' }
  if (from && to && from > to)       return { ok: false, error: 'from tidak boleh setelah to' }
  const filter = from || to ? { ...(from && { gte: from }), ...(to && { lte: to }) } : undefined
  return { ok: true, from, to, filter }
}
