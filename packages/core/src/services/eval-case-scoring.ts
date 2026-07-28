import type { EvalCase, EvalRubric, EvalRunResult } from "../domain/entities";
import { createId } from "../ids";
import {
  normalizeToolCallExpectations,
  normalizeToolOutcomeExpectations,
  scoreExpectedToolCalls,
  scoreExpectedToolOutcomes,
} from "./eval-tool-scoring";

export function scoreEvalCase(
  testCase: EvalCase,
  output: string,
  orgId: string,
): Omit<EvalRunResult, "createdAt" | "runId"> {
  const containsPassed =
    testCase.expectedContains === undefined ||
    output.includes(testCase.expectedContains);
  const observedCitations = extractCitationReferences(output);
  const citationPassed =
    !testCase.requiresCitation || observedCitations.length > 0;
  const rubricChecks = scoreRubric(testCase.rubric, output);
  const checkResults = [
    ...(testCase.expectedContains === undefined ? [] : [containsPassed]),
    ...(testCase.requiresCitation ? [citationPassed] : []),
    ...rubricChecks.scores,
  ];
  const score =
    checkResults.length === 0
      ? 1
      : checkResults.filter(Boolean).length / checkResults.length;
  const passed = checkResults.every(Boolean);
  return {
    id: createId("eval_result"),
    orgId,
    caseId: testCase.id,
    status: passed ? "passed" : "failed",
    score,
    output,
    checks: {
      expectedContains: testCase.expectedContains ?? null,
      containsPassed,
      requiresCitation: testCase.requiresCitation,
      citationPassed,
      observedCitations,
      rubric: rubricChecks.details,
    },
  };
}

export function normalizeEvalRubric(rubric: EvalRubric): EvalRubric {
  const normalized: EvalRubric = {};
  const mustContain = uniqueTerms(rubric.mustContain);
  const mustNotContain = uniqueTerms(rubric.mustNotContain);
  const requiredCitations = uniqueTerms(rubric.requiredCitations);
  const expectedToolCalls = normalizeToolCallExpectations(
    rubric.expectedToolCalls,
  );
  const expectedToolOutcomes = normalizeToolOutcomeExpectations(
    rubric.expectedToolOutcomes,
  );
  if (mustContain.length > 0) normalized.mustContain = mustContain;
  if (mustNotContain.length > 0) normalized.mustNotContain = mustNotContain;
  if (requiredCitations.length > 0)
    normalized.requiredCitations = requiredCitations;
  if (rubric.minLength !== undefined) normalized.minLength = rubric.minLength;
  if (rubric.maxLength !== undefined) normalized.maxLength = rubric.maxLength;
  if (expectedToolCalls.length > 0)
    normalized.expectedToolCalls = expectedToolCalls;
  if (expectedToolOutcomes.length > 0)
    normalized.expectedToolOutcomes = expectedToolOutcomes;
  return normalized;
}

function scoreRubric(
  rubric: EvalRubric | undefined,
  output: string,
): { details: Record<string, unknown>; scores: boolean[] } {
  if (rubric === undefined) return { details: {}, scores: [] };
  const mustContain = uniqueTerms(rubric.mustContain);
  const mustNotContain = uniqueTerms(rubric.mustNotContain);
  const requiredCitations = uniqueTerms(rubric.requiredCitations);
  const expectedToolCalls = normalizeToolCallExpectations(
    rubric.expectedToolCalls,
  );
  const expectedToolOutcomes = normalizeToolOutcomeExpectations(
    rubric.expectedToolOutcomes,
  );
  const mustContainPassed = mustContain.map((term) => ({
    term,
    passed: output.includes(term),
  }));
  const mustNotContainPassed = mustNotContain.map((term) => ({
    term,
    passed: !output.includes(term),
  }));
  const citationChecks = scoreRequiredCitations(requiredCitations, output);
  const toolCallChecks = scoreExpectedToolCalls(expectedToolCalls, output);
  const toolOutcomeChecks = scoreExpectedToolOutcomes(
    expectedToolOutcomes,
    output,
  );
  const length = output.length;
  const minLengthPassed =
    rubric.minLength === undefined ? undefined : length >= rubric.minLength;
  const maxLengthPassed =
    rubric.maxLength === undefined ? undefined : length <= rubric.maxLength;
  return {
    details: {
      mustContain: mustContainPassed,
      mustNotContain: mustNotContainPassed,
      length,
      minLength: rubric.minLength ?? null,
      maxLength: rubric.maxLength ?? null,
      minLengthPassed: minLengthPassed ?? null,
      maxLengthPassed: maxLengthPassed ?? null,
      requiredCitations: citationChecks.details,
      observedCitations: citationChecks.observed,
      expectedToolCalls: toolCallChecks.details,
      expectedToolOutcomes: toolOutcomeChecks.details,
    },
    scores: [
      ...mustContainPassed.map((check) => check.passed),
      ...mustNotContainPassed.map((check) => check.passed),
      ...citationChecks.scores,
      ...toolCallChecks.scores,
      ...toolOutcomeChecks.scores,
      ...(minLengthPassed === undefined ? [] : [minLengthPassed]),
      ...(maxLengthPassed === undefined ? [] : [maxLengthPassed]),
    ],
  };
}

function scoreRequiredCitations(requiredCitations: string[], output: string) {
  const observed = extractCitationReferences(output);
  const observedSet = new Set(observed.map(normalizedCitationReference));
  const details = requiredCitations.map((citation) => ({
    citation,
    passed: observedSet.has(normalizedCitationReference(citation)),
  }));
  return { details, observed, scores: details.map((check) => check.passed) };
}

function extractCitationReferences(output: string): string[] {
  const references: string[] = [];
  const inlinePattern = /\[(?:source|citation)\s*[:#-]?\s*([^\]\n]+)\]/giu;
  for (const match of output.matchAll(inlinePattern)) {
    const reference = cleanCitationReference(match[1]);
    if (reference !== undefined) references.push(reference);
  }
  const romeoListPattern = /-\s*\[\d+\]\s+[^\n]*?\(([^()\n]+)\)/gu;
  for (const match of output.matchAll(romeoListPattern)) {
    const reference = cleanCitationReference(match[1]);
    if (reference !== undefined) references.push(reference);
  }
  return uniqueTerms(references).slice(0, 50);
}

function cleanCitationReference(value: string | undefined): string | undefined {
  const reference = value?.trim().replace(/^[\s"'`]+|[\s"'`.,;:]+$/gu, "");
  return reference === undefined || reference.length === 0
    ? undefined
    : reference;
}

function normalizedCitationReference(value: string): string {
  return cleanCitationReference(value)?.toLowerCase() ?? "";
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
