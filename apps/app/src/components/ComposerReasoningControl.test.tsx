import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../lib/i18n";
import { ComposerReasoningControl } from "./ComposerReasoningControl";

function renderControl(
  mode: "default" | "high",
  modelSupportsReasoning: boolean,
) {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale="en">
      <ComposerReasoningControl
        disabled={false}
        mode={mode}
        modelSupportsReasoning={modelSupportsReasoning}
        onChange={vi.fn()}
      />
    </LocaleProvider>,
  );
}

describe("ComposerReasoningControl", () => {
  it("hides a default override for a model without reasoning", () => {
    expect(renderControl("default", false)).toBe("");
  });

  it("keeps an unsupported explicit override visible and actionable", () => {
    const markup = renderControl("high", false);
    expect(markup).toContain("reasoningControl: reasoningHigh");
    expect(markup).toContain("reasoningUnavailable");
    expect(markup).toContain("invalid");
    expect(markup).toContain('aria-invalid="true"');
  });

  it("discloses the latency and token-cost tradeoff", () => {
    expect(renderControl("high", true)).toContain("reasoningCostDisclosure");
  });
});
