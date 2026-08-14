import { describe, expect, it } from "vitest";

import {
  authorizeImageJob,
  cancelImageJob,
  assertImageJobSource,
} from "./image-job-policy";

describe("image job policy", () => {
  it("cancels a running job and refuses a revoked source", () => {
    const authorized = authorizeImageJob({
      platformDisabled: false,
      kind: "edit",
      jobId: "image_job_1",
      source: { fileId: "file_1", ready: true, revoked: false },
    });
    expect(authorized.outcome).toBe("accepted");
    expect(cancelImageJob(authorized.job!)).toMatchObject({
      outcome: "accepted",
      job: { state: "cancelled" },
    });
    expect(
      authorizeImageJob({
        platformDisabled: false,
        kind: "edit",
        jobId: "image_job_2",
        source: { fileId: "file_1", ready: true, revoked: true },
      }),
    ).toEqual({ outcome: "denied", code: "image_job_source_revoked" });
    expect(
      assertImageJobSource({ fileId: "file_1", ready: false, revoked: false }),
    ).toEqual({ outcome: "denied", code: "file_not_ready" });
    expect(
      authorizeImageJob({
        platformDisabled: true,
        kind: "edit",
        jobId: "image_job_3",
      }),
    ).toEqual({
      outcome: "denied",
      code: "capability_platform_disabled",
    });
  });
});
