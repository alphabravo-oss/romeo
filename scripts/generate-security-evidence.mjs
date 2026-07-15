import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'

import {
  addCounts,
  addSeverity,
  argValue,
  argValues,
  emptySeverityCounts,
  fileEvidence,
  hasFlag,
  nonEmptyString,
  optionalFile,
  positiveInteger,
  readJson,
  removeUndefined,
  repoPath,
  root,
  severityAtOrAbove,
  severities,
  validateSha256,
  writeJsonOrStdout
} from './lib/release-artifacts.mjs'

const manifestPath = repoPath(argValue('--manifest') ?? 'dist/release/release-manifest.json')
const outputPath = repoPath(argValue('--output') ?? 'dist/release/security-evidence.json')
const explicitSbomPath = argValue('--sbom')
const auditFilePath = argValue('--audit-file')
const containerScanPaths = argValues('--container-scan-file').map((path) => resolve(root, path))
const generatedAt = argValue('--generated-at') ?? new Date().toISOString()
const failOn = argValue('--fail-on') ?? 'high'
const skipAudit = hasFlag('--skip-audit')
const stdout = hasFlag('--stdout')

if (failOn !== 'none' && !severities.includes(failOn)) {
  throw new Error(`--fail-on must be one of ${severities.join(', ')} or none.`)
}

const manifest = readJson(manifestPath)
const artifacts = normalizeManifestArtifacts(manifest.artifacts)
const sbomPath = resolveSbomPath()
const sbom = sbomPath === undefined ? undefined : summarizeSbom(sbomPath)
const audit = skipAudit ? skippedAudit() : summarizeAudit()
const containerScans = containerScanPaths.map(summarizeContainerScan)
const totalCounts = emptySeverityCounts()

addCounts(totalCounts, audit.counts)
for (const scan of containerScans) addCounts(totalCounts, scan.counts)

const failures = policyFailures(totalCounts)
const evidence = {
  schemaVersion: 'romeo.security-evidence.v1',
  generatedAt,
  status: failures.length === 0 ? 'pass' : 'fail',
  policy: {
    failOn
  },
  release: {
    name: nonEmptyString(manifest.name, 'release manifest name'),
    version: nonEmptyString(manifest.version, 'release manifest version'),
    manifest: fileEvidence(manifestPath, relative(dirname(outputPath), manifestPath)),
    artifacts
  },
  sources: removeUndefined({
    sbom,
    npmAudit: audit.source,
    containerScans: containerScans.map((scan) => scan.source)
  }),
  findings: {
    npmAudit: audit.counts,
    containerScans: combinedContainerCounts(containerScans),
    total: totalCounts
  },
  failures
}

writeJsonOrStdout({ path: outputPath, value: evidence, stdout })
if (!stdout) console.log(`Wrote Romeo release security evidence to ${relative(root, outputPath)}`)
if (failures.length > 0) process.exit(1)

function normalizeManifestArtifacts(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Release manifest must contain artifacts.')
  return value.map((artifact) => ({
    name: nonEmptyString(artifact.name, 'artifact name'),
    version: nonEmptyString(artifact.version, `artifact ${artifact.name} version`),
    file: nonEmptyString(artifact.file, `artifact ${artifact.name} file`),
    bytes: positiveInteger(artifact.bytes, `artifact ${artifact.name} bytes`),
    sha256: validateSha256(artifact.sha256, `artifact ${artifact.name} sha256`)
  }))
}

function resolveSbomPath() {
  if (explicitSbomPath !== undefined) return resolve(root, explicitSbomPath)
  return optionalFile(join(dirname(manifestPath), 'sbom.cdx.json'))
}

function summarizeSbom(path) {
  const document = readJson(path)
  if (document.bomFormat !== 'CycloneDX') throw new Error('SBOM evidence must be a CycloneDX document.')
  return {
    ...fileEvidence(path, relative(dirname(outputPath), path)),
    format: document.bomFormat,
    specVersion: nonEmptyString(document.specVersion, 'SBOM specVersion'),
    componentCount: Array.isArray(document.components) ? document.components.length : 0,
    dependencyCount: Array.isArray(document.dependencies) ? document.dependencies.length : 0
  }
}

function skippedAudit() {
  return {
    source: {
      type: 'pnpm-audit',
      status: 'skipped'
    },
    counts: emptySeverityCounts()
  }
}

function summarizeAudit() {
  if (auditFilePath !== undefined) {
    const resolved = resolve(root, auditFilePath)
    return {
      source: {
        type: 'pnpm-audit',
        ...fileEvidence(resolved, relative(dirname(outputPath), resolved))
      },
      counts: countsFromNpmAudit(readJson(resolved))
    }
  }

  const result = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8'
  })
  const raw = result.stdout.trim()
  if (raw.length === 0) {
    process.stderr.write(result.stderr)
    throw new Error('pnpm audit did not return JSON output.')
  }
  return {
    source: {
      type: 'pnpm-audit',
      command: 'pnpm audit --prod --json',
      exitCode: result.status ?? 0
    },
    counts: countsFromNpmAudit(JSON.parse(raw))
  }
}

function countsFromNpmAudit(document) {
  const metadataCounts = countsFromMetadata(document.metadata?.vulnerabilities)
  if (metadataCounts !== undefined) return metadataCounts

  const counts = emptySeverityCounts()
  for (const vulnerability of Object.values(document.vulnerabilities ?? {})) addSeverity(counts, vulnerability?.severity)
  for (const advisory of Object.values(document.advisories ?? {})) addSeverity(counts, advisory?.severity)
  return counts
}

function summarizeContainerScan(path) {
  const document = readJson(path)
  return {
    source: {
      type: 'container-scan',
      ...fileEvidence(path, relative(dirname(outputPath), path))
    },
    counts: countsFromContainerScan(document)
  }
}

function countsFromContainerScan(document) {
  const counts = emptySeverityCounts()
  for (const result of document.Results ?? []) {
    for (const vulnerability of result.Vulnerabilities ?? []) addSeverity(counts, vulnerability.Severity)
  }
  for (const match of document.matches ?? []) addSeverity(counts, match.vulnerability?.severity)
  return counts
}

function countsFromMetadata(value) {
  if (typeof value !== 'object' || value === null) return undefined
  const counts = emptySeverityCounts()
  for (const severity of severities) {
    const count = value[severity]
    if (Number.isInteger(count) && count >= 0) counts[severity] = count
  }
  return counts
}

function combinedContainerCounts(scans) {
  const counts = emptySeverityCounts()
  for (const scan of scans) addCounts(counts, scan.counts)
  return counts
}

function policyFailures(counts) {
  const failingCount = severityAtOrAbove(counts, failOn)
  if (failingCount === 0) return []
  return [
    {
      code: 'vulnerability_threshold_exceeded',
      message: `${failingCount} vulnerability findings meet or exceed the ${failOn} release threshold.`
    }
  ]
}
