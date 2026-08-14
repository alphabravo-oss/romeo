import { describe, expect, it } from "vitest";

import {
  authorizeRealtimeSession,
  defaultRealtimeRetention,
} from "./realtime-session-policy";

describe("realtime session policy", () => {
  it("fails closed when the gateway is uninstalled and keeps batch STT/TTS as fallback", () => {
    expect(defaultRealtimeRetention()).toBe("none");
    expect(
      authorizeRealtimeSession({
        platformDisabled: false,
        gatewayInstalled: false,
        retention: "none",
        durationSeconds: 30,
        maxDurationSeconds: 1800,
      }),
    ).toEqual({
      outcome: "denied",
      code: "realtime_runtime_uninstalled",
      fallback: "batch_stt_tts",
    });
    expect(
      authorizeRealtimeSession({
        platformDisabled: true,
        gatewayInstalled: true,
        retention: "none",
        durationSeconds: 30,
        maxDurationSeconds: 1800,
      }),
    ).toEqual({
      outcome: "denied",
      code: "capability_platform_disabled",
      fallback: "batch_stt_tts",
    });
    expect(
      authorizeRealtimeSession({
        platformDisabled: false,
        gatewayInstalled: true,
        retention: "none",
        durationSeconds: 30,
        maxDurationSeconds: 1800,
      }),
    ).toEqual({
      outcome: "accepted",
      retention: "none",
      fallback: "none",
    });
  });
});
