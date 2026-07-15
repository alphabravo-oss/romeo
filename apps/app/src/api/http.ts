export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('accept', 'application/json')
  if (init.body !== undefined) headers.set('content-type', 'application/json')

  const response = await fetch(path, { ...init, headers })
  const body = (await response.json().catch(() => undefined)) as T | { error?: { message?: string } } | undefined

  if (!response.ok) {
    if (isApiError(body)) throw new ApiClientError(body.error.code, body.error.message, response.status, body.error.details ?? {})
    throw new Error(`Romeo API request failed with ${response.status}.`)
  }

  return body as T
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown>
  ) {
    super(message)
  }
}

function isApiError(body: unknown): body is { error: { code: string; message: string; details?: Record<string, unknown> } } {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false
  const error = (body as { error?: unknown }).error
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' && typeof (error as { message?: unknown }).message === 'string'
}
