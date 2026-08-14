import { fileTombstoneFields } from "@romeo/core";
import { and, count, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { messageFileReferences, objectRecords, resourceGrants } from "./schema";

type FileDeletionDatabase = Pick<RomeoDatabase, "delete" | "select" | "update">;

export async function deleteFileObjectData(
  db: FileDeletionDatabase,
  orgId: string,
  fileId: string,
): Promise<void> {
  const [{ value: referenceCount = 0 } = {}] = await db
    .select({ value: count() })
    .from(messageFileReferences)
    .where(eq(messageFileReferences.fileId, fileId));
  if (Number(referenceCount) > 0)
    throw new Error(
      "Cannot delete a file while governed message references exist.",
    );
  const deletedAt = new Date();
  await db
    .delete(resourceGrants)
    .where(
      and(
        eq(resourceGrants.orgId, orgId),
        eq(resourceGrants.resourceType, "file"),
        eq(resourceGrants.resourceId, fileId),
      ),
    );
  await db
    .update(objectRecords)
    .set({
      ...fileTombstoneFields(fileId, deletedAt.toISOString()),
      deletedAt,
      updatedAt: deletedAt,
    })
    .where(and(eq(objectRecords.orgId, orgId), eq(objectRecords.id, fileId)));
}
