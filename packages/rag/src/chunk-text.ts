export function chunkText(text: string, input: { maxChars?: number; overlapChars?: number } = {}): string[] {
  const maxChars = input.maxChars ?? 900
  const overlapChars = input.overlapChars ?? 120
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  if (normalized.length === 0) return []

  const chunks: string[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    const end = Math.min(cursor + maxChars, normalized.length)
    const boundary = findBoundary(normalized, cursor, end)
    chunks.push(normalized.slice(cursor, boundary).trim())
    if (boundary >= normalized.length) break
    cursor = Math.max(boundary - overlapChars, cursor + 1)
  }
  return chunks.filter(Boolean)
}

function findBoundary(text: string, start: number, end: number): number {
  if (end >= text.length) return text.length
  const slice = text.slice(start, end)
  const paragraph = slice.lastIndexOf('\n\n')
  if (paragraph > 120) return start + paragraph
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('\n'))
  return sentence > 120 ? start + sentence + 1 : end
}
