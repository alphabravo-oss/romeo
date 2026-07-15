export interface ParsedArgs {
  flags: Record<string, string | true>
  positionals: string[]
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue

    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2)
    if (!rawName) continue

    if (inlineValue !== undefined) {
      flags[rawName] = inlineValue
      continue
    }

    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[rawName] = next
      index += 1
    } else {
      flags[rawName] = true
    }
  }

  return { flags, positionals }
}

export function flagValue(flags: ParsedArgs['flags'], ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags[name]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

export function hasFlag(flags: ParsedArgs['flags'], ...names: string[]): boolean {
  return names.some((name) => flags[name] === true)
}
