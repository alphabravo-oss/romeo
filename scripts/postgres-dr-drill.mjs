import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

import {
  argValue,
  ensureParentDirectory,
  hasFlag,
  printPlan,
  redactedConnection,
  redactedRemoteUrl,
  repoPath,
  timestampForFilename
} from './lib/postgres-maintenance.mjs'

const databaseUrl = nonEmpty(argValue('--database-url') ?? process.env.DRILL_DATABASE_URL)
if (databaseUrl === undefined) throw new Error('DRILL_DATABASE_URL or --database-url is required for restore drills.')

const inputValue = argValue('--input')
if (inputValue === undefined || inputValue.length === 0) throw new Error('--input is required.')

const input = inputValue.startsWith('/') ? inputValue : repoPath(inputValue)
const outputValue = argValue('--output')
const output = outputValue === undefined ? repoPath(`backups/romeo-dr-drill-${timestampForFilename()}.json`) : resolveRepoPath(outputValue)
const expectedSha256 = argValue('--expected-sha256')
const downloadUrl = nonEmpty(argValue('--download-url') ?? process.env.POSTGRES_RESTORE_DOWNLOAD_URL)
const pgRestore = argValue('--pg-restore')
const dryRun = hasFlag('--dry-run')
const confirmed = hasFlag('--confirm-isolated-target')

const restoreArgs = ['scripts/postgres-restore.mjs', '--input', input, '--confirm']
if (expectedSha256 !== undefined) restoreArgs.push('--expected-sha256', expectedSha256)
if (pgRestore !== undefined) restoreArgs.push('--pg-restore', pgRestore)

if (dryRun) {
  printPlan({
    operation: 'postgres.dr_drill',
    target: redactedConnection(databaseUrl),
    input,
    output,
    expectedSha256,
    download: downloadUrl === undefined ? undefined : { type: 'presigned_get', url: redactedRemoteUrl(downloadUrl) },
    requiresConfirm: true
  })
  process.exit(0)
}

if (!confirmed) {
  throw new Error('Restore drills are destructive. Re-run with --confirm-isolated-target after selecting an isolated target database.')
}

const startedAt = new Date()
const result = spawnSync(process.execPath, restoreArgs, {
  cwd: repoPath('.'),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ...(downloadUrl === undefined ? {} : { POSTGRES_RESTORE_DOWNLOAD_URL: downloadUrl })
  },
  stdio: 'inherit'
})
const completedAt = new Date()
const evidence = {
  schemaVersion: 'romeo.postgres-dr-drill.v1',
  status: result.status === 0 ? 'passed' : 'failed',
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationMs: completedAt.getTime() - startedAt.getTime(),
  target: redactedConnection(databaseUrl),
  input,
  expectedSha256,
  download: downloadUrl === undefined ? undefined : { type: 'presigned_get', url: redactedRemoteUrl(downloadUrl) },
  restoreExitCode: result.status ?? 1
}

ensureParentDirectory(output)
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(`Wrote PostgreSQL DR drill evidence to ${output}`)
if (result.status !== 0) process.exit(result.status ?? 1)

function resolveRepoPath(path) {
  return path.startsWith('/') ? path : repoPath(path)
}

function nonEmpty(value) {
  return value === undefined || value.length === 0 ? undefined : value
}
