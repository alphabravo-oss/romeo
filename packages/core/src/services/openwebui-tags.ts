export interface ImportedOpenWebUiTag {
  name: string;
  slug: string;
}

export function openWebUiTagSlug(name: string): string {
  return name.trim().replace(/\s+/gu, "_").toLowerCase();
}

export function openWebUiTagsFromChat(
  chat: Record<string, unknown>,
): ImportedOpenWebUiTag[] {
  const candidates = [
    ...tagValues(chat.tags),
    ...tagValues(asRecord(chat.meta)?.tags),
  ];
  const bySlug = new Map<string, ImportedOpenWebUiTag>();
  for (const name of candidates) {
    const slug = openWebUiTagSlug(name);
    if (slug.length === 0 || bySlug.has(slug)) continue;
    bySlug.set(slug, { name, slug });
  }
  return Array.from(bySlug.values());
}

function tagValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(tagValue)
    .filter((tag): tag is string => tag !== undefined);
}

function tagValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  const record = asRecord(value);
  return stringField(record?.name) ?? stringField(record?.id);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
