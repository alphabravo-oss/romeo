// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerPendingAttachments } from "./ComposerAttachmentTray";
import type { PendingDocumentAttachment } from "./useWorkspaceAttachments";

vi.mock("../lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key} ${Object.values(values).join(" ")}`,
  }),
}));

afterEach(cleanup);

const noop = () => undefined;

function documentAttachment(
  input: Partial<PendingDocumentAttachment> &
    Pick<PendingDocumentAttachment, "fileName" | "id" | "mimeType">,
): PendingDocumentAttachment {
  return {
    percent: 100,
    sizeBytes: 10,
    status: "ready",
    ...input,
  };
}

function renderTray(
  documentAttachments: PendingDocumentAttachment[],
  onMoveDocument = vi.fn(),
) {
  return render(
    <ComposerPendingAttachments
      documentAttachments={documentAttachments}
      imageAttachments={[]}
      isStreaming={false}
      knowledgeOverrideLabel={undefined}
      onCancelAttachment={noop}
      onClearKnowledgeOverride={noop}
      onMoveDocument={onMoveDocument}
      onMoveImage={noop}
      onRemoveDocument={noop}
      onRemoveImage={noop}
      onRetryDocument={noop}
      onSelectDocumentPage={noop}
      selectedModel={undefined}
    />,
  );
}

describe("ComposerPendingAttachments accessibility behavior", () => {
  it("withholds speech playback until a transcript is ready", () => {
    const pending = documentAttachment({
      audioAccessibility: { kind: "speech", status: "pending" },
      downloadUrl: "/api/v1/files/audio-1/content",
      fileName: "interview.mp3",
      id: "audio-1",
      mimeType: "audio/mpeg",
    });
    const view = renderTray([pending]);
    expect(view.container.querySelector("audio")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "trayTranscriptPending",
    );

    view.rerender(
      <ComposerPendingAttachments
        documentAttachments={[
          {
            ...pending,
            audioAccessibility: {
              kind: "speech",
              status: "ready",
              transcript: "Hello from Romeo",
            },
          },
        ]}
        imageAttachments={[]}
        isStreaming={false}
        knowledgeOverrideLabel={undefined}
        onCancelAttachment={noop}
        onClearKnowledgeOverride={noop}
        onMoveDocument={noop}
        onMoveImage={noop}
        onRemoveDocument={noop}
        onRemoveImage={noop}
        onRetryDocument={noop}
        onSelectDocumentPage={noop}
        selectedModel={undefined}
      />,
    );
    const audio = view.container.querySelector("audio");
    const track = audio?.querySelector('track[kind="captions"]');
    expect(audio?.getAttribute("aria-describedby")).toBe(
      "audio-description-audio-1",
    );
    expect(track?.getAttribute("src")).toContain("data:text/vtt");
    expect(screen.getByText("Hello from Romeo").id).toBe(
      "audio-description-audio-1",
    );
  });

  it("announces failed transcripts and supports described non-speech audio", () => {
    const view = renderTray([
      documentAttachment({
        audioAccessibility: { kind: "speech", status: "failed" },
        downloadUrl: "/api/v1/files/failed/content",
        fileName: "failed.wav",
        id: "failed",
        mimeType: "audio/wav",
      }),
      documentAttachment({
        audioAccessibility: {
          description: "A short notification chime",
          kind: "non_speech",
          status: "ready",
        },
        downloadUrl: "/api/v1/files/chime/content",
        fileName: "chime.wav",
        id: "chime",
        mimeType: "audio/wav",
      }),
    ]);
    expect(screen.getByRole("alert").textContent).toBe("trayTranscriptFailed");
    expect(screen.getByText("A short notification chime").textContent).toBe(
      "A short notification chime",
    );
    expect(view.container.querySelectorAll("audio")).toHaveLength(1);
  });

  it("uses named move buttons, disables boundaries, and preserves focus", () => {
    const move = vi.fn();
    renderTray(
      [
        documentAttachment({
          fileName: "first.pdf",
          id: "first",
          mimeType: "application/pdf",
        }),
        documentAttachment({
          fileName: "second.pdf",
          id: "second",
          mimeType: "application/pdf",
        }),
      ],
      move,
    );
    const earlierFirst = screen.getByRole("button", {
      name: "moveAttachmentEarlier: first.pdf",
    }) as HTMLButtonElement;
    const laterFirst = screen.getByRole("button", {
      name: "moveAttachmentLater: first.pdf",
    }) as HTMLButtonElement;
    const laterSecond = screen.getByRole("button", {
      name: "moveAttachmentLater: second.pdf",
    }) as HTMLButtonElement;
    expect(earlierFirst.disabled).toBe(true);
    expect(laterSecond.disabled).toBe(true);
    laterFirst.focus();
    fireEvent.click(laterFirst);
    expect(move).toHaveBeenCalledWith("first", 1);
    expect(document.activeElement).toBe(laterFirst);
  });
});
