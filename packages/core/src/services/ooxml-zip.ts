import { inflateRawSync } from 'node:zlib'

import { ApiError } from '../errors'

export interface OoxmlZipOptions {
  maxBytes: number
  maxEntries: number
  maxEntryBytes: number
}

export interface OoxmlZipEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
  read(): Uint8Array
}

interface CentralDirectoryEntry {
  compressedSize: number
  compressionMethod: number
  flags: number
  localHeaderOffset: number
  name: string
  uncompressedSize: number
}

const eocdSignature = 0x06054b50
const centralDirectorySignature = 0x02014b50
const localFileHeaderSignature = 0x04034b50
const maxZipCommentBytes = 65_535
const zip64Sentinel = 0xffffffff

export function readOoxmlZipEntries(bytes: Uint8Array, options: OoxmlZipOptions): Map<string, OoxmlZipEntry> {
  if (bytes.byteLength > options.maxBytes) {
    throw new ApiError('extraction_input_too_large', 'Knowledge source is too large for Office extraction.', 413, {
      maxBytes: options.maxBytes,
      sizeBytes: bytes.byteLength
    })
  }

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (buffer.readUInt16LE(eocdOffset + 4) !== 0 || buffer.readUInt16LE(eocdOffset + 6) !== 0) {
    throw new ApiError('unsupported_archive', 'Split ZIP archives are not supported for Office extraction.', 415)
  }
  if (entryCount > options.maxEntries) {
    throw new ApiError('archive_entry_limit_exceeded', 'Office document contains too many ZIP entries.', 413, { maxEntries: options.maxEntries })
  }
  if (centralDirectoryOffset + centralDirectorySize > buffer.byteLength) {
    throw new ApiError('invalid_archive', 'Office document ZIP central directory is invalid.', 422)
  }

  const entries = new Map<string, OoxmlZipEntry>()
  let offset = centralDirectoryOffset
  for (let index = 0; index < entryCount; index += 1) {
    const entry = readCentralDirectoryEntry(buffer, offset)
    offset = entry.nextOffset
    if (!isSafeZipPath(entry.name)) throw new ApiError('unsafe_archive_path', 'Office document contains an unsafe ZIP entry path.', 422)
    if (entry.uncompressedSize > options.maxEntryBytes) {
      throw new ApiError('archive_entry_too_large', 'Office document ZIP entry is too large for extraction.', 413, {
        entryName: entry.name,
        maxEntryBytes: options.maxEntryBytes
      })
    }
    entries.set(entry.name, createZipEntry(buffer, entry, options))
  }

  return entries
}

function readCentralDirectoryEntry(buffer: Buffer, offset: number): CentralDirectoryEntry & { nextOffset: number } {
  if (offset + 46 > buffer.byteLength || buffer.readUInt32LE(offset) !== centralDirectorySignature) {
    throw new ApiError('invalid_archive', 'Office document ZIP central directory entry is invalid.', 422)
  }
  const flags = buffer.readUInt16LE(offset + 8)
  const compressionMethod = buffer.readUInt16LE(offset + 10)
  const compressedSize = buffer.readUInt32LE(offset + 20)
  const uncompressedSize = buffer.readUInt32LE(offset + 24)
  const fileNameLength = buffer.readUInt16LE(offset + 28)
  const extraLength = buffer.readUInt16LE(offset + 30)
  const commentLength = buffer.readUInt16LE(offset + 32)
  const localHeaderOffset = buffer.readUInt32LE(offset + 42)
  const nameStart = offset + 46
  const nameEnd = nameStart + fileNameLength
  const nextOffset = nameEnd + extraLength + commentLength
  if (nextOffset > buffer.byteLength) throw new ApiError('invalid_archive', 'Office document ZIP entry extends past the archive.', 422)
  if ((flags & 1) === 1) throw new ApiError('encrypted_archive', 'Encrypted Office documents are not supported for extraction.', 415)
  if (compressedSize === zip64Sentinel || uncompressedSize === zip64Sentinel || localHeaderOffset === zip64Sentinel) {
    throw new ApiError('unsupported_archive', 'ZIP64 Office documents are not supported for extraction.', 415)
  }
  if (compressionMethod !== 0 && compressionMethod !== 8) {
    throw new ApiError('unsupported_archive_compression', 'Office document ZIP compression method is not supported.', 415, { compressionMethod })
  }

  return {
    compressedSize,
    compressionMethod,
    flags,
    localHeaderOffset,
    name: buffer.toString('utf8', nameStart, nameEnd),
    nextOffset,
    uncompressedSize
  }
}

function createZipEntry(buffer: Buffer, entry: CentralDirectoryEntry, options: OoxmlZipOptions): OoxmlZipEntry {
  return {
    name: entry.name,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    read() {
      const compressed = readCompressedEntry(buffer, entry)
      const inflated = entry.compressionMethod === 0 ? compressed : inflateRawSync(compressed)
      if (inflated.byteLength !== entry.uncompressedSize) {
        throw new ApiError('invalid_archive', 'Office document ZIP entry size did not match its central directory.', 422, { entryName: entry.name })
      }
      if (inflated.byteLength > options.maxEntryBytes) {
        throw new ApiError('archive_entry_too_large', 'Office document ZIP entry is too large for extraction.', 413, {
          entryName: entry.name,
          maxEntryBytes: options.maxEntryBytes
        })
      }
      return inflated
    }
  }
}

function readCompressedEntry(buffer: Buffer, entry: CentralDirectoryEntry): Buffer {
  const offset = entry.localHeaderOffset
  if (offset + 30 > buffer.byteLength || buffer.readUInt32LE(offset) !== localFileHeaderSignature) {
    throw new ApiError('invalid_archive', 'Office document ZIP local file header is invalid.', 422, { entryName: entry.name })
  }
  const fileNameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + fileNameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > buffer.byteLength) throw new ApiError('invalid_archive', 'Office document ZIP entry extends past the archive.', 422, { entryName: entry.name })
  return buffer.subarray(dataStart, dataEnd)
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowerBound = Math.max(0, buffer.byteLength - maxZipCommentBytes - 22)
  for (let offset = buffer.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) return offset
  }
  throw new ApiError('invalid_archive', 'Office document ZIP end-of-central-directory record was not found.', 422)
}

function isSafeZipPath(name: string): boolean {
  if (name.length === 0 || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name)) return false
  return !name.split('/').some((part) => part === '..')
}
