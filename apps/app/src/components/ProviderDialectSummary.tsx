import { StatusBadge } from "@romeo/ui";
import { useId } from "react";

import type { Provider } from "../features/providers/types";
import { useLocale, type MessageKey } from "../lib/i18n";

type Dialect = Provider["dialect"];

const operationRows = [
  ["chat", "providerDialectChat"],
  ["discovery", "providerDialectDiscovery"],
  ["embeddings", "providerDialectEmbeddings"],
  ["imageGeneration", "providerDialectImageGeneration"],
  ["audio", "providerDialectAudio"],
  ["files", "providerDialectFiles"],
  ["batches", "providerDialectBatches"],
  ["tokenCounting", "providerDialectTokenCounting"],
  ["capabilityProbing", "providerDialectCapabilityProbing"],
  ["errorNormalization", "providerDialectErrorNormalization"],
  ["usageParsing", "providerDialectUsageParsing"],
] as const satisfies ReadonlyArray<
  readonly [keyof Dialect["operations"], MessageKey]
>;

export function ProviderDialectSummary({ dialect }: { dialect: Dialect }) {
  const { t } = useLocale();
  const headingId = useId();
  return (
    <ProviderDialectSummaryView dialect={dialect} headingId={headingId} t={t} />
  );
}

export function ProviderDialectSummaryView({
  dialect,
  headingId,
  t,
}: {
  dialect: Dialect;
  headingId: string;
  t: (key: MessageKey) => string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-3 rounded-md border border-border p-3"
    >
      <div>
        <h3 className="text-sm font-semibold" id={headingId}>
          {t("providerDialect")}
        </h3>
        <p className="text-sm text-muted">{t("providerDialectDescription")}</p>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("providerDialectContractVersion")}
          </dt>
          <dd translate="no">{dialect.contractVersion}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {t("providerDialectImplementationVersion")}
          </dt>
          <dd translate="no">{dialect.version}</dd>
        </div>
      </dl>
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
          {t("providerDialectOperations")}
        </h4>
        <ul className="mt-2 flex flex-wrap gap-2">
          {operationRows.map(([operation, label]) => {
            const supported = dialect.operations[operation];
            return (
              <li className="flex items-center gap-2" key={operation}>
                <span>{t(label)}</span>
                <StatusBadge tone={supported ? "success" : "neutral"}>
                  {t(
                    supported
                      ? "providerDialectSupported"
                      : "providerDialectUnsupported",
                  )}
                </StatusBadge>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
