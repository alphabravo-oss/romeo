import type { FileObject } from "../domain/entities";
import type {
  ClaimFileLifecycleInput,
  FinishFileLifecycleLeaseInput,
  RenewFileLifecycleLeaseInput,
} from "../domain/repository-content";
import { assertFileLifecycleTransition } from "../services/file-lifecycle";
import { replaceById } from "./collection-helpers";
import type { SeedData } from "./seed-data";

type FileData = Pick<SeedData, "fileObjects">;

export function claimNextInMemoryFileLifecycle(
  data: FileData,
  input: ClaimFileLifecycleInput,
): FileObject | undefined {
  const candidate = data.fileObjects
    .filter(isClaimable(input.now))
    .sort(compareClaims)[0];
  if (candidate === undefined) return undefined;
  const claimed: FileObject = {
    ...candidate,
    status: candidate.status === "failed" ? "quarantined" : candidate.status,
    lifecycleVersion: (candidate.lifecycleVersion ?? 0) + 1,
    lifecycleAttempts: (candidate.lifecycleAttempts ?? 0) + 1,
    lifecycleLeaseOwner: input.leaseOwner,
    lifecycleLeaseToken: input.leaseToken,
    lifecycleLeaseExpiresAt: input.leaseExpiresAt,
    updatedAt: input.now,
  };
  delete claimed.lifecycleFailureCode;
  delete claimed.lifecycleNextAttemptAt;
  assertFileLifecycleTransition(candidate, claimed);
  return replaceById(data.fileObjects, claimed);
}

export function renewInMemoryFileLifecycleLease(
  data: FileData,
  input: RenewFileLifecycleLeaseInput,
): FileObject | undefined {
  const current = data.fileObjects.find((file) => file.id === input.fileId);
  if (!hasLiveLease(current, input, input.now)) return undefined;
  const renewed: FileObject = {
    ...current,
    lifecycleVersion: (current.lifecycleVersion ?? 0) + 1,
    lifecycleLeaseExpiresAt: input.leaseExpiresAt,
    updatedAt: input.now,
  };
  assertFileLifecycleTransition(current, renewed);
  return replaceById(data.fileObjects, renewed);
}

export function writeClaimedInMemoryFileLifecycle(
  data: FileData,
  input: FinishFileLifecycleLeaseInput,
  clearLease: boolean,
): FileObject | undefined {
  const current = data.fileObjects.find((file) => file.id === input.file.id);
  if (!hasLiveLease(current, input, input.now)) return undefined;
  if (
    (input.file.lifecycleVersion ?? 0) !==
    (current.lifecycleVersion ?? 0) + 1
  )
    return undefined;
  const completed = { ...input.file };
  if (clearLease) {
    delete completed.lifecycleLeaseOwner;
    delete completed.lifecycleLeaseToken;
    delete completed.lifecycleLeaseExpiresAt;
  }
  assertFileLifecycleTransition(current, completed);
  return replaceById(data.fileObjects, completed);
}

function isClaimable(now: string) {
  return (file: FileObject): boolean =>
    ["quarantined", "scanning", "extracting", "transcoding", "failed"].includes(
      file.status,
    ) &&
    (file.lifecycleAttempts ?? 0) < 100 &&
    (file.lifecycleNextAttemptAt === undefined ||
      file.lifecycleNextAttemptAt <= now) &&
    (file.lifecycleLeaseExpiresAt === undefined ||
      file.lifecycleLeaseExpiresAt <= now);
}

function compareClaims(left: FileObject, right: FileObject): number {
  return (
    (left.lifecycleNextAttemptAt ?? "").localeCompare(
      right.lifecycleNextAttemptAt ?? "",
    ) ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function hasLiveLease(
  file: FileObject | undefined,
  input: { leaseOwner: string; leaseToken: string },
  now: string,
): file is FileObject {
  return (
    file !== undefined &&
    file.lifecycleLeaseOwner === input.leaseOwner &&
    file.lifecycleLeaseToken === input.leaseToken &&
    file.lifecycleLeaseExpiresAt !== undefined &&
    file.lifecycleLeaseExpiresAt > now
  );
}
