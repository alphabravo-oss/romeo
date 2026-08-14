import { describe, expect, it } from "vitest";

import type { MessageKey } from "./i18n";
import { providerRunFailure } from "./run-registry-events";

const translate = (key: MessageKey) => key;

describe("providerRunFailure", () => {
  it("maps provider failures without retaining untrusted error details", () => {
    const failure = providerRunFailure(
      {
        type: "run.failed",
        data: {
          errorCode: "provider_run_failed",
          message: "Authorization: Bearer super-secret at 10.0.0.8",
        },
      },
      translate,
    );

    expect(failure).toEqual({
      code: "provider_run_failed",
      message: "providerFailed",
    });
    expect(JSON.stringify(failure)).not.toContain("super-secret");
    expect(JSON.stringify(failure)).not.toContain("10.0.0.8");
  });

  it("keeps localized classification for known HTTP failures", () => {
    expect(
      providerRunFailure(
        {
          type: "run.failed",
          data: {
            errorCode: "provider_run_failed",
            errorType: "provider_http_401",
            message: "sk-live-secret",
          },
        },
        translate,
      ),
    ).toEqual({
      code: "provider_run_failed",
      message: "providerRejectedKey",
    });
  });
});
