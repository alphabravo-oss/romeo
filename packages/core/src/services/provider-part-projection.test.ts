import { describe, expect, it } from "vitest";

import {
  authorizeMediaQuota,
  issueFilePartAccess,
  projectProviderParts,
} from "./provider-part-projection";

describe("provider part projection and media access", () => {
  it("projects supported parts, applies a fallback, and denies unknown types", () => {
    expect(
      projectProviderParts({
        parts: [{ type: "text" }, { type: "audio_ref" }, { type: "image_ref" }],
        supported: new Set(["text", "image_ref"]),
        fallbacks: { audio_ref: "stt" },
      }),
    ).toEqual({
      outcome: "projected",
      accepted: ["text", "image_ref"],
      transformed: [{ type: "audio_ref", fallback: "stt" }],
    });
    expect(
      projectProviderParts({
        parts: [{ type: "video_ref" }],
        supported: new Set(["text"]),
        fallbacks: {},
      }),
    ).toEqual({
      outcome: "denied",
      code: "unsupported_part",
      type: "video_ref",
    });
  });

  it("enforces media quotas before dispatch and issues short attachment URLs", () => {
    expect(
      authorizeMediaQuota({
        counts: 2,
        bytes: 9_000,
        pixels: 4_000_000,
        limits: { maxCounts: 4, maxBytes: 8_000, maxPixels: 8_000_000 },
      }),
    ).toEqual({
      outcome: "denied",
      code: "media_quota_exceeded",
      dimension: "bytes",
    });
    expect(
      issueFilePartAccess({
        authorized: true,
        revoked: false,
        ttlSeconds: 3_600,
        maxTtlSeconds: 120,
      }),
    ).toEqual({
      outcome: "accepted",
      ttlSeconds: 120,
      contentDisposition: "attachment",
    });
    expect(
      issueFilePartAccess({
        authorized: true,
        revoked: true,
        ttlSeconds: 30,
      }),
    ).toEqual({ outcome: "denied", code: "file_part_revoked" });
  });
});
