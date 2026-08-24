import type { BaseModel } from "@romeo/providers";

const REASONING_STREAM_TIMEOUT_FLOOR_MS = 180_000;

export function providerTimeoutFields(
  configuredMs: number | undefined,
  model: BaseModel,
): { providerTimeoutMs: number } | Record<string, never> {
  if (configuredMs === undefined) return {};
  return {
    providerTimeoutMs:
      model.capabilities.reasoning === true
        ? Math.max(configuredMs, REASONING_STREAM_TIMEOUT_FLOOR_MS)
        : configuredMs,
  };
}
