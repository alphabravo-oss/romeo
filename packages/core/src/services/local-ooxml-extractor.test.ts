import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import { LocalOoxmlTextExtractor } from './local-ooxml-extractor'

const docxMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const pptxMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('LocalOoxmlTextExtractor', () => {
  it('extracts DOCX document text from bounded OOXML parts', async () => {
    const extractor = new LocalOoxmlTextExtractor()
    const bytes = createZip([
      {
        name: 'word/document.xml',
        content:
          '<w:document><w:body><w:p><w:r><w:t>Romeo retention &amp; audit controls.</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p></w:body></w:document>'
      },
      { name: 'word/_rels/document.xml.rels', content: '<Relationships />' }
    ])

    const result = await extractor.extract({ bytes, fileName: 'policy.docx', mimeType: docxMimeType })

    expect(result.content).toContain('Romeo retention & audit controls.')
    expect(result.content).toContain('Second paragraph.')
    expect(result.metadata).toEqual({ extractor: 'ooxml-text', mimeType: docxMimeType, officeDocumentType: 'docx', partCount: 1 })
  })

  it('extracts PPTX slide and speaker-note text in natural slide order', async () => {
    const extractor = new LocalOoxmlTextExtractor()
    const bytes = createZip([
      { name: 'ppt/slides/slide10.xml', content: '<p:sld><a:t>Final rollout checkpoint</a:t></p:sld>' },
      { name: 'ppt/slides/slide2.xml', content: '<p:sld><a:t>Phase two controls</a:t></p:sld>' },
      { name: 'ppt/notesSlides/notesSlide2.xml', content: '<p:notes><a:t>Speaker note evidence</a:t></p:notes>' }
    ])

    const result = await extractor.extract({ bytes, fileName: 'roadmap.pptx', mimeType: pptxMimeType })

    expect(result.content.indexOf('Phase two controls')).toBeLessThan(result.content.indexOf('Final rollout checkpoint'))
    expect(result.content).toContain('Speaker note evidence')
    expect(result.metadata).toMatchObject({ extractor: 'ooxml-text', officeDocumentType: 'pptx', partCount: 3 })
  })

  it('extracts XLSX shared strings, inline strings, and scalar cell values', async () => {
    const extractor = new LocalOoxmlTextExtractor()
    const bytes = createZip([
      {
        name: 'xl/sharedStrings.xml',
        content: '<sst><si><t>Security review</t></si><si><r><t>Retention</t></r><r><t> evidence</t></r></si></sst>'
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        content:
          '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Owner</t></is></c><c r="C1"><v>42</v></c><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>'
      }
    ])

    const result = await extractor.extract({ bytes, fileName: 'controls.xlsx', mimeType: xlsxMimeType })

    expect(result.content).toContain('Security review')
    expect(result.content).toContain('Retention evidence')
    expect(result.content).toContain('Owner')
    expect(result.content).toContain('42')
    expect(result.metadata).toMatchObject({ extractor: 'ooxml-text', officeDocumentType: 'xlsx', partCount: 1 })
  })

  it('rejects oversized Office XML parts before indexing content', async () => {
    const extractor = new LocalOoxmlTextExtractor({ maxEntryBytes: 10 })
    const bytes = createZip([{ name: 'word/document.xml', content: '<w:t>This part is too large.</w:t>' }])

    await expect(extractor.extract({ bytes, fileName: 'large.docx', mimeType: docxMimeType })).rejects.toMatchObject({
      code: 'archive_entry_too_large'
    })
  })

  it('rejects Office archives with too many entries', async () => {
    const extractor = new LocalOoxmlTextExtractor({ maxEntries: 1 })
    const bytes = createZip([
      { name: 'word/document.xml', content: '<w:t>Allowed part.</w:t>' },
      { name: 'word/header1.xml', content: '<w:t>Extra part.</w:t>' }
    ])

    await expect(extractor.extract({ bytes, fileName: 'many.docx', mimeType: docxMimeType })).rejects.toMatchObject({
      code: 'archive_entry_limit_exceeded'
    })
  })
})

function createZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  const localFiles: Buffer[] = []
  const centralDirectory: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const content = Buffer.from(entry.content, 'utf8')
    const compressed = deflateRawSync(content)
    localFiles.push(localHeader(name, compressed, content), compressed)
    centralDirectory.push(centralHeader(name, compressed, content, offset))
    offset += 30 + name.byteLength + compressed.byteLength
  }

  const centralDirectoryOffset = offset
  const centralDirectorySize = centralDirectory.reduce((total, item) => total + item.byteLength, 0)
  return Buffer.concat([...localFiles, ...centralDirectory, endOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset)])
}

function localHeader(name: Buffer, compressed: Buffer, content: Buffer): Buffer {
  const header = Buffer.alloc(30 + name.byteLength)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0, 6)
  header.writeUInt16LE(8, 8)
  header.writeUInt32LE(0, 14)
  header.writeUInt32LE(compressed.byteLength, 18)
  header.writeUInt32LE(content.byteLength, 22)
  header.writeUInt16LE(name.byteLength, 26)
  name.copy(header, 30)
  return header
}

function centralHeader(name: Buffer, compressed: Buffer, content: Buffer, localHeaderOffset: number): Buffer {
  const header = Buffer.alloc(46 + name.byteLength)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(8, 10)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(compressed.byteLength, 20)
  header.writeUInt32LE(content.byteLength, 24)
  header.writeUInt16LE(name.byteLength, 28)
  header.writeUInt32LE(localHeaderOffset, 42)
  name.copy(header, 46)
  return header
}

function endOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Buffer {
  const record = Buffer.alloc(22)
  record.writeUInt32LE(0x06054b50, 0)
  record.writeUInt16LE(entryCount, 8)
  record.writeUInt16LE(entryCount, 10)
  record.writeUInt32LE(centralDirectorySize, 12)
  record.writeUInt32LE(centralDirectoryOffset, 16)
  return record
}
