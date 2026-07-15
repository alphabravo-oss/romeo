const defaultMaxExtractionBytes = 1_000_000
const structuredTextMimeTypes = new Set(['application/json', 'application/x-ndjson'])

export interface ExtractKnowledgeTextInput {
  bytes: Uint8Array
  fileName?: string
  maxBytes?: number
  mimeType: string
}

export interface ExtractedKnowledgeText {
  content: string
  metadata: Record<string, unknown>
}

export class KnowledgeExtractionError extends Error {
  constructor(
    readonly code: 'unsupported_media_type' | 'extraction_input_too_large' | 'unsupported_encoding' | 'invalid_json' | 'empty_extraction',
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

export function canExtractKnowledgeText(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType)
  return normalized.startsWith('text/') || structuredTextMimeTypes.has(normalized)
}

export function extractKnowledgeText(input: ExtractKnowledgeTextInput): ExtractedKnowledgeText {
  const mimeType = normalizeMimeType(input.mimeType)
  const maxBytes = input.maxBytes ?? defaultMaxExtractionBytes
  if (!canExtractKnowledgeText(mimeType)) {
    throw new KnowledgeExtractionError('unsupported_media_type', 'Knowledge extraction is only available for supported textual formats.', { mimeType })
  }
  if (input.bytes.byteLength > maxBytes) {
    throw new KnowledgeExtractionError('extraction_input_too_large', 'Knowledge source is too large for synchronous text extraction.', {
      maxBytes,
      sizeBytes: input.bytes.byteLength
    })
  }

  const decoded = decodeUtf8(input.bytes)
  if (mimeType === 'application/json') return normalizeJson(decoded, mimeType)
  if (mimeType === 'application/x-ndjson') return normalizeNdjson(decoded, mimeType)
  if (mimeType === 'text/html') return normalizeHtml(decoded, mimeType)
  return normalizePlainText(decoded, mimeType)
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new KnowledgeExtractionError('unsupported_encoding', 'Knowledge source text must be UTF-8 encoded.')
  }
}

function normalizeJson(text: string, mimeType: string): ExtractedKnowledgeText {
  try {
    return {
      content: requireContent(JSON.stringify(JSON.parse(text), null, 2)),
      metadata: { extractor: 'json', mimeType }
    }
  } catch {
    throw new KnowledgeExtractionError('invalid_json', 'JSON knowledge source could not be parsed.', { mimeType })
  }
}

function normalizeNdjson(text: string, mimeType: string): ExtractedKnowledgeText {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  try {
    return {
      content: requireContent(lines.map((line) => JSON.stringify(JSON.parse(line), null, 2)).join('\n')),
      metadata: { extractor: 'ndjson', mimeType }
    }
  } catch {
    throw new KnowledgeExtractionError('invalid_json', 'NDJSON knowledge source could not be parsed.', { mimeType })
  }
}

function normalizeHtml(text: string, mimeType: string): ExtractedKnowledgeText {
  const stripped = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
  return {
    content: requireContent(normalizeWhitespace(stripped)),
    metadata: { extractor: 'html-text', mimeType }
  }
}

function normalizePlainText(text: string, mimeType: string): ExtractedKnowledgeText {
  return {
    content: requireContent(normalizeWhitespace(text)),
    metadata: { extractor: 'plain-text', mimeType }
  }
}

function requireContent(text: string): string {
  const content = text.trim()
  if (content.length === 0) throw new KnowledgeExtractionError('empty_extraction', 'Knowledge extraction produced no indexable text.')
  return content
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}
