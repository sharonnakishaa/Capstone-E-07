import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

// Format hash: scrypt$<salt hex>$<hash hex 64 byte>. Tanpa dependency tambahan.
const KEY_LEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `scrypt$${salt}$${scryptSync(password, salt, KEY_LEN).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'hex')
  const actual   = scryptSync(password, salt, expected.length || KEY_LEN)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Password acak yang mudah diketik (tanpa karakter mirip seperti 0/O, 1/l). */
export function generatePassword(length = 14): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(length)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}
