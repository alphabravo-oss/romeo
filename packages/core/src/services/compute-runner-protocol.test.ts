import { describe, expect, it } from "vitest";

import {
  authorizeComputeJob,
  computeHasAmbientSecrets,
  evaluateComputeEgress,
  recoverComputeLease,
} from "./compute-runner-protocol";

describe("compute runner protocol", () => {
  it("fails closed when uninstalled or platform-disabled and never runs on the host", () => {
    expect(
      authorizeComputeJob({
        platformDisabled: true,
        runtime: "kata_qemu",
        jobId: "job_1",
      }),
    ).toEqual({
      outcome: "denied",
      code: "capability_platform_disabled",
    });
    expect(
      authorizeComputeJob({
        platformDisabled: false,
        runtime: "uninstalled",
        jobId: "job_1",
      }),
    ).toEqual({
      outcome: "denied",
      code: "compute_runtime_uninstalled",
    });
    expect(
      authorizeComputeJob({
        platformDisabled: false,
        runtime: "kata_qemu",
        jobId: "job_1",
      }),
    ).toEqual({ outcome: "accepted", jobId: "job_1" });
  });

  it("default-denies egress and recovers only a live matching lease", () => {
    expect(
      evaluateComputeEgress({
        hostname: "169.254.169.254",
        approvedDestinations: ["example.com"],
      }),
    ).toEqual({ outcome: "denied", code: "compute_egress_denied" });
    expect(
      evaluateComputeEgress({
        hostname: "example.com",
        approvedDestinations: ["example.com"],
      }),
    ).toMatchObject({ outcome: "accepted" });
    expect(
      recoverComputeLease({
        lease: {
          jobId: "job_1",
          runnerId: "runner_a",
          leaseToken: "tok",
          expiresAt: "2026-08-14T10:00:00.000Z", // deliberately-expired: foreign runner
        },
        runnerId: "runner_b",
        now: "2026-08-14T09:59:00.000Z",
      }),
    ).toEqual({ outcome: "denied", code: "compute_lease_lost" });
    expect(
      recoverComputeLease({
        lease: {
          jobId: "job_1",
          runnerId: "runner_a",
          leaseToken: "tok",
          expiresAt: "2027-08-14T10:00:00.000Z",
        },
        runnerId: "runner_a",
        now: "2026-08-14T09:59:00.000Z",
      }),
    ).toEqual({ outcome: "accepted", jobId: "job_1" });
    expect(
      computeHasAmbientSecrets({ OPENAI_API_KEY: "sk-test" }),
    ).toBe(true);
    expect(computeHasAmbientSecrets({})).toBe(false);
  });
});
