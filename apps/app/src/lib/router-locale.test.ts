import { describe, expect, it } from "vitest";

import {
  localeFromAcceptLanguage,
  normalizeRouterLocale,
} from "./router-locale";

describe("request-safe router locale", () => {
  it("selects the highest-quality supported request language", () => {
    expect(localeFromAcceptLanguage("de-DE, fr-FR;q=0.8, es;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("fr-CA, en;q=0.5")).toBe("fr");
  });

  it("ignores disabled, malformed, and unsupported language entries", () => {
    expect(localeFromAcceptLanguage("es;q=0, fr;q=wat, en;q=0.4")).toBe("en");
    expect(localeFromAcceptLanguage("de, zh-Hant;q=0.9")).toBe("en");
    expect(normalizeRouterLocale("ES-mx")).toBe("es");
  });
});
