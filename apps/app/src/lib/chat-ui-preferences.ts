import { useQuery } from "@tanstack/react-query";

import {
  getServerInterfacePreferences,
  type InterfacePreferences,
} from "../features/interface-preferences";

/** Defaults match server normalize(): most chrome on; follow-ups/continue opt-in. */
export const CHAT_UI_PREF_DEFAULTS = {
  showFollowUps: false,
  showStarterPrompts: true,
  showContinueButton: false,
  enterToSend: true,
  stickToBottom: true,
  showRunStatus: true,
  showMessageModelLabel: true,
  showMessageTimestamps: true,
} as const;

export type ChatUiPreferences = {
  [K in keyof typeof CHAT_UI_PREF_DEFAULTS]: boolean;
};

export const CHAT_UI_PREF_KEYS = Object.keys(
  CHAT_UI_PREF_DEFAULTS,
) as Array<keyof ChatUiPreferences>;

export function chatUiPreferencesFrom(
  value: Partial<InterfacePreferences> | undefined,
): ChatUiPreferences {
  return {
    showFollowUps: value?.showFollowUps === true,
    showStarterPrompts: value?.showStarterPrompts !== false,
    showContinueButton: value?.showContinueButton === true,
    enterToSend: value?.enterToSend !== false,
    stickToBottom: value?.stickToBottom !== false,
    showRunStatus: value?.showRunStatus !== false,
    showMessageModelLabel: value?.showMessageModelLabel !== false,
    showMessageTimestamps: value?.showMessageTimestamps !== false,
  };
}

export function useChatUiPreferences(): ChatUiPreferences {
  const query = useQuery({
    queryKey: ["interfacePreferences"],
    queryFn: getServerInterfacePreferences,
    staleTime: 60_000,
  });
  return chatUiPreferencesFrom(query.data);
}
