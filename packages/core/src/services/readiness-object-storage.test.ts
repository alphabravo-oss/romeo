import { MemoryObjectStore, type ObjectStore } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import { testEnv } from "../test-support/env";
import { objectStorageReadinessCheck } from "./readiness-object-storage";

const readyResult = {
  authenticated: true,
  deleteVerified: true,
  encryptionConfigured: true,
  lifecycleConfigured: true,
  readAfterWriteVerified: true,
  ready: true,
  replicationConfigured: false,
  tlsEnabled: true,
  versioningEnabled: true,
  writeVerified: true,
};

function probedStore(
  checkReadiness: NonNullable<ObjectStore["checkReadiness"]>,
): ObjectStore {
  const store = new MemoryObjectStore();
  return Object.assign(store, { checkReadiness });
}

describe("object storage readiness", () => {
  it("passes only after live posture and data-plane checks pass", async () => {
    const check = await objectStorageReadinessCheck(
      testEnv({ OBJECT_STORE_DRIVER: "s3" }),
      probedStore(async () => readyResult),
    );
    expect(check).toMatchObject({
      id: "object_storage",
      status: "pass",
      details: {
        authenticated: true,
        deleteVerified: true,
        encryptionConfigured: true,
        lifecycleConfigured: true,
        readAfterWriteVerified: true,
        tlsEnabled: true,
        versioningEnabled: true,
        writeVerified: true,
      },
    });
  });

  it("fails closed for a missing probe, failed requirement, or probe error", async () => {
    const env = testEnv({ OBJECT_STORE_DRIVER: "s3" });
    const checks = await Promise.all([
      objectStorageReadinessCheck(env, new MemoryObjectStore()),
      objectStorageReadinessCheck(
        env,
        probedStore(async () => ({ ...readyResult, ready: false })),
      ),
      objectStorageReadinessCheck(
        env,
        probedStore(async () => {
          throw new Error("bucket and endpoint must stay private");
        }),
      ),
    ]);
    expect(checks.every((check) => check.status === "fail")).toBe(true);
    expect(JSON.stringify(checks)).not.toMatch(/bucket|endpoint/);
  });
});
