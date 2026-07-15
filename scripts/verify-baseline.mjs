import { spawnSync } from 'node:child_process'

const commands = [
  ['pnpm', ['test']],
  ['pnpm', ['check']],
  ['pnpm', ['build']]
]

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
