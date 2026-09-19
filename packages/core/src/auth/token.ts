// Access-token crypto for every principal (internal users + external collaborators). The token is the
// bearer credential; it is stored ENCRYPTED AT REST (reversible) rather than one-way hashed - the
// admin must be able to re-copy a manual invite link (no email transport yet). See
// docs/AUTH.md. Shared by the auth layer (login) and admin token issuance.

import { authSecret } from './secrets.js'
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGO = 'aes-256-gcm'

/** Derive a stable 32-byte key from AUTH_TOKEN_SECRET - env, else this Box's generated secrets file
 *  (auth/secrets.ts, which also refuses placeholders and short values). The legacy PODS_TOKEN_SECRET
 *  fallback went on 2026-09-13 with its session counterpart. Rotating this makes every stored token
 *  unreadable, which is why it is generated once and kept. */
function key(): Buffer {
  return createHash('sha256').update(authSecret('AUTH_TOKEN_SECRET')).digest()
}

/** A fresh URL-safe access token (192 bits of entropy). */
export function generateAccessToken(): string {
  return randomBytes(24).toString('base64url')
}

/** Encrypt a token → `iv.tag.ciphertext` (all base64url). */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.')
}

/** Decrypt a stored ciphertext back to the plaintext token (throws if tampered / wrong key). */
export function decryptToken(stored: string): string {
  const [ivB64, tagB64, ctB64] = stored.split('.')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed token ciphertext')
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8')
}

/** Constant-time compare a presented token against a stored ciphertext. */
export function tokenMatches(presented: string, stored: string | null): boolean {
  if (!stored) return false
  let actual: string
  try {
    actual = decryptToken(stored)
  } catch {
    return false
  }
  const a = Buffer.from(presented)
  const b = Buffer.from(actual)
  return a.length === b.length && timingSafeEqual(a, b)
}
