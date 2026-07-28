import type {
  EvalToolCallExpectation,
  EvalToolOutcomeExpectation,
} from "../domain/entities";

export function normalizeToolCallExpectations(
  calls: EvalToolCallExpectation[] | undefined,
): EvalToolCallExpectation[] {
  const normalized = new Map<string, EvalToolCallExpectation>();
  for (const call of calls ?? []) {
    const name = call.name.trim();
    if (name.length === 0) continue;
    const args = normalizeToolArguments(call.arguments);
    const item: EvalToolCallExpectation = {
      name,
      ...(args === undefined ? {} : { arguments: args }),
    };
    normalized.set(JSON.stringify(item), item);
  }
  return [...normalized.values()];
}

export function normalizeToolOutcomeExpectations(
  outcomes: EvalToolOutcomeExpectation[] | undefined,
): EvalToolOutcomeExpectation[] {
  const normalized = new Map<string, EvalToolOutcomeExpectation>();
  for (const outcome of outcomes ?? []) {
    const name = outcome.name.trim();
    if (name.length === 0) continue;
    const outputKeys = uniqueTerms(outcome.outputKeys).slice(0, 25);
    const errorCode = cleanStableCode(outcome.errorCode);
    const item: EvalToolOutcomeExpectation = {
      name,
      ...(outcome.status === undefined ? {} : { status: outcome.status }),
      ...(outputKeys.length === 0 ? {} : { outputKeys }),
      ...(errorCode === undefined ? {} : { errorCode }),
    };
    normalized.set(JSON.stringify(item), item);
  }
  return [...normalized.values()];
}

export function scoreExpectedToolCalls(
  expectedCalls: EvalToolCallExpectation[],
  output: string,
): {
  details: Array<EvalToolCallExpectation & { passed: boolean }>;
  scores: boolean[];
} {
  if (expectedCalls.length === 0) return { details: [], scores: [] };
  const observedCalls = extractToolCalls(output);
  const details = expectedCalls.map((expected) => ({
    ...expected,
    passed: observedCalls.some((observed) =>
      toolCallMatches(expected, observed),
    ),
  }));
  return { details, scores: details.map((check) => check.passed) };
}

export function scoreExpectedToolOutcomes(
  expectedOutcomes: EvalToolOutcomeExpectation[],
  output: string,
): {
  details: Array<EvalToolOutcomeExpectation & { passed: boolean }>;
  scores: boolean[];
} {
  if (expectedOutcomes.length === 0) return { details: [], scores: [] };
  const observedOutcomes = extractToolOutcomes(output);
  const details = expectedOutcomes.map((expected) => ({
    ...expected,
    passed: observedOutcomes.some((observed) =>
      toolOutcomeMatches(expected, observed),
    ),
  }));
  return { details, scores: details.map((check) => check.passed) };
}

function extractToolCalls(output: string): EvalToolCallExpectation[] {
  const calls: EvalToolCallExpectation[] = [];
  const fencePattern =
    /```(?:romeo-tool-call|tool-call|json)\s*([\s\S]*?)```/giu;
  for (const match of output.matchAll(fencePattern)) {
    const json = match[1]?.trim();
    if (json === undefined || json.length === 0) continue;
    calls.push(...toolCallsFromJson(json));
  }
  return calls;
}

function extractToolOutcomes(output: string): EvalToolOutcomeExpectation[] {
  const outcomes: EvalToolOutcomeExpectation[] = [];
  const fencePattern =
    /```(?:romeo-tool-outcome|tool-outcome|tool-result|json)\s*([\s\S]*?)```/giu;
  for (const match of output.matchAll(fencePattern)) {
    const json = match[1]?.trim();
    if (json === undefined || json.length === 0) continue;
    outcomes.push(...toolOutcomesFromJson(json));
  }
  return outcomes;
}

function toolCallsFromJson(json: string): EvalToolCallExpectation[] {
  try {
    const parsed: unknown = JSON.parse(json);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const record = value as Record<string, unknown>;
      const name =
        typeof record.name === "string"
          ? record.name
          : typeof record.tool === "string"
            ? record.tool
            : undefined;
      if (name === undefined || isToolOutcomeOnlyRecord(record)) return [];
      const args = normalizeToolArguments(record.arguments);
      return [{ name, ...(args === undefined ? {} : { arguments: args }) }];
    });
  } catch {
    return [];
  }
}

function toolOutcomesFromJson(json: string): EvalToolOutcomeExpectation[] {
  try {
    const parsed: unknown = JSON.parse(json);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const record = value as Record<string, unknown>;
      const name =
        typeof record.name === "string"
          ? record.name
          : typeof record.tool === "string"
            ? record.tool
            : undefined;
      if (name === undefined) return [];
      const status = normalizeToolOutcomeStatus(record.status);
      const outputKeys = normalizeStringList(record.outputKeys);
      const errorCode = cleanStableCode(record.errorCode);
      if (
        status === undefined &&
        outputKeys.length === 0 &&
        errorCode === undefined
      )
        return [];
      return [
        {
          name,
          ...(status === undefined ? {} : { status }),
          ...(outputKeys.length === 0 ? {} : { outputKeys }),
          ...(errorCode === undefined ? {} : { errorCode }),
        },
      ];
    });
  } catch {
    return [];
  }
}

function toolCallMatches(
  expected: EvalToolCallExpectation,
  observed: EvalToolCallExpectation,
): boolean {
  if (expected.name !== observed.name) return false;
  if (expected.arguments === undefined) return true;
  if (observed.arguments === undefined) return false;
  return Object.entries(expected.arguments).every(
    ([key, value]) => observed.arguments?.[key] === value,
  );
}

function toolOutcomeMatches(
  expected: EvalToolOutcomeExpectation,
  observed: EvalToolOutcomeExpectation,
): boolean {
  if (expected.name !== observed.name) return false;
  if (expected.status !== undefined && expected.status !== observed.status)
    return false;
  if (
    expected.errorCode !== undefined &&
    expected.errorCode !== observed.errorCode
  )
    return false;
  if (expected.outputKeys !== undefined) {
    const observedKeys = new Set(observed.outputKeys ?? []);
    if (expected.outputKeys.some((key) => !observedKeys.has(key))) return false;
  }
  return true;
}

function isToolOutcomeOnlyRecord(record: Record<string, unknown>): boolean {
  return (
    record.arguments === undefined &&
    (record.status !== undefined ||
      record.outputKeys !== undefined ||
      record.errorCode !== undefined)
  );
}

function normalizeToolArguments(
  value: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    )
      normalized[key] = item;
  }
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueTerms(
        value.filter((item): item is string => typeof item === "string"),
      )
    : [];
}

function normalizeToolOutcomeStatus(
  value: unknown,
): EvalToolOutcomeExpectation["status"] | undefined {
  return value === "success" || value === "failure" ? value : undefined;
}

function cleanStableCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim();
  return /^[a-z0-9][a-z0-9_.:-]{0,119}$/iu.test(code) ? code : undefined;
}

function uniqueTerms(terms: string[] | undefined): string[] {
  return [
    ...new Set(
      (terms ?? [])
        .map((term) => term.trim())
        .filter((term) => term.length > 0),
    ),
  ];
}
