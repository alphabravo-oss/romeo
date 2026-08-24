import { seededSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import type { RunRecord } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { FileService } from "./file-service";
import { storeProviderOutputFile } from "./run-provider-output-file-service";

describe("provider output file persistence", () => {
  it("uses the governed file lifecycle and stores real provider bytes", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const [model, provider] = await Promise.all([
      repository.getModel("model_openai_compatible_default"),
      repository.getProvider("provider_openai_compatible"),
    ]);
    if (model === undefined || provider === undefined)
      throw new Error("Expected seeded provider catalog");
    const run: RunRecord = {
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      chatId: "chat_welcome",
      createdAt: "2026-08-23T12:00:00.000Z",
      createdBy: seededSubject.id,
      id: "run_provider_output_file",
      modelId: model.id,
      orgId: seededSubject.orgId,
      providerId: provider.id,
      status: "running",
      workspaceId: "workspace_default",
    };
    const bytes = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );

    const stored = await storeProviderOutputFile({
      fileService: new FileService(repository, objectStore),
      index: 0,
      model,
      part: { bytes, mediaType: "image/png", type: "image" },
      provider,
      run,
      subject: seededSubject,
    });

    const file = await repository.getFileObject(stored.fileId);
    expect(file).toMatchObject({
      metadata: {
        modelId: model.id,
        providerId: provider.id,
        runId: run.id,
        source: "provider_output",
      },
      mimeType: "image/png",
      purpose: "generated_image",
      sizeBytes: bytes.byteLength,
      status: "quarantined",
      lifecycleAttempts: 0,
    });
    expect(await objectStore.getObject(file!.objectKey)).toEqual(bytes);
    expect(
      (await repository.listResourceGrants(run.orgId)).filter(
        (grant) => grant.resourceId === stored.fileId,
      ),
    ).toHaveLength(2);
  });

  it("rejects mislabeled provider bytes before creating a file", async () => {
    const repository = new InMemoryRomeoRepository();
    const [model, provider] = await Promise.all([
      repository.getModel("model_openai_compatible_default"),
      repository.getProvider("provider_openai_compatible"),
    ]);
    if (model === undefined || provider === undefined)
      throw new Error("Expected seeded provider catalog");
    await expect(
      storeProviderOutputFile({
        fileService: new FileService(repository, new MemoryObjectStore()),
        index: 0,
        model,
        part: {
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: "image/png",
          type: "image",
        },
        provider,
        run: {
          agentId: "agent_default",
          agentVersionId: "agent_version_default_v1",
          chatId: "chat_welcome",
          createdAt: "2026-08-23T12:00:00.000Z",
          createdBy: seededSubject.id,
          id: "run_provider_output_invalid",
          modelId: model.id,
          orgId: seededSubject.orgId,
          providerId: provider.id,
          status: "running",
          workspaceId: "workspace_default",
        },
        subject: seededSubject,
      }),
    ).rejects.toMatchObject({ code: "file_mime_mismatch", status: 415 });
  });
});
