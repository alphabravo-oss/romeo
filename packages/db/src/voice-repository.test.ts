import { describe, expect, it } from "vitest";

import { toVoiceProfileRecord } from "./voice-repository";

describe("voice repository mappers", () => {
  it("maps voice profile timestamps and normalizes style tags", () => {
    const voice = toVoiceProfileRecord({
      id: "voice_1",
      orgId: "org_1",
      providerId: "voice_disabled",
      providerVoiceId: "en-US-1",
      name: "Narrator",
      language: "en-US",
      styleTags: ["calm", 42, "narration"] as never,
      cloningAllowed: false,
      enabled: true,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:05:00.000Z"),
    });

    expect(voice).toEqual({
      id: "voice_1",
      orgId: "org_1",
      providerId: "voice_disabled",
      providerVoiceId: "en-US-1",
      name: "Narrator",
      language: "en-US",
      styleTags: ["calm", "narration"],
      cloningAllowed: false,
      enabled: true,
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:05:00.000Z",
    });
  });
});
