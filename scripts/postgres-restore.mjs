import {
  assertExpectedSha256,
  argValue,
  ensureParentDirectory,
  hasFlag,
  postgresEnvironment,
  printPlan,
  readDatabaseUrl,
  redactedConnection,
  redactedRemoteUrl,
  repoPath,
  runPostgresCommand
} from './lib/postgres-maintenance.mjs'
import { createWriteStream, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const inputValue = argValue('--input')
if (inputValue === undefined || inputValue.length === 0) throw new Error('--input is required.')

const databaseUrl = readDatabaseUrl()
const input = inputValue.startsWith('/') ? inputValue : repoPath(inputValue)
const command = argValue('--pg-restore') ?? 'pg_restore'
const downloadUrl = nonEmpty(argValue('--download-url') ?? process.env.POSTGRES_RESTORE_DOWNLOAD_URL)
const expectedSha256 = argValue('--expected-sha256')
const database = postgresEnvironment(databaseUrl).PGDATABASE
const args = ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction', '--dbname', database, input]
const dryRun = hasFlag('--dry-run')

if (!dryRun && !hasFlag('--confirm')) {
  throw new Error('PostgreSQL restore is destructive. Re-run with --confirm after validating the target database and backup file.')
}

if (dryRun) {
  printPlan({
    operation: 'postgres.restore',
    command,
    args,
    env: { PGCONNECTION: redactedConnection(databaseUrl) },
    input,
    download: downloadUrl === undefined ? undefined : { type: 'presigned_get', url: redactedRemoteUrl(downloadUrl) },
    expectedSha256,
    requiresConfirm: true
  })
  process.exit(0)
}

if (downloadUrl !== undefined) await downloadBackup(downloadUrl, input)
if (!existsSync(input)) throw new Error(`Backup file does not exist: ${input}`)
await assertExpectedSha256(input, expectedSha256)

runPostgresCommand({ command, args, databaseUrl })
console.log(`Restored PostgreSQL backup from ${input}`)

function nonEmpty(value) {
  return value === undefined || value.length === 0 ? undefined : value
}

async function downloadBackup(url, path) {
  const response = await fetch(url)
  if (!response.ok || response.body === null) throw new Error(`Backup download failed with HTTP ${response.status}.`)
  ensureParentDirectory(path)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path))
  console.log(`Downloaded PostgreSQL backup from ${redactedRemoteUrl(url)} to ${path}`)
}
