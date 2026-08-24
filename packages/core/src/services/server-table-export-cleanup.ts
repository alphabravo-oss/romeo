import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { RomeoRepository } from "../domain/repository";
import { writeAuditLog } from "./audit-log";
import {
  cleanExportPayload,
  deleteExportObjects,
  parseExportManifest,
  parseExportPayload,
  TABLE_EXPORT_JOB_TYPE,
  TABLE_EXPORT_MAX_MANIFEST_BYTES,
} from "./server-table-export-support";

export async function deleteTableExport(input: {
  jobId: string;
  objectStore: ObjectStore;
  repository: RomeoRepository;
  subject: AuthSubject;
}): Promise<{ deleted: true }> {
  const stored = await input.repository.getBackgroundJob(
    input.subject.orgId,
    input.jobId,
  );
  const payload =
    stored === undefined ? undefined : parseExportPayload(stored.payload);
  if (
    stored === undefined ||
    stored.type !== TABLE_EXPORT_JOB_TYPE ||
    payload === undefined
  )
    return { deleted: true };
  if (payload.artifact !== undefined) {
    const manifestBytes = await input.objectStore.getObject(
      payload.artifact.key,
      {
        maxBytes: TABLE_EXPORT_MAX_MANIFEST_BYTES,
      },
    );
    const manifest =
      manifestBytes === undefined
        ? undefined
        : parseExportManifest(
            JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown,
          );
    if (manifest !== undefined)
      await deleteExportObjects(input.objectStore, manifest.partKeys);
    await input.objectStore.deleteObject(payload.artifact.key);
  }
  await deleteExportObjects(input.objectStore, payload.partKeys);
  const now = new Date().toISOString();
  const { artifact: _artifact, cursor: _cursor, ...withoutArtifact } = payload;
  await input.repository.updateBackgroundJob({
    ...stored,
    status: "completed",
    completedAt: now,
    updatedAt: now,
    payload: cleanExportPayload({
      ...withoutArtifact,
      state: "expired",
      partKeys: [],
    }),
  });
  await writeAuditLog(input.repository, {
    subject: input.subject,
    action: "admin.table_export.delete",
    resourceType: "table_export",
    resourceId: input.jobId,
    metadata: { resource: payload.snapshot.resource },
  });
  return { deleted: true };
}
