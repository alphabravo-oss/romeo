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

const adminCommonNamespaces = [
  "admin-navigation",
  "admin-section",
  "shared-control",
  "workspace-capability",
  "workspace-shell-and-connector",
] as const satisfies readonly LocaleNamespace[];

const adminSectionNamespaces: Record<string, readonly LocaleNamespace[]> = {
  abuse: withNamespaces(adminCommonNamespaces, "abuse-control"),
  access: withNamespaces(adminCommonNamespaces, "access-credential"),
  analytics: withNamespaces(adminCommonNamespaces, "admin-operations"),
  audit: withNamespaces(adminCommonNamespaces, "admin-operations"),
  "auth-providers": withNamespaces(
    adminCommonNamespaces,
    "auth-provider-admin",
  ),
  billing: withNamespaces(adminCommonNamespaces, "billing-admin"),
  capabilities: withNamespaces(adminCommonNamespaces, "capability-admin"),
  compute: withNamespaces(adminCommonNamespaces, "trust-compute"),
  "chat-experience": withNamespaces(
    adminCommonNamespaces,
    "prompt-template-admin",
  ),
  connections: withNamespaces(
    adminCommonNamespaces,
    "integration-automation",
    "tool-connector-admin",
  ),
  "connected-apps": withNamespaces(
    adminCommonNamespaces,
    "integration-automation",
  ),
  governance: withNamespaces(adminCommonNamespaces, "governance"),
  groups: withNamespaces(adminCommonNamespaces, "group-organization"),
  impersonation: withNamespaces(adminCommonNamespaces, "device-impersonation"),
  "notification-channels": withNamespaces(
    adminCommonNamespaces,
    "notification-admin",
  ),
  operations: withNamespaces(adminCommonNamespaces, "admin-operations"),
  organizations: withNamespaces(adminCommonNamespaces, "group-organization"),
  overview: withNamespaces(adminCommonNamespaces, "admin-overview"),
  posture: withNamespaces(adminCommonNamespaces, "operations-posture"),
  "prompt-templates": withNamespaces(
    adminCommonNamespaces,
    "prompt-template-admin",
  ),
  providers: withNamespaces(
    adminCommonNamespaces,
    "agent-studio",
    "group-organization",
    "knowledge-workspace",
    "lifecycle-tool-voice",
    "model-admin",
    "provider",
  ),
  rag: withNamespaces(adminCommonNamespaces, "rag-governance"),
  usage: withNamespaces(
    adminCommonNamespaces,
    "admin-operations",
    "billing-admin",
  ),
  users: withNamespaces(adminCommonNamespaces, "user-admin"),
  "web-search": withNamespaces(adminCommonNamespaces, "web-search-admin"),
  webhooks: withNamespaces(adminCommonNamespaces, "integration-automation"),
  workflows: withNamespaces(adminCommonNamespaces, "workflow-admin"),
  "workspace-members": withNamespaces(
    adminCommonNamespaces,
    "group-organization",
  ),
};

const settingsCommonNamespaces = [
  "admin-navigation",
  "admin-section",
  "settings",
  "shared-control",
  "workspace-shell-and-connector",
] as const satisfies readonly LocaleNamespace[];

const settingsSectionNamespaces: Record<string, readonly LocaleNamespace[]> = {
  account: settingsCommonNamespaces,
  "device-tokens": withNamespaces(
    settingsCommonNamespaces,
    "device-impersonation",
  ),
  interface: settingsCommonNamespaces,
  memories: settingsCommonNamespaces,
  notes: settingsCommonNamespaces,
  notifications: withNamespaces(settingsCommonNamespaces, "notification-admin"),
  security: withNamespaces(
    settingsCommonNamespaces,
    "access-credential",
    "security",
  ),
};

const workspaceCommonNamespaces = [
  "admin-navigation",
  "admin-section",
  "eval-workspace",
  "shared-control",
  "workspace-capability",
  "workspace-shell-and-connector",
] as const satisfies readonly LocaleNamespace[];

const workspaceSectionNamespaces: Record<string, readonly LocaleNamespace[]> = {
  agents: withNamespaces(
    workspaceCommonNamespaces,
    "agent-studio",
    "group-organization",
    "knowledge-workspace",
    "lifecycle-tool-voice",
    "model-admin",
    "provider",
  ),
  collaboration: withNamespaces(
    workspaceCommonNamespaces,
    "group-organization",
    "integration-automation",
  ),
  evals: withNamespaces(workspaceCommonNamespaces, "eval-workspace"),
  knowledge: withNamespaces(workspaceCommonNamespaces, "knowledge-workspace"),
  tools: withNamespaces(
    workspaceCommonNamespaces,
    "lifecycle-tool-voice",
    "tool-connector-admin",
  ),
  voice: withNamespaces(workspaceCommonNamespaces, "lifecycle-tool-voice"),
};

export function localeNamespacesForAdminSection(
  section: string,
): readonly LocaleNamespace[] {
  return adminSectionNamespaces[section] ?? adminCommonNamespaces;
}

export function localeNamespacesForSettingsSection(
  section: string,
): readonly LocaleNamespace[] {
  return settingsSectionNamespaces[section] ?? settingsCommonNamespaces;
}

export function localeNamespacesForWorkspaceSection(
  section: string,
): readonly LocaleNamespace[] {
  return workspaceSectionNamespaces[section] ?? workspaceCommonNamespaces;
}

function withNamespaces(
  common: readonly LocaleNamespace[],
  ...section: LocaleNamespace[]
): readonly LocaleNamespace[] {
  return [...new Set([...common, ...section])];
}

const LocaleControlContext = createContext((_locale: Locale) => {});

export function LocaleProvider({
  children,
  initialLocale = "en",
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [instance] = useState(() => createRomeoI18n(initialLocale));
  useEffect(() => {
    const stored = storedLocale(initialLocale);
    document.documentElement.lang = stored;
    void instance.changeLanguage(stored);
  }, [initialLocale, instance]);
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
      t: (
        key: MessageKey,
        values?: Record<string, boolean | number | string>,
      ): string =>
        values === undefined ? translate(key) : translate(key, values),
    }),
    [locale, setLocale, translate],
  );
}

export function useLocaleNamespaces(namespaces: readonly LocaleNamespace[]) {
  // Always bind the same hook arity. Spreading a section-sized list into
  // useTranslation() changes useMemo dep length when the console section
  // changes, which React rejects and which left chrome labels on stale
  // catalogs.
  const { i18n } = useTranslation("core");
  const [, setRevision] = useState(0);
  const signature = namespaces.join("\0");
  const fallback = [
    "core",
    ...namespaces.filter((namespace) => namespace !== "core"),
  ];
  if (!sameFallbackNamespaces(i18n.options.fallbackNS, fallback)) {
    i18n.options.fallbackNS = fallback;
  }
  useEffect(() => {
    let cancelled = false;
    void i18n.loadNamespaces([...namespaces]).then(() => {
      if (!cancelled) setRevision((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [i18n, signature]);
}

function sameFallbackNamespaces(
  current: unknown,
  next: readonly string[],
): boolean {
  if (!Array.isArray(current) || current.length !== next.length) return false;
  return current.every((namespace, index) => namespace === next[index]);
}

function createRomeoI18n(initialLocale: Locale) {
  const instance = createInstance().use(
    resourcesToBackend(loadLocaleNamespace),
  );
  void instance.init({
    defaultNS: "core",
    fallbackLng: "en",
    fallbackNS: ["core"],
    initImmediate: false,
    interpolation: { escapeValue: false },
    lng: initialLocale,
    ns: ["core"],
    partialBundledLanguages: true,
    resources: coreLocaleResources,
    returnNull: false,
  });
  return instance;
}

function storedLocale(fallback: Locale): Locale {
  const value =
    typeof localStorage === "undefined"
      ? fallback
      : localStorage.getItem("romeo:locale");
  return normalizeLocale(value ?? fallback);
}

function normalizeLocale(value: string | undefined): Locale {
  return value === "es" || value === "fr" ? value : "en";
}
