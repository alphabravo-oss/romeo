import type { MessageKey } from "../lib/i18n";
import type {
  ProviderKindDefinition,
  ProviderKind,
} from "../features/providers/types";

export type ProviderConfigurationFieldId =
  ProviderKindDefinition["configuration"]["fields"][number]["id"];

export const providerFieldCopyKeys = {
  baseUrl: "providerSetupFieldBaseUrl",
  credentialRef: "providerSetupFieldCredentialRef",
  modelIds: "providerSetupFieldModelIds",
  name: "providerSetupFieldName",
} as const satisfies Record<ProviderConfigurationFieldId, MessageKey>;

const knownProviderKinds = new Set<ProviderKind>([
  "anthropic",
  "ollama",
  "openai-compatible",
  "openai-responses-compatible",
]);

export function providerKindDefinition(
  definitions: ProviderKindDefinition[],
  kind: ProviderKind,
): ProviderKindDefinition | undefined {
  return definitions.find((definition) => definition.kind === kind);
}

export function providerConfigurationField(
  definition: ProviderKindDefinition | undefined,
  id: ProviderConfigurationFieldId,
) {
  const field = definition?.configuration.fields.find(
    (candidate) => candidate.id === id,
  );
  // UI copy remains a finite reviewed client mapping. A mismatched server copy
  // key fails closed instead of selecting an arbitrary translation/component.
  return field?.copyKey === providerFieldCopyKeys[id] ? field : undefined;
}

export function providerKindOptions(definitions: ProviderKindDefinition[]) {
  return definitions
    .filter((definition) => knownProviderKinds.has(definition.kind))
    .map((definition) => ({
      label: definition.displayName,
      value: definition.kind,
    }));
}

export function parseProviderModelIds(
  value: string,
  maxItems: number,
): { exceeded: boolean; items: string[] } {
  const items = [
    ...new Set(
      value
        .split(/[\n,]/u)
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  return { exceeded: items.length > maxItems, items: items.slice(0, maxItems) };
}
