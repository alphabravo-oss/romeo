import { describe, expect, it } from "vitest";

import {
  loadLocaleNamespace,
  namespaceNames,
  supportedLocales,
  type SupportedLocale,
} from "../locales";

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
});

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
