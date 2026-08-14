import type { UsageMetricDefinition } from "@romeo/api-client/generated/query";
import type { UseQueryResult } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LocaleProvider, type MessageKey } from "../lib/i18n";
import spanish from "../locales/es/admin-operations.json";
import french from "../locales/fr/admin-operations.json";
import { UsageMetricCatalogSection } from "./UsageMetricCatalog";

const definition: UsageMetricDefinition = {
  aggregation: "sum",
  billable: true,
  category: "text_token",
  measurement: "reported",
  metric: "llm.input_token.reported",
  overlapPolicy: "component_of_total",
  sourceTypes: ["run"],
  unit: "token",
};

const labels: Partial<Record<MessageKey, string>> = {
  usageMetric: "Metric",
  usageUnit: "Unit",
  usageMetricCatalogTitle: "Metric definitions",
  usageMetricCatalogDescription: "Canonical metric semantics.",
  usageMetricCatalogEmpty: "No metric definitions available.",
  usageMetricCatalogEmptyDescription: "Refresh the catalog.",
  usageMetricCategoryMeasurement: "Category / measurement",
  usageMetricBillingSemantics: "Billing / overlap",
  usageMetricBillable: "Billable",
  usageMetricNotBillable: "Not billable",
  usageOverlapComponent: "Component of another total",
  usageCategoryTextTokens: "Text tokens",
  usageMeasurementReported: "Provider reported",
  usageUnitTokens: "Tokens",
  usageMetricReportedInputTokens: "Input tokens reported",
};
const t = (key: MessageKey) => labels[key] ?? key;

describe("UsageMetricCatalogSection", () => {
  it("renders localized compact taxonomy semantics in a table", () => {
    const markup = renderCatalog(queryState({ data: [definition] }));

    expect(markup).toContain("<table");
    expect(markup).toContain("Input tokens reported");
    expect(markup).toContain("llm.input_token.reported");
    expect(markup).toContain("Provider reported");
    expect(markup).toContain("Billable");
    expect(markup).toContain("Component of another total");
  });

  it("renders the same metric semantics from Spanish and French catalogs", () => {
    const query = queryState({ data: [definition] });
    const spanishMarkup = renderCatalog(query, catalogTranslator(spanish));
    const frenchMarkup = renderCatalog(query, catalogTranslator(french));

    expect(spanishMarkup).toContain("Tokens de entrada informados");
    expect(spanishMarkup).toContain("Componente de otro total");
    expect(frenchMarkup).toContain("Jetons d’entrée déclarés");
    expect(frenchMarkup).toContain("Composant d’un autre total");
  });

  it("exposes accessible loading, error, and empty states", () => {
    const loading = renderCatalog(queryState({ isPending: true }));
    const error = renderCatalog(
      queryState({ error: new Error("credential=secret"), isError: true }),
    );
    const empty = renderCatalog(queryState({ data: [] }));

    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(error).toContain('role="alert"');
    expect(error).not.toContain("credential=secret");
    expect(empty).toContain("No metric definitions available.");
  });

  it("never renders unknown server-provided taxonomy values", () => {
    const unsafe = {
      ...definition,
      metric: "<img src=x onerror=alert(1)>",
      unit: "credential=secret",
    } as unknown as UsageMetricDefinition;
    const markup = renderCatalog(queryState({ data: [unsafe] }));

    expect(markup).toContain("No metric definitions available.");
    expect(markup).not.toContain("onerror");
    expect(markup).not.toContain("credential=secret");
  });
});

function renderCatalog(
  query: UseQueryResult<UsageMetricDefinition[], Error>,
  translate = t,
): string {
  return renderToStaticMarkup(
    <LocaleProvider>
      <UsageMetricCatalogSection query={query} t={translate} />
    </LocaleProvider>,
  );
}

function catalogTranslator(
  catalog: Record<string, string>,
): (key: MessageKey) => string {
  return (key) => catalog[key] ?? key;
}

function queryState(
  input: Partial<UseQueryResult<UsageMetricDefinition[], Error>>,
): UseQueryResult<UsageMetricDefinition[], Error> {
  return {
    data: undefined,
    error: null,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
    ...input,
  } as unknown as UseQueryResult<UsageMetricDefinition[], Error>;
}
