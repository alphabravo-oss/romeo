import { describe, expect, it } from "vitest";

import {
  CHAT_UI_PREF_DEFAULTS,
  chatUiPreferencesFrom,
} from "./chat-ui-preferences";

describe("chatUiPreferencesFrom", () => {
  it("defaults follow-ups/continue off and the rest on when unset", () => {
    expect(chatUiPreferencesFrom(undefined)).toEqual(CHAT_UI_PREF_DEFAULTS);
    expect(chatUiPreferencesFrom({})).toEqual(CHAT_UI_PREF_DEFAULTS);
    expect(CHAT_UI_PREF_DEFAULTS.showFollowUps).toBe(false);
    expect(CHAT_UI_PREF_DEFAULTS.showContinueButton).toBe(false);
  });

  it("honors explicit true for opt-in chrome and false for opt-out", () => {
    expect(
      chatUiPreferencesFrom({
        showFollowUps: true,
        showContinueButton: true,
        enterToSend: false,
      }),
    ).toMatchObject({
      showFollowUps: true,
      showContinueButton: true,
      enterToSend: false,
      stickToBottom: true,
    });
  });
});
