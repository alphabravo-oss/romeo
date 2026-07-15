import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifestPath = resolve(root, argValue('--manifest') ?? 'dist/release/release-manifest.json')
const outputPath = resolve(root, argValue('--output') ?? 'dist/release/release-channel.json')
const channel = argValue('--channel') ?? 'stable'
const generatedAt = argValue('--generated-at') ?? new Date().toISOString()
const artifactBaseUrl = trimTrailingSlash(argValue('--artifact-base-url'))
const releaseNotesUrl = argValue('--release-notes-url')
const upgradeGuideUrl = argValue('--upgrade-guide-url')
const provenanceUrl = argValue('--provenance-url')
const stdout = process.argv.includes('--stdout')

const rootPackage = readJson(join(root, 'package.json'))
const manifest = readJson(manifestPath)
const sbomPath = resolveSbomPath()
const sbom = sbomPath === undefined ? undefined : readSbom(sbomPath)
const artifacts = normalizeArtifacts(manifest.artifacts)

const release = removeUndefined({
  version: stringField(manifest.version, 'release manifest version'),
  generatedAt: stringField(manifest.generatedAt, 'release manifest generatedAt'),
  packageManager: stringField(manifest.packageManager, 'release manifest packageManager'),
  compatibility: {
    node: rootPackage.engines?.node,
    pnpm: rootPackage.engines?.pnpm
  },
  artifacts,
  sbom,
  publishOrder: Array.isArray(manifest.publishOrder) ? manifest.publishOrder : undefined,
  releaseNotesUrl,
  upgradeGuideUrl,
  provenanceUrl
})

const channelDocument = {
  schemaVersion: 'romeo.release-channel.v1',
  generatedAt,
  channel,
  latest: release.version,
  releases: [release]
}

const body = `${JSON.stringify(channelDocument, null, 2)}\n`
if (stdout) {
  process.stdout.write(body)
} else {
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, body, 'utf8')
  console.log(`Wrote Romeo ${channel} release-channel metadata to ${relative(root, outputPath)}`)
}

function normalizeArtifacts(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Release manifest must contain at least one artifact.')
  return value.map((artifact) => {
    const file = stringField(artifact.file, 'artifact file')
    const sha256 = stringField(artifact.sha256, `artifact ${file} sha256`)
    if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`Artifact ${file} has an invalid SHA-256 hash.`)
    const normalized = {
      name: stringField(artifact.name, `artifact ${file} name`),
      version: stringField(artifact.version, `artifact ${file} version`),
      file,
      bytes: positiveInteger(artifact.bytes, `artifact ${file} bytes`),
      sha256
    }
    if (artifactBaseUrl !== undefined) normalized.url = `${artifactBaseUrl}/${encodeURIComponent(file)}`
    return normalized
  })
}

function resolveSbomPath() {
  const explicit = argValue('--sbom')
  if (explicit !== undefined) return resolve(root, explicit)
  const candidate = join(dirname(manifestPath), 'sbom.cdx.json')
  return existsSync(candidate) ? candidate : undefined
}

function readSbom(path) {
  const document = readJson(path)
  if (document.bomFormat !== 'CycloneDX') throw new Error('SBOM must be a CycloneDX document.')
  const file = relative(dirname(outputPath), path) || 'sbom.cdx.json'
  return {
    file,
    bytes: statSync(path).size,
    sha256: sha256File(path),
    format: document.bomFormat,
    specVersion: stringField(document.specVersion, 'SBOM specVersion'),
    componentCount: Array.isArray(document.components) ? document.components.length : 0,
    dependencyCount: Array.isArray(document.dependencies) ? document.dependencies.length : 0
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function stringField(value, name) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a non-empty string.`)
  return value
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`)
  return value
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function trimTrailingSlash(value) {
  if (value === undefined) return undefined
  return value.replace(/\/+$/u, '')
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
