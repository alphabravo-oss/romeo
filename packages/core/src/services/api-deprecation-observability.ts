import {
  apiDeprecationRegistry,
  type ApiDeprecationDefinition,
} from "@romeo/contracts";

const responseClasses = ["1xx", "2xx", "3xx", "4xx", "5xx", "other"] as const;
type ResponseClass = (typeof responseClasses)[number];

export interface ApiDeprecationUsageOperation {
  firstUsedAt?: string;
  lastUsedAt?: string;
  operationId: string;
  requestCount: number;
  responseClasses: Record<ResponseClass, number>;
  zeroUsageWindowSeconds: number;
  zeroUsageWindowStartedAt: string;
}

export interface ApiDeprecationUsageSnapshot {
  generatedAt: string;
  observationScope: "process";
  observationStartedAt: string;
  observationWindowSeconds: number;
  operations: ApiDeprecationUsageOperation[];
}

interface MutableUsage {
  firstUsedAt?: string;
  lastUsedAt?: string;
  requestCount: number;
  responseClasses: Record<ResponseClass, number>;
}

export class ApiDeprecationUsageStore {
  private readonly observationStartedAt: string;
  private readonly usage = new Map<string, MutableUsage>();

  constructor(
    definitions: readonly ApiDeprecationDefinition[],
    private readonly now: () => number = Date.now,
  ) {
    this.observationStartedAt = new Date(this.now()).toISOString();
    for (const definition of definitions) {
      if (this.usage.has(definition.operationId))
        throw new TypeError("Duplicate API deprecation operation ID.");
      this.usage.set(definition.operationId, emptyUsage());
    }
  }

  record(operationId: string, status: number): void {
    const usage = this.usage.get(operationId);
    if (usage === undefined) return;
    const usedAt = new Date(this.now()).toISOString();
    usage.firstUsedAt ??= usedAt;
    usage.lastUsedAt = usedAt;
    usage.requestCount = increment(usage.requestCount);
    const responseClass = classifyResponse(status);
    usage.responseClasses[responseClass] = increment(
      usage.responseClasses[responseClass],
    );
  }

  snapshot(): ApiDeprecationUsageSnapshot {
    const now = this.now();
    const generatedAt = new Date(now).toISOString();
    return {
      generatedAt,
      observationScope: "process",
      observationStartedAt: this.observationStartedAt,
      observationWindowSeconds: elapsedSeconds(this.observationStartedAt, now),
      operations: Array.from(this.usage, ([operationId, usage]) => {
        const zeroUsageWindowStartedAt =
          usage.lastUsedAt ?? this.observationStartedAt;
        return {
          ...(usage.firstUsedAt === undefined
            ? {}
            : { firstUsedAt: usage.firstUsedAt }),
          ...(usage.lastUsedAt === undefined
            ? {}
            : { lastUsedAt: usage.lastUsedAt }),
          operationId,
          requestCount: usage.requestCount,
          responseClasses: { ...usage.responseClasses },
          zeroUsageWindowSeconds: elapsedSeconds(zeroUsageWindowStartedAt, now),
          zeroUsageWindowStartedAt,
        };
      }).sort((left, right) =>
        left.operationId.localeCompare(right.operationId),
      ),
    };
  }
}

export const apiDeprecationUsageStore = new ApiDeprecationUsageStore(
  apiDeprecationRegistry,
);

function emptyUsage(): MutableUsage {
  return {
    requestCount: 0,
    responseClasses: {
      "1xx": 0,
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
      other: 0,
    },
  };
}

function classifyResponse(status: number): ResponseClass {
  const candidate = `${Math.floor(status / 100)}xx`;
  return responseClasses.includes(candidate as ResponseClass)
    ? (candidate as ResponseClass)
    : "other";
}

function elapsedSeconds(startedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1_000));
}

function increment(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1);
}
