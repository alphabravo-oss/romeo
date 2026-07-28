import { Button } from "@romeo/ui";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import Sun from "lucide-react/dist/esm/icons/sun.mjs";
import { useSyncExternalStore } from "react";

import { getStoredTheme, setTheme } from "../lib/theme";

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
  const dark = useSyncExternalStore(subscribe, isDarkTheme, () => false);

  function toggleTheme() {
    const next = !dark;
    setTheme(next ? "dark" : "light");
  }

  const storedTheme = getStoredTheme();
  const label = dark ? "Use light theme" : "Use dark theme";

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
        <Sun aria-hidden="true" size={17} />
      ) : (
        <Moon aria-hidden="true" size={17} />
      )}
    </Button>
  );
}
