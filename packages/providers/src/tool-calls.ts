export interface ProviderToolCallRequest {
  providerCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  argumentKeys: string[];
}

export interface ProviderToolCallChunk {
  type: "tool_call";
  toolCall: ProviderToolCallRequest;
  toolCalls?: ProviderToolCallRequest[];
}

export function normalizeProviderToolCall(
  input: unknown,
): ProviderToolCallRequest | undefined {
  const record = asRecord(input);
  if (record === undefined) return undefined;

  const normalized = normalizedFields(record);
  if (normalized === undefined) return undefined;

  const name = safeToolName(normalized.name);
  const args = safeToolArguments(normalized.arguments);
  if (name === undefined || args === undefined) return undefined;

  return {
    providerCallId: safeProviderCallId(normalized.providerCallId, name, args),
    name,
    arguments: args,
    argumentKeys: Object.keys(args).sort(),
  };
}

export function normalizeProviderToolCalls(
  input: unknown,
): ProviderToolCallRequest[] {
  if (Array.isArray(input)) {
    return input.flatMap((item) => {
      const call = normalizeProviderToolCall(item);
      return call === undefined ? [] : [call];
    });
  }
  const call = normalizeProviderToolCall(input);
  return call === undefined ? [] : [call];
}

export function providerToolCallRedactionHash(value: string): string {
  const seeds = [
    0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f,
    0x165667b1, 0xd3a2646c,
  ];
  return seeds.map((seed) => fnv1a(`${seed}\0${value}`, seed)).join("");
}

function normalizedFields(record: Record<string, unknown>):
  | {
      arguments: unknown;
      name: unknown;
      providerCallId: unknown;
    }
  | undefined {
  const functionRecord = asRecord(record.function);
  if (functionRecord !== undefined) {
    return {
      arguments: functionRecord.arguments,
      name: functionRecord.name,
      providerCallId: record.id ?? record.call_id ?? record.callId,
    };
  }

  return {
    arguments: record.arguments ?? record.args,
    name: record.name,
    providerCallId:
      record.providerCallId ?? record.id ?? record.call_id ?? record.callId,
  };
}

function safeToolName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 160) return undefined;
  if (!/^[A-Za-z0-9_.:/-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function safeToolArguments(
  value: unknown,
): Record<string, unknown> | undefined {
  const parsed =
    typeof value === "string" ? parseJsonRecord(value) : asRecord(value);
  if (parsed === undefined) return undefined;
  return parsed;
}

function safeProviderCallId(
  value: unknown,
  name: string,
  args: Record<string, unknown>,
): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= 200) return trimmed;
  }

  return `provider_call_${providerToolCallRedactionHash(
    `provider.tool_call.v1\0${name}\0${JSON.stringify(args)}`,
  ).slice(0, 32)}`;
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
