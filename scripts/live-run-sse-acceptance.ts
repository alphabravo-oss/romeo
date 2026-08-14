import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultProviderCapabilities } from "../packages/providers/src/index.ts";
import type { RomeoRepository } from "../packages/core/src/domain/repository.ts";
import { replayRunEvents } from "../packages/core/src/services/run-events.ts";
import { RunEventSequencer } from "../packages/core/src/services/run-event-sequencer.ts";
import {
  InMemoryRunEventTransport,
  type RunEventNotice,
  type RunEventTransport,
} from "../packages/core/src/services/run-event-transport.ts";
import {
  createLivePostgresRepositoryFixture,
  explainRunEventTail,
  postgresConformanceDatabaseUrl,
  seedRunEventHistory,
} from "../packages/db/src/test-support/postgres-conformance-harness.ts";

class ObservedRunEventTransport implements RunEventTransport {
  private readonly delegate = new InMemoryRunEventTransport();
  activeSubscriptions = 0;
  publishedNotices = 0;

  async publish(notice: RunEventNotice): Promise<void> {
    this.publishedNotices += 1;
    await this.delegate.publish(notice);
  }

  async subscribe(
    runId: string,
    handler: (notice: RunEventNotice) => void,
  ): Promise<() => void> {
    const unsubscribe = await this.delegate.subscribe(runId, handler);
    this.activeSubscriptions += 1;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activeSubscriptions -= 1;
      unsubscribe();
    };
  }
}

const adminDatabaseUrl = postgresConformanceDatabaseUrl();
if (adminDatabaseUrl === undefined) {
  throw new Error("ROMEO_POSTGRES_CONFORMANCE_DATABASE_URL is required.");
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  repoRoot,
  argValue("--output") ?? "dist/evidence/live-run-sse-acceptance.json",
);
const historicalEventCount = positiveIntegerArg("--historical-events", 10_000);
const concurrentStreamCount = positiveIntegerArg("--streams", 1_000);
const liveEventCount = positiveIntegerArg("--live-events", 32);
const pageSize = positiveIntegerArg("--page-size", 64);
const maxCompletionMs = positiveIntegerArg("--max-completion-ms", 30_000);
const maxHeapGrowthBytes =
  positiveIntegerArg("--max-heap-growth-mb", 512) * 1024 * 1024;

if (historicalEventCount < pageSize + 1) {
  throw new Error("--historical-events must exceed --page-size.");
}

const fixture = await createLivePostgresRepositoryFixture(adminDatabaseUrl);
const checks: Record<string, boolean | number> = {};

try {
  const runtime = await seedRuntime(fixture.repository);
  const historicalRun = await fixture.repository.createRun({
    id: "run_sse_acceptance_history",
    orgId: "org_default",
    workspaceId: "workspace_default",
    chatId: "chat_welcome",
    agentId: runtime.agentId,
    agentVersionId: runtime.agentVersionId,
    modelId: runtime.modelId,
    providerId: runtime.providerId,
    status: "completed",
    createdBy: "user_dev_admin",
    createdAt: "2026-08-14T00:00:00.000Z",
    completedAt: "2026-08-14T00:10:00.000Z",
  });

  await seedRunEventHistory(
    fixture.databaseUrl,
    historicalRun.id,
    historicalEventCount,
  );

  const tailAfter = historicalEventCount - pageSize;
  const tail = await fixture.repository.listRunEventsAfter(
    historicalRun.id,
    tailAfter,
    pageSize,
  );
  assert(
    tail.length === pageSize &&
      tail[0]?.sequence === tailAfter + 1 &&
      tail.at(-1)?.sequence === historicalEventCount,
    "bounded_tail_replay_failed",
  );
  checks.historicalTailRows = tail.length;

  const plan = await explainRunEventTail(
    fixture.databaseUrl,
    historicalRun.id,
    tailAfter,
    pageSize,
  );
  const indexNames = collectPlanValues(plan, "Index Name");
  assert(
    indexNames.includes("run_event_sequence_idx"),
    "tail_query_did_not_use_sequence_index",
  );
  checks.indexedTailPlan = true;

  const restartedSequencer = new RunEventSequencer(
    new InMemoryRunEventTransport(),
  );
  const restartedReplay = await collectSequences(
    replayRunEvents(
      fixture.repository,
      restartedSequencer,
      historicalRun.id,
      historicalEventCount - 10,
      { closeWhenCaughtUp: true, pageSize },
    ),
  );
  assert(
    restartedReplay.join(",") ===
      Array.from({ length: 10 }, (_, index) =>
        String(historicalEventCount - 9 + index),
      ).join(","),
    "restart_replay_sequence_mismatch",
  );
  checks.restartReplayRows = restartedReplay.length;

  const liveRun = await fixture.repository.createRun({
    ...historicalRun,
    id: "run_sse_acceptance_live",
    status: "running",
    completedAt: undefined,
  });
  const observedTransport = new ObservedRunEventTransport();
  const liveSequencer = new RunEventSequencer(observedTransport);
  const queryStats = { count: 0, maxRows: 0 };
  const replayRepository = cursorOnlyRepository(fixture.repository, queryStats);
  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const consumers = Array.from({ length: concurrentStreamCount }, async () =>
    collectSequences(
      replayRunEvents(replayRepository, liveSequencer, liveRun.id, 0, {
        fallbackPollMs: 60_000,
        pageSize,
      }),
    ),
  );

  await Promise.resolve();
  const liveEvents = [];
  for (let index = 1; index <= liveEventCount + 1; index += 1) {
    liveEvents.push(
      await liveSequencer.create(fixture.repository, {
        runId: liveRun.id,
        type: index === liveEventCount + 1 ? "run.completed" : "message.delta",
        data: {},
      }),
    );
  }
  await liveSequencer.append(fixture.repository, liveEvents);

  const sequencesByStream = await Promise.race([
    Promise.all(consumers),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error("concurrent_stream_timeout")),
        maxCompletionMs,
      ).unref();
    }),
  ]);
  const durationMs = Math.round(performance.now() - startedAt);
  const expectedSequenceList = Array.from(
    { length: liveEventCount + 1 },
    (_, index) => index + 1,
  ).join(",");
  assert(
    sequencesByStream.every(
      (sequences) =>
        sequences.length === new Set(sequences).size &&
        sequences.join(",") === expectedSequenceList,
    ),
    "concurrent_stream_loss_or_duplication",
  );
  assert(queryStats.maxRows <= pageSize, "cursor_page_exceeded_hard_limit");
  assert(
    observedTransport.activeSubscriptions === 0,
    "stream_subscriptions_not_released",
  );
  const heapGrowthBytes = Math.max(
    0,
    process.memoryUsage().heapUsed - heapBefore,
  );
  assert(
    heapGrowthBytes <= maxHeapGrowthBytes,
    "stream_heap_growth_exceeded_limit",
  );

  checks.concurrentStreams = concurrentStreamCount;
  checks.eventsPerLiveStream = liveEventCount + 1;
  checks.cursorQueries = queryStats.count;
  checks.maximumCursorRows = queryStats.maxRows;
  checks.noticesPublished = observedTransport.publishedNotices;
  checks.activeSubscriptionsAfterCompletion =
    observedTransport.activeSubscriptions;
  checks.completionMs = durationMs;
  checks.heapGrowthBytes = heapGrowthBytes;
  checks.noEventLossOrDuplication = true;

  await writeEvidence("passed");
  console.log("Live run SSE acceptance passed.");
  console.log(`Wrote SSE evidence to ${outputPath}`);
} catch (error) {
  await writeEvidence("failed");
  throw error;
} finally {
  await fixture.close();
}

function cursorOnlyRepository(
  repository: RomeoRepository,
  stats: { count: number; maxRows: number },
): RomeoRepository {
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (property === "listRunEvents") {
        return () => {
          throw new Error("full_history_query_used_by_stream");
        };
      }
      if (property === "listRunEventsAfter") {
        return async (runId: string, after: number, limit: number) => {
          const rows = await target.listRunEventsAfter(runId, after, limit);
          stats.count += 1;
          stats.maxRows = Math.max(stats.maxRows, rows.length);
          return rows;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

async function collectSequences(
  events: AsyncIterable<{ sequence: number }>,
): Promise<number[]> {
  const sequences: number[] = [];
  for await (const event of events) sequences.push(event.sequence);
  return sequences;
}

async function seedRuntime(repository: RomeoRepository): Promise<{
  agentId: string;
  agentVersionId: string;
  modelId: string;
  providerId: string;
}> {
  const capabilities = defaultProviderCapabilities("openai-compatible");
  const provider = await repository.createProvider({
    id: "provider_sse_acceptance",
    orgId: "org_default",
    type: "openai-compatible",
    name: "SSE acceptance provider",
    baseUrl: "https://sse-acceptance.invalid/v1",
    enabled: true,
    capabilities,
  });
  await repository.upsertModels([
    {
      id: "model_sse_acceptance",
      providerId: provider.id,
      name: "sse-acceptance-model",
      displayName: "SSE acceptance model",
      enabled: true,
      capabilities,
      contextWindow: 8_192,
    },
  ]);
  const agent = await repository.createAgent({
    id: "agent_sse_acceptance",
    orgId: "org_default",
    workspaceId: "workspace_default",
    name: "SSE acceptance agent",
    createdBy: "user_dev_admin",
    baseModelId: "model_sse_acceptance",
    systemPrompt: "SSE acceptance fixture.",
    parameters: { temperature: 0 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    updatedAt: "2026-08-14T00:00:00.000Z",
  });
  const version = await repository.createAgentVersion({
    id: "agent_version_sse_acceptance_v1",
    agentId: agent.id,
    orgId: "org_default",
    workspaceId: "workspace_default",
    version: 1,
    status: "published",
    baseModelId: "model_sse_acceptance",
    systemPrompt: agent.systemPrompt,
    parameters: agent.parameters,
    memoryPolicy: agent.memoryPolicy,
    safetySettings: agent.safetySettings,
    createdBy: "user_dev_admin",
    createdAt: "2026-08-14T00:00:00.000Z",
    publishedAt: "2026-08-14T00:00:00.000Z",
  });
  return {
    agentId: agent.id,
    agentVersionId: version.id,
    modelId: "model_sse_acceptance",
    providerId: provider.id,
  };
}

function collectPlanValues(value: unknown, key: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPlanValues(item, key));
  }
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  return [
    ...(typeof record[key] === "string" ? [record[key] as string] : []),
    ...Object.values(record).flatMap((item) => collectPlanValues(item, key)),
  ];
}

function assert(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function positiveIntegerArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

async function writeEvidence(status: "failed" | "passed"): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        schema: "romeo.run-sse-live-acceptance.v1",
        generatedAt: new Date().toISOString(),
        status,
        configuration: {
          historicalEventCount,
          concurrentStreamCount,
          liveEventCount,
          pageSize,
          maxCompletionMs,
          maxHeapGrowthBytes,
        },
        checks,
        redaction: {
          includesEventData: false,
          includesIdentifiers: false,
          includesPrompts: false,
          includesUrlsOrCredentials: false,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}
