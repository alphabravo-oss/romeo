export interface CliIo {
  stdout: Pick<NodeJS.WriteStream, 'write'>
  stderr: Pick<NodeJS.WriteStream, 'write'>
}

export const processIo: CliIo = {
  stdout: process.stdout,
  stderr: process.stderr
}

export function writeJson(io: CliIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function writeLine(io: CliIo, value: string): void {
  io.stdout.write(`${value}\n`)
}
