import { devQueryDiagnosticMeta } from "./query-cache-diagnostics";
import {
  queryCacheProfiles,
  type QueryCacheProfile,
} from "./query-cache-policy";

/**
 * Shared policy for app-owned server queries. Resource factories remain
 * responsible for their key, loader, enabled state, and any deliberate
 * polling/structural-sharing behavior; callers receive a closed option object
 * and cannot replace cache or retry policy at the component boundary.
 */
export function serverQueryPolicy(
  profile: QueryCacheProfile,
  resource: string,
  dimensions: Record<string, unknown> = {},
) {
  return {
    ...queryCacheProfiles[profile],
    meta: {
      ssr: false,
      ...devQueryDiagnosticMeta(resource, dimensions),
    },
  } as const;
}

/**
 * Gives every handwritten loader consistent cancellation semantics. Generated
 * SDK option factories already pass Query's AbortSignal to fetch directly.
 * Legacy loaders may additionally consume the signal; either way an aborted
 * request can never commit a late value to the cache.
 */
export async function abortableQuery<T>(
  signal: AbortSignal,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const value = await load(signal);
  signal.throwIfAborted();
  return value;
}
