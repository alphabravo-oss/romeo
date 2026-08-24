import coreEN from "./en/core.json";
import coreES from "./es/core.json";
import coreFR from "./fr/core.json";

export const supportedLocales = ["en", "es", "fr"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

export const namespaceNames = [
  "abuse-control",
  "access-credential",
  "admin-navigation",
  "admin-operations",
  "admin-overview",
  "admin-section",
  "agent-studio",
  "api-errors",
  "auth",
  "auth-provider-admin",
  "billing-admin",
  "capability-admin",
  "chat-supplement",
  "core",
  "device-impersonation",
  "eval-workspace",
  "governance",
  "group-organization",
  "integration-automation",
  "knowledge-workspace",
  "lifecycle-tool-voice",
  "model-admin",
  "notification-admin",
  "operations-posture",
  "prompt-template-admin",
  "provider",
  "rag-governance",
  "security",
  "settings",
  "shared-control",
  "tool-connector-admin",
  "trust-compute",
  "user-admin",
  "web-search-admin",
  "workspace-capability",
  "workspace-shell-and-connector",
] as const;
export type LocaleNamespace = (typeof namespaceNames)[number];

export const coreLocaleResources = {
  en: { core: coreEN },
  es: { core: coreES },
  fr: { core: coreFR },
} as const;

const localeLoaders = import.meta.glob<{
  default: Record<string, string>;
}>("./{en,es,fr}/*.json");
const localeNamespacePromises = new Map<
  string,
  Promise<Record<string, string>>
>();
const loadedLocaleNamespaces = new Map<string, Record<string, string>>();

export async function loadLocaleNamespace(
  locale: string,
  namespace: string,
): Promise<Record<string, string>> {
  if (!isSupportedLocale(locale) || !isLocaleNamespace(namespace)) {
    throw new Error(`Unsupported locale namespace: ${locale}/${namespace}`);
  }
  const loader = localeLoaders[`./${locale}/${namespace}.json`];
  if (!loader) {
    throw new Error(`Missing locale namespace: ${locale}/${namespace}`);
  }
  const key = `${locale}/${namespace}`;
  const existing = localeNamespacePromises.get(key);
  if (existing !== undefined) return existing;
  const loading = loader()
    .then((module) => {
      loadedLocaleNamespaces.set(key, module.default);
      return module.default;
    })
    .catch((error: unknown) => {
      localeNamespacePromises.delete(key);
      throw error;
    });
  localeNamespacePromises.set(key, loading);
  return loading;
}

export async function preloadLocaleNamespaces(
  locale: SupportedLocale,
  namespaces: readonly LocaleNamespace[],
): Promise<Record<string, Record<string, string>>> {
  const unique = [...new Set(namespaces)];
  const resources = await Promise.all(
    unique.map(
      async (namespace) =>
        [namespace, await loadLocaleNamespace(locale, namespace)] as const,
    ),
  );
  return Object.fromEntries(resources);
}

export function cachedLocaleNamespaces(
  locale: SupportedLocale,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    namespaceNames.flatMap((namespace) => {
      const resource = loadedLocaleNamespaces.get(`${locale}/${namespace}`);
      return resource === undefined ? [] : [[namespace, resource]];
    }),
  );
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return supportedLocales.some((locale) => locale === value);
}

export function isLocaleNamespace(value: string): value is LocaleNamespace {
  return namespaceNames.some((namespace) => namespace === value);
}

type EnglishMessages = typeof coreEN &
  typeof import("./en/abuse-control.json") &
  typeof import("./en/access-credential.json") &
  typeof import("./en/admin-navigation.json") &
  typeof import("./en/admin-operations.json") &
  typeof import("./en/admin-overview.json") &
  typeof import("./en/admin-section.json") &
  typeof import("./en/agent-studio.json") &
  typeof import("./en/api-errors.json") &
  typeof import("./en/auth.json") &
  typeof import("./en/auth-provider-admin.json") &
  typeof import("./en/billing-admin.json") &
  typeof import("./en/capability-admin.json") &
  typeof import("./en/chat-supplement.json") &
  typeof import("./en/device-impersonation.json") &
  typeof import("./en/eval-workspace.json") &
  typeof import("./en/governance.json") &
  typeof import("./en/group-organization.json") &
  typeof import("./en/integration-automation.json") &
  typeof import("./en/knowledge-workspace.json") &
  typeof import("./en/lifecycle-tool-voice.json") &
  typeof import("./en/model-admin.json") &
  typeof import("./en/notification-admin.json") &
  typeof import("./en/operations-posture.json") &
  typeof import("./en/prompt-template-admin.json") &
  typeof import("./en/provider.json") &
  typeof import("./en/rag-governance.json") &
  typeof import("./en/security.json") &
  typeof import("./en/settings.json") &
  typeof import("./en/shared-control.json") &
  typeof import("./en/tool-connector-admin.json") &
  typeof import("./en/trust-compute.json") &
  typeof import("./en/user-admin.json") &
  typeof import("./en/web-search-admin.json") &
  typeof import("./en/workspace-capability.json") &
  typeof import("./en/workspace-shell-and-connector.json");

export type MessageKey = keyof EnglishMessages;
