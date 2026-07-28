import {
  evalsCreateSuite,
  evalsGetDashboard,
  evalsListRatings,
  evalsListRuns,
  evalsListSuites,
  evalsRateResult,
  evalsRunSuite,
  type EvalRubric,
} from "@romeo/api-client/generated/sdk";
import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { flagValue, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import {
  csvFlag,
  optionalIntegerFlag,
  optionalNonNegativeIntegerFlag,
  requiredFlag,
} from "./command-flags";
import type { CliIo } from "./io";
import { writeJson } from "./io";

interface EvalCommandContext {
  generatedClient?: GeneratedApiClient;
  io: CliIo;
  parsed: ParsedArgs;
}

export function executeEvalCommand(
  area: string,
  action: string | undefined,
  context: EvalCommandContext,
): Promise<number> | undefined {
  if (area !== "evals") return undefined;
  const command = evalCommand(action, context);
  return command === undefined ? undefined : result(context, command);
}

function evalCommand(
  action: string | undefined,
  context: EvalCommandContext,
): Promise<unknown> | undefined {
  if (action === "list") return listSuites(context);
  if (action === "runs") return listRuns(context);
  if (action === "dashboard") return dashboard(context);
  if (action === "create") return createSuite(context);
  if (action === "run") return runSuite(context);
  if (action === "ratings") return listRatings(context);
  if (action === "rate") return rateResult(context);
  return undefined;
}

function listSuites(context: EvalCommandContext) {
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  return evalsListSuites({
    client: generatedClient(context),
    path: { agentId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function listRuns(context: EvalCommandContext) {
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  return evalsListRuns({
    client: generatedClient(context),
    path: { agentId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function dashboard(context: EvalCommandContext) {
  const agentId = requiredFlag(context.parsed, "agent", "agent-id");
  return evalsGetDashboard({
    client: generatedClient(context),
    path: { agentId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function createSuite(context: EvalCommandContext) {
  const rubric = rubricFromFlags(context.parsed);
  const body = {
    agentId: requiredFlag(context.parsed, "agent", "agent-id"),
    name: flagValue(context.parsed.flags, "name") ?? "Golden prompt",
    cases: [
      {
        input: requiredFlag(context.parsed, "prompt"),
        expectedContains: requiredFlag(context.parsed, "expected"),
        ...(rubric === undefined ? {} : { rubric }),
      },
    ],
  };
  return evalsCreateSuite({
    body,
    client: generatedClient(context),
    throwOnError: true,
  }).then(dataEnvelope);
}

function runSuite(context: EvalCommandContext) {
  const suiteId = requiredFlag(context.parsed, "suite", "suite-id");
  return evalsRunSuite({
    client: generatedClient(context),
    path: { suiteId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function listRatings(context: EvalCommandContext) {
  const runId = requiredFlag(context.parsed, "run", "run-id");
  return evalsListRatings({
    client: generatedClient(context),
    path: { runId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function rateResult(context: EvalCommandContext) {
  const resultId = requiredFlag(context.parsed, "result", "result-id");
  const comment = flagValue(context.parsed.flags, "comment");
  const body = {
    rating: requiredRating(context.parsed),
    ...(comment === undefined ? {} : { comment }),
  };
  return evalsRateResult({
    body,
    client: generatedClient(context),
    path: { resultId },
    throwOnError: true,
  }).then(dataEnvelope);
}

function generatedClient(context: EvalCommandContext): GeneratedApiClient {
  if (context.generatedClient === undefined)
    throw new Error("The generated Romeo API client is required.");
  return context.generatedClient;
}

function rubricFromFlags(parsed: ParsedArgs): EvalRubric | undefined {
  const mustContain = csvFlag(parsed, "must-contain");
  const mustNotContain = csvFlag(parsed, "must-not-contain");
  const expectedTools = csvFlag(parsed, "expected-tool", "expected-tools");
  const requiredCitations = csvFlag(
    parsed,
    "required-citation",
    "required-citations",
  );
  const minLength = optionalNonNegativeIntegerFlag(parsed, "min-length");
  const maxLength = optionalIntegerFlag(parsed, "max-length");
  if (
    minLength !== undefined &&
    maxLength !== undefined &&
    minLength > maxLength
  )
    throw new CliUsageError(
      "--min-length must be less than or equal to --max-length.",
    );
  if (
    mustContain.length === 0 &&
    mustNotContain.length === 0 &&
    expectedTools.length === 0 &&
    requiredCitations.length === 0 &&
    minLength === undefined &&
    maxLength === undefined
  )
    return undefined;
  return {
    ...(mustContain.length > 0 ? { mustContain } : {}),
    ...(mustNotContain.length > 0 ? { mustNotContain } : {}),
    ...(expectedTools.length > 0
      ? { expectedToolCalls: expectedTools.map((name) => ({ name })) }
      : {}),
    ...(requiredCitations.length > 0 ? { requiredCitations } : {}),
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
  };
}

function requiredRating(parsed: ParsedArgs): "fail" | "neutral" | "pass" {
  const rating = requiredFlag(parsed, "rating");
  if (rating === "fail" || rating === "neutral" || rating === "pass")
    return rating;
  throw new CliUsageError("--rating must be pass, neutral, or fail.");
}

function dataEnvelope<T>(response: { data: { data: T } }): T {
  return response.data.data;
}

async function result(
  context: EvalCommandContext,
  value: Promise<unknown>,
): Promise<number> {
  writeJson(context.io, await value);
  return 0;
}
