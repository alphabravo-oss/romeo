import type { RetrievalHit } from "@romeo/rag";

import type { RagPolicyAgenticSettings } from "../domain/rag-policy";
import type { RomeoRepository } from "../domain/repository";
import { readRagPolicy } from "./rag-policy-service";

export const defaultAgenticHopLimit = 3;

export function shouldUseAgenticRag(
  settings: RagPolicyAgenticSettings,
  requested?: boolean,
): boolean {
  if (!settings.enabled) return false;
  if (settings.userMode === "required") return true;
  return requested === true;
}

export async function resolveRunAgentic(
  repository: RomeoRepository,
  orgId: string,
  requested?: boolean,
): Promise<boolean> {
  const policy = await readRagPolicy(repository, orgId);
  return shouldUseAgenticRag(policy.agentic, requested);
}

export function planAgenticQueries(query: string): string[] {
  const original = collapseWhitespace(query);
  if (original.length === 0) return [];
  const planned = [original];
  for (const phrase of quotedPhrases(original)) pushUnique(planned, phrase);
  for (const part of splitComparative(original)) pushUnique(planned, part);
  for (const part of splitConjunctions(original)) pushUnique(planned, part);
  return planned.slice(0, 4);
}

export function planFollowUpQueries(
  query: string,
  hits: readonly RetrievalHit[],
): string[] {
  const missing = missingQueryTerms(query, hits);
  if (missing.length === 0) return [];
  const followUps = [missing.join(" ")];
  const title = hits[0]?.citation.title;
  if (title !== undefined && title.trim().length > 0) {
    followUps.push(`${collapseWhitespace(title)} ${missing.join(" ")}`);
  }
  return followUps
    .map((item) => collapseWhitespace(item))
    .filter((item) => item.length > 0)
    .slice(0, 2);
}

export function hitsAreSufficient(
  hits: readonly RetrievalHit[],
  query: string,
): boolean {
  if (hits.length === 0) return false;
  const ranked = [...hits].sort((left, right) => right.score - left.score);
  const top = ranked[0]!.score;
  if (top >= 0.6 && ranked.length >= 1) {
    return !isMultiPartQuery(query) || distinctDocuments(ranked) >= 2;
  }
  return ranked.length >= 2 && top >= 0.35;
}

export function mergeRetrievalHits(
  existing: Map<string, RetrievalHit>,
  incoming: readonly RetrievalHit[],
): void {
  for (const hit of incoming) {
    const current = existing.get(hit.id);
    if (current === undefined || hit.score > current.score) {
      existing.set(hit.id, hit);
    }
  }
}

function quotedPhrases(query: string): string[] {
  return [...query.matchAll(/"([^"]{2,80})"/gu)]
    .map((match) => collapseWhitespace(match[1] ?? ""))
    .filter((phrase) => phrase.length > 0);
}

function splitComparative(query: string): string[] {
  const parts = query.split(
    /\s+(?:vs\.?|versus|compared to|compared with|difference between)\s+/iu,
  );
  return parts.length > 1
    ? parts.map((part) => collapseWhitespace(part)).filter(hasEnoughTerms)
    : [];
}

function splitConjunctions(query: string): string[] {
  if (!/\s+(?:and|or)\s+/iu.test(query)) return [];
  return query
    .split(/\s+(?:and|or)\s+/iu)
    .map((part) => collapseWhitespace(part))
    .filter(hasEnoughTerms);
}

function isMultiPartQuery(query: string): boolean {
  return (
    splitComparative(query).length > 1 || splitConjunctions(query).length > 1
  );
}

function missingQueryTerms(
  query: string,
  hits: readonly RetrievalHit[],
): string[] {
  const corpus = hits
    .map((hit) => `${hit.citation.title} ${hit.content}`)
    .join(" ")
    .toLowerCase();
  return tokenize(query).filter((term) => !corpus.includes(term));
}

function distinctDocuments(hits: readonly RetrievalHit[]): number {
  return new Set(hits.map((hit) => hit.citation.documentId)).size;
}

function hasEnoughTerms(value: string): boolean {
  return tokenize(value).length >= 2;
}

function pushUnique(values: string[], next: string): void {
  const normalized = collapseWhitespace(next);
  if (
    normalized.length === 0 ||
    values.some((value) => value.toLowerCase() === normalized.toLowerCase())
  ) {
    return;
  }
  values.push(normalized);
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]{3,}/gu) ?? [];
}
