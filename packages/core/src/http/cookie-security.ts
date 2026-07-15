import type { Context } from 'hono'

export function shouldSecureCookie(context: Context): boolean {
  const forwardedProto = context.req.header('x-forwarded-proto')
  if (forwardedProto !== undefined) return forwardedProto.split(',')[0]?.trim() === 'https'
  return new URL(context.req.url).protocol === 'https:'
}
