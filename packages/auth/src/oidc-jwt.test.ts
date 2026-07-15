import { describe, expect, it } from 'vitest'

import { verifyOidcJwt } from './oidc-jwt'

describe('OIDC JWT verification', () => {
  it('verifies RS256 tokens and returns claims', async () => {
    const keys = await createRsaKeyPair('kid_1')
    const token = await signJwt(keys.privateKey, { alg: 'RS256', kid: 'kid_1', typ: 'JWT' }, validClaims())

    const claims = await verifyOidcJwt(token, {
      issuer: 'https://idp.example.com/realms/romeo',
      audience: 'romeo',
      jwks: [keys.publicJwk],
      now: new Date('2026-06-27T12:00:00.000Z')
    })

    expect(claims.sub).toBe('oidc-user-1')
    expect(claims.aud).toEqual(['romeo', 'account'])
  })

  it('rejects wrong audiences and expired tokens', async () => {
    const keys = await createRsaKeyPair('kid_1')
    const wrongAudience = await signJwt(keys.privateKey, { alg: 'RS256', kid: 'kid_1' }, { ...validClaims(), aud: 'other-client' })
    const expired = await signJwt(keys.privateKey, { alg: 'RS256', kid: 'kid_1' }, { ...validClaims(), exp: 100 })

    await expect(
      verifyOidcJwt(wrongAudience, {
        issuer: 'https://idp.example.com/realms/romeo',
        audience: 'romeo',
        jwks: [keys.publicJwk],
        now: new Date('2026-06-27T12:00:00.000Z')
      })
    ).rejects.toThrow('audience')
    await expect(
      verifyOidcJwt(expired, {
        issuer: 'https://idp.example.com/realms/romeo',
        audience: 'romeo',
        jwks: [keys.publicJwk],
        now: new Date('2026-06-27T12:00:00.000Z')
      })
    ).rejects.toThrow('expired')
  })
})

function validClaims() {
  return {
    iss: 'https://idp.example.com/realms/romeo',
    sub: 'oidc-user-1',
    aud: ['romeo', 'account'],
    exp: 1_782_562_400,
    iat: 1_782_558_800,
    groups: ['/romeo/users']
  }
}

async function createRsaKeyPair(kid: string): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey & { kid?: string }
  publicJwk.kid = kid
  publicJwk.alg = 'RS256'
  publicJwk.use = 'sig'
  return { privateKey: pair.privateKey, publicJwk }
}

async function signJwt(privateKey: CryptoKey, header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> {
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(signingInput)))
  return `${signingInput}.${base64Url(signature)}`
}

function base64UrlJson(value: Record<string, unknown>): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)))
}

function base64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}
