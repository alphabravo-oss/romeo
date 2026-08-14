import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocaleProvider, type Locale } from "../lib/i18n";
import { RouteLoadingState } from "./RouteLoadingState";

function render(locale: Locale): string {
  return renderToStaticMarkup(
    <LocaleProvider initialLocale={locale}>
      <RouteLoadingState />
    </LocaleProvider>,
  );
}

describe("route loading state", () => {
  it.each([
    ["en", "Loading…"],
    ["es", "Cargando…"],
    ["fr", "Chargement…"],
  ] as const)("is localized and accessible in %s", (locale, label) => {
    const markup = render(locale);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain(label);
  });
});
