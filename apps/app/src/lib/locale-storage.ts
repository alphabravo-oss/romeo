import type { Locale } from "./i18n";

const localeStorageKey = "romeo:locale";
export const localeCookieName = "romeo_locale";
let cachedLocale: Locale | undefined;

export function readCachedLocale(
  fallback: Locale,
  storage = safeLocaleStorage(),
): Locale {
  if (typeof window === "undefined") return fallback;
  if (cachedLocale !== undefined) return cachedLocale;
  if (storage === undefined) {
    cachedLocale = fallback;
    return fallback;
  }
  try {
    const stored = validLocale(storage.getItem(localeStorageKey));
    cachedLocale = stored ?? fallback;
  } catch {
    cachedLocale = fallback;
  }
  return cachedLocale;
}

export function persistCachedLocale(
  locale: Locale,
  storage = safeLocaleStorage(),
): boolean {
  cachedLocale = locale;
  persistLocaleCookie(locale);
  if (storage === undefined) return false;
  try {
    storage.setItem(localeStorageKey, locale);
    return true;
  } catch {
    return false;
  }
}

function persistLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  try {
    document.cookie = `${localeCookieName}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // Cookie access can be blocked independently. The in-memory locale remains
    // authoritative for this document even when SSR continuity is unavailable.
  }
}

export function subscribeToStoredLocale(
  onLocale: (locale: Locale) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== localeStorageKey) return;
    const locale = validLocale(event.newValue);
    if (locale === undefined || locale === cachedLocale) return;
    cachedLocale = locale;
    onLocale(locale);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function resetLocaleStorageCacheForTests(): void {
  cachedLocale = undefined;
}

function safeLocaleStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function validLocale(value: string | null): Locale | undefined {
  return value === "en" || value === "es" || value === "fr" ? value : undefined;
}
