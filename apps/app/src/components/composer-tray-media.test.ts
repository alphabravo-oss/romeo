import { describe, expect, it } from "vitest";

import {
  audioCaptionTrackUrl,
  documentPageSelection,
  imageAltText,
  metadataAudioAccessibility,
  metadataPageCount,
  metadataTranscript,
  safeAttachmentDownloadUrl,
} from "./composer-tray-media";

describe("composer tray media", () => {
  it("builds a bounded, injection-safe WebVTT caption track", () => {
    const url = audioCaptionTrackUrl("hello --> world\0");
    expect(url).toMatch(/^data:text\/vtt;charset=utf-8,/);
    const decoded = decodeURIComponent(url.split(",")[1] ?? "");
    expect(decoded).toContain("WEBVTT");
    expect(decoded).toContain("hello → world");
    expect(decoded).not.toContain("\0");
  });

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
    expect(
      safeAttachmentDownloadUrl("https://evil.example/files/x/content"),
    ).toBe(undefined);
    expect(safeAttachmentDownloadUrl("javascript:alert(1)")).toBeUndefined();
    expect(metadataPageCount({ pageCount: 4 })).toBe(4);
    expect(metadataTranscript({ transcript: "  spoken words  " })).toBe(
      "spoken words",
    );
  });

  it("requires a transcript for speech and accepts described non-speech audio", () => {
    expect(metadataAudioAccessibility({ transcriptStatus: "pending" })).toEqual(
      { kind: "speech", status: "pending" },
    );
    expect(metadataAudioAccessibility({ transcriptStatus: "failed" })).toEqual({
      kind: "speech",
      status: "failed",
    });
    expect(
      metadataAudioAccessibility({ transcript: " Spoken words " }),
    ).toEqual({ kind: "speech", status: "ready", transcript: "Spoken words" });
    expect(
      metadataAudioAccessibility({
        audioDescription: " Ocean waves ",
        audioKind: "non_speech",
      }),
    ).toEqual({
      description: "Ocean waves",
      kind: "non_speech",
      status: "ready",
    });
    expect(metadataAudioAccessibility({})).toEqual({
      kind: "speech",
      status: "required",
    });
  });
});
