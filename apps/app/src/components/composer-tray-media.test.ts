import { describe, expect, it } from "vitest";

import {
  documentPageSelection,
  imageAltText,
  metadataPageCount,
  metadataTranscript,
  safeAttachmentDownloadUrl,
} from "./composer-tray-media";

describe("composer tray media", () => {
  it("builds useful image alt text and bounded page selection", () => {
    expect(
      imageAltText({ fileName: "diagram.png", height: 768, width: 1024 }),
    ).toBe("diagram.png, 1024 by 768 pixels");
    expect(documentPageSelection({ pageCount: 12, selectedPage: 99 })).toEqual({
      pageCount: 12,
      selectedPage: 12,
    });
    expect(documentPageSelection({})).toBeUndefined();
  });

  it("allows only same-origin file content downloads and reads extraction metadata", () => {
    expect(safeAttachmentDownloadUrl("/files/file_1/content")).toBe(
      "/files/file_1/content",
    );
    expect(safeAttachmentDownloadUrl("/api/v1/files/file_1/content")).toBe(
      "/api/v1/files/file_1/content",
    );
    expect(safeAttachmentDownloadUrl("https://evil.example/files/x/content")).toBe(
      undefined,
    );
    expect(safeAttachmentDownloadUrl("javascript:alert(1)")).toBeUndefined();
    expect(metadataPageCount({ pageCount: 4 })).toBe(4);
    expect(metadataTranscript({ transcript: "  spoken words  " })).toBe(
      "spoken words",
    );
  });
});
