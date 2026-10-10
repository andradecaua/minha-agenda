#!/usr/bin/env node
/**
 * Gera um par VAPID (P-256) pra Web Push.
 *
 * Uso:
 *   node scripts/generate-vapid.mjs
 *
 * - PUBLIC vai pro frontend (`VITE_VAPID_PUBLIC_KEY` em `.env.local`)
 *   em formato base64url do ponto não comprimido (65 bytes: 0x04 || x || y).
 * - PRIVATE é segredo — colocar nos secrets da Edge Function
 *   (`VAPID_PRIVATE_KEY` no Supabase, junto com `VAPID_SUBJECT=mailto:...`).
 * - NUNCA commitar a privada.
 *
 * Zero deps: usa `node:crypto` (Node 18+).
 */
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
})

const pubJwk = publicKey.export({ format: 'jwk' })
const privJwk = privateKey.export({ format: 'jwk' })

if (!pubJwk.x || !pubJwk.y || !privJwk.d) {
  throw new Error('JWK incompleta — falha ao gerar par')
}

const x = Buffer.from(pubJwk.x, 'base64url')
const y = Buffer.from(pubJwk.y, 'base64url')
const rawPub = Buffer.concat([Buffer.from([0x04]), x, y])

const vapidPublic = rawPub.toString('base64url')
const vapidPrivate = privJwk.d

console.log('VAPID_PUBLIC_KEY=' + vapidPublic)
console.log('VAPID_PRIVATE_KEY=' + vapidPrivate)
console.log('')
console.log('Próximos passos:')
console.log('  1. .env.local:')
console.log('       VITE_VAPID_PUBLIC_KEY=' + vapidPublic)
console.log('  2. Supabase > Edge Functions > Secrets:')
console.log('       VAPID_PUBLIC_KEY=' + vapidPublic)
console.log('       VAPID_PRIVATE_KEY=' + vapidPrivate)
console.log('       VAPID_SUBJECT=mailto:suporte@seudominio.com')
console.log('  (A pública aparece nos dois lados; a privada SÓ no servidor.)')
