import { Input, NativeSelect } from "@romeo/ui";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { getStoredTheme, setTheme, type Theme } from "../lib/theme";
import { resolveThemeSelection } from "../lib/theme-preference";
import { useThemePreference } from "../lib/use-theme-preference";
import { useLocale, type Locale } from "../lib/i18n";
import {
  applyInterfacePreferences,
  getInterfacePreferences,
  type Density,
  type FontSize,
} from "../lib/interface-preferences";
import {
  CHAT_UI_PREF_DEFAULTS,
  type ChatUiPreferences,
  chatUiPreferencesFrom,
} from "../lib/chat-ui-preferences";
import { interfacePreferencesPatchMutationOptions } from "../features/interface-preferences/mutation-options";
import { interfacePreferencesQueryOptions } from "../lib/api-query-options";
import { useRouterApiClient } from "../lib/router-context";

const OPTIONS: Theme[] = ["system", "light", "dark"];

const CHAT_TOGGLES: Array<{
  key: keyof ChatUiPreferences;
  labelKey:
    | "chatPrefFollowUps"
    | "chatPrefStarterPrompts"
    | "chatPrefContinue"
    | "chatPrefEnterToSend"
    | "chatPrefStickToBottom"
    | "chatPrefRunStatus"
    | "chatPrefModelLabel"
    | "chatPrefTimestamps";
  descKey:
    | "chatPrefFollowUpsDesc"
    | "chatPrefStarterPromptsDesc"
    | "chatPrefContinueDesc"
    | "chatPrefEnterToSendDesc"
    | "chatPrefStickToBottomDesc"
    | "chatPrefRunStatusDesc"
    | "chatPrefModelLabelDesc"
    | "chatPrefTimestampsDesc";
}> = [
  {
    key: "showFollowUps",
    labelKey: "chatPrefFollowUps",
    descKey: "chatPrefFollowUpsDesc",
  },
  {
    key: "showStarterPrompts",
    labelKey: "chatPrefStarterPrompts",
    descKey: "chatPrefStarterPromptsDesc",
  },
  {
    key: "showContinueButton",
    labelKey: "chatPrefContinue",
    descKey: "chatPrefContinueDesc",
  },
  {
    key: "enterToSend",
    labelKey: "chatPrefEnterToSend",
    descKey: "chatPrefEnterToSendDesc",
  },
  {
    key: "stickToBottom",
    labelKey: "chatPrefStickToBottom",
    descKey: "chatPrefStickToBottomDesc",
  },
  {
    key: "showRunStatus",
    labelKey: "chatPrefRunStatus",
    descKey: "chatPrefRunStatusDesc",
  },
  {
    key: "showMessageModelLabel",
    labelKey: "chatPrefModelLabel",
    descKey: "chatPrefModelLabelDesc",
  },
  {
    key: "showMessageTimestamps",
    labelKey: "chatPrefTimestamps",
    descKey: "chatPrefTimestampsDesc",
  },
];

export function InterfaceSettings() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const seeded = useRef(false);
  const themePreference = useThemePreference();
  const { locale, setLocale, t } = useLocale();
  const [preferences, setPreferences] = useState(() =>
    getInterfacePreferences(),
  );
  const [chatPrefs, setChatPrefs] = useState<ChatUiPreferences>(
    () => CHAT_UI_PREF_DEFAULTS,
  );
  const apiClient = useRouterApiClient();
  const serverPreferences = useQuery(
    interfacePreferencesQueryOptions(apiClient),
  );
  const savePreferences = useMutation(
    interfacePreferencesPatchMutationOptions(),
  );

  useEffect(() => {
    if (seeded.current || serverPreferences.data === undefined) return;
    const remote = serverPreferences.data;
    const resolvedTheme = resolveThemeSelection({
      serverTheme: remote.theme,
      localTheme: theme,
      hasSeeded: seeded.current,
    });
    seeded.current = true;
    setTheme(resolvedTheme);
    setThemeState(resolvedTheme);
    setLocale(remote.locale);
    const next = {
      density: remote.density,
      fontSize: remote.fontSize,
      reducedMotion: remote.reducedMotion,
    };
    setPreferences(next);
    applyInterfacePreferences(next);
    setChatPrefs(chatUiPreferencesFrom(remote));
  }, [serverPreferences.data, setLocale, theme]);

  function choose(next: Theme) {
    themePreference.updateTheme(next);
    setThemeState(next);
  }

  function updatePreferences(next: Partial<typeof preferences>) {
    const merged = { ...preferences, ...next };
    setPreferences(merged);
    applyInterfacePreferences(merged);
    savePreferences.mutate(next, {
      onSuccess: (data) => setChatPrefs(chatUiPreferencesFrom(data)),
    });
  }

  function updateChatPref(key: keyof ChatUiPreferences, value: boolean) {
    setChatPrefs((current) => ({ ...current, [key]: value }));
    savePreferences.mutate(
      { [key]: value },
      { onSuccess: (data) => setChatPrefs(chatUiPreferencesFrom(data)) },
    );
  }

  return (
    <div className="grid gap-6">
      <div>
        <div className="rm-card-title">{t("appearance")}</div>
        <div className="rm-field">
          <label className="rm-field-label" htmlFor="interface-theme">
            <div className="rm-field-name">{t("theme")}</div>
            <div className="rm-field-desc">{t("themeDescription")}</div>
          </label>
          <NativeSelect
            id="interface-theme"
            className="rm-field-control"
            onChange={(event) => choose(event.currentTarget.value as Theme)}
            value={theme}
          >
            {OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t(option)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="rm-field">
          <label className="rm-field-label" htmlFor="interface-language">
            <span className="rm-field-name">{t("language")}</span>
            <span className="rm-field-desc">{t("languageDescription")}</span>
          </label>
          <NativeSelect
            className="rm-field-control"
            id="interface-language"
            onChange={(event) => {
              const next = event.currentTarget.value as Locale;
              setLocale(next);
              savePreferences.mutate(
                { locale: next },
                {
                  onSuccess: (data) =>
                    setChatPrefs(chatUiPreferencesFrom(data)),
                },
              );
            }}
            value={locale}
          >
            <option value="en">{t("english")}</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
          </NativeSelect>
        </div>
        <div className="rm-field">
          <label className="rm-field-label" htmlFor="interface-text-size">
            <span className="rm-field-name">{t("textSize")}</span>
          </label>
          <NativeSelect
            className="rm-field-control"
            id="interface-text-size"
            onChange={(event) =>
              updatePreferences({
                fontSize: event.currentTarget.value as FontSize,
              })
            }
            value={preferences.fontSize}
          >
            <option value="small">{t("small")}</option>
            <option value="medium">{t("interfaceDensityMedium")}</option>
            <option value="large">{t("large")}</option>
          </NativeSelect>
        </div>
        <div className="rm-field">
          <label className="rm-field-label" htmlFor="interface-density">
            <span className="rm-field-name">{t("density")}</span>
          </label>
          <NativeSelect
            className="rm-field-control"
            id="interface-density"
            onChange={(event) =>
              updatePreferences({
                density: event.currentTarget.value as Density,
              })
            }
            value={preferences.density}
          >
            <option value="comfortable">{t("comfortable")}</option>
            <option value="compact">{t("compact")}</option>
          </NativeSelect>
        </div>
        <label className="rm-field" htmlFor="interface-reduced-motion">
          <span className="rm-field-label">
            <span className="rm-field-name">{t("reducedMotion")}</span>
            <span className="rm-field-desc">
              {t("reducedMotionDescription")}
            </span>
          </span>
          <Input
            checked={preferences.reducedMotion}
            id="interface-reduced-motion"
            onChange={(event) =>
              updatePreferences({ reducedMotion: event.currentTarget.checked })
            }
            type="checkbox"
          />
        </label>
      </div>

      <div>
        <div className="rm-card-title">{t("chatPreferences")}</div>
        <p className="mb-3 text-sm text-muted">
          {t("chatPreferencesDescription")}
        </p>
        <div className="grid gap-2">
          {CHAT_TOGGLES.map((item) => (
            <label
              className="flex items-start gap-3 rounded-md border border-border p-3"
              htmlFor={`chat-pref-${item.key}`}
              key={item.key}
            >
              <Input
                checked={chatPrefs[item.key]}
                id={`chat-pref-${item.key}`}
                onChange={(event) =>
                  updateChatPref(item.key, event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>
                <strong className="block text-sm">{t(item.labelKey)}</strong>
                <span className="mt-1 block text-sm text-muted">
                  {t(item.descKey)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {savePreferences.isError || themePreference.isError ? (
        <p className="text-sm text-danger" role="alert">
          {t("preferencesSyncFailed")}
        </p>
      ) : null}
    </div>
  );
}
