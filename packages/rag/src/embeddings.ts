const embeddingDimensions = 32

export function createTextEmbedding(text: string): number[] {
  const vector = Array.from({ length: embeddingDimensions }, () => 0)
  for (const token of tokenize(text)) {
    const hash = hashToken(token)
    const index = hash % embeddingDimensions
    vector[index]! += hash % 2 === 0 ? 1 : -1
  }
  return normalize(vector)
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length)
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((total, value) => total + value * value, 0))
  return magnitude === 0 ? vector : vector.map((value) => Number((value / magnitude).toFixed(6)))
}

function hashToken(token: string): number {
  let hash = 2166136261
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? []
}
