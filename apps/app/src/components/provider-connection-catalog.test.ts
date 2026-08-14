import { describe, expect, it } from "vitest";

import type { ProviderKindDefinition } from "../features/providers/types";
import {
  parseProviderModelIds,
  providerConfigurationField,
  providerKindDefinition,
  providerKindOptions,
} from "./provider-connection-catalog";

const definition = {
  kind: "ollama",
  displayName: "Ollama",
  configuration: {
    schemaVersion: 1,
    fields: [
      {
        id: "name",
        input: "text",
        required: true,
        writeOnly: false,
        sensitive: false,
        maxLength: 200,
        copyKey: "providerSetupFieldName",
      },
    ],
  },
} as ProviderKindDefinition;

describe("provider connection catalog", () => {
  it("selects installed kinds and accepts only reviewed field copy keys", () => {
    expect(providerKindOptions([definition])).toEqual([
      { label: "Ollama", value: "ollama" },
    ]);
    expect(
      providerKindOptions([
        definition,
        { ...definition, kind: "future-provider" },
      ] as ProviderKindDefinition[]),
    ).toEqual([{ label: "Ollama", value: "ollama" }]);
    expect(providerKindDefinition([definition], "ollama")).toBe(definition);
    expect(providerConfigurationField(definition, "name")).toMatchObject({
      maxLength: 200,
    });
    expect(
      providerConfigurationField(
        {
          ...definition,
          configuration: {
            schemaVersion: 1,
            fields: [
              { ...definition.configuration.fields[0]!, copyKey: "evil" },
            ],
          },
        },
        "name",
      ),
    ).toBeUndefined();
  });

  it("deduplicates and bounds model identifiers", () => {
    expect(parseProviderModelIds(" model-a\nmodel-b,model-a ", 2)).toEqual({
      exceeded: false,
      items: ["model-a", "model-b"],
    });
    expect(parseProviderModelIds("one,two,three", 2)).toEqual({
      exceeded: true,
      items: ["one", "two"],
    });
  });
});
