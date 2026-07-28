import { createInstance } from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import {
  coreLocaleResources,
  loadLocaleNamespace,
  namespaceNames,
  type LocaleNamespace,
  type MessageKey,
} from "../locales";

export type Locale = "en" | "es" | "fr";
export type { MessageKey };

export const localeNamespaceGroups = {
  admin: [...namespaceNames],
  chat: [
    "chat-supplement",
    "knowledge-workspace",
    "lifecycle-tool-voice",
    "model-admin",
    "prompt-template-admin",
    "provider",
    "shared-control",
    "workspace-capability",
    "workspace-shell-and-connector",
  ],
  settings: [
    "access-credential",
    "admin-navigation",
    "admin-section",
    "device-impersonation",
    "notification-admin",
    "prompt-template-admin",
    "security",
    "settings",
    "shared-control",
    "user-admin",
    "workspace-capability",
    "workspace-shell-and-connector",
  ],
  workspace: [
    "admin-navigation",
    "agent-studio",
    "eval-workspace",
    "group-organization",
    "integration-automation",
    "knowledge-workspace",
    "lifecycle-tool-voice",
    "model-admin",
    "provider",
    "shared-control",
    "tool-connector-admin",
    "workflow-admin",
    "workspace-capability",
    "workspace-shell-and-connector",
  ],
} as const satisfies Record<string, readonly LocaleNamespace[]>;

const LocaleControlContext = createContext((_locale: Locale) => {});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [instance] = useState(createRomeoI18n);
  useEffect(() => {
    const stored = storedLocale();
    document.documentElement.lang = stored;
    void instance.changeLanguage(stored);
  }, [instance]);
  const setLocale = useCallback(
    (next: Locale) => {
      localStorage.setItem("romeo:locale", next);
      document.documentElement.lang = next;
      void instance.changeLanguage(next);
    },
    [instance],
  );
  return (
    <I18nextProvider i18n={instance} defaultNS="core">
      <LocaleControlContext.Provider value={setLocale}>
        {children}
      </LocaleControlContext.Provider>
    </I18nextProvider>
  );
}

export function useLocale() {
  const setLocale = useContext(LocaleControlContext);
  const { i18n, t: translate } = useTranslation("core");
  const locale = normalizeLocale(i18n.resolvedLanguage);
  return useMemo(
    () => ({
      locale,
      setLocale,
      t: (key: MessageKey): string => translate(key),
    }),
    [locale, setLocale, translate],
  );
}

export function useLocaleNamespaces(namespaces: readonly LocaleNamespace[]) {
  const { i18n } = useTranslation([...namespaces]);
  // Components intentionally use one global MessageKey union. Limit that
  // global lookup to the namespaces declared by the active route instead of
  // silently searching every catalog in the product.
  i18n.options.fallbackNS = [
    "core",
    ...namespaces.filter((namespace) => namespace !== "core"),
  ];
}

function createRomeoI18n() {
  const instance = createInstance().use(
    resourcesToBackend(loadLocaleNamespace),
  );
  void instance.init({
    defaultNS: "core",
    fallbackLng: "en",
    fallbackNS: ["core"],
    initImmediate: false,
    interpolation: { escapeValue: false },
    lng: "en",
    ns: ["core"],
    partialBundledLanguages: true,
    resources: coreLocaleResources,
    returnNull: false,
  });
  return instance;
}

function storedLocale(): Locale {
  const value =
    typeof localStorage === "undefined"
      ? "en"
      : localStorage.getItem("romeo:locale");
  return normalizeLocale(value ?? undefined);
}

function normalizeLocale(value: string | undefined): Locale {
  return value === "es" || value === "fr" ? value : "en";
}
