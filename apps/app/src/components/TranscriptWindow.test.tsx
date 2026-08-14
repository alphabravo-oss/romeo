// @vitest-environment jsdom

import { act } from "react";
import { useCallback, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  shouldVirtualizeTranscript,
  transcriptMessageDomId,
  transcriptMessageIdFromHash,
  transcriptRangeExtractor,
  TranscriptWindow,
} from "./TranscriptWindow";

interface Row {
  id: string;
  height: number;
}

const rows = Array.from({ length: 1_200 }, (_, index) => ({
  id: `message_${index}`,
  height: 72 + (index % 7) * 31,
}));

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  disconnect() {}
  observe(target: Element) {
    const element = target as HTMLElement;
    const height = element.classList.contains("viewport")
      ? 600
      : Number(element.dataset.height ?? "180");
    queueMicrotask(() =>
      this.callback(
        [
          {
            borderBoxSize: [{ blockSize: height, inlineSize: 768 }],
            contentBoxSize: [{ blockSize: height, inlineSize: 768 }],
            contentRect: new DOMRect(0, 0, 768, height),
            devicePixelContentBoxSize: [],
            target,
          },
        ],
        this,
      ),
    );
  }
  unobserve() {}
}

describe("TranscriptWindow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps the server/non-JS document complete and ordered", () => {
    const html = renderToString(
      <TranscriptWindow
        accessibleDescription="All messages"
        feedLabel="Conversation transcript"
        getScrollElement={() => null}
        items={rows.slice(0, 75)}
        renderItem={(row) => <article key={row.id}>{row.id}</article>}
        showAllLabel="Show all"
        useWindowedLabel="Use window"
        windowedDescription="Nearby messages"
      />,
    );

    expect(html.match(/<article/g)?.length).toBe(75);
    expect(html).toContain('role="feed"');
    expect(html).toContain('aria-label="Conversation transcript"');
    expect(html.indexOf("message_0")).toBeLessThan(html.indexOf("message_74"));
    expect(html).not.toContain("virtualized");
  });

  it("bounds mounted rows and expands before browser find", async () => {
    await renderHarness(root, rows);

    const list = container.querySelector<HTMLElement>(".rm-message-list");
    expect(list?.classList.contains("virtualized")).toBe(true);
    expect(container.querySelectorAll("article").length).toBeLessThan(40);

    await act(async () => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "f",
        }),
      );
    });

    expect(container.querySelectorAll("article").length).toBe(rows.length);
    expect(list?.classList.contains("virtualized")).toBe(false);
    expect(container.textContent).toContain("All loaded messages are present");
  });

  it("returns to a bounded window after the explicit accessibility mode", async () => {
    await renderHarness(root, rows);
    const showAll = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Show all",
    );
    await act(async () => showAll?.click());
    expect(container.querySelectorAll("article").length).toBe(rows.length);

    const useWindow = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Use window",
    );
    await act(async () => useWindow?.click());
    expect(container.querySelectorAll("article").length).toBeLessThan(40);
  });
});

describe("transcript windowing helpers", () => {
  it("uses hydration, measurement, threshold, and accessibility gates", () => {
    expect(
      shouldVirtualizeTranscript({
        canMeasure: true,
        clientReady: true,
        forceAccessible: false,
        messageCount: 60,
      }),
    ).toBe(true);
    expect(
      shouldVirtualizeTranscript({
        canMeasure: true,
        clientReady: false,
        forceAccessible: false,
        messageCount: 1_200,
      }),
    ).toBe(false);
    expect(
      shouldVirtualizeTranscript({
        canMeasure: true,
        clientReady: true,
        forceAccessible: true,
        messageCount: 1_200,
      }),
    ).toBe(false);
  });

  it("keeps focused and deep-linked indexes in a sorted bounded range", () => {
    expect(
      transcriptRangeExtractor(
        { count: 1_200, endIndex: 15, overscan: 2, startIndex: 10 },
        [900, 4, 900],
      ),
    ).toEqual([4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 900]);
  });

  it("round-trips privacy-safe message fragment identifiers", () => {
    const id = "message/with spaces?#";
    const domId = transcriptMessageDomId(id);
    expect(domId).toBe("message-message%2Fwith%20spaces%3F%23");
    expect(transcriptMessageIdFromHash(`#${domId}`)).toBe(id);
    expect(transcriptMessageIdFromHash("#message-%E0%A4%A")).toBeUndefined();
  });
});

async function renderHarness(root: Root, items: readonly Row[]) {
  await act(async () => {
    root.render(<TestHarness items={items} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function TestHarness({ items }: { items: readonly Row[] }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const attachViewport = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    if (node === null) return;
    Object.defineProperties(node, {
      clientHeight: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 768 },
      scrollHeight: { configurable: true, value: 200_000 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    node.getBoundingClientRect = () => new DOMRect(0, 0, 768, 600);
  }, []);
  const getScrollElement = useCallback(() => viewportRef.current, []);
  return (
    <div className="viewport" ref={attachViewport}>
      <TranscriptWindow
        accessibleDescription="All loaded messages are present"
        estimateSize={(index) => items[index]?.height ?? 180}
        feedLabel="Conversation transcript"
        getScrollElement={getScrollElement}
        items={items}
        renderItem={(row, index) => (
          <article
            data-height={row.height}
            data-message-id={row.id}
            id={transcriptMessageDomId(row.id)}
            key={row.id}
          >
            Variable message {index}
          </article>
        )}
        showAllLabel="Show all"
        useWindowedLabel="Use window"
        windowedDescription="Nearby messages are present"
      />
    </div>
  );
}
