import type { FileObject } from "../domain/entities";
import type { AuthorizedFileCatalogQuery } from "../domain/repository";
import type { SeedData } from "./seed-data";
import { assertFileLifecycleTransition } from "../services/file-lifecycle";
import { append, replaceById } from "./collection-helpers";

export function listInMemoryFiles(
  data: SeedData,
  orgId: string,
  workspaceId?: string,
): FileObject[] {
  return data.fileObjects
    .filter(
      (file) =>
        file.orgId === orgId &&
        (workspaceId === undefined || file.workspaceId === workspaceId),
    )
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id),
    );
}

export function createInMemoryFile(data: SeedData, file: FileObject): FileObject {
  return append(data.fileObjects, {
    ...file,
    lifecycleVersion: file.lifecycleVersion ?? 0,
    lifecycleAttempts: file.lifecycleAttempts ?? 0,
  });
}

export function updateInMemoryFile(data: SeedData, file: FileObject): FileObject {
  const current = data.fileObjects.find((candidate) => candidate.id === file.id);
  if (current !== undefined) assertFileLifecycleTransition(current, file);
  return replaceById(data.fileObjects, file);
}

export function listAuthorizedInMemoryFilesPage(
  data: Pick<SeedData, "fileObjects" | "grants">,
  input: AuthorizedFileCatalogQuery,
): { items: FileObject[]; total: number } {
  const query = input.query?.trim().toLocaleLowerCase() ?? "";
  const visible = data.fileObjects
    .filter(
      (file) =>
        file.orgId === input.orgId &&
        file.workspaceId === input.workspaceId &&
        file.status !== "deleted",
    )
    .filter(
      (file) =>
        input.purposes === undefined || input.purposes.includes(file.purpose),
    )
    .filter(
      (file) =>
        input.excludePurposes === undefined ||
        !input.excludePurposes.includes(file.purpose),
    )
    .filter((file) => matchesQuery(file, query))
    .filter((file) => hasCatalogAccess(data, input, file))
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id),
    );
  return {
    items: visible.slice(input.offset, input.offset + input.limit),
    total: visible.length,
  };
}

function matchesQuery(file: FileObject, query: string): boolean {
  if (query === "") return true;
  const title =
    typeof file.metadata.title === "string" ? file.metadata.title : "";
  return `${file.fileName} ${file.mimeType} ${title}`
    .toLocaleLowerCase()
    .includes(query);
}

function hasCatalogAccess(
  data: Pick<SeedData, "grants">,
  input: AuthorizedFileCatalogQuery,
  file: FileObject,
): boolean {
  if (input.isAdmin) return true;
  if (
    file.ownerType === input.principalType &&
    file.ownerId === input.principalId
  )
    return true;
  if (
    input.accessMode === "workspace_content" &&
    file.metadata.scope === "workspace"
  )
    return true;
  return (
    input.accessMode === "file_grants" &&
    data.grants.some(
      (grant) =>
        grant.resourceType === "file" &&
        grant.resourceId === file.id &&
        (grant.permission === "read" || grant.permission === "write") &&
        ((grant.principalType === input.principalType &&
          grant.principalId === input.principalId) ||
          (grant.principalType === "group" &&
            input.groupIds.includes(grant.principalId))),
    )
  );
}
