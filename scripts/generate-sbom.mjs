import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'

const output = argValue('--output') ?? 'release/sbom.cdx.json'
const timestamp = argValue('--timestamp') ?? new Date().toISOString()
const stdout = hasFlag('--stdout')
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'))
const graph = JSON.parse(execFileSync('pnpm', ['list', '-r', '--json', '--prod', '--depth', 'Infinity'], { encoding: 'utf8' }))

const components = new Map()
const dependencies = new Map()
const rootRef = componentRef(rootPackage.name, rootPackage.version)

for (const project of graph) {
  const projectVersion = packageVersion(project)
  if (typeof project.name !== 'string' || projectVersion === undefined) continue
  const ref = addComponent({
    name: project.name,
    version: projectVersion,
    path: project.path,
    resolved: undefined,
    scope: 'required'
  })
  addDependencies(ref, project.dependencies ?? {})
}

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: deterministicSerialNumber([...components.values()], timestamp),
  version: 1,
  metadata: {
    timestamp,
    tools: [{ vendor: 'Romeo', name: 'generate-sbom', version: rootPackage.version }],
    component: {
      type: 'application',
      name: rootPackage.name,
      version: rootPackage.version,
      'bom-ref': rootRef
    }
  },
  components: [...components.values()].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'])),
  dependencies: [...dependencies.entries()]
    .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() }))
    .sort((left, right) => left.ref.localeCompare(right.ref))
}

const body = `${JSON.stringify(bom, null, 2)}\n`
if (stdout) {
  process.stdout.write(body)
} else {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, body, 'utf8')
  console.log(`Wrote CycloneDX SBOM with ${bom.components.length} components to ${output}`)
}

function addDependencies(ref, deps) {
  const dependsOn = dependencies.get(ref) ?? new Set()
  dependencies.set(ref, dependsOn)
  for (const dep of Object.values(deps)) {
    if (typeof dep !== 'object' || dep === null) continue
    const name = typeof dep.from === 'string' ? dep.from : dep.name
    const version = packageVersion(dep)
    if (typeof name !== 'string' || version === undefined) continue
    const depRef = addComponent({
      name,
      version,
      path: dep.path,
      resolved: dep.resolved,
      scope: 'required'
    })
    dependsOn.add(depRef)
    addDependencies(depRef, dep.dependencies ?? {})
  }
}

function addComponent(input) {
  const ref = componentRef(input.name, input.version)
  if (!components.has(ref)) {
    const component = {
      type: 'library',
      name: input.name,
      version: input.version,
      scope: input.scope,
      'bom-ref': ref,
      purl: packageUrl(input.name, input.version)
    }
    const externalReferences = externalReferencesFor(input)
    if (externalReferences.length > 0) component.externalReferences = externalReferences
    components.set(ref, component)
  }
  return ref
}

function packageVersion(node) {
  if (typeof node.version === 'string' && !node.version.startsWith('link:')) return node.version
  if (typeof node.path === 'string') {
    try {
      const manifest = JSON.parse(readFileSync(`${node.path}/package.json`, 'utf8'))
      if (typeof manifest.version === 'string') return manifest.version
    } catch {
      return undefined
    }
  }
  return undefined
}

function externalReferencesFor(input) {
  const refs = []
  if (typeof input.resolved === 'string' && input.resolved.startsWith('https://')) {
    refs.push({ type: 'distribution', url: input.resolved })
  }
  if (typeof input.path === 'string' && input.path.startsWith(process.cwd())) {
    refs.push({ type: 'other', url: `workspace:${relative(process.cwd(), input.path) || '.'}` })
  }
  return refs
}

function componentRef(name, version) {
  return `pkg:npm/${packageNameForPurl(name)}@${encodeURIComponent(version)}`
}

function packageUrl(name, version) {
  return componentRef(name, version)
}

function packageNameForPurl(name) {
  if (name.startsWith('@')) {
    const [scope, packageName] = name.split('/')
    return `${encodeURIComponent(scope)}/${encodeURIComponent(packageName ?? '')}`
  }
  return encodeURIComponent(name)
}

function deterministicSerialNumber(components, timestampValue) {
  const hash = createHash('sha256')
    .update(JSON.stringify({ components: components.map((component) => component['bom-ref']).sort(), timestamp: timestampValue }))
    .digest('hex')
  return `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  return process.argv[index + 1]
}

function hasFlag(name) {
  return process.argv.includes(name)
}
