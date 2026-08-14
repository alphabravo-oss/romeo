import type {
  ModelDefaultParameters,
  ModelPricing,
  ProviderCapabilities,
} from "./types";

export interface DiscoveredModelProfile {
  capabilities: ProviderCapabilities;
  contextWindow: number;
  defaultParameters?: ModelDefaultParameters;
  pricing?: ModelPricing;
}

export function profileDiscoveredModel(input: {
  base: ProviderCapabilities;
  fallbackContextWindow: number;
  metadata?: Record<string, unknown>;
  name: string;
}): DiscoveredModelProfile {
  const metadata = input.metadata ?? {};
  const name = input.name.trim();
  const params = supportedParameters(metadata);
  const capabilities = inferCapabilities(input.base, name, metadata, params);
  const contextWindow =
    readPositiveInt(
      metadata.context_length,
      metadata.context_window,
      metadata.max_model_len,
      metadata.max_input_tokens,
      nestedNumber(metadata, ["architecture", "context_length"]),
      nestedNumber(metadata, ["top_provider", "context_length"]),
    ) ??
    inferContextWindow(name) ??
    input.fallbackContextWindow;
  const maxOutputTokens =
    readPositiveInt(
      metadata.max_output_tokens,
      metadata.max_completion_tokens,
      nestedNumber(metadata, ["top_provider", "max_completion_tokens"]),
    ) ?? inferMaxOutputTokens(name, contextWindow, capabilities);
  const pricing = readTokenPricing(metadata);
  return {
    capabilities,
    contextWindow,
    ...(maxOutputTokens === undefined
      ? {}
      : { defaultParameters: { maxOutputTokens } }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

export function modelAcceptsTemperature(
  capabilities: ProviderCapabilities,
): boolean {
  return capabilities.temperature !== false;
}

function inferCapabilities(
  base: ProviderCapabilities,
  name: string,
  metadata: Record<string, unknown>,
  params: Set<string> | undefined,
): ProviderCapabilities {
  const embeddingOnly = looksLikeEmbeddingModel(name, metadata, params);
  const vision = resolveFlag(
    booleanFrom(
      metadata.vision,
      nestedValue(metadata, ["capabilities", "vision"]),
      nestedValue(metadata, ["architecture", "modality"]),
    ),
    modalityIncludes(metadata, "vision", "image") ? true : undefined,
    params !== undefined && hasAny(params, ["image", "vision"])
      ? true
      : undefined,
    looksLikeVisionModel(name),
  );
  const audio = resolveFlag(
    modalityIncludes(metadata, "audio", "audio-input") ? true : undefined,
    looksLikeAudioModel(name),
  );
  const imageGeneration = resolveFlag(
    booleanFrom(
      metadata.image_generation,
      metadata.imageGeneration,
      nestedValue(metadata, ["capabilities", "image_generation"]),
      nestedValue(metadata, ["capabilities", "imageGeneration"]),
    ),
    outputIncludes(metadata, "image") ? true : undefined,
    looksLikeImageGenerationModel(name),
  );
  const toolCalling = resolveFlag(
    booleanFrom(
      nestedValue(metadata, ["capabilities", "tools"]),
      nestedValue(metadata, ["capabilities", "tool_calling"]),
    ),
    params === undefined
      ? undefined
      : hasAny(params, ["tools", "tool_choice", "functions"]),
    embeddingOnly || imageGeneration ? false : base.toolCalling,
  );
  const structuredJson = resolveFlag(
    booleanFrom(nestedValue(metadata, ["capabilities", "structured_json"])),
    params === undefined
      ? undefined
      : hasAny(params, [
          "response_format",
          "structured_outputs",
          "json_schema",
        ]),
    embeddingOnly || imageGeneration ? false : base.structuredJson,
  );
  const reasoning = resolveFlag(
    booleanFrom(
      metadata.reasoning,
      nestedValue(metadata, ["capabilities", "reasoning"]),
    ),
    params !== undefined
      ? hasAny(params, ["reasoning", "include_reasoning", "thinking"])
      : undefined,
    looksLikeReasoningModel(name) ? true : undefined,
    base.reasoning,
  );
  const temperature = resolveTemperature(name, params, reasoning);
  const modalities = uniqueModalities([
    ...(embeddingOnly ? (["embeddings"] as const) : (["text"] as const)),
    ...(vision ? (["vision"] as const) : []),
    ...(audio ? (["audio-input"] as const) : []),
  ]);
  return {
    ...base,
    audioInput: audio,
    imageGeneration,
    modalities,
    reasoning,
    structuredJson: embeddingOnly || imageGeneration ? false : structuredJson,
    temperature,
    toolCalling: embeddingOnly || imageGeneration ? false : toolCalling,
    vision,
  };
}

function resolveTemperature(
  name: string,
  params: Set<string> | undefined,
  reasoning: boolean,
): boolean {
  if (params !== undefined) return params.has("temperature");
  if (rejectsTemperatureByName(name)) return false;
  return !reasoning || !isReasoningOnlyFamily(name);
}

function inferContextWindow(name: string): number | undefined {
  const normalized = normalizeName(name);
  if (/\bclaude\b/u.test(normalized)) return 200_000;
  if (/\bgpt[-_. ]?5\b/u.test(normalized)) return 400_000;
  if (/\bo[1-4]\b/u.test(normalized)) return 200_000;
  if (
    /\bgpt[-_. ]?4o\b/u.test(normalized) ||
    /\bgpt[-_. ]?4[.]1\b/u.test(normalized)
  ) {
    return 128_000;
  }
  if (/\bdeepseek\b/u.test(normalized)) return 128_000;
  if (/\bgemini\b/u.test(normalized)) return 1_000_000;
  return undefined;
}

function inferMaxOutputTokens(
  name: string,
  contextWindow: number,
  capabilities: ProviderCapabilities,
): number | undefined {
  if (
    capabilities.modalities.includes("embeddings") &&
    !capabilities.modalities.includes("text")
  ) {
    return undefined;
  }
  if (capabilities.imageGeneration === true) return undefined;
  const normalized = normalizeName(name);
  if (/\bo[1-4]\b/u.test(normalized) || /\bgpt[-_. ]?5\b/u.test(normalized)) {
    return Math.min(100_000, contextWindow);
  }
  if (capabilities.reasoning) return Math.min(16_384, contextWindow);
  return Math.max(1, Math.min(8_192, Math.floor(contextWindow / 4) || 4_096));
}

export function looksLikeImageGenerationModel(name: string): boolean {
  return /(?:^|[-_.])(gpt[-_.]?image|dall[-_.]?e|imagegen|imagen|flux|stable[-_.]?diffusion)(?:$|[-_.0-9])/iu.test(
    name,
  );
}

function looksLikeEmbeddingModel(
  name: string,
  metadata: Record<string, unknown>,
  params: Set<string> | undefined,
): boolean {
  if (outputIncludes(metadata, "embedding", "embeddings")) return true;
  if (
    params !== undefined &&
    params.size > 0 &&
    ![...params].some((item) => item !== "dimensions")
  ) {
    return /embed/iu.test(name);
  }
  return /(?:^|[-_.])(embed|embedding|text[-_.]?embedding)(?:$|[-_.])/iu.test(
    name,
  );
}

function looksLikeVisionModel(name: string): boolean {
  return /(?:gpt[-_. ]?4o|gpt[-_. ]?4[.]1|claude|gemini|llava|pixtral|qwen[-_.]?vl|vision|grok[-_.]?2[-_.]?vision)/iu.test(
    name,
  );
}

function looksLikeAudioModel(name: string): boolean {
  return /(?:whisper|audio|speech|tts|transcri)/iu.test(name);
}

function looksLikeReasoningModel(name: string): boolean {
  const normalized = normalizeName(name);
  return (
    /\bo[1-4](?:[-_. ]|$)/u.test(normalized) ||
    /\bgpt[-_. ]?5\b/u.test(normalized) ||
    /\b(reasoner|reasoning|thinking|r1)\b/u.test(normalized) ||
    /\bdeepseek[-_. ]?(r1|reasoner|v4)\b/u.test(normalized) ||
    /\bqwq\b/u.test(normalized)
  );
}

function isReasoningOnlyFamily(name: string): boolean {
  const normalized = normalizeName(name);
  return (
    /\bo[1-4](?:[-_. ]|$)/u.test(normalized) ||
    /\b(reasoner|r1)\b/u.test(normalized)
  );
}

function rejectsTemperatureByName(name: string): boolean {
  const normalized = normalizeName(name);
  return (
    /\bo[1-4](?:[-_. ]|$)/u.test(normalized) ||
    /\bdeepseek[-_. ]?reasoner\b/u.test(normalized)
  );
}

function supportedParameters(
  metadata: Record<string, unknown>,
): Set<string> | undefined {
  const raw =
    metadata.supported_parameters ??
    metadata.supported_parameter ??
    nestedValue(metadata, ["capabilities", "supported_parameters"]);
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return new Set(raw.map((item) => String(item).toLowerCase()));
}

function readTokenPricing(
  metadata: Record<string, unknown>,
): ModelPricing | undefined {
  const pricing = asRecord(metadata.pricing) ?? metadata;
  const input = tokenUsd(
    pricing.inputTokenUsd ??
      pricing.prompt ??
      pricing.input ??
      pricing.input_cost_per_token,
  );
  const output = tokenUsd(
    pricing.outputTokenUsd ??
      pricing.completion ??
      pricing.output ??
      pricing.output_cost_per_token,
  );
  if (input === undefined || output === undefined) return undefined;
  if (input <= 0 || output <= 0) return undefined;
  return { inputTokenUsd: input, outputTokenUsd: output };
}

function tokenUsd(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed >= 0.001 ? parsed / 1_000_000 : parsed;
}

function modalityIncludes(
  metadata: Record<string, unknown>,
  ...needles: string[]
): boolean {
  const values = [
    ...arrayOfStrings(metadata.input_modalities),
    ...arrayOfStrings(metadata.output_modalities),
    ...arrayOfStrings(
      nestedValue(metadata, ["architecture", "input_modalities"]),
    ),
    ...arrayOfStrings(
      nestedValue(metadata, ["architecture", "output_modalities"]),
    ),
    ...arrayOfStrings(nestedValue(metadata, ["architecture", "modality"])),
  ];
  return values.some((value) =>
    needles.some((needle) => value.includes(needle)),
  );
}

function outputIncludes(
  metadata: Record<string, unknown>,
  ...needles: string[]
): boolean {
  const values = [
    ...arrayOfStrings(metadata.output_modalities),
    ...arrayOfStrings(
      nestedValue(metadata, ["architecture", "output_modalities"]),
    ),
  ];
  return values.some((value) =>
    needles.some((needle) => value.includes(needle)),
  );
}

function uniqueModalities(
  values: Array<ProviderCapabilities["modalities"][number]>,
): ProviderCapabilities["modalities"] {
  return [...new Set(values)];
}

function resolveFlag(...candidates: Array<boolean | undefined>): boolean {
  for (const value of candidates) {
    if (value !== undefined) return value;
  }
  return false;
}

function booleanFrom(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.toLowerCase();
      if (normalized.includes("vision") || normalized.includes("image->")) {
        return true;
      }
    }
  }
  return undefined;
}

function readPositiveInt(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function nestedNumber(
  record: Record<string, unknown>,
  path: string[],
): unknown {
  return nestedValue(record, path);
}

function nestedValue(record: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    const next = asRecord(current);
    if (next === undefined) return undefined;
    current = next[key];
  }
  return current;
}

function arrayOfStrings(value: unknown): string[] {
  if (typeof value === "string") return [value.toLowerCase()];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "string" ? [item.toLowerCase()] : [],
  );
}

function hasAny(params: Set<string>, keys: string[]): boolean {
  return keys.some((key) => params.has(key));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[_/]+/gu, "-");
}
