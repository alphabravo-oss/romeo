import type { RomeoEnv } from "@romeo/config";
import type { ObjectStore } from "@romeo/storage";

import { fail, pass, warn, type ReadinessCheck } from "./readiness-result";

export async function objectStorageReadinessCheck(
  env: RomeoEnv,
  objectStore: ObjectStore | undefined,
): Promise<ReadinessCheck> {
  if (env.OBJECT_STORE_DRIVER === "memory") {
    return warn("object_storage", "Memory object storage is enabled.", {
      required: "OBJECT_STORE_DRIVER=s3",
    });
  }
  if (objectStore?.checkReadiness === undefined) {
    return fail(
      "object_storage",
      "critical",
      "Durable object storage does not expose a live readiness probe.",
      { driver: "s3", liveProbe: false },
    );
  }
  try {
    const result = await objectStore.checkReadiness();
    const details = {
      authenticated: result.authenticated,
      deleteVerified: result.deleteVerified,
      encryptionConfigured: result.encryptionConfigured,
      lifecycleConfigured: result.lifecycleConfigured,
      readAfterWriteVerified: result.readAfterWriteVerified,
      replicationConfigured: result.replicationConfigured,
      tlsEnabled: result.tlsEnabled,
      versioningEnabled: result.versioningEnabled,
      writeVerified: result.writeVerified,
    };
    return result.ready
      ? pass(
          "object_storage",
          "Durable object storage passed live security and data-plane checks.",
          details,
        )
      : fail(
          "object_storage",
          "critical",
          "Durable object storage failed required security or durability checks.",
          details,
        );
  } catch {
    return fail(
      "object_storage",
      "critical",
      "Durable object storage readiness could not be verified.",
      { driver: "s3", liveProbe: false },
    );
  }
}
