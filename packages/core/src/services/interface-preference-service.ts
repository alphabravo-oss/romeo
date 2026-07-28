import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";

export interface InterfacePreferences {
  theme: "system" | "light" | "dark";
  locale: "en" | "es" | "fr";
  fontSize: "small" | "medium" | "large";
  density: "comfortable" | "compact";
  reducedMotion: boolean;
}

const defaults: InterfacePreferences = {
  theme: "system",
  locale: "en",
  fontSize: "medium",
  density: "comfortable",
  reducedMotion: false,
};

export class InterfacePreferenceService {
  constructor(private readonly repository: RomeoRepository) {}

  async get(subject: AuthSubject): Promise<InterfacePreferences> {
    const value =
      (await this.repository.getSystemSetting(preferenceKey(subject)))?.value ??
      {};
    return normalize(value);
  }

  async update(
    subject: AuthSubject,
    input: Partial<InterfacePreferences>,
  ): Promise<InterfacePreferences> {
    const data = normalize({ ...(await this.get(subject)), ...input });
    await this.repository.upsertSystemSetting({
      key: preferenceKey(subject),
      value: { ...data },
      updatedAt: new Date().toISOString(),
    });
    return data;
  }
}

function preferenceKey(
  subject: Pick<AuthSubject, "orgId" | "type" | "id">,
): string {
  return `interface_preferences.v1:${subject.orgId}:${subject.type}:${subject.id}`;
}

function normalize(value: Record<string, unknown>): InterfacePreferences {
  return {
    theme:
      value.theme === "light" || value.theme === "dark"
        ? value.theme
        : defaults.theme,
    locale:
      value.locale === "es" || value.locale === "fr"
        ? value.locale
        : defaults.locale,
    fontSize:
      value.fontSize === "small" || value.fontSize === "large"
        ? value.fontSize
        : defaults.fontSize,
    density: value.density === "compact" ? "compact" : defaults.density,
    reducedMotion: value.reducedMotion === true,
  };
}
