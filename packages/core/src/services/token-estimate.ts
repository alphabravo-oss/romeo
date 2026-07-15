// Single owner for token estimation: the number that gates the context budget must be the
// number that bills, otherwise a mis-estimate silently under-reports usage.
export function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return Math.max(1, Math.ceil(trimmed.length / 4))
}
