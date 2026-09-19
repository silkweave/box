// Signing keys belong to the local configuration and are generated on first use.
import { randomBytes } from 'node:crypto'
import { boxJson } from '../box-config.js'
import { configRoot } from '../io.js'
import { writeBoxLocal } from '../box-json.js'

export type SecretName = 'AUTH_SESSION_SECRET' | 'AUTH_TOKEN_SECRET'
const PLACEHOLDERS = new Set(['CHANGE_ME', 'change-me-to-a-long-random-string', 'changeme', 'secret'])

export function authSecret(name: SecretName): string {
  const key = name === 'AUTH_SESSION_SECRET' ? 'sessionSecret' : 'tokenSecret'
  const configured = boxJson().auth[key]
  if (configured) {
    if (PLACEHOLDERS.has(configured) || configured.length < 32) {
      throw new Error(`auth.${key} must be a non-placeholder secret of at least 32 characters`)
    }
    return configured
  }
  const value = randomBytes(32).toString('base64url')
  writeBoxLocal(configRoot(), { auth: { [key]: value } })
  return value
}
