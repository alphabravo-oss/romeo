import { relative } from 'node:path'

import {
  argValue,
  fileEvidence,
  hasFlag,
  nonEmptyString,
  positiveInteger,
  readJson,
  repoPath,
  root,
  validateSha256,
  writeJsonOrStdout
} from './lib/release-artifacts.mjs'

const channelPath = repoPath(argValue('--channel-file') ?? 'dist/release/release-channel.json')
const outputPath = repoPath(argValue('--output') ?? 'dist/release/upgrade-validation.json')
const rootPackage = readJson(repoPath('package.json'))
const channel = readJson(channelPath)
const generatedAt = argValue('--generated-at') ?? new Date().toISOString()
const fromVersion = argValue('--from-version') ?? rootPackage.version
const targetVersion = argValue('--target-version') ?? channel.latest
const requireArtifactUrls = hasFlag('--require-artifact-urls')
const requireProvenance = hasFlag('--require-provenance')
const requireUpgradeGuide = hasFlag('--require-upgrade-guide')
const stdout = hasFlag('--stdout')

const checks = []
const targetRelease = findTargetRelease()
const plan = {
  schemaVersion: 'romeo.upgrade-validation.v1',
  generatedAt,
  status: 'pass',
  channel: {
    file: relative(root, channelPath),
    name: channel.channel,
    latest: channel.latest,
    ...fileEvidence(channelPath, relative(root, channelPath))
  },
  fromVersion,
  targetVersion,
  release: targetRelease === undefined ? undefined : releaseSummary(targetRelease),
  checks
}

check('release channel schema', channel.schemaVersion === 'romeo.release-channel.v1')
check('target release exists', targetRelease !== undefined)
if (targetRelease !== undefined) {
  validateVersionProgression()
  validateReleaseTimestamps(targetRelease)
  validateCompatibility(targetRelease)
  validatePublishOrder(targetRelease)
  validateArtifacts(targetRelease)
  validateOptionalEvidence(targetRelease)
}

if (checks.some((item) => item.status === 'fail')) plan.status = 'fail'

writeJsonOrStdout({ path: outputPath, value: plan, stdout })
if (!stdout) console.log(`Wrote Romeo upgrade validation to ${relative(root, outputPath)}`)
if (plan.status === 'fail') process.exit(1)

function findTargetRelease() {
  if (!Array.isArray(channel.releases)) return undefined
  return channel.releases.find((release) => release?.version === targetVersion)
}

function releaseSummary(release) {
  return {
    version: release.version,
    generatedAt: release.generatedAt,
    artifacts: Array.isArray(release.artifacts)
      ? release.artifacts.map((artifact) => ({
          name: artifact.name,
          version: artifact.version,
          file: artifact.file
        }))
      : []
  }
}

function validateVersionProgression() {
  const from = parseVersion(fromVersion, '--from-version')
  const target = parseVersion(targetVersion, '--target-version')
  check('target version is not older than current version', compareVersions(target, from) >= 0)
}

function validateReleaseTimestamps(release) {
  check('channel generatedAt is a valid timestamp', validTimestamp(channel.generatedAt))
  check('release generatedAt is a valid timestamp', validTimestamp(release.generatedAt))
}

function validateCompatibility(release) {
  const nodeRange = release.compatibility?.node
  const pnpmRange = release.compatibility?.pnpm
  check('Node compatibility metadata is present', typeof nodeRange === 'string' && nodeRange.length > 0)
  check('pnpm compatibility metadata is present', typeof pnpmRange === 'string' && pnpmRange.length > 0)
  if (typeof nodeRange === 'string') {
    check('current Node satisfies release minimum', satisfiesMinimum(process.versions.node, nodeRange))
  }
}

function validatePublishOrder(release) {
  const order = Array.isArray(release.publishOrder) ? release.publishOrder : []
  const apiClientIndex = order.indexOf('@romeo/api-client')
  const cliIndex = order.indexOf('@romeo/cli')
  check('SDK publishes before CLI', apiClientIndex >= 0 && cliIndex >= 0 && apiClientIndex < cliIndex)
}

function validateArtifacts(release) {
  const artifacts = Array.isArray(release.artifacts) ? release.artifacts : []
  check('release includes artifacts', artifacts.length > 0)
  const names = new Set()
  for (const artifact of artifacts) {
    const label = artifact?.name ?? 'artifact'
    try {
      names.add(nonEmptyString(artifact.name, `${label} name`))
      nonEmptyString(artifact.version, `${label} version`)
      nonEmptyString(artifact.file, `${label} file`)
      positiveInteger(artifact.bytes, `${label} bytes`)
      validateSha256(artifact.sha256, `${label} sha256`)
      check(`${label} metadata is valid`, true)
    } catch (error) {
      check(`${label} metadata is valid`, false, error.message)
    }
    if (requireArtifactUrls) {
      check(`${label} artifact URL is present`, typeof artifact.url === 'string' && artifact.url.startsWith('https://'))
    }
  }
  check('release includes SDK artifact', names.has('@romeo/api-client'))
  check('release includes CLI artifact', names.has('@romeo/cli'))
}

function validateOptionalEvidence(release) {
  if (release.sbom !== undefined) {
    try {
      nonEmptyString(release.sbom.file, 'SBOM file')
      positiveInteger(release.sbom.bytes, 'SBOM bytes')
      validateSha256(release.sbom.sha256, 'SBOM sha256')
      check('SBOM metadata is valid', release.sbom.format === 'CycloneDX')
    } catch (error) {
      check('SBOM metadata is valid', false, error.message)
    }
  }
  if (requireProvenance) {
    check('provenance URL is present', typeof release.provenanceUrl === 'string' && release.provenanceUrl.startsWith('https://'))
  }
  if (requireUpgradeGuide && compareVersions(parseVersion(targetVersion, '--target-version'), parseVersion(fromVersion, '--from-version')) > 0) {
    check('upgrade guide URL is present', typeof release.upgradeGuideUrl === 'string' && release.upgradeGuideUrl.startsWith('https://'))
  }
}

function check(name, passed, detail) {
  checks.push({
    name,
    status: passed ? 'pass' : 'fail',
    ...(detail === undefined ? {} : { detail })
  })
}

function parseVersion(value, label) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(nonEmptyString(value, label))
  if (match === null) throw new Error(`${label} must be a semantic version.`)
  return match.slice(1, 4).map((part) => Number.parseInt(part, 10))
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function satisfiesMinimum(version, range) {
  const match = /^>=\s*(\d+\.\d+\.\d+)$/u.exec(range)
  if (match === null) return true
  return compareVersions(parseVersion(version, 'current Node version'), parseVersion(match[1], 'Node range')) >= 0
}
