// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markdownParses = vi.hoisted(() => vi.fn<(source: string) => void>());

vi.mock("react-markdown", async () => {
  const { createElement } = await import("react");
  return {
    default: ({ children }: { children?: string }) => {
      const source = children ?? "";
      markdownParses(source);
      return createElement("span", { "data-markdown-document": true }, source);
    },
  };
});

import { Markdown } from "./markdown";

describe("streaming Markdown rendering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    markdownParses.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps completed blocks render-stable across a 2,000-delta long answer", () => {
    const completed = Array.from(
      { length: 100 },
      (_, index) =>
        `Paragraph ${index}: ${"stable enterprise answer text ".repeat(6)}\n\n`,
    );
    const prefix = completed.join("");
    let source = `${prefix}Incomplete tail: `;
    let monolithicParsedBytes = 0;

    const render = () => {
      monolithicParsedBytes += source.length;
      act(() => root.render(<Markdown content={source} streaming />));
    };

    render();
    for (let delta = 0; delta < 2_000; delta += 1) {
      source += String(delta % 10);
      render();
    }

    const parsedSources = markdownParses.mock.calls.map(([value]) => value);
    const segmentedParsedBytes = parsedSources.reduce(
      (total, value) => total + value.length,
      0,
    );
    for (const stableBlock of completed) {
      expect(
        parsedSources.filter((value) => value === stableBlock),
      ).toHaveLength(1);
    }
    expect(markdownParses).toHaveBeenCalledTimes(100 + 2_001);
    expect(segmentedParsedBytes).toBeLessThan(monolithicParsedBytes / 8);
    act(() => root.render(<Markdown content={source} streaming={false} />));
    expect(markdownParses).toHaveBeenLastCalledWith(source);
    expect(container.textContent).toBe(source);
  });
});
