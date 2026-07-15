import type { ExtractedKnowledgeText } from '@romeo/rag'

import { ApiError } from '../errors'
import type { KnowledgeBinaryExtractor } from './knowledge-extraction-worker'
import { readOoxmlZipEntries, type OoxmlZipEntry } from './ooxml-zip'

export interface LocalOoxmlTextExtractorOptions {
  maxBytes?: number
  maxEntries?: number
  maxEntryBytes?: number
  maxTextChars?: number
}

type OoxmlKind = 'docx' | 'pptx' | 'xlsx'

const defaultMaxBytes = 20_000_000
const defaultMaxEntries = 512
const defaultMaxEntryBytes = 5_000_000
const defaultMaxTextChars = 1_000_000

const mimeTypes = new Map<string, OoxmlKind>([
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx']
])

export class LocalOoxmlTextExtractor implements KnowledgeBinaryExtractor {
  constructor(private readonly options: LocalOoxmlTextExtractorOptions = {}) {}

  async extract(input: { bytes: Uint8Array; fileName: string; mimeType: string }): Promise<ExtractedKnowledgeText> {
    const mimeType = normalizeMimeType(input.mimeType)
    const kind = mimeTypes.get(mimeType)
    if (kind === undefined) {
      throw new ApiError('unsupported_media_type', 'Local Office extraction only supports docx, pptx, and xlsx sources.', 415, { mimeType })
    }

    const entries = readOoxmlZipEntries(input.bytes, {
      maxBytes: this.options.maxBytes ?? defaultMaxBytes,
      maxEntries: this.options.maxEntries ?? defaultMaxEntries,
      maxEntryBytes: this.options.maxEntryBytes ?? defaultMaxEntryBytes
    })
    const parts = kind === 'docx' ? extractDocxParts(entries) : kind === 'pptx' ? extractPptxParts(entries) : extractXlsxParts(entries)
    const content = requireContent(limitText(normalizeWhitespace(parts.join('\n\n')), this.options.maxTextChars ?? defaultMaxTextChars))
    return {
      content,
      metadata: { extractor: 'ooxml-text', mimeType, officeDocumentType: kind, partCount: parts.length }
    }
  }
}

function extractDocxParts(entries: Map<string, OoxmlZipEntry>): string[] {
  return readXmlParts(
    entries,
    [...entries.keys()].filter(
      (name) =>
        name === 'word/document.xml' ||
        /^word\/(header|footer)\d*\.xml$/.test(name) ||
        name === 'word/footnotes.xml' ||
        name === 'word/endnotes.xml'
    )
  )
}

function extractPptxParts(entries: Map<string, OoxmlZipEntry>): string[] {
  const names = [...entries.keys()]
  const slides = names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((left, right) => naturalCompare(left, right))
  const notes = names.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).sort((left, right) => naturalCompare(left, right))
  return readXmlParts(entries, [...slides, ...notes])
}

function extractXlsxParts(entries: Map<string, OoxmlZipEntry>): string[] {
  const sharedStrings = readSharedStrings(entries.get('xl/sharedStrings.xml'))
  return [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((left, right) => naturalCompare(left, right))
    .map((name) => extractWorksheetText(readEntryText(entries.get(name)), sharedStrings))
    .filter((part) => part.length > 0)
}

function readXmlParts(entries: Map<string, OoxmlZipEntry>, names: string[]): string[] {
  return names.map((name) => xmlText(readEntryText(entries.get(name)))).filter((part) => part.length > 0)
}

function readSharedStrings(entry: OoxmlZipEntry | undefined): string[] {
  if (entry === undefined) return []
  const xml = readEntryText(entry)
  const strings: string[] = []
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    strings.push(xmlText(match[1] ?? ''))
  }
  return strings
}

function extractWorksheetText(xml: string, sharedStrings: string[]): string {
  const parts: string[] = []
  for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attributes = match[1] ?? ''
    const cellXml = match[2] ?? ''
    const type = readXmlAttribute(attributes, 't')
    if (type === 's') {
      const index = Number(readFirstElementText(cellXml, 'v'))
      const value = Number.isInteger(index) ? sharedStrings[index] : undefined
      if (value !== undefined && value.length > 0) parts.push(value)
    } else if (type === 'inlineStr') {
      const value = xmlText(cellXml)
      if (value.length > 0) parts.push(value)
    } else {
      const value = decodeXmlEntities(readFirstElementText(cellXml, 'v')).trim()
      if (value.length > 0) parts.push(value)
    }
  }
  return parts.join('\n')
}

function readEntryText(entry: OoxmlZipEntry | undefined): string {
  if (entry === undefined) return ''
  return new TextDecoder('utf-8', { fatal: false }).decode(entry.read())
}

function xmlText(xml: string): string {
  return decodeXmlEntities(
    xml
      .replace(/<[^>]+(?:p|tr|br|tab)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
  ).trim()
}

function readFirstElementText(xml: string, localName: string): string {
  const pattern = new RegExp(`<[^>]*:?${localName}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`, 'i')
  return pattern.exec(xml)?.[1] ?? ''
}

function readXmlAttribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1]
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function limitText(text: string, maxTextChars: number): string {
  return text.length > maxTextChars ? text.slice(0, maxTextChars) : text
}

function requireContent(content: string): string {
  if (content.length === 0) throw new ApiError('empty_extraction', 'Office document extraction produced no indexable text.', 422)
  return content
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true })
}
