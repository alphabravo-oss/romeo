import { Input, NativeSelect } from "@romeo/ui";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { getStoredTheme, setTheme, type Theme } from "../lib/theme";
import { useLocale, type Locale } from "../lib/i18n";
import {
  applyInterfacePreferences,
  getInterfacePreferences,
  type Density,
  type FontSize,
} from "../lib/interface-preferences";
import {
  getServerInterfacePreferences,
  updateServerInterfacePreferences,
} from "../features/interface-preferences";

const OPTIONS: Theme[] = ["system", "light", "dark"];

export function InterfaceSettings() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const { locale, setLocale, t } = useLocale();
  const [preferences, setPreferences] = useState(() =>
    getInterfacePreferences(),
  );
  const serverPreferences = useQuery({
    queryKey: ["interfacePreferences"],
    queryFn: getServerInterfacePreferences,
  });
  const savePreferences = useMutation({
    mutationFn: updateServerInterfacePreferences,
  });

  useEffect(() => {
    if (serverPreferences.data === undefined) return;
    const remote = serverPreferences.data;
    setTheme(remote.theme);
    setThemeState(remote.theme);
    setLocale(remote.locale);
    const next = {
      density: remote.density,
      fontSize: remote.fontSize,
      reducedMotion: remote.reducedMotion,
    };
    setPreferences(next);
    applyInterfacePreferences(next);
  }, [serverPreferences.data, setLocale]);

  function choose(next: Theme) {
    setTheme(next);
    setThemeState(next);
    savePreferences.mutate({ theme: next });
  }

  function updatePreferences(next: Partial<typeof preferences>) {
    const merged = { ...preferences, ...next };
    setPreferences(merged);
    applyInterfacePreferences(merged);
    savePreferences.mutate(next);
  }

  return (
    <div className="rm-panel p-4">
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
            savePreferences.mutate({ locale: next });
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
          <option value="medium">{t("medium")}</option>
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
          <span className="rm-field-desc">{t("reducedMotionDescription")}</span>
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
      {savePreferences.isError ? (
        <p className="text-sm text-danger" role="alert">
          {t("preferencesSyncFailed")}
        </p>
      ) : null}
    </div>
  );
}
