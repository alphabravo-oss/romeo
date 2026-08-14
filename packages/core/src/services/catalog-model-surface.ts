import { previewModelCompatibility } from "./provider-adapter-contracts";

export type CatalogSupportLevel = "emulated" | "native" | "unsupported";
export type CatalogProbeFreshness = "fresh" | "never" | "stale";

const FRESH_PROBE_MS = 24 * 60 * 60 * 1_000;

export interface CatalogModelSurface {
  contextWindow: number;
  deploymentBoundary: "hosted-api" | "local-runtime";
  maxOutputTokens?: number;
  modalities: string[];
  pricing?: {
    inputTokenUsd: number;
    outputTokenUsd: number;
  };
  probeFreshness: CatalogProbeFreshness;
  reasoning: CatalogSupportLevel;
  region?: string;
  tools: CatalogSupportLevel;
  vision: CatalogSupportLevel;
}

export function catalogSupportLevel(
  advertised: boolean,
  source?: "detected" | "override",
): CatalogSupportLevel {
  if (!advertised) return "unsupported";
  return source === "override" ? "emulated" : "native";
}

export function catalogProbeFreshness(
  probedAt: string | undefined,
  now: number,
): CatalogProbeFreshness {
  if (probedAt === undefined) return "never";
  const probed = Date.parse(probedAt);
  if (!Number.isFinite(probed)) return "never";
  return now - probed <= FRESH_PROBE_MS ? "fresh" : "stale";
}

export function catalogModelSurface(input: {
  deploymentMode: "hosted-api" | "local-runtime";
  model: {
    capabilities: {
      modalities: readonly string[];
      reasoning?: boolean;
      toolCalling: boolean;
      vision: boolean;
    };
    capabilitiesSource?: "detected" | "override";
    contextWindow: number;
    defaultParameters?: { maxOutputTokens?: number };
    pricing?: { inputTokenUsd: number; outputTokenUsd: number };
  };
  now?: number;
  probedAt?: string;
  region?: string;
}): CatalogModelSurface {
  const source = input.model.capabilitiesSource;
  return {
    contextWindow: input.model.contextWindow,
    deploymentBoundary: input.deploymentMode,
    modalities: [...input.model.capabilities.modalities],
    probeFreshness: catalogProbeFreshness(input.probedAt, input.now ?? Date.now()),
    reasoning: catalogSupportLevel(
      input.model.capabilities.reasoning === true,
      source,
    ),
    tools: catalogSupportLevel(input.model.capabilities.toolCalling, source),
    vision: catalogSupportLevel(input.model.capabilities.vision, source),
    ...(input.model.defaultParameters?.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: input.model.defaultParameters.maxOutputTokens }),
    ...(input.model.pricing === undefined
      ? {}
      : {
          pricing: {
            inputTokenUsd: input.model.pricing.inputTokenUsd,
            outputTokenUsd: input.model.pricing.outputTokenUsd,
          },
        }),
    ...(input.region === undefined ? {} : { region: input.region }),
  };
}

export function explainModelUnavailability(input: {
  model: {
    entitled: boolean;
    imageOutput: boolean;
    localRuntime: boolean;
    reasoning: boolean;
    regionAllowed: boolean;
    tools: boolean;
  };
  required: {
    attachments: boolean;
    imageOutput: boolean;
    localOnly: boolean;
    reasoning: boolean;
    tools: boolean;
  };
}) {
  return previewModelCompatibility({
    model: input.model,
    required: input.required,
  });
}
