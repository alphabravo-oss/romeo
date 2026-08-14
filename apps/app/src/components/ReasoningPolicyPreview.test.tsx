import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../lib/i18n";
import { ReasoningPolicyPreview } from "./ReasoningPolicyPreview";

describe("ReasoningPolicyPreview", () => {
  it("shows bounded requested/effective provenance without provider payloads", () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider initialLocale="en">
        <ReasoningPolicyPreview
          policy={{
            adjustments: [
              {
                parameter: "effort",
                reason: "capped_by_governance",
              },
            ],
            effective: {
              effort: "medium",
              mode: "auto",
              schemaVersion: 1,
            },
            rejected: false,
            requested: {
              effort: "high",
              mode: "auto",
              schemaVersion: 1,
            },
            source: "run_request",
          }}
        />
      </LocaleProvider>,
    );

    expect(markup).toContain("reasoningHigh");
    expect(markup).toContain("reasoningMedium");
    expect(markup).toContain("reasoningSourceRunRequest");
    expect(markup).toContain("reasoningAdjustedGovernanceCap");
    expect(markup).not.toMatch(/api[_-]?key|reasoning_content|provider body/i);
  });
});
