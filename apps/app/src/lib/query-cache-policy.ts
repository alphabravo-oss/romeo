import { queryRetryDelay, shouldRetryQuery } from "./query-policy";

const retryPolicy = {
  networkMode: "online" as const,
  retry: shouldRetryQuery,
  retryDelay: queryRetryDelay,
} as const;

export const queryCacheProfiles = {
  volatile: {
    ...retryPolicy,
    gcTime: 5 * 60_000,
    refetchOnReconnect: "always" as const,
    refetchOnWindowFocus: true,
    staleTime: 0,
  },
  interactive: {
    ...retryPolicy,
    gcTime: 30 * 60_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  },
  stable: {
    ...retryPolicy,
    gcTime: 60 * 60_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  },
  immutable: {
    ...retryPolicy,
    gcTime: 24 * 60 * 60_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  },
} as const;

export type QueryCacheProfile = keyof typeof queryCacheProfiles;
