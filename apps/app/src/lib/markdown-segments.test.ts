import { describe, expect, it } from "vitest";

import {
  absoluteMarkdownOffset,
  advanceMarkdownSegmentation,
  detectMarkdownFeatures,
  segmentStreamingMarkdown,
} from "./markdown-segments";

describe("streaming Markdown segmentation", () => {
  it("freezes only blocks followed by a subsequent block", () => {
    const first = segmentStreamingMarkdown("Alpha.\n\nBeta");
    expect(first.stable).toEqual([{ content: "Alpha.\n\n", start: 0 }]);
    expect(first.tail).toEqual({ content: "Beta", start: 8 });

    const second = advanceMarkdownSegmentation(
      first,
      "Alpha.\n\nBeta.\n\nGamma",
    );
    expect(second.stable[0]).toBe(first.stable[0]);
    expect(second.stable[1]).toEqual({ content: "Beta.\n\n", start: 8 });
    expect(second.tail).toEqual({ content: "Gamma", start: 15 });

    const third = advanceMarkdownSegmentation(
      second,
      "Alpha.\n\nBeta.\n\nGamma!",
    );
    expect(third.stable).toBe(second.stable);
  });

  it("never splits fenced code or display math at internal blank lines", () => {
    for (const source of [
      "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter",
      "$$\na + b\n\nc + d\n$$\n\nAfter",
      "\\[\na + b\n\nc + d\n\\]\n\nAfter",
      "$$a + b\n\nc + d$$\n\nAfter",
    ]) {
      const plan = segmentStreamingMarkdown(source);
      expect(plan.stable).toHaveLength(1);
      expect(plan.stable[0]!.content + plan.tail.content).toBe(source);
      expect(plan.tail.content).toBe("After");
    }
  });

  it("keeps source-relative node offsets addressable after segmentation", () => {
    expect(absoluteMarkdownOffset(240, 17)).toBe(257);
    expect(absoluteMarkdownOffset(240, undefined)).toBeUndefined();
  });

  it("loads optional parsers only for segments that use their syntax", () => {
    expect(detectMarkdownFeatures("plain `$$` prose")).toEqual({
      fencedCode: false,
      math: false,
    });
    expect(
      detectMarkdownFeatures("```mermaid\ngraph TD\nA[$$]-->B\n```"),
    ).toEqual({ fencedCode: true, math: false });
    expect(detectMarkdownFeatures("The result is $$x^2$$.")).toEqual({
      fencedCode: false,
      math: true,
    });
  });

  it("keeps loose lists, task lists, quotes, and tables structurally whole", () => {
    const source = [
      "1. first",
      "",
      "2. second",
      "",
      "- [x] task",
      "",
      "Paragraph after list.",
      "",
      "> quote one",
      "",
      "> quote two",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "Tail",
    ].join("\n");
    const plan = segmentStreamingMarkdown(source);
    expect(plan.stable.map((segment) => segment.content)).toEqual([
      "1. first\n\n2. second\n\n- [x] task\n\n",
      "Paragraph after list.\n\n",
      "> quote one\n\n> quote two\n\n",
      "| A | B |\n| - | - |\n| 1 | 2 |\n\n",
    ]);
    expect(plan.tail.content).toBe("Tail");
  });

  it("keeps blank lines inside an indented code block", () => {
    const source = "    first line\n\n    second line\n\nTail";
    const plan = segmentStreamingMarkdown(source);
    expect(plan.stable).toEqual([
      { content: "    first line\n\n    second line\n\n", start: 0 },
    ]);
    expect(plan.tail.content).toBe("Tail");
  });

  it("falls back to one document for reference links and raw HTML", () => {
    for (const source of [
      "Read [the guide][docs].\n\nLater.\n\n[docs]: https://example.com",
      "Read [docs].\n\n[docs]: https://example.com",
      "<details>\n\ncontent\n\n</details>",
    ]) {
      const plan = segmentStreamingMarkdown(source);
      expect(plan.stable).toEqual([]);
      expect(plan.tail).toEqual({ content: source, start: 0 });
    }
  });

  it("reconstructs every source byte and resets safely on replacement", () => {
    const source = "One\n\nTwo\n\n```mermaid\ngraph TD\nA-->B\n```\n\nTail";
    const plan = segmentStreamingMarkdown(source);
    expect(
      plan.stable.map((segment) => segment.content).join("") +
        plan.tail.content,
    ).toBe(source);
    const replacement = advanceMarkdownSegmentation(plan, "Short replacement");
    expect(replacement.stable).toEqual([]);
    expect(replacement.tail).toEqual({
      content: "Short replacement",
      start: 0,
    });
  });
});
