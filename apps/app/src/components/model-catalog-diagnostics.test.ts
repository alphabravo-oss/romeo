import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("model catalog probe and verify surfaces", () => {
  it("ships probe progress, cancellation, safe errors, and an audit link", () => {
    const diagnostics = readFileSync(
      new URL("ModelCatalogDiagnostics.tsx", import.meta.url),
      "utf8",
    );
    const details = readFileSync(
      new URL("ProviderDetailsSheet.tsx", import.meta.url),
      "utf8",
    );
    expect(diagnostics).toMatch(/AbortController/u);
    expect(diagnostics).toMatch(/catalogProbeModel/u);
    expect(diagnostics).toMatch(/catalogProbeCancelled/u);
    expect(diagnostics).toMatch(/safeUserErrorMessage/u);
    expect(diagnostics).toMatch(/catalogViewAudit/u);
    expect(diagnostics).toMatch(/catalogExplainUnavailability/u);
    expect(details).toMatch(/onCancelVerify/u);
    expect(details).toMatch(/catalogViewAudit/u);
  });
});
