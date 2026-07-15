import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { ApiError } from '../errors'
import { LocalPdfTextExtractor } from './local-pdf-extractor'

describe('LocalPdfTextExtractor', () => {
  it('extracts PDF text through an injected pdftotext-compatible runner', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7 romeo fixture')
    const extractor = new LocalPdfTextExtractor({
      commandPath: '/usr/local/bin/pdftotext',
      runner: async (file, args, options) => {
        const inputPath = args.at(-2)
        expect(file).toBe('/usr/local/bin/pdftotext')
        expect(args.slice(0, 2)).toEqual(['-layout', '-nopgbrk'])
        expect(args.at(-1)).toBe('-')
        expect(options.cwd).toContain('romeo-pdf-')
        expect(options.timeoutMs).toBe(15_000)
        expect(new TextDecoder().decode(await readFile(inputPath!))).toBe('%PDF-1.7 romeo fixture')
        return { stdout: 'Romeo PDF text\\n\\n  Retention appendix ', stderr: '' }
      }
    })

    const result = await extractor.extract({ bytes, fileName: 'policy.pdf', mimeType: 'application/pdf' })

    expect(result.content).toContain('Romeo PDF text')
    expect(result.content).toContain('Retention appendix')
    expect(result.metadata).toEqual({ extractor: 'pdftotext', mimeType: 'application/pdf' })
  })

  it('rejects oversized PDF input before invoking the runner', async () => {
    let invoked = false
    const extractor = new LocalPdfTextExtractor({
      maxBytes: 2,
      runner: async () => {
        invoked = true
        return { stdout: 'unused', stderr: '' }
      }
    })

    await expect(extractor.extract({ bytes: new TextEncoder().encode('%PDF-1'), fileName: 'large.pdf', mimeType: 'application/pdf' })).rejects.toMatchObject({
      code: 'extraction_input_too_large'
    })
    expect(invoked).toBe(false)
  })

  it('rejects malformed PDF bytes before invoking the runner', async () => {
    let invoked = false
    const extractor = new LocalPdfTextExtractor({
      runner: async () => {
        invoked = true
        return { stdout: 'unused', stderr: '' }
      }
    })

    await expect(extractor.extract({ bytes: new Uint8Array([1, 2, 3]), fileName: 'bad.pdf', mimeType: 'application/pdf' })).rejects.toMatchObject({
      code: 'invalid_pdf_header'
    })
    expect(invoked).toBe(false)
  })

  it('returns stable API errors for empty extraction output', async () => {
    const extractor = new LocalPdfTextExtractor({
      runner: async () => ({ stdout: '   ', stderr: '' })
    })

    const bytes = new TextEncoder().encode('%PDF-1.7')
    await expect(extractor.extract({ bytes, fileName: 'empty.pdf', mimeType: 'application/pdf' })).rejects.toBeInstanceOf(ApiError)
    await expect(extractor.extract({ bytes, fileName: 'empty.pdf', mimeType: 'application/pdf' })).rejects.toMatchObject({
      code: 'empty_extraction'
    })
  })
})
