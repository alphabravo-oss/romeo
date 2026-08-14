import { isPrivateNetworkHost } from "./network-host-policy";

export type ComputeRuntimeProfile = "kata_qemu" | "uninstalled";

export interface ComputeJobLease {
  jobId: string;
  runnerId: string;
  leaseToken: string;
  expiresAt: string;
}

export interface ComputeEgressRequest {
  hostname: string;
  approvedDestinations: readonly string[];
}

export type ComputeAuthorization =
  | { outcome: "accepted"; jobId: string }
  | {
      outcome: "denied";
      code:
        | "capability_platform_disabled"
        | "compute_runtime_uninstalled"
        | "compute_egress_denied"
        | "compute_lease_lost";
    };

export function authorizeComputeJob(input: {
  platformDisabled: boolean;
  runtime: ComputeRuntimeProfile;
  jobId: string;
}): ComputeAuthorization {
  if (input.platformDisabled)
    return { outcome: "denied", code: "capability_platform_disabled" };
  if (input.runtime !== "kata_qemu")
    return { outcome: "denied", code: "compute_runtime_uninstalled" };
  return { outcome: "accepted", jobId: input.jobId };
}

export function evaluateComputeEgress(
  request: ComputeEgressRequest,
): ComputeAuthorization {
  const host = request.hostname.trim().toLowerCase();
  if (
    host.length === 0 ||
    isPrivateNetworkHost(host) ||
    !request.approvedDestinations.includes(host)
  )
    return { outcome: "denied", code: "compute_egress_denied" };
  return { outcome: "accepted", jobId: "" };
}

export function recoverComputeLease(input: {
  lease?: ComputeJobLease;
  runnerId: string;
  now: string;
}): ComputeAuthorization {
  if (input.lease === undefined)
    return { outcome: "denied", code: "compute_lease_lost" };
  if (input.lease.runnerId !== input.runnerId)
    return { outcome: "denied", code: "compute_lease_lost" };
  if (Date.parse(input.lease.expiresAt) <= Date.parse(input.now))
    return { outcome: "denied", code: "compute_lease_lost" };
  return { outcome: "accepted", jobId: input.lease.jobId };
}

export function computeHasAmbientSecrets(
  env: Record<string, string | undefined>,
): boolean {
  return [
    "DATABASE_URL",
    "SECRET_ENCRYPTION_KEY",
    "OPENAI_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
  ].some((name) => (env[name] ?? "").length > 0);
}
