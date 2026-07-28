import { flagValue, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";

export function requiredFlag(parsed: ParsedArgs, ...names: string[]): string {
  const value = flagValue(parsed.flags, ...names);
  if (value === undefined) throw new CliUsageError(`Missing --${names[0]}.`);
  return value;
}

export function csvFlag(parsed: ParsedArgs, ...names: string[]): string[] {
  return (flagValue(parsed.flags, ...names) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function optionalCsvFlag(
  parsed: ParsedArgs,
  ...names: string[]
): string[] | undefined {
  return flagValue(parsed.flags, ...names) === undefined
    ? undefined
    : csvFlag(parsed, ...names);
}

export function optionalMappingFlag(
  parsed: ParsedArgs,
  ...names: string[]
): Record<string, string> | undefined {
  const values = optionalCsvFlag(parsed, ...names);
  if (values === undefined) return undefined;
  const output: Record<string, string> = {};
  for (const value of values) {
    const [external, internal] = value.split("=", 2);
    if (
      external === undefined ||
      internal === undefined ||
      external.length === 0 ||
      internal.length === 0
    )
      throw new CliUsageError(
        `--${names[0]} entries must use external=internal.`,
      );
    output[external] = internal;
  }
  return output;
}

export function numberFlag(
  parsed: ParsedArgs,
  defaultValue: number,
  name: string,
): number {
  const raw = flagValue(parsed.flags, name);
  if (raw === undefined) return defaultValue;
  const parsedValue = Number(raw);
  if (!Number.isFinite(parsedValue) || parsedValue < 0)
    throw new CliUsageError(`--${name} must be a non-negative number.`);
  return parsedValue;
}

export function optionalBooleanFlag(
  parsed: ParsedArgs,
  name: string,
): boolean | undefined {
  const raw = flagValue(parsed.flags, name);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new CliUsageError(`--${name} must be true or false.`);
}

export function optionalIntegerFlag(
  parsed: ParsedArgs,
  name: string,
): number | undefined {
  const raw = flagValue(parsed.flags, name);
  if (raw === undefined) return undefined;
  const parsedValue = Number(raw);
  if (!Number.isInteger(parsedValue) || parsedValue < 1)
    throw new CliUsageError(`--${name} must be a positive integer.`);
  return parsedValue;
}

export function optionalNonNegativeIntegerFlag(
  parsed: ParsedArgs,
  name: string,
): number | undefined {
  const raw = flagValue(parsed.flags, name);
  if (raw === undefined) return undefined;
  const parsedValue = Number(raw);
  if (!Number.isInteger(parsedValue) || parsedValue < 0)
    throw new CliUsageError(`--${name} must be a non-negative integer.`);
  return parsedValue;
}
