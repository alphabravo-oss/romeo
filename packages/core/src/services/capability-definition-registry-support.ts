import { assertCapabilityDefaultConfiguration } from "./capability-configuration";
import type {
  CapabilityDefinition,
  CapabilityId,
} from "./capability-definition-registry";

export function cloneCapabilityDefinition(
  definition: CapabilityDefinition,
): CapabilityDefinition {
  return {
    ...definition,
    controllingLayers: [...definition.controllingLayers],
    allowedStates: [...definition.allowedStates],
    defaultConfiguration: structuredClone(definition.defaultConfiguration),
    merge: {
      boolean: definition.merge.boolean,
      booleans: [...definition.merge.booleans],
      maxima: [...definition.merge.maxima],
      allowlists: [...definition.merge.allowlists],
    },
    requiredScopes: [...definition.requiredScopes],
    dependencies: [...definition.dependencies],
    copy: { ...definition.copy },
  };
}

export function validateCapabilityRegistry(
  definitions: readonly CapabilityDefinition[],
): void {
  const ids = new Set<CapabilityId>();
  for (const definition of definitions) {
    if (ids.has(definition.id))
      throw new Error(`Duplicate capability definition: ${definition.id}`);
    ids.add(definition.id);
    assertCapabilityDefaultConfiguration(definition);
    if (
      definition.allowedStates.includes("disabled") &&
      ["content_firewall", "knowledge_acl", "tenant_encryption"].includes(
        definition.id,
      )
    )
      throw new Error(
        `Capability ${definition.id} is security-mandatory and cannot expose disable.`,
      );
  }
}
