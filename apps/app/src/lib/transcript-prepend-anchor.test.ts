import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureTranscriptPrependAnchor,
  restoreTranscriptPrependAnchor,
} from "./transcript-prepend-anchor";

describe("transcript prepend anchoring", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tracks a delayed virtual canvas resize and preserves the pixel anchor", () => {
    vi.useFakeTimers();
    let scrollHeight = 10_000;
    const viewport = {
      get scrollHeight() {
        return scrollHeight;
      },
      scrollTop: 8_000,
    } as HTMLElement;
    const snapshot = captureTranscriptPrependAnchor(viewport);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const settled = vi.fn();

    restoreTranscriptPrependAnchor(viewport, snapshot, settled);
    expect(viewport.scrollTop).toBe(8_000);
    scrollHeight = 12_500;
    runNextFrame(frames);
    expect(viewport.scrollTop).toBe(10_500);
    for (let frame = 0; frame < 18; frame++) runNextFrame(frames);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    runNextFrame(frames);
    expect(settled).toHaveBeenCalledOnce();
  });

  it("cancels pending layout work on navigation or branch change", () => {
    const frames: FrameRequestCallback[] = [];
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return 41;
    });
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const viewport = { scrollHeight: 100, scrollTop: 10 } as HTMLElement;

    const cleanup = restoreTranscriptPrependAnchor(
      viewport,
      captureTranscriptPrependAnchor(viewport),
    );
    cleanup();

    expect(cancel).toHaveBeenCalledWith(41);
  });

  it("cancels delayed verification after a settled prepend", () => {
    vi.useFakeTimers();
    let scrollHeight = 100;
    const viewport = {
      get scrollHeight() {
        return scrollHeight;
      },
      scrollTop: 10,
    } as HTMLElement;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const settled = vi.fn();

    const cleanup = restoreTranscriptPrependAnchor(
      viewport,
      captureTranscriptPrependAnchor(viewport),
      settled,
    );
    scrollHeight = 200;
    runNextFrame(frames);
    for (let frame = 0; frame < 18; frame++) runNextFrame(frames);
    cleanup();
    vi.advanceTimersByTime(100);

    expect(frames).toHaveLength(0);
    expect(settled).not.toHaveBeenCalled();
  });

  it("corrects a retained row when mobile layout shifts without a height delta", () => {
    const viewport = documentLikeElement("viewport");
    const message = documentLikeElement("message");
    message.dataset.messageId = "message-42";
    viewport.scrollTop = 8_000;
    let layoutTop = 40;
    viewport.getBoundingClientRect = () => rectangle(0, 844);
    message.getBoundingClientRect = () =>
      rectangle(layoutTop - (viewport.scrollTop - 8_000), 120);
    viewport.querySelectorAll = (() => [
      message,
    ]) as unknown as typeof viewport.querySelectorAll;
    const snapshot = captureTranscriptPrependAnchor(viewport);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    restoreTranscriptPrependAnchor(viewport, snapshot);
    layoutTop = 99;
    runNextFrame(frames);
    expect(viewport.scrollTop).toBe(8_059);
    runNextFrame(frames);
    expect(message.getBoundingClientRect().top).toBe(40);
  });
});

function runNextFrame(frames: FrameRequestCallback[]) {
  const frame = frames.shift();
  expect(frame).toBeDefined();
  frame?.(performance.now());
}

function documentLikeElement(_name: string): HTMLElement {
  return {
    dataset: {},
    scrollHeight: 10_000,
    scrollTop: 0,
  } as HTMLElement;
}

function rectangle(top: number, height: number): DOMRect {
  return { bottom: top + height, height, top } as DOMRect;
}
