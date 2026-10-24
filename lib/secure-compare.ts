import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Bandingkan dua secret (API key, token) dalam waktu konstan, supaya isi secret tidak bisa
 * ditebak karakter demi karakter dari lamanya respons (timing attack).
 * Keduanya di-hash dulu ke SHA-256 agar panjangnya selalu sama — panjang secret juga tidak bocor.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}
