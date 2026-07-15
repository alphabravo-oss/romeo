import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";

import { parseArgs } from "./args";
import { executeCommand, CliUsageError } from "./commands";
import { createClient, resolveConfig } from "./config";
import { processIo, type CliIo } from "./io";

export interface RunCliInput {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  io?: CliIo;
  dnsLookup?: (
    host: string,
  ) => Promise<Array<{ address: string; family?: number }>>;
  readFile?: (path: string) => Promise<Uint8Array>;
}

export async function runCli(input: RunCliInput = {}): Promise<number> {
  const parsed = parseArgs(input.argv ?? process.argv.slice(2));
  const io = input.io ?? processIo;

  try {
    const config = resolveConfig(parsed, input.env ?? process.env);
    const client = createClient(config);
    return await executeCommand({
      client,
      dnsLookup: input.dnsLookup ?? nodeDnsLookup,
      fetchImpl: input.fetchImpl ?? fetch,
      io,
      parsed,
      readFile: input.readFile ?? readFile,
    });
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.stderr.write(`${error.message}\n`);
      return 2;
    }

    io.stderr.write(
      `${error instanceof Error ? error.message : "Unknown Romeo CLI failure."}\n`,
    );
    return 1;
  }
}

function nodeDnsLookup(
  host: string,
): Promise<Array<{ address: string; family?: number }>> {
  return lookup(host, { all: true });
}
