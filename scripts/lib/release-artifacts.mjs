import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../..', import.meta.url))
export const severities = ['info', 'low', 'moderate', 'high', 'critical']

export function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

export function argValues(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) values.push(process.argv[index + 1])
  }
  return values.filter((value) => value !== undefined)
}

export function hasFlag(name) {
  return process.argv.includes(name)
}

export function repoPath(path) {
  return resolve(root, path)
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function writeJsonOrStdout({ path, value, stdout }) {
  const body = `${JSON.stringify(value, null, 2)}\n`
  if (stdout) {
    process.stdout.write(body)
  } else {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body, 'utf8')
  }
}

export function optionalFile(path) {
  return path !== undefined && existsSync(path) ? path : undefined
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function fileEvidence(path, file = path) {
  return {
    file,
    bytes: statSync(path).size,
    sha256: sha256File(path)
  }
}

export function emptySeverityCounts() {
  return Object.fromEntries(severities.map((severity) => [severity, 0]))
}

export function addSeverity(counts, value) {
  const severity = normalizeSeverity(value)
  counts[severity] += 1
}

export function addCounts(target, source) {
  for (const severity of severities) target[severity] += source[severity] ?? 0
}

export function normalizeSeverity(value) {
  const normalized = String(value ?? 'info').toLowerCase()
  if (normalized === 'medium') return 'moderate'
  return severities.includes(normalized) ? normalized : 'info'
}

export function severityAtOrAbove(counts, threshold) {
  if (threshold === 'none') return 0
  const index = severities.indexOf(threshold)
  if (index < 0) throw new Error(`Unsupported severity threshold: ${threshold}`)
  return severities.slice(index).reduce((total, severity) => total + (counts[severity] ?? 0), 0)
}

export function validateSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest.`)
  }
  return value
}

export function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`)
  return value
}

export function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string.`)
  return value
}

export function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
