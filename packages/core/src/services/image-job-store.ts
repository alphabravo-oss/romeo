import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { isFileReadyForUse } from "./file-lifecycle";
import {
  authorizeImageJob,
  cancelImageJob,
  type ImageJob,
  type ImageJobDecision,
  type ImageJobKind,
} from "./image-job-policy";

const SCHEMA = "romeo.image-job.v1";

export class ImageJobStore {
  constructor(private readonly repository: RomeoRepository) {}

  async create(input: {
    subject: AuthSubject;
    workspaceId: string;
    kind: ImageJobKind;
    sourceFileId?: string;
    platformDisabled: boolean;
  }): Promise<ImageJobDecision> {
    assertScope(input.subject, "runs:create");
    const source = await this.resolveSource(input.subject, input.sourceFileId);
    const decision = authorizeImageJob({
      platformDisabled: input.platformDisabled,
      kind: input.kind,
      jobId: createId("image_job"),
      ...(source === undefined ? {} : { source }),
    });
    if (decision.outcome === "accepted")
      await this.write(input.subject.orgId, decision.job);
    return decision;
  }

  async cancel(input: {
    subject: AuthSubject;
    jobId: string;
  }): Promise<ImageJobDecision> {
    assertScope(input.subject, "runs:create");
    const job = await this.read(input.subject.orgId, input.jobId);
    if (job === undefined) throw notFound("Image job");
    const decision = cancelImageJob(job);
    if (decision.outcome === "accepted")
      await this.write(input.subject.orgId, decision.job);
    return decision;
  }

  private async resolveSource(
    subject: AuthSubject,
    fileId: string | undefined,
  ): Promise<{ fileId: string; ready: boolean; revoked: boolean } | undefined> {
    if (fileId === undefined) return undefined;
    const file = await this.repository.getFileObject(fileId);
    if (file === undefined || file.orgId !== subject.orgId)
      return { fileId, ready: false, revoked: true };
    return {
      fileId: file.id,
      ready: isFileReadyForUse(file),
      revoked: file.status === "deleted" || file.deletedAt !== undefined,
    };
  }

  private async read(orgId: string, jobId: string): Promise<ImageJob | undefined> {
    const value = (await this.repository.getSystemSetting(storeKey(orgId, jobId)))
      ?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== SCHEMA || candidate.orgId !== orgId) return undefined;
    return candidate.job as ImageJob;
  }

  private async write(orgId: string, job: ImageJob): Promise<void> {
    await this.repository.upsertSystemSetting({
      key: storeKey(orgId, job.id),
      value: { schema: SCHEMA, orgId, job },
      updatedAt: new Date().toISOString(),
    });
  }
}

function storeKey(orgId: string, jobId: string): string {
  return `image_job.v1:${orgId}:${jobId}`;
}
