import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = new URL('..', import.meta.url).pathname
const outDir = argValue('--out-dir') ?? join(root, 'dist', 'release')
const skipVerify = process.argv.includes('--skip-verify')
const rootPackage = readPackage('package.json')

if (!skipVerify) run('pnpm', ['verify'])

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const apiClientPackage = readPackage('packages/api-client/package.json')
const cliPackage = readPackage('packages/cli/package.json')

pack('@romeo/api-client')
pack('@romeo/cli')

const apiClientTarball = join(outDir, `romeo-api-client-${apiClientPackage.version}.tgz`)
const cliTarball = join(outDir, `romeo-cli-${cliPackage.version}.tgz`)

assertTarball(apiClientTarball, {
  required: ['package/package.json', 'package/src/index.ts', 'package/src/client.ts'],
  forbidden: ['.test.ts']
})
assertTarball(cliTarball, {
  required: ['package/package.json', 'package/bin/romeo.mjs', 'package/src/index.ts', 'package/src/knowledge-worker.ts', 'package/src/webhook-worker.ts'],
  forbidden: ['.test.ts']
})

const packedCliPackage = JSON.parse(capture('tar', ['-xOf', cliTarball, 'package/package.json']))
if (packedCliPackage.dependencies?.['@romeo/api-client'] !== apiClientPackage.version) {
  throw new Error('Packed CLI dependency does not match the packed API client version.')
}

const manifest = {
  name: rootPackage.name,
  version: rootPackage.version,
  generatedAt: new Date().toISOString(),
  packageManager: rootPackage.packageManager,
  artifacts: [
    artifact('@romeo/api-client', apiClientPackage.version, apiClientTarball),
    artifact('@romeo/cli', cliPackage.version, cliTarball)
  ],
  publishOrder: ['@romeo/api-client', '@romeo/cli']
}
const manifestPath = join(outDir, 'release-manifest.json')
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(`Packed Romeo release artifacts into ${outDir}`)
console.log(`- ${apiClientTarball}`)
console.log(`- ${cliTarball}`)
console.log(`- ${manifestPath}`)

function pack(filter) {
  run('pnpm', ['--filter', filter, 'pack', '--pack-destination', outDir])
}

function readPackage(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'))
}

function assertTarball(path, checks) {
  const contents = capture('tar', ['-tf', path]).trim().split('\n')
  for (const required of checks.required) {
    if (!contents.includes(required)) throw new Error(`Missing ${required} from ${path}`)
  }
  for (const forbidden of checks.forbidden) {
    const match = contents.find((entry) => entry.includes(forbidden))
    if (match !== undefined) throw new Error(`Forbidden artifact ${match} found in ${path}`)
  }
}

function artifact(name, version, path) {
  return {
    name,
    version,
    file: path.split('/').at(-1),
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex')
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.stderr.write(result.stdout)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
