import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  loadLocaleNamespace,
  namespaceNames,
  supportedLocales,
  type SupportedLocale,
} from "../locales";
import { localeNamespaceGroups } from "./i18n";

function interpolationVariables(message: string): string[] {
  return [...message.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1]!)
    .sort();
}

describe("core chat translation catalogs", () => {
  it("keeps English, Spanish, and French keys in exact parity", async () => {
    const messages = await loadMessages();
    const englishKeys = Object.keys(messages.en).sort();
    expect(Object.keys(messages.es).sort()).toEqual(englishKeys);
    expect(Object.keys(messages.fr).sort()).toEqual(englishKeys);
  });

  it("does not ship empty core-chat translations", async () => {
    const messages = await loadMessages();
    for (const catalog of Object.values(messages)) {
      expect(
        Object.values(catalog).every((message) => message.trim().length > 0),
      ).toBe(true);
    }
  });

  it("keeps every namespace in key and interpolation parity", async () => {
    for (const namespace of namespaceNames) {
      const english = await loadLocaleNamespace("en", namespace);
      const englishKeys = Object.keys(english).sort();
      for (const locale of ["es", "fr"] as const) {
        const translated = await loadLocaleNamespace(locale, namespace);
        expect(
          Object.keys(translated).sort(),
          `${locale}/${namespace}`,
        ).toEqual(englishKeys);
        for (const key of englishKeys) {
          const source = english[key]!;
          const target = translated[key]!;
          expect(target.trim(), `${locale}/${namespace}/${key}`).not.toBe("");
          expect(
            interpolationVariables(target),
            `${locale}/${namespace}/${key}`,
          ).toEqual(interpolationVariables(source));
        }
      }
    }
  });

  it("keeps shared table controls explicitly localized", async () => {
    const messages = await loadMessages();
    expect(messages.es.tableSearch).toBe("Buscar en la tabla");
    expect(messages.es.tableOptions).toBe("Opciones de tabla");
    expect(messages.fr.tableSearch).toBe("Rechercher dans le tableau");
    expect(messages.fr.tableOptions).toBe("Options du tableau");
  });

  it("loads both catalogs used by device tokens on the settings route", () => {
    expect(localeNamespaceGroups.settings).toEqual(
      expect.arrayContaining(["admin-section", "device-impersonation"]),
    );
  });

  it("has no key defined in more than one namespace with conflicting values", async () => {
    const conflicts: string[] = [];
    for (const locale of supportedLocales) {
      const byKey = new Map<string, Map<string, string>>();
      for (const namespace of namespaceNames) {
        const catalog = await loadLocaleNamespace(locale, namespace);
        for (const [key, value] of Object.entries(catalog)) {
          const seen = byKey.get(key) ?? new Map<string, string>();
          seen.set(namespace, value);
          byKey.set(key, seen);
        }
      }
      conflicts.push(
        ...[...byKey.entries()]
          .filter(([, seen]) => new Set(seen.values()).size > 1)
          .map(
            ([key, seen]) => `${locale}/${key}: ${[...seen.keys()].join(", ")}`,
          ),
      );
    }
    expect(conflicts, "duplicate keys with conflicting values").toEqual([]);
  });

  it("ships no unreferenced message keys", async () => {
    const sources = await readAllSourceText(new URL("../", import.meta.url));
    const unused: string[] = [];
    for (const namespace of namespaceNames) {
      const catalog = await loadLocaleNamespace("en", namespace);
      for (const key of Object.keys(catalog)) {
        // Deliberately conservative substring matching can miss a dead key
        // embedded in a larger string, but never breaks the build on a live
        // literal key. There are no dynamic template-literal t() call sites.
        if (!sources.includes(`"${key}"`) && !sources.includes(`'${key}'`)) {
          unused.push(`${namespace}.${key}`);
        }
      }
    }
    expect(unused).toEqual([]);
  });
});

async function readAllSourceText(directory: URL): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        if (entry.name === "locales") return "";
        return readAllSourceText(new URL(`${entry.name}/`, directory));
      }
      if (
        !entry.isFile() ||
        !/\.(?:ts|tsx)$/u.test(entry.name) ||
        /\.test\.(?:ts|tsx)$/u.test(entry.name)
      )
        return "";
      return readFile(new URL(entry.name, directory), "utf8");
    }),
  );
  return contents.join("\n");
}

async function loadMessages() {
  return Object.fromEntries(
    await Promise.all(
      supportedLocales.map(async (locale) => [
        locale,
        await loadCatalog(locale),
      ]),
    ),
  ) as Record<SupportedLocale, Record<string, string>>;
}

async function loadCatalog(locale: SupportedLocale) {
  return Object.assign(
    {},
    ...(await Promise.all(
      namespaceNames.map((namespace) => loadLocaleNamespace(locale, namespace)),
    )),
  );
}
