import { describe, expect, it } from "vitest";

import type { AuthSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";

import type { FileObject, FileObjectPurpose } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { FileService } from "./file-service";
import { WorkspaceContentService } from "./workspace-content-service";

const subject: AuthSubject = {
  id: "user_file_catalog",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: ["group_file_catalog"],
  scopes: ["files:read", "files:write"],
};

describe("authorized file catalog pagination", () => {
  it("applies file grants and content scope before totals and limits", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const files = new FileService(repository, objectStore);
    const content = new WorkspaceContentService(repository, files, objectStore);
    const owned = fileFixture("file_catalog_owned", "general", subject.id);
    const groupShared = fileFixture(
      "file_catalog_group",
      "general",
      "another_user",
    );
    const hidden = fileFixture(
      "file_catalog_hidden",
      "general",
      "another_user",
    );
    const workspaceMemory = fileFixture(
      "file_catalog_workspace_memory",
      "memory",
      "another_user",
      { scope: "workspace", title: "Workspace preference" },
    );
    const personalMemory = fileFixture(
      "file_catalog_personal_memory",
      "memory",
      "another_user",
      { scope: "personal", title: "Private preference" },
    );
    const ownedMemory = fileFixture(
      "file_catalog_owned_memory",
      "memory",
      subject.id,
      { scope: "personal", title: "Owned preference" },
    );
    for (const file of [
      owned,
      groupShared,
      hidden,
      workspaceMemory,
      personalMemory,
      ownedMemory,
    ]) {
      await repository.createFileObject(file);
      await objectStore.putObject({
        key: file.objectKey,
        body: new TextEncoder().encode(`body:${file.id}`),
        contentType: file.mimeType,
      });
    }
    await repository.createResourceGrant({
      id: "grant_file_catalog_group",
      resourceType: "file",
      resourceId: groupShared.id,
      principalType: "group",
      principalId: "group_file_catalog",
      permission: "read",
    });

    const first = await files.listPage(subject, {
      excludePurposes: ["memory", "note"],
      workspaceId: "workspace_default",
      limit: 1,
      offset: 0,
    });
    const second = await files.listPage(subject, {
      excludePurposes: ["memory", "note"],
      workspaceId: "workspace_default",
      limit: 1,
      offset: 1,
    });
    const memories = await content.listPage(subject, "memory", {
      workspaceId: "workspace_default",
      limit: 10,
      offset: 0,
      query: "preference",
    });

    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect(
      new Set([...first.items, ...second.items].map((file) => file.id)),
    ).toEqual(new Set([owned.id, groupShared.id]));
    expect(memories.total).toBe(2);
    expect(memories.items.map((item) => item.id).sort()).toEqual(
      [ownedMemory.id, workspaceMemory.id].sort(),
    );
  });
});

function fileFixture(
  id: string,
  purpose: FileObjectPurpose,
  ownerId: string,
  metadata: Record<string, unknown> = {},
): FileObject {
  return {
    id,
    orgId: "org_default",
    workspaceId: "workspace_default",
    ownerType: "user",
    ownerId,
    fileName: `${id}.txt`,
    mimeType: "text/plain",
    sizeBytes: 8,
    sha256: "a".repeat(64),
    objectKey: `files/catalog/${id}`,
    purpose,
    status: "available",
    metadata,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: `2026-07-16T12:00:${id.endsWith("owned") ? "02" : "01"}.000Z`,
  };
}
