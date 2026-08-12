import { describe, expect, it } from "vitest";

import {
  citationHrefPrefix,
  linkCitationMarkers,
  stripCitationFooter,
} from "./chat-citations";

// react-markdown rewrites any protocol outside http/https/mailto/xmpp to the
// empty string, which would silently strip every marker's href.
it("targets a fragment, not a custom protocol", () => {
  expect(citationHrefPrefix.startsWith("#")).toBe(true);
  expect(citationHrefPrefix).not.toContain(":");
});

describe("stripCitationFooter", () => {
  it("removes the footer the server appends", () => {
    expect(
      stripCitationFooter(
        "The policy renews yearly [1].\n\nCitations:\n- [1] Policy (chunk_a)\n- [2] Handbook (chunk_b)\n",
      ),
    ).toBe("The policy renews yearly [1].");
  });

  it("leaves an answer that merely discusses citations alone", () => {
    const content = "I read the Citations: section and it was useful.";
    expect(stripCitationFooter(content)).toBe(content);
  });

  it("only matches at the end, so a mid-answer block survives", () => {
    const content =
      "Intro\n\nCitations:\n- [1] Policy (chunk_a)\n\nAnd then the real answer.";
    expect(stripCitationFooter(content)).toBe(content);
  });
});

describe("linkCitationMarkers", () => {
  it("links a marker that is in range", () => {
    expect(linkCitationMarkers("Renewal is annual [1].", 2)).toBe(
      "Renewal is annual [1](#romeo-citation-0).",
    );
  });

  it("leaves an out-of-range marker verbatim", () => {
    expect(linkCitationMarkers("Published in [9] and [2024].", 2)).toBe(
      "Published in [9] and [2024].",
    );
  });

  it("does nothing when the turn retrieved nothing", () => {
    expect(linkCitationMarkers("See [1].", 0)).toBe("See [1].");
  });

  it("leaves a marker inside a fenced block untouched", () => {
    const content =
      "Before [1].\n\n```ts\nconst x = list[1];\n```\n\nAfter [1].";
    expect(linkCitationMarkers(content, 1)).toBe(
      "Before [1](#romeo-citation-0).\n\n```ts\nconst x = list[1];\n```\n\nAfter [1](#romeo-citation-0).",
    );
  });

  it("leaves a marker inside an inline code span untouched", () => {
    expect(linkCitationMarkers("Use `rows[1]` for [1].", 1)).toBe(
      "Use `rows[1]` for [1](#romeo-citation-0).",
    );
  });

  it("does not double-link the model's own markdown links", () => {
    expect(linkCitationMarkers("See [1](https://example.com).", 1)).toBe(
      "See [1](https://example.com).",
    );
  });

  it("does not treat a tilde fence as prose", () => {
    expect(linkCitationMarkers("~~~\ntotals[1]\n~~~", 1)).toBe(
      "~~~\ntotals[1]\n~~~",
    );
  });
});
