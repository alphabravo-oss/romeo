import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ExtractedKnowledgeText } from '@romeo/rag'

import { ApiError } from '../errors'
import type { KnowledgeBinaryExtractor } from './knowledge-extraction-worker'

export interface CommandResult {
  stderr: string
  stdout: string
}

export type CommandRunner = (file: string, args: string[], options: { cwd: string; maxBuffer: number; timeoutMs: number }) => Promise<CommandResult>

export interface LocalPdfTextExtractorOptions {
  commandPath?: string
  maxBytes?: number
  runner?: CommandRunner
  timeoutMs?: number
}

const defaultMaxBytes = 20_000_000
const defaultTimeoutMs = 15_000

export class LocalPdfTextExtractor implements KnowledgeBinaryExtractor {
  constructor(private readonly options: LocalPdfTextExtractorOptions = {}) {}

  async extract(input: { bytes: Uint8Array; fileName: string; mimeType: string }): Promise<ExtractedKnowledgeText> {
    const mimeType = normalizeMimeType(input.mimeType)
    if (mimeType !== 'application/pdf') {
      throw new ApiError('unsupported_media_type', 'Local PDF extraction only supports application/pdf sources.', 415, { mimeType })
    }
    if (!hasPdfHeader(input.bytes)) {
      throw new ApiError('invalid_pdf_header', 'PDF source does not start with a valid PDF header.', 422)
    }

    const maxBytes = this.options.maxBytes ?? defaultMaxBytes
    if (input.bytes.byteLength > maxBytes) {
      throw new ApiError('extraction_input_too_large', 'Knowledge source is too large for local PDF extraction.', 413, {
        maxBytes,
        sizeBytes: input.bytes.byteLength
      })
    }

    const directory = await mkdtemp(join(tmpdir(), 'romeo-pdf-'))
    const pdfPath = join(directory, 'source.pdf')
    try {
      await writeFile(pdfPath, input.bytes)
      const runner = this.options.runner ?? runCommand
      const result = await runner(this.options.commandPath ?? 'pdftotext', ['-layout', '-nopgbrk', pdfPath, '-'], {
        cwd: directory,
        maxBuffer: Math.max(1_000_000, maxBytes * 2),
        timeoutMs: this.options.timeoutMs ?? defaultTimeoutMs
      })
      return {
        content: requireContent(normalizeWhitespace(result.stdout)),
        metadata: { extractor: 'pdftotext', mimeType }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError('pdf_extraction_failed', 'PDF text extraction failed.', 422, { reason: errorName(error) })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}

function runCommand(file: string, args: string[], options: { cwd: string; maxBuffer: number; timeoutMs: number }): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        encoding: 'utf8',
        env: minimalCommandEnv(),
        maxBuffer: options.maxBuffer,
        timeout: options.timeoutMs,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
}

function minimalCommandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['LANG', 'LC_ALL', 'PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'WINDIR']) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function requireContent(content: string): string {
  if (content.length === 0) throw new ApiError('empty_extraction', 'PDF text extraction produced no indexable text.', 422)
  return content
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'unknown_error'
}
