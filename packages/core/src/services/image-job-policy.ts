export type ImageJobKind = "generate" | "edit" | "variation";
export type ImageJobState =
  | "queued"
  | "running"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed";

export interface ImageJobSource {
  fileId: string;
  ready: boolean;
  revoked: boolean;
}

export interface ImageJob {
  id: string;
  kind: ImageJobKind;
  state: ImageJobState;
  source?: ImageJobSource;
}

export type ImageJobDecision =
  | { outcome: "accepted"; job: ImageJob }
  | {
      outcome: "denied";
      code:
        | "capability_platform_disabled"
        | "image_job_cancelled"
        | "image_job_source_revoked"
        | "file_not_ready";
    };

export function authorizeImageJob(input: {
  platformDisabled: boolean;
  kind: ImageJobKind;
  jobId: string;
  source?: ImageJobSource;
}): ImageJobDecision {
  if (input.platformDisabled && input.kind !== "generate")
    return { outcome: "denied", code: "capability_platform_disabled" };
  if (input.source?.revoked === true)
    return { outcome: "denied", code: "image_job_source_revoked" };
  if (input.source !== undefined && input.source.ready !== true)
    return { outcome: "denied", code: "file_not_ready" };
  return {
    outcome: "accepted",
    job: {
      id: input.jobId,
      kind: input.kind,
      state: "queued",
      ...(input.source === undefined ? {} : { source: input.source }),
    },
  };
}

export function cancelImageJob(job: ImageJob): ImageJobDecision {
  if (job.state === "completed" || job.state === "failed")
    return { outcome: "denied", code: "image_job_cancelled" };
  if (job.state === "cancelled")
    return { outcome: "accepted", job };
  return { outcome: "accepted", job: { ...job, state: "cancelled" } };
}

export function assertImageJobSource(source: ImageJobSource): ImageJobDecision {
  if (source.revoked)
    return { outcome: "denied", code: "image_job_source_revoked" };
  if (!source.ready) return { outcome: "denied", code: "file_not_ready" };
  return {
    outcome: "accepted",
    job: {
      id: source.fileId,
      kind: "edit",
      state: "queued",
      source,
    },
  };
}
