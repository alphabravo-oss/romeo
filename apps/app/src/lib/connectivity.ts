import { useSyncExternalStore } from "react";

export type MutationNetworkGate =
  | "offline"
  | "ready"
  | "revalidating"
  | "revalidation_failed";

export class MutationNetworkBlockedError extends Error {
  readonly code = "mutation_network_blocked";

  constructor(readonly gate: MutationNetworkGate) {
    super("Changes are unavailable until the secure connection is ready.");
    this.name = "MutationNetworkBlockedError";
  }
}

let mutationNetworkGate: MutationNetworkGate = browserIsOnline()
  ? "ready"
  : "offline";

export function subscribeToNetworkStatus(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function browserIsOnline(): boolean {
  return typeof navigator === "undefined" ||
    typeof navigator.onLine !== "boolean"
    ? true
    : navigator.onLine;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeToNetworkStatus,
    browserIsOnline,
    () => true,
  );
}

export function mutationNetworkState(): MutationNetworkGate {
  return browserIsOnline() ? mutationNetworkGate : "offline";
}

export function markMutationNetworkOffline(): void {
  mutationNetworkGate = "offline";
}

export function beginMutationNetworkRevalidation(): void {
  mutationNetworkGate = "revalidating";
}

export function completeMutationNetworkRevalidation(): void {
  mutationNetworkGate = "ready";
}

export function failMutationNetworkRevalidation(): void {
  mutationNetworkGate = "revalidation_failed";
}

export function assertMutationNetworkReady(): void {
  const gate = mutationNetworkState();
  if (gate !== "ready") throw new MutationNetworkBlockedError(gate);
}
