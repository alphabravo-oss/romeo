import { useState } from "react";

import { getStoredTheme, setTheme, type Theme } from "../lib/theme";

const OPTIONS: { label: string; value: Theme }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

export function InterfaceSettings() {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());

  function choose(next: Theme) {
    setTheme(next);
    setThemeState(next);
  }

  return (
    <div className="rm-panel p-4">
      <div className="rm-card-title">Appearance</div>
      <div className="rm-field">
        <div className="rm-field-label">
          <div className="rm-field-name">Theme</div>
          <div className="rm-field-desc">
            System follows your device’s light or dark setting.
          </div>
        </div>
        <select
          className="rm-field-control"
          onChange={(event) => choose(event.currentTarget.value as Theme)}
          value={theme}
        >
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
