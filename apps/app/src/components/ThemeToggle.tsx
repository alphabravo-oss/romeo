import { Button } from "@romeo/ui";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import Sun from "lucide-react/dist/esm/icons/sun.mjs";
import { useSyncExternalStore } from "react";

import { useLocale } from "../lib/i18n";
import { getStoredTheme } from "../lib/theme";
import { useThemePreference } from "../lib/use-theme-preference";

function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("romeo-theme-change", onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener("romeo-theme-change", onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function ThemeToggle() {
  const { t } = useLocale();
  const { updateTheme } = useThemePreference();
  const dark = useSyncExternalStore(subscribe, isDarkTheme, () => false);

  function toggleTheme() {
    const next = !dark;
    updateTheme(next ? "dark" : "light");
  }

  const storedTheme = getStoredTheme();
  const label = dark ? t("switchToLight") : t("switchToDark");

  return (
    <Button
      aria-label={label}
      className="rm-theme-toggle"
      data-theme={storedTheme}
      onClick={toggleTheme}
      title={label}
      type="button"
    >
      {dark ? (
        <Sun aria-hidden="true" size={15} />
      ) : (
        <Moon aria-hidden="true" size={15} />
      )}
    </Button>
  );
}
