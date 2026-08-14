import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import type { Locale } from "./i18n";

const supportedLocales = new Set<Locale>(["en", "es", "fr"]);

export function normalizeRouterLocale(value: string | undefined): Locale {
  const base = value?.trim().toLowerCase().split("-")[0];
  return supportedLocales.has(base as Locale) ? (base as Locale) : "en";
}

/** Resolve the best supported locale without retaining the request header. */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (header === null || header.trim() === "") return "en";
  const candidates = header
    .split(",")
    .map((entry, index) => {
      const [language = "", ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      const parsedQuality = qualityParameter
        ? Number.parseFloat(qualityParameter.trim().slice(2))
        : 1;
      return {
        index,
        language,
        quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
      };
    })
    .filter(({ quality }) => quality > 0)
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );

  for (const candidate of candidates) {
    const locale = candidate.language.trim().toLowerCase().split("-")[0];
    if (supportedLocales.has(locale as Locale)) return locale as Locale;
  }
  return "en";
}

export const getRouterLocale = createIsomorphicFn()
  // The server-rendered <html lang> is the hydration contract. A stored user
  // preference is applied by LocaleProvider after hydration, avoiding a
  // request-locale/client-storage mismatch during React's initial render.
  .client(() =>
    normalizeRouterLocale(globalThis.document?.documentElement.lang),
  )
  .server(() =>
    localeFromAcceptLanguage(getRequest().headers.get("accept-language")),
  );
