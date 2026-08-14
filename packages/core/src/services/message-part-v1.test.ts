import { describe, expect, it } from "vitest";

import { assertFileReadyForUse } from "./file-lifecycle";
import { fileIdsForMessagePart, parseMessagePartV1 } from "./message-part-v1";

describe("typed message parts", () => {
  it("round-trips a v1 image_ref and denies attach before ready", () => {
    const part = parseMessagePartV1({
      schemaVersion: 1,
      type: "image_ref",
      id: "part_1",
      messageId: "msg_1",
      position: 0,
      createdAt: "2026-08-14T12:00:00.000Z",
      fileId: "file_1",
      mediaType: "image/png",
    });
    expect(fileIdsForMessagePart(part)).toEqual(["file_1"]);
    expect(parseMessagePartV1(part)).toEqual(part);
    expect(() =>
      assertFileReadyForUse({ status: "scanning" }),
    ).toThrowError(/not completed its security lifecycle/);
    expect(() => assertFileReadyForUse({ status: "ready" })).not.toThrow();
  });
});
