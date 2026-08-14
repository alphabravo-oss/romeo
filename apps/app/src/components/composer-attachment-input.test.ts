import { describe, expect, it } from "vitest";

import {
  claimPastedFiles,
  filesFromClipboard,
  movePendingAttachment,
  shouldClaimFilePaste,
  trayCompatibilityConstraint,
} from "./composer-attachment-input";

describe("composer attachment input", () => {
  it("claims file paste without treating empty clipboards as attachments", () => {
    const transfer = {
      files: [new File(["x"], "photo.png", { type: "image/png" })],
    } as unknown as DataTransfer;
    expect(filesFromClipboard(transfer)).toHaveLength(1);
    expect(shouldClaimFilePaste(filesFromClipboard(transfer))).toBe(true);
    expect(shouldClaimFilePaste(filesFromClipboard(null))).toBe(false);
    const attached: File[][] = [];
    const fileEvent = {
      clipboardData: transfer,
      preventDefault() {
        attached.push([]);
      },
    };
    claimPastedFiles(fileEvent, true, (files) => attached.push(files));
    expect(attached[1]).toHaveLength(1);
    const textEvent = {
      clipboardData: null,
      preventDefault() {
        throw new Error("text paste must remain unclaimed");
      },
    };
    claimPastedFiles(textEvent, true, () => {
      throw new Error("text paste must not attach");
    });
  });

  it("reorders pending attachments and names the exact tray constraint", () => {
    expect(
      movePendingAttachment(
        [
          { id: "a", name: "one" },
          { id: "b", name: "two" },
          { id: "c", name: "three" },
        ],
        "b",
        -1,
      ).map((item) => item.id),
    ).toEqual(["b", "a", "c"]);
    expect(
      trayCompatibilityConstraint({
        hasAudio: false,
        hasDocuments: false,
        hasImages: true,
        model: {
          capabilities: {
            audioInput: false,
            toolCalling: true,
            vision: false,
          },
        },
      }),
    ).toBe("vision");
  });
});
