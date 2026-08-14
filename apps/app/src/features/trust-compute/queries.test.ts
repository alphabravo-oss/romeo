import { afterEach, describe, expect, it, vi } from "vitest";

import { getTrustPosture } from "./queries";
import {
  admitComputeArtifact,
  authorizeRuntimeImage,
  evaluateSandboxPosture,
  previewComputeOperations,
} from "./mutations";
import {
  hardenedSandboxPreview,
  publicRuntimeImagePreview,
  traversalArtifactPreview,
  unavailableOpsPreview,
} from "./previews";
import { trustPostureQueryOptions } from "./query-options";
import {
  evaluateSandboxPostureMutationOptions,
  previewComputeOperationsMutationOptions,
} from "./mutation-options";
import * as appQueryKeys from "../../lib/app-query-keys";

function mockFetch(returnBody: unknown) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(returnBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("trust and compute generated surfaces", () => {
  it("loads trust posture without treating missing config as synthetic green", async () => {
    const fetchMock = mockFetch({
      data: {
        keys: "not_configured",
        residency: "not_configured",
        dlp: "not_applicable",
        acl: "not_configured",
        syntheticGreen: false,
      },
    });
    const posture = await getTrustPosture();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/trust/posture",
      expect.objectContaining({ method: "GET" }),
    );
    expect(posture).toEqual({
      keys: "not_configured",
      residency: "not_configured",
      dlp: "not_applicable",
      acl: "not_configured",
      syntheticGreen: false,
    });
    expect(trustPostureQueryOptions().queryKey).toEqual(
      appQueryKeys.trustPosture(),
    );
  });

  it("posts sandbox, image, intake, and ops previews to the authorized routes", async () => {
    const responses: Record<string, unknown> = {
      "/api/v1/compute/sandbox/posture": { outcome: "accepted" },
      "/api/v1/compute/runtime-images/authorize": {
        code: "compute_public_package_install_denied",
        outcome: "denied",
      },
      "/api/v1/compute/artifacts/intake": {
        code: "compute_artifact_intake_denied",
        outcome: "denied",
      },
      "/api/v1/compute/operations/posture": {
        alerts: ["capacity_exhausted"],
        lastRejectionCode: "compute_runtime_uninstalled",
        state: "unavailable",
      },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const data = responses[path];
      if (data === undefined) {
        throw new Error(`unexpected preview route ${path}`);
      }
      expect(init?.method).toBe("POST");
      expect(String(init?.body ?? "")).toContain("{");
      return new Response(JSON.stringify({ data }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      evaluateSandboxPosture(hardenedSandboxPreview),
    ).resolves.toEqual({ outcome: "accepted" });
    await expect(
      authorizeRuntimeImage(publicRuntimeImagePreview),
    ).resolves.toEqual({
      code: "compute_public_package_install_denied",
      outcome: "denied",
    });
    await expect(admitComputeArtifact(traversalArtifactPreview)).resolves.toEqual(
      {
        code: "compute_artifact_intake_denied",
        outcome: "denied",
      },
    );
    await expect(
      previewComputeOperations(unavailableOpsPreview),
    ).resolves.toMatchObject({
      lastRejectionCode: "compute_runtime_uninstalled",
      state: "unavailable",
    });

    const posts = fetchMock.mock.calls.map(([url, init]) => ({
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      method: init?.method,
      url: String(url),
    }));
    expect(posts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          body: expect.objectContaining({
            nonRoot: true,
            teardown: "deterministic",
          }),
          method: "POST",
          url: "/api/v1/compute/sandbox/posture",
        }),
        expect.objectContaining({
          body: expect.objectContaining({
            publicPackageInstall: true,
            signed: true,
          }),
          method: "POST",
          url: "/api/v1/compute/runtime-images/authorize",
        }),
        expect.objectContaining({
          body: expect.objectContaining({
            outputPath: "../secret.csv",
          }),
          method: "POST",
          url: "/api/v1/compute/artifacts/intake",
        }),
        expect.objectContaining({
          body: expect.objectContaining({
            capacityRemaining: 0,
          }),
          method: "POST",
          url: "/api/v1/compute/operations/posture",
        }),
      ]),
    );
    expect(posts).toHaveLength(4);
    expect(evaluateSandboxPostureMutationOptions().meta).toMatchObject({
      ephemeral: true,
      mutationPolicy: "compute.sandbox.posture",
    });
    expect(previewComputeOperationsMutationOptions().meta).toMatchObject({
      ephemeral: true,
      mutationPolicy: "compute.operations.posture",
    });
  });
});
