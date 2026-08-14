import type {
  UsageMetricCode,
  UsageMetricDefinition,
} from "@romeo/api-client/generated/query";
import { StatusBadge } from "@romeo/ui";
import type { UseQueryResult } from "@tanstack/react-query";

import type { MessageKey } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { createColumnHelper, DataTable, type ColumnDef } from "./DataTable";

type Translate = (key: MessageKey) => string;

type CatalogRow = UsageMetricDefinition & {
  categoryLabelKey: MessageKey;
  labelKey: MessageKey;
  measurementLabelKey: MessageKey;
  overlapLabelKey: MessageKey;
  unitLabelKey: MessageKey;
};

const metricLabelKeys = {
  "audio.input_byte": "usageMetricAudioInputBytes",
  "audio.input_second": "usageMetricAudioInputSeconds",
  "audio.output_character": "usageMetricAudioOutputCharacters",
  "audio.output_second": "usageMetricAudioOutputSeconds",
  "chat.message.feedback": "usageMetricChatFeedback",
  "compute.cpu_millisecond": "usageMetricCpuTime",
  "compute.memory_byte_millisecond": "usageMetricMemoryTime",
  "file.upload.pipeline_duration": "usageMetricFileUploadDuration",
  "image.cost.micro_usd": "usageMetricImageCost",
  "image.generated": "usageMetricImagesGenerated",
  "image.input": "usageMetricInputImages",
  "llm.cached_input_token.reported": "usageMetricCachedInputTokens",
  "llm.input_token.estimated": "usageMetricEstimatedInputTokens",
  "llm.input_token.reported": "usageMetricReportedInputTokens",
  "llm.output_token.estimated": "usageMetricEstimatedOutputTokens",
  "llm.output_token.reported": "usageMetricReportedOutputTokens",
  "llm.reasoning_token.reported": "usageMetricReasoningTokens",
  "llm.total_token.reported": "usageMetricReportedTotalTokens",
  "provider.error": "usageMetricProviderErrors",
  "queue.wait": "usageMetricQueueWait",
  "retrieval.unit": "usageMetricRetrievalUnits",
  "run.cancelled": "usageMetricRunsCancelled",
  "run.completed": "usageMetricRunsCompleted",
  "run.duration": "usageMetricRunDuration",
  "run.failed": "usageMetricRunsFailed",
  "run.output_throughput": "usageMetricOutputThroughput",
  "run.recovery": "usageMetricRunRecoveries",
  "run.started": "usageMetricRunsStarted",
  "run.time_to_first_token": "usageMetricTimeToFirstToken",
  "sse.connection": "usageMetricStreamConnections",
  "sse.disconnect": "usageMetricStreamDisconnections",
  "sse.reconnect": "usageMetricStreamReconnections",
  "storage.byte": "usageMetricStoredBytes",
  "storage.embedding_indexed": "usageMetricEmbeddingsIndexed",
  "storage.source_completed": "usageMetricSourceBytesCompleted",
  "storage.source_deleted": "usageMetricSourceBytesDeleted",
  "storage.source_extracted": "usageMetricSourceBytesExtracted",
  "storage.source_registered": "usageMetricSourceBytesRegistered",
  "storage.source_reindexed": "usageMetricSourceBytesReindexed",
  "tool.call.failure": "usageMetricToolCallsFailed",
  "tool.call.success": "usageMetricToolCallsSucceeded",
  "trace.span": "usageMetricTraceDuration",
  "video.input_second": "usageMetricVideoInputSeconds",
  "voice.message.generated": "usageMetricVoiceMessagesGenerated",
  "voice.preview.generated": "usageMetricVoicePreviewsGenerated",
  "voice.transcription.generated": "usageMetricVoiceTranscriptionsGenerated",
  "web.search.request": "usageMetricWebSearches",
  "web.url.fetch": "usageMetricWebUrlFetches",
} as const satisfies Record<UsageMetricCode, MessageKey>;

const categoryLabelKeys = {
  activity: "usageCategoryActivity",
  audio: "usageCategoryAudio",
  compute: "usageCategoryCompute",
  cost: "usageCategoryCost",
  image: "usageCategoryImage",
  latency: "usageCategoryLatency",
  retrieval: "usageCategoryRetrieval",
  storage: "usageCategoryStorage",
  text_token: "usageCategoryTextTokens",
  video: "usageCategoryVideo",
} as const satisfies Record<UsageMetricDefinition["category"], MessageKey>;

const measurementLabelKeys = {
  activity: "usageMeasurementActivity",
  estimated: "usageMeasurementEstimated",
  measured: "usageMeasurementMeasured",
  reported: "usageMeasurementReported",
} as const satisfies Record<UsageMetricDefinition["measurement"], MessageKey>;

const overlapLabelKeys = {
  component_of_total: "usageOverlapComponent",
  exclusive: "usageOverlapExclusive",
  non_additive: "usageOverlapNonAdditive",
} as const satisfies Record<UsageMetricDefinition["overlapPolicy"], MessageKey>;

const unitLabelKeys = {
  byte: "usageUnitBytes",
  byte_millisecond: "usageUnitByteMilliseconds",
  call: "usageUnitCalls",
  character: "usageUnitCharacters",
  connection: "usageUnitConnections",
  cpu_millisecond: "usageUnitCpuMilliseconds",
  embedding: "usageUnitEmbeddings",
  error: "usageUnitErrors",
  event: "usageUnitEvents",
  feedback: "usageUnitFeedback",
  image: "usageUnitImages",
  micro_usd: "usageUnitMicroUsd",
  millisecond: "usageUnitMilliseconds",
  recovery: "usageUnitRecoveries",
  request: "usageUnitRequests",
  retrieval_unit: "usageUnitRetrievalUnits",
  run: "usageUnitRuns",
  second: "usageUnitSeconds",
  token: "usageUnitTokens",
  token_per_second: "usageUnitTokensPerSecond",
  url: "usageUnitUrls",
} as const satisfies Record<string, MessageKey>;

const catalogColumn = createColumnHelper<CatalogRow>();

export function UsageMetricCatalogSection<TError>({
  query,
  t,
}: {
  query: UseQueryResult<UsageMetricDefinition[], TError>;
  t: Translate;
}) {
  return (
    <section
      aria-describedby="usage-metric-catalog-description"
      aria-labelledby="usage-metric-catalog-title"
      className="mt-4 grid gap-2"
    >
      <div>
        <h3
          className="text-xs font-medium text-muted"
          id="usage-metric-catalog-title"
        >
          {t("usageMetricCatalogTitle")}
        </h3>
        <p
          className="mt-1 text-xs text-muted"
          id="usage-metric-catalog-description"
        >
          {t("usageMetricCatalogDescription")}
        </p>
      </div>
      <PanelState
        empty={t("usageMetricCatalogEmpty")}
        emptyDescription={t("usageMetricCatalogEmptyDescription")}
        query={query}
      >
        {(definitions) => (
          <UsageMetricCatalog definitions={definitions} t={t} />
        )}
      </PanelState>
    </section>
  );
}

export function UsageMetricCatalog({
  definitions,
  t,
}: {
  definitions: UsageMetricDefinition[];
  t: Translate;
}) {
  const rows = trustedCatalogRows(definitions);
  return (
    <DataTable
      columns={catalogColumns(t)}
      data={rows}
      empty={t("usageMetricCatalogEmpty")}
      exportFileName={false}
      getRowId={(row) => row.metric}
      minTableWidth={720}
      pageSize={12}
      preferenceKey="usage-metric-catalog"
      rowAriaLabel={(row) => t(row.labelKey)}
      searchVisibility="always"
    />
  );
}

function catalogColumns(t: Translate): ColumnDef<CatalogRow, any>[] {
  return [
    catalogColumn.accessor("metric", {
      header: t("usageMetric"),
      cell: (cell) => (
        <span className="grid gap-0.5">
          <span className="font-medium">{t(cell.row.original.labelKey)}</span>
          <code className="rm-cell-muted text-xs" translate="no">
            {cell.getValue()}
          </code>
        </span>
      ),
    }),
    catalogColumn.accessor("unit", {
      header: t("usageUnit"),
      cell: (cell) => t(cell.row.original.unitLabelKey),
    }),
    catalogColumn.accessor("category", {
      header: t("usageMetricCategoryMeasurement"),
      cell: (cell) => (
        <span className="grid gap-0.5">
          <span>{t(cell.row.original.categoryLabelKey)}</span>
          <span className="rm-cell-muted text-xs">
            {t(cell.row.original.measurementLabelKey)}
          </span>
        </span>
      ),
    }),
    catalogColumn.accessor("billable", {
      header: t("usageMetricBillingSemantics"),
      cell: (cell) => (
        <span className="grid gap-1">
          <StatusBadge tone={cell.getValue() ? "info" : "neutral"}>
            {t(
              cell.getValue()
                ? "usageMetricBillable"
                : "usageMetricNotBillable",
            )}
          </StatusBadge>
          <span className="rm-cell-muted text-xs">
            {t(cell.row.original.overlapLabelKey)}
          </span>
        </span>
      ),
    }),
  ];
}

/** Only contract-known values can cross into the rendered catalog. */
export function trustedCatalogRows(
  definitions: readonly UsageMetricDefinition[],
): CatalogRow[] {
  return definitions.flatMap((definition) => {
    if (
      !hasOwn(metricLabelKeys, definition.metric) ||
      !hasOwn(categoryLabelKeys, definition.category) ||
      !hasOwn(measurementLabelKeys, definition.measurement) ||
      !hasOwn(overlapLabelKeys, definition.overlapPolicy) ||
      !hasOwn(unitLabelKeys, definition.unit) ||
      typeof definition.billable !== "boolean"
    ) {
      return [];
    }
    return [
      {
        ...definition,
        categoryLabelKey: categoryLabelKeys[definition.category],
        labelKey: metricLabelKeys[definition.metric],
        measurementLabelKey: measurementLabelKeys[definition.measurement],
        overlapLabelKey: overlapLabelKeys[definition.overlapPolicy],
        unitLabelKey: unitLabelKeys[definition.unit],
      },
    ];
  });
}

function hasOwn<T extends object>(value: T, key: PropertyKey): key is keyof T {
  return Object.hasOwn(value, key);
}
