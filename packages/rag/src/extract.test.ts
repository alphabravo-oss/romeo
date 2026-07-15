import { describe, expect, it } from 'vitest'

import { canExtractKnowledgeText, extractKnowledgeText, KnowledgeExtractionError } from './extract'

describe('knowledge text extraction', () => {
  it('normalizes HTML into indexable text without scripts or tags', () => {
    const extracted = extractKnowledgeText({
      bytes: new TextEncoder().encode('<main><h1>Romeo</h1><script>ignore()</script><p>Access &amp; retention</p></main>'),
      mimeType: 'text/html; charset=utf-8'
    })

    expect(extracted.content).toBe('Romeo Access & retention')
    expect(extracted.metadata.extractor).toBe('html-text')
  })

  it('formats JSON text for indexing', () => {
    const extracted = extractKnowledgeText({
      bytes: new TextEncoder().encode('{"policy":"quota","limit":10}'),
      mimeType: 'application/json'
    })

    expect(extracted.content).toContain('"policy": "quota"')
    expect(extracted.metadata.extractor).toBe('json')
  })

  it('rejects unsupported binary formats in the synchronous extractor', () => {
    expect(canExtractKnowledgeText('application/pdf')).toBe(false)
    expect(() => extractKnowledgeText({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })).toThrow(KnowledgeExtractionError)
  })
})
