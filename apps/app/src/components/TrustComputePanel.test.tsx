import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocaleProvider } from "../lib/i18n";
import { createRomeoQueryClient } from "../lib/query-client";
import { TrustComputePanelView } from "./TrustComputePanel";

describe("TrustComputePanel", () => {
  it("renders posture without presenting synthetic green as verified", () => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={createRomeoQueryClient()}>
        <LocaleProvider>
          <TrustComputePanelView
            posture={{
              acl: "not_configured",
              dlp: "not_applicable",
              keys: "not_configured",
              residency: "not_configured",
              syntheticGreen: false,
            }}
          />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    expect(markup).toContain("trustSyntheticGreenNever");
    expect(markup).toContain("trustPostureNotConfigured");
    expect(markup).toContain("computeEvaluateSandbox");
    expect(markup).not.toMatch(/syntheticGreen["']?\s*[:=]\s*true/iu);
  });
});
