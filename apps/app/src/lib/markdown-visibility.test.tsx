// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg role="img"></svg>' })),
}));

vi.mock("mermaid", () => ({ default: mermaid }));

import {
  createTranscriptVisibilityRegistry,
  TranscriptRowVisibilityBoundary,
} from "../components/transcript-row-visibility";
import { Markdown } from "./markdown";

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

describe("visible Markdown features", () => {
  let container: HTMLDivElement;
  let observer: TestIntersectionObserver;
  let root: Root;

  beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000000",
    );
    mermaid.initialize.mockClear();
    mermaid.render.mockClear();
    TestIntersectionObserver.instances = [];
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

  it("loads strict Mermaid only when the transcript row is near-visible", async () => {
    const registry = createTranscriptVisibilityRegistry(() => container);
    await act(async () => {
      root.render(
        <TranscriptRowVisibilityBoundary
          elementId="message-row"
          registry={registry}
        >
          <article id="message-row">
            <Markdown
              content={"```mermaid\ngraph TD\nA-->B\n```"}
              previewDiagrams
            />
          </article>
        </TranscriptRowVisibilityBoundary>,
      );
    });
    observer = TestIntersectionObserver.instances[0]!;
    expect(mermaid.render).not.toHaveBeenCalled();

    await act(async () =>
      observer.emit(document.getElementById("message-row")!, true),
    );
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledOnce());
    expect(mermaid.initialize).toHaveBeenCalledWith({
      securityLevel: "strict",
      startOnLoad: false,
    });
    expect(container.querySelector(".rm-mermaid-preview svg")).not.toBeNull();

    await act(async () =>
      observer.emit(document.getElementById("message-row")!, false),
    );
    expect(container.querySelector(".rm-mermaid-preview")).toBeNull();
    expect(mermaid.render).toHaveBeenCalledOnce();
    registry.dispose();
  });
});

class TestIntersectionObserver implements IntersectionObserver {
  static instances: TestIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin = "400px 0px";
  readonly scrollMargin = "0px 0px 0px 0px";
  readonly thresholds = [0.01];

  constructor(private readonly callback: IntersectionObserverCallback) {
    TestIntersectionObserver.instances.push(this);
  }

  disconnect() {}
  observe() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  unobserve() {}

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
