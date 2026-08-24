import type { BackgroundJob } from "../domain/entities";
import type {
  ListBackgroundJobsInput,
  RomeoRepository,
} from "../domain/repository";

const backgroundJobPageSize = 500;

type BackgroundJobQuery = Omit<ListBackgroundJobsInput, "cursor" | "limit">;

export async function* iterateBackgroundJobs(
  repository: RomeoRepository,
  orgId: string,
  query: BackgroundJobQuery = {},
): AsyncGenerator<BackgroundJob> {
  let cursor: ListBackgroundJobsInput["cursor"];
  for (;;) {
    const page = await repository.listBackgroundJobs(orgId, {
      ...query,
      ...(cursor === undefined ? {} : { cursor }),
      limit: backgroundJobPageSize,
    });
    for (const job of page) yield job;
    const last = page.at(-1);
    if (last === undefined || page.length < backgroundJobPageSize) return;
    cursor = { createdAt: last.createdAt, id: last.id };
  }
}

export async function collectBackgroundJobs(
  repository: RomeoRepository,
  orgId: string,
  query: BackgroundJobQuery = {},
): Promise<BackgroundJob[]> {
  const jobs: BackgroundJob[] = [];
  for await (const job of iterateBackgroundJobs(repository, orgId, query))
    jobs.push(job);
  return jobs;
}

const approvalArtifactTypes = [
  "tool.approval.binding",
  "tool.approval.consumption",
  "tool.approval.decision",
  "tool.operation.approval.consumption",
  "tool.operation.approval.decision",
] as const;

export async function listApprovalArtifactJobs(
  repository: RomeoRepository,
  orgId: string,
  approvalRequestId: string,
): Promise<BackgroundJob[]> {
  const pages = await Promise.all(
    approvalArtifactTypes.map((type) =>
      repository.listBackgroundJobs(orgId, {
        limit: 1,
        payloadEquals: { approvalRequestId },
        statuses: ["completed"],
        type,
      }),
    ),
  );
  return pages.flat();
}

export async function collectApprovalQueueJobs(
  repository: RomeoRepository,
  orgId: string,
): Promise<BackgroundJob[]> {
  const groups = await Promise.all([
    collectBackgroundJobs(repository, orgId, {
      statuses: ["completed"],
      type: "tool.operation.approval_request",
    }),
    ...approvalArtifactTypes.map((type) =>
      collectBackgroundJobs(repository, orgId, {
        statuses: ["completed"],
        type,
      }),
    ),
  ]);
  return groups.flat();
}
