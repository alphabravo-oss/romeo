import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";

export const CONTENT_POLICY_DETECTOR_CODES = [
  "credit_card",
  "email_address",
  "us_ssn",
  "api_token",
] as const;
export type ContentPolicyDetectorCode =
  (typeof CONTENT_POLICY_DETECTOR_CODES)[number];
export type ContentPolicyAction = "disabled" | "audit" | "block" | "redact";
export type ContentPolicyDetectorActions = Record<
  ContentPolicyDetectorCode,
  ContentPolicyAction
>;

interface StoredContentPolicy {
  schema: "romeo.content-policy.v1";
  orgId: string;
  detectors: ContentPolicyDetectorActions;
  updatedAt: string;
  updatedBy: string;
}

export interface ContentPolicyDetection {
  code: ContentPolicyDetectorCode;
  count: number;
  action: Exclude<ContentPolicyAction, "disabled">;
}

export interface ContentPolicyEvaluation {
  action: "allow" | "audit" | "block" | "redact";
  detections: ContentPolicyDetection[];
}

const DEFAULT_ACTIONS: ContentPolicyDetectorActions = {
  credit_card: "disabled",
  email_address: "disabled",
  us_ssn: "disabled",
  api_token: "disabled",
};
const ACTIONS = new Set<ContentPolicyAction>([
  "disabled",
  "audit",
  "block",
  "redact",
]);

export class ContentPolicyService {
  constructor(private readonly repository: RomeoRepository) {}

  async report(subject: AuthSubject) {
    assertScope(subject, "admin:read");
    return reportFor(this.repository, subject.orgId);
  }

  async update(input: {
    subject: AuthSubject;
    detectors: Partial<ContentPolicyDetectorActions>;
  }) {
    assertScope(input.subject, "admin:write");
    if (Object.keys(input.detectors).length === 0) {
      throw new ApiError(
        "content_policy_empty_update",
        "Content policy update must include at least one detector action.",
        400,
      );
    }
    return this.repository.transaction(async (repository) => {
      const current = await readPolicy(repository, input.subject.orgId);
      const now = new Date().toISOString();
      const stored: StoredContentPolicy = {
        schema: "romeo.content-policy.v1",
        orgId: input.subject.orgId,
        detectors: {
          ...(current?.detectors ?? DEFAULT_ACTIONS),
          ...input.detectors,
        },
        updatedAt: now,
        updatedBy: input.subject.id,
      };
      await repository.upsertSystemSetting({
        key: settingKey(input.subject.orgId),
        value: {
          schema: stored.schema,
          orgId: stored.orgId,
          detectors: { ...stored.detectors },
          updatedAt: stored.updatedAt,
          updatedBy: stored.updatedBy,
        },
        updatedAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.content_policy.update",
        resourceType: "content_policy",
        resourceId: input.subject.orgId,
        metadata: {
          detectors: CONTENT_POLICY_DETECTOR_CODES.filter(
            (code) => input.detectors[code] !== undefined,
          ).map((code) => ({ code, count: 0, action: stored.detectors[code] })),
        },
      });
      return publicReport(stored, "org");
    });
  }

  async simulate(input: { subject: AuthSubject; content: string }) {
    assertScope(input.subject, "admin:write");
    const policy = await actionsFor(this.repository, input.subject.orgId);
    const evaluation = evaluateStrings([input.content], policy);
    if (evaluation.result.detections.length > 0) {
      await auditEvaluation(
        this.repository,
        input.subject,
        "admin.content_policy.simulate",
        evaluation.result,
      );
    }
    return {
      ...evaluation.result,
      evaluatedAt: new Date().toISOString(),
      redaction: {
        rawContentReturned: false as const,
        rawMatchesReturned: false as const,
      },
    };
  }
}

export async function enforceContentPolicyText(
  repository: RomeoRepository,
  subject: AuthSubject,
  content: string,
): Promise<{ content: string; evaluation: ContentPolicyEvaluation }> {
  const result = await enforceContentPolicyStrings(repository, subject, [
    content,
  ]);
  return { content: result.contents[0]!, evaluation: result.evaluation };
}

export async function enforceContentPolicyStrings(
  repository: RomeoRepository,
  subject: AuthSubject,
  contents: readonly string[],
): Promise<{ contents: string[]; evaluation: ContentPolicyEvaluation }> {
  const evaluated = evaluateStrings(
    contents,
    await actionsFor(repository, subject.orgId),
  );
  if (evaluated.result.detections.length > 0) {
    await auditEvaluation(
      repository,
      subject,
      "content_policy.enforce",
      evaluated.result,
    );
  }
  if (evaluated.result.action === "block") throw blockedError(evaluated.result);
  return { contents: evaluated.contents, evaluation: evaluated.result };
}

export async function enforceContentPolicyValue<T>(
  repository: RomeoRepository,
  subject: AuthSubject,
  value: T,
): Promise<{ value: T; evaluation: ContentPolicyEvaluation }> {
  const strings: string[] = [];
  collectStrings(value, strings, new WeakSet<object>());
  const enforced = await enforceContentPolicyStrings(
    repository,
    subject,
    strings,
  );
  let offset = 0;
  const transformed = mapStrings(
    value,
    () => enforced.contents[offset++]!,
  ) as T;
  return { value: transformed, evaluation: enforced.evaluation };
}

function collectStrings(
  value: unknown,
  output: string[],
  seen: WeakSet<object>,
): void {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, seen);
    return;
  }
  for (const item of Object.values(value)) collectStrings(item, output, seen);
}

function mapStrings(value: unknown, next: () => string): unknown {
  if (typeof value === "string") return next();
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, next));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mapStrings(item, next)]),
  );
}

interface Match {
  code: ContentPolicyDetectorCode;
  start: number;
  end: number;
}

export const evaluateContentPolicyStrings = evaluateStrings;
export const contentPolicyActionsFor = actionsFor;
export const contentPolicySettingKey = settingKey;

function evaluateStrings(
  contents: readonly string[],
  policy: ContentPolicyDetectorActions,
): { contents: string[]; result: ContentPolicyEvaluation } {
  const matches = contents.map((content) => detect(content, policy));
  const detections = CONTENT_POLICY_DETECTOR_CODES.flatMap((code) => {
    const count = matches.reduce(
      (total, list) =>
        total + list.filter((match) => match.code === code).length,
      0,
    );
    const action = policy[code];
    return count === 0 || action === "disabled"
      ? []
      : [{ code, count, action } as ContentPolicyDetection];
  });
  const action = aggregateAction(detections);
  return {
    contents:
      action === "block"
        ? [...contents]
        : contents.map((content, index) =>
            redact(content, matches[index]!, policy),
          ),
    result: { action, detections },
  };
}

function aggregateAction(
  detections: ContentPolicyDetection[],
): ContentPolicyEvaluation["action"] {
  if (detections.some((item) => item.action === "block")) return "block";
  if (detections.some((item) => item.action === "redact")) return "redact";
  if (detections.some((item) => item.action === "audit")) return "audit";
  return "allow";
}

function detect(
  content: string,
  policy: ContentPolicyDetectorActions,
): Match[] {
  const found: Match[] = [];
  if (policy.credit_card !== "disabled") {
    for (const match of content.matchAll(
      /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
    )) {
      const value = match[0];
      const digits = value.replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits))
        found.push({
          code: "credit_card",
          start: match.index!,
          end: match.index! + value.length,
        });
    }
  }
  addRegexMatches(
    found,
    content,
    "email_address",
    policy,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi,
  );
  addRegexMatches(
    found,
    content,
    "us_ssn",
    policy,
    /(?<!\d)(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}(?!\d)/g,
  );
  addRegexMatches(
    found,
    content,
    "api_token",
    policy,
    /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g,
  );
  return dedupeMatches(found);
}

function addRegexMatches(
  output: Match[],
  content: string,
  code: ContentPolicyDetectorCode,
  policy: ContentPolicyDetectorActions,
  pattern: RegExp,
): void {
  if (policy[code] === "disabled") return;
  for (const match of content.matchAll(pattern))
    output.push({
      code,
      start: match.index!,
      end: match.index! + match[0].length,
    });
}

function dedupeMatches(matches: Match[]): Match[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.code}:${match.start}:${match.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function redact(
  content: string,
  matches: Match[],
  policy: ContentPolicyDetectorActions,
): string {
  const selected = matches
    .filter((match) => policy[match.code] === "redact")
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .filter(
      (match, index, all) => index === 0 || match.start >= all[index - 1]!.end,
    );
  let output = "";
  let cursor = 0;
  for (const match of selected) {
    output += content.slice(cursor, match.start);
    output += `[REDACTED:${match.code.toUpperCase()}]`;
    cursor = match.end;
  }
  return output + content.slice(cursor);
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

function blockedError(result: ContentPolicyEvaluation): ApiError {
  return new ApiError(
    "content_policy_blocked",
    "Content was blocked by the organization content policy.",
    403,
    {
      detectors: result.detections
        .filter((item) => item.action === "block")
        .map(({ code, count, action }) => ({ code, count, action })),
    },
  );
}

async function auditEvaluation(
  repository: RomeoRepository,
  subject: AuthSubject,
  action: "admin.content_policy.simulate" | "content_policy.enforce",
  result: ContentPolicyEvaluation,
): Promise<void> {
  await writeAuditLog(repository, {
    subject,
    action,
    resourceType: "content_policy",
    resourceId: subject.orgId,
    metadata: {
      detectors: result.detections.map(({ code, count, action }) => ({
        code,
        count,
        action,
      })),
    },
  });
}

async function reportFor(repository: RomeoRepository, orgId: string) {
  const stored = await readPolicy(repository, orgId);
  return stored === undefined
    ? publicReport(
        {
          schema: "romeo.content-policy.v1",
          orgId,
          detectors: { ...DEFAULT_ACTIONS },
          updatedAt: "",
          updatedBy: "",
        },
        "default",
      )
    : publicReport(stored, "org");
}

function publicReport(
  policy: StoredContentPolicy,
  policySource: "default" | "org",
) {
  return {
    schema: policy.schema,
    orgId: policy.orgId,
    detectors: { ...policy.detectors },
    policySource,
    ...(policySource === "default"
      ? {}
      : { updatedAt: policy.updatedAt, updatedBy: policy.updatedBy }),
    redaction: {
      rawContentReturned: false as const,
      rawMatchesReturned: false as const,
      detectorPatternsReturned: false as const,
    },
  };
}

async function actionsFor(repository: RomeoRepository, orgId: string) {
  return (
    (await readPolicy(repository, orgId))?.detectors ?? { ...DEFAULT_ACTIONS }
  );
}

async function readPolicy(
  repository: RomeoRepository,
  orgId: string,
): Promise<StoredContentPolicy | undefined> {
  const value = (await repository.getSystemSetting(settingKey(orgId)))?.value;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schema !== "romeo.content-policy.v1" ||
    candidate.orgId !== orgId
  )
    return undefined;
  const detectors = candidate.detectors;
  if (
    detectors === null ||
    typeof detectors !== "object" ||
    Array.isArray(detectors)
  )
    return undefined;
  const detectorRecord = detectors as Record<string, unknown>;
  if (
    !CONTENT_POLICY_DETECTOR_CODES.every((code) =>
      ACTIONS.has(detectorRecord[code] as ContentPolicyAction),
    )
  )
    return undefined;
  if (
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.updatedBy !== "string"
  )
    return undefined;
  return {
    schema: "romeo.content-policy.v1",
    orgId,
    detectors: Object.fromEntries(
      CONTENT_POLICY_DETECTOR_CODES.map((code) => [code, detectorRecord[code]]),
    ) as ContentPolicyDetectorActions,
    updatedAt: candidate.updatedAt,
    updatedBy: candidate.updatedBy,
  };
}

function settingKey(orgId: string): string {
  return `content_policy.v1:${orgId}`;
}
