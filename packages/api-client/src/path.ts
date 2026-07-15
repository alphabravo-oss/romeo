export function pathId(value: string): string {
  return encodeURIComponent(value)
}

export function withQuery(path: string, params: Record<string, boolean | number | string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }

  const query = search.toString()
  return query.length > 0 ? `${path}?${query}` : path
}
