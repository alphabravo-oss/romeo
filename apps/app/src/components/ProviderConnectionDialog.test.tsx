// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderKindDefinition } from "../features/providers/types";
import { providerKindsQueryOptions } from "../lib/api-query-options";
import { LocaleProvider } from "../lib/i18n";
import { ConnectionDialog } from "./ProviderConnectionDialog";

let container: HTMLDivElement;
let root: Root;
const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

const definition = {
  kind: "openai-compatible",
  displayName: "OpenAI-compatible",
  defaultClassification: "external",
  supportedClassifications: ["external", "local"],
  configuration: {
    schemaVersion: 1,
    fields: [
      field("name", "text", true, "providerSetupFieldName", {
        maxLength: 90,
      }),
      field("baseUrl", "url", true, "providerSetupFieldBaseUrl", {
        maxLength: 1_500,
      }),
      field(
        "credentialRef",
        "secret_reference",
        false,
        "providerSetupFieldCredentialRef",
        { maxLength: 321, sensitive: true, writeOnly: true },
      ),
      field(
        "modelIds",
        "identifier_list",
        false,
        "providerSetupFieldModelIds",
        { maxItems: 2 },
      ),
    ],
  },
} as ProviderKindDefinition;

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("ProviderConnectionDialog", () => {
  it("uses only installed reviewed metadata and enforces server bounds", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(providerKindsQueryOptions().queryKey, {
      data: [definition],
    });

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <LocaleProvider>
            <ConnectionDialog
              busy={false}
              onClose={vi.fn()}
              onSave={vi.fn()}
              provider={undefined}
            />
          </LocaleProvider>
        </QueryClientProvider>,
      );
    });

    const name = document.querySelector<HTMLInputElement>('[name="name"]');
    const baseUrl =
      document.querySelector<HTMLInputElement>('[name="baseUrl"]');
    const credential =
      document.querySelector<HTMLInputElement>('[name="apiKey"]');
    const save = document.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );

    expect(name?.maxLength).toBe(90);
    expect(baseUrl?.maxLength).toBe(1_500);
    expect(credential?.maxLength).toBe(321);
    expect(credential?.type).toBe("password");
    expect(credential?.required).toBe(false);
    expect(save?.disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "providerDeploymentClassifications",
    );
    expect(document.body.textContent).not.toContain("vault://");
  });
});

function field(
  id: "baseUrl" | "credentialRef" | "modelIds" | "name",
  input: "identifier_list" | "secret_reference" | "text" | "url",
  required: boolean,
  copyKey: string,
  options: {
    maxItems?: number;
    maxLength?: number;
    sensitive?: boolean;
    writeOnly?: boolean;
  } = {},
) {
  return {
    id,
    input,
    required,
    copyKey,
    sensitive: options.sensitive ?? false,
    writeOnly: options.writeOnly ?? false,
    ...(options.maxItems === undefined ? {} : { maxItems: options.maxItems }),
    ...(options.maxLength === undefined
      ? {}
      : { maxLength: options.maxLength }),
  };
}
