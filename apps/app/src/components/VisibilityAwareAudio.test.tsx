// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTranscriptVisibilityRegistry,
  TranscriptRowVisibilityBoundary,
} from "./transcript-row-visibility";
import { VisibilityAwareAudio } from "./VisibilityAwareAudio";

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

describe("VisibilityAwareAudio", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    TestIntersectionObserver.instance = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("defers metadata and pauses playback when its row leaves view", async () => {
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const registry = createTranscriptVisibilityRegistry(() => container);
    await act(async () => {
      root.render(
        <TranscriptRowVisibilityBoundary elementId="row" registry={registry}>
          <article id="row">
            <VisibilityAwareAudio src="/speech.mp3" />
          </article>
        </TranscriptRowVisibilityBoundary>,
      );
    });
    const audio = container.querySelector("audio");
    expect(audio?.preload).toBe("none");
    const observer = TestIntersectionObserver.instance!;
    await act(async () => observer.emit(document.getElementById("row")!, true));
    pause.mockClear();
    await act(async () =>
      observer.emit(document.getElementById("row")!, false),
    );
    expect(pause).toHaveBeenCalledOnce();
    registry.dispose();
  });

  it("shares one observer across every transcript row", () => {
    const registry = createTranscriptVisibilityRegistry(() => container);
    const first = document.createElement("article");
    const second = document.createElement("article");
    const unsubscribeFirst = registry.subscribe(first, vi.fn());
    const unsubscribeSecond = registry.subscribe(second, vi.fn());
    const observer = TestIntersectionObserver.instance!;
    expect(observer.observed).toEqual(new Set([first, second]));
    unsubscribeFirst();
    expect(observer.observed).toEqual(new Set([second]));
    unsubscribeSecond();
    registry.dispose();
    expect(observer.disconnected).toBe(true);
  });
});

class TestIntersectionObserver implements IntersectionObserver {
  static instance: TestIntersectionObserver | undefined;
  readonly root = null;
  readonly rootMargin = "400px 0px";
  readonly scrollMargin = "0px 0px 0px 0px";
  readonly thresholds = [0.01];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(private readonly callback: IntersectionObserverCallback) {
    TestIntersectionObserver.instance = this;
  }

  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }

  emit(target: Element, visible: boolean) {
    this.callback(
      [
        {
          boundingClientRect: new DOMRect(),
          intersectionRatio: visible ? 1 : 0,
          intersectionRect: new DOMRect(),
          isIntersecting: visible,
          rootBounds: new DOMRect(),
          target,
          time: performance.now(),
        },
      ],
      this,
    );
  }
}
