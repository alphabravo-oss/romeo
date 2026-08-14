import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./i18n", () => ({
  useLocale: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import { ArtifactContext, Markdown } from "./markdown";

const artifactLookup = vi.fn(() => undefined);
const artifactBinding = {
  lookup: artifactLookup,
  open: vi.fn(),
  shownKey: undefined,
  shownVersion: undefined,
};

describe("segmented Markdown artifacts", () => {
  it("rebases a fenced block to its canonical message offset", () => {
    const source = [
      "Completed prose.",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      "Tail",
    ].join("\n");
    artifactLookup.mockClear();

    const markup = renderToStaticMarkup(
      <ArtifactContext.Provider value={artifactBinding}>
        <Markdown content={source} messageId="message-1" streaming />
      </ArtifactContext.Provider>,
    );

    expect(artifactLookup).toHaveBeenCalledWith(
      "message-1",
      source.indexOf("```ts"),
    );
    expect(markup).toContain('aria-label="copy"');
    expect(markup).toContain('aria-label="download"');
  });
});
