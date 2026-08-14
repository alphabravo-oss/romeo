import { describe, expect, it } from "vitest";

import {
  planFileReferenceAttach,
  reconcileAttachRetention,
} from "./file-reference-writer";

describe("file reference writer", () => {
  it("denies attach-before-ready and plans typed refs for ready files", () => {
    expect(
      planFileReferenceAttach({
        files: [
          {
            id: "file_uploading",
            status: "uploading",
            mimeType: "text/plain",
            fileName: "note.txt",
          },
        ],
        messageId: "msg_1",
        now: "2026-08-14T12:00:00.000Z",
      }),
    ).toMatchObject({ outcome: "denied", code: "file_not_ready" });
    const planned = planFileReferenceAttach({
      files: [
        {
          id: "file_ready",
          status: "ready",
          mimeType: "image/png",
          fileName: "shot.png",
        },
      ],
      messageId: "msg_1",
      now: "2026-08-14T12:00:00.000Z",
    });
    expect(planned.outcome).toBe("accepted");
    if (planned.outcome !== "accepted") return;
    expect(planned.parts[0]).toMatchObject({
      type: "image_ref",
      fileId: "file_ready",
    });
    expect(JSON.stringify(planned.parts)).not.toContain("data:");
  });

  it("retains under legal hold, attaches with references, and returns to ready on detach", () => {
    expect(
      reconcileAttachRetention({ referenceCount: 1, legalHoldActive: true }),
    ).toBe("retained");
    expect(
      reconcileAttachRetention({ referenceCount: 2, legalHoldActive: false }),
    ).toBe("attached");
    expect(
      reconcileAttachRetention({ referenceCount: 0, legalHoldActive: false }),
    ).toBe("ready");
  });
});
