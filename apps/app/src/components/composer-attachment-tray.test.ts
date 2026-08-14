import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("mixed attachment tray surfaces", () => {
  it("ships progress, scan, rich media, capture, keyboard, and reduced-motion", () => {
    const tray = readFileSync(
      new URL("ComposerAttachmentTray.tsx", import.meta.url),
      "utf8",
    );
    const composer = readFileSync(
      new URL("ChatComposer.tsx", import.meta.url),
      "utf8",
    );
    const styles = readFileSync(
      new URL("../styles/app-conversation.css", import.meta.url),
      "utf8",
    );
    expect(tray).toMatch(/role="progressbar"/u);
    expect(tray).toMatch(/trayRetryUpload/u);
    expect(tray).toMatch(/onCancelAttachment/u);
    expect(tray).toMatch(/<audio controls/u);
    expect(tray).toMatch(/traySafeDownload/u);
    expect(tray).toMatch(/trayDocumentPage/u);
    expect(tray).toMatch(/ArrowLeft/u);
    expect(composer).toMatch(/capture="environment"/u);
    expect(styles).toMatch(/prefers-reduced-motion: reduce/u);
    expect(styles).toMatch(/\.reduce-motion \.rm-tray-progress-bar/u);
  });
});
