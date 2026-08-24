import { describe, expect, it, vi } from "vitest";

import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import { createScheduledRuntimeWorkers } from "./scheduled-runtime-workers";
import type { RomeoServices } from "./service-registry-types";

describe("scheduled runtime workers", () => {
  it("deploys the file lifecycle queue through the supervised tenant worker", async () => {
    const repository = new InMemoryRomeoRepository();
    const processLifecycleJob = vi.fn(async () => ({ outcome: "idle" }));
    const coordinator = createScheduledRuntimeWorkers({
      createServices: () =>
        ({ files: { processLifecycleJob } }) as unknown as RomeoServices,
      env: testEnv(),
      scope: inMemoryScope(repository),
    });

    const report = await coordinator.runOnce("file_lifecycle");

    expect(processLifecycleJob).toHaveBeenCalledWith({
      workerId: "scheduled_file_lifecycle_org_default",
    });
    expect(report).toMatchObject({ claimed: 1, failed: 0, succeeded: 1 });
  });

  it("deploys the content deletion outbox through the supervised tenant worker", async () => {
    const repository = new InMemoryRomeoRepository();
    const processContentDeletionJob = vi.fn(async () => ({ outcome: "idle" }));
    const coordinator = createScheduledRuntimeWorkers({
      createServices: () =>
        ({
          knowledge: { processContentDeletionJob },
        }) as unknown as RomeoServices,
      env: testEnv(),
      scope: inMemoryScope(repository),
    });

    const report = await coordinator.runOnce("content_deletion");

    expect(processContentDeletionJob).toHaveBeenCalledWith({
      subject: expect.objectContaining({ orgId: "org_default" }),
      workerId: "scheduled_content_deletion_org_default",
    });
    expect(report).toMatchObject({ claimed: 1, failed: 0, succeeded: 1 });
  });
});

function inMemoryScope(
  repository: InMemoryRomeoRepository,
): RepositoryRequestScope {
  return {
    runAsSystem: (work) => repository.transaction(work),
    runAsTenant: (_orgId, work) => repository.transaction(work),
  };
}
