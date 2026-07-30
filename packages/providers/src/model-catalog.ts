/**
 * Provider catalogs are bounded to keep a misconfigured or hostile endpoint
 * from exhausting the process. The limit is intentionally well above the
 * catalog size of mainstream hosted and local providers.
 */
export const MAX_DISCOVERED_MODELS = 2_000;
