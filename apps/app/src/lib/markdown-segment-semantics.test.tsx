import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";
import { segmentStreamingMarkdown } from "./markdown-segments";

const semanticSource = [
  "## Result",
  "",
  "A safe [external link](https://example.com) and ~~GFM~~.",
  "Cited fact [1](#romeo-citation-0).",
  "",
  "| Feature | State |",
  "| --- | --- |",
  "| table | kept |",
  "",
  "1. first",
  "",
  "2. second",
  "",
  "$$",
  "a^2 + b^2 = c^2",
  "$$",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  "```mermaid",
  "graph TD",
  "A-->B",
  "```",
  "",
  "    indented one",
  "",
  "    indented two",
  "",
  "Incomplete tail",
].join("\n");

function renderDocument(source: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      rehypePlugins={[
        [rehypeHighlight, { detect: true, ignoreMissing: true }],
        rehypeKatex,
      ]}
      remarkPlugins={[remarkGfm, remarkMath]}
    >
      {source}
    </ReactMarkdown>,
  );
}

describe("segmented Markdown semantics", () => {
  it("matches one-document output for GFM, math, code, and Mermaid fences", () => {
    const plan = segmentStreamingMarkdown(semanticSource);
    const segmentedMarkup = [...plan.stable, plan.tail]
      .map((segment) => renderDocument(segment.content))
      .join("\n");

    expect(plan.stable.length).toBeGreaterThan(3);
    expect(segmentedMarkup).toBe(renderDocument(semanticSource));
  });

  it("keeps cross-block definitions and partial HTML monolithic", () => {
    for (const source of [
      "[Romeo][product]\n\n[product]: https://example.com",
      "<details\nopen>\n\ncontent\n\n</details>",
    ]) {
      const plan = segmentStreamingMarkdown(source);
      expect(plan.stable).toEqual([]);
      expect(renderDocument(plan.tail.content)).toBe(renderDocument(source));
    }
  });

  it("retains the safe-link and inert-HTML boundary while streaming", () => {
    const markup = renderToStaticMarkup(
      <Markdown
        content={[
          "[Safe](https://example.com)",
          "",
          "[Unsafe](javascript:alert(1))",
          "",
          "<script>alert('no')</script>",
        ].join("\n")}
        streaming
      />,
    );

    expect(markup).toContain('rel="noreferrer nofollow"');
    expect(markup).toContain('target="_blank"');
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("<script");
  });
});
