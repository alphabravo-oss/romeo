import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ImageJobStore } from "./image-job-store";

describe("image job store", () => {
  it("reads file readiness and cancels only a stored job", async () => {
    const repository = new InMemoryRomeoRepository();
    const store = new ImageJobStore(repository);
    await repository.createFileObject({
      id: "file_ready",
      orgId: "org_default",
      workspaceId: "workspace_default",
      ownerType: "user",
      ownerId: seededSubject.id,
      fileName: "ready.png",
      mimeType: "image/png",
      sizeBytes: 8,
      sha256: "a".repeat(64),
      objectKey: "files/ready.png",
      purpose: "general",
      status: "ready",
      lifecycleVersion: 1,
      metadata: {},
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
    });
    await repository.createFileObject({
      id: "file_uploading",
      orgId: "org_default",
      workspaceId: "workspace_default",
      ownerType: "user",
      ownerId: seededSubject.id,
      fileName: "pending.png",
      mimeType: "image/png",
      sizeBytes: 8,
      sha256: "b".repeat(64),
      objectKey: "files/pending.png",
      purpose: "general",
      status: "uploading",
      lifecycleVersion: 1,
      metadata: {},
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
    });

    expect(
      (
        await store.create({
          subject: seededSubject,
          workspaceId: "workspace_default",
          kind: "edit",
          sourceFileId: "file_uploading",
          platformDisabled: false,
        })
      ).outcome,
    ).toBe("denied");
    const created = await store.create({
      subject: seededSubject,
      workspaceId: "workspace_default",
      kind: "edit",
      sourceFileId: "file_ready",
      platformDisabled: false,
    });
    expect(created.outcome).toBe("accepted");
    if (created.outcome !== "accepted") return;
    expect(created.job.source).toEqual({
      fileId: "file_ready",
      ready: true,
      revoked: false,
    });
    await expect(
      store.cancel({ subject: seededSubject, jobId: "image_job_missing" }),
    ).rejects.toMatchObject({ code: "not_found" });
    const cancelled = await store.cancel({
      subject: seededSubject,
      jobId: created.job.id,
    });
    expect(cancelled).toMatchObject({
      outcome: "accepted",
      job: { state: "cancelled" },
    });
  });
});
