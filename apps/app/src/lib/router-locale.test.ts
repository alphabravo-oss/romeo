import { describe, expect, it } from "vitest";

import {
  localeFromAcceptLanguage,
  localeFromCookie,
  normalizeRouterLocale,
} from "./router-locale";

describe("request-safe router locale", () => {
  it("selects the highest-quality supported request language", () => {
    expect(localeFromAcceptLanguage("de-DE, fr-FR;q=0.8, es;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("fr-CA, en;q=0.5")).toBe("fr");
  });

  it("prefers a valid persisted interface locale without trusting arbitrary cookies", () => {
    expect(
      localeFromCookie("session=opaque; romeo_locale=fr; theme=dark"),
    ).toBe("fr");
    expect(localeFromCookie("romeo_locale=de")).toBeUndefined();
    expect(localeFromCookie("not_romeo_locale=es")).toBeUndefined();
  });

  it("ignores disabled, malformed, and unsupported language entries", () => {
    expect(localeFromAcceptLanguage("es;q=0, fr;q=wat, en;q=0.4")).toBe("en");
    expect(localeFromAcceptLanguage("de, zh-Hant;q=0.9")).toBe("en");
    expect(normalizeRouterLocale("ES-mx")).toBe("es");
  });
});
