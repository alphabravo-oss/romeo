#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const tsxPackageJsonPath = require.resolve('tsx/package.json')
const tsxCliPath = join(dirname(tsxPackageJsonPath), 'dist/cli.mjs')
const entrypointPath = join(packageRoot, 'src/index.ts')

const child = spawn(process.execPath, [tsxCliPath, entrypointPath, ...process.argv.slice(2)], {
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exitCode = code ?? 1
})
