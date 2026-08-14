import type { BaseModel, Provider } from "../features/providers/types";

export type CatalogSupportLevel = "emulated" | "native" | "unsupported";
export type CatalogProbeFreshness = "fresh" | "never" | "stale";

const FRESH_PROBE_MS = 24 * 60 * 60 * 1_000;

export interface CatalogModelSurfaceView {
  contextWindow: number;
  deploymentBoundary: "hosted-api" | "local-runtime";
  maxOutputTokens?: number;
  modalities: string[];
  pricing?: { inputTokenUsd: number; outputTokenUsd: number };
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
  now = Date.now(),
): CatalogProbeFreshness {
  if (probedAt === undefined) return "never";
  const probed = Date.parse(probedAt);
  if (!Number.isFinite(probed)) return "never";
  return now - probed <= FRESH_PROBE_MS ? "fresh" : "stale";
}

export function modelCatalogSurface(
  model: BaseModel & {
    catalogSurface?: CatalogModelSurfaceView;
    probedAt?: string;
  },
  provider?: Provider & { region?: string },
): CatalogModelSurfaceView {
  if (model.catalogSurface !== undefined) return model.catalogSurface;
  const source = model.capabilitiesSource;
  return {
    contextWindow: model.contextWindow,
    deploymentBoundary: model.capabilities.deployment.mode,
    modalities: [...model.capabilities.modalities],
    probeFreshness: catalogProbeFreshness(model.probedAt),
    reasoning: catalogSupportLevel(model.capabilities.reasoning === true, source),
    tools: catalogSupportLevel(model.capabilities.toolCalling, source),
    vision: catalogSupportLevel(model.capabilities.vision, source),
    ...(model.defaultParameters?.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: model.defaultParameters.maxOutputTokens }),
    ...(model.pricing === undefined
      ? {}
      : {
          pricing: {
            inputTokenUsd: model.pricing.inputTokenUsd,
            outputTokenUsd: model.pricing.outputTokenUsd,
          },
        }),
    ...(provider?.region === undefined ? {} : { region: provider.region }),
  };
}

export function catalogUnavailableReason(model: BaseModel):
  | "not_entitled"
  | "not_in_latest_sync"
  | undefined {
  if (model.available === false) return "not_in_latest_sync";
  if (!model.enabled) return "not_entitled";
  return undefined;
}
