import type { ExtractedKnowledgeText } from '@romeo/rag'

import { ApiError } from '../errors'
import type { KnowledgeBinaryExtractor } from './knowledge-extraction-worker'
import { LocalOoxmlTextExtractor, type LocalOoxmlTextExtractorOptions } from './local-ooxml-extractor'
import { LocalPdfTextExtractor, type LocalPdfTextExtractorOptions } from './local-pdf-extractor'

export interface LocalDocumentTextExtractorOptions {
  ooxml?: LocalOoxmlTextExtractorOptions
  pdf?: LocalPdfTextExtractorOptions
}

const pdfMimeType = 'application/pdf'
const ooxmlMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])

export class LocalDocumentTextExtractor implements KnowledgeBinaryExtractor {
  private readonly ooxml: LocalOoxmlTextExtractor
  private readonly pdf: LocalPdfTextExtractor

  constructor(options: LocalDocumentTextExtractorOptions = {}) {
    this.ooxml = new LocalOoxmlTextExtractor(options.ooxml)
    this.pdf = new LocalPdfTextExtractor(options.pdf)
  }

  extract(input: { bytes: Uint8Array; fileName: string; mimeType: string }): Promise<ExtractedKnowledgeText> {
    const mimeType = normalizeMimeType(input.mimeType)
    if (mimeType === pdfMimeType) return this.pdf.extract({ ...input, mimeType })
    if (ooxmlMimeTypes.has(mimeType)) return this.ooxml.extract({ ...input, mimeType })
    throw new ApiError('unsupported_media_type', 'Local document extraction only supports PDF and Office document sources.', 415, { mimeType })
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}
