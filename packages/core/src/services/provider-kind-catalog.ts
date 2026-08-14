import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ProviderKindCatalogEntry } from "@romeo/contracts";
import {
  defaultProviderCapabilities,
  listProviderDialects,
  type ProviderKind,
} from "@romeo/providers";

const providerDisplayNames = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI-compatible",
  "openai-responses-compatible": "OpenAI Responses-compatible",
  ollama: "Ollama",
} as const satisfies Record<ProviderKind, string>;

export function listProviderKindCatalog(
  subject: AuthSubject,
): ProviderKindCatalogEntry[] {
  assertScope(subject, "providers:read");
  return listProviderDialects().map((dialect) => {
    const defaultCapabilities = defaultProviderCapabilities(dialect.kind);
    return {
      kind: dialect.kind,
      defaultClassification:
        defaultCapabilities.deployment.mode === "local-runtime"
          ? "local"
          : "external",
      supportedClassifications:
        dialect.kind === "openai-compatible" ||
        dialect.kind === "openai-responses-compatible"
          ? (["external", "local"] as const)
          : dialect.kind === "ollama"
            ? (["local"] as const)
            : (["external"] as const),
      displayName: providerDisplayNames[dialect.kind],
      dialect: {
        contractVersion: dialect.contractVersion,
        version: dialect.version,
        operations: { ...dialect.operations },
      },
      defaultCapabilities: structuredClone(defaultCapabilities),
      configuration: {
        schemaVersion: 1,
        fields: configurationFields(dialect.kind),
      },
    };
  });
}

function configurationFields(
  kind: ProviderKind,
): ProviderKindCatalogEntry["configuration"]["fields"] {
  return [
    {
      id: "name",
      input: "text",
      required: true,
      writeOnly: false,
      sensitive: false,
      maxLength: 200,
      copyKey: "providerSetupFieldName",
    },
    {
      id: "baseUrl",
      input: "url",
      required: true,
      writeOnly: false,
      sensitive: false,
      maxLength: 2_000,
      copyKey: "providerSetupFieldBaseUrl",
    },
    {
      id: "credentialRef",
      input: "secret_reference",
      // Generic compatibility protocols can target either hosted or local
      // endpoints. Only Anthropic is unconditionally credentialed by kind;
      // runtime verification remains authoritative for every endpoint.
      required: kind === "anthropic",
      writeOnly: true,
      sensitive: true,
      maxLength: 500,
      copyKey: "providerSetupFieldCredentialRef",
    },
    {
      id: "modelIds",
      input: "identifier_list",
      required: false,
      writeOnly: false,
      sensitive: false,
      maxItems: 2_000,
      copyKey: "providerSetupFieldModelIds",
    },
  ];
}
