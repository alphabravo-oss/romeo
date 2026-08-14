import type { RetrievalHit } from "@romeo/rag";
import type { AuthSubject } from "@romeo/auth";

import type { AgentSafetySettings } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import {
  inspectPromptInjection,
  shouldScanPromptInjection,
  type PromptInjectionCategory,
} from "./agent-safety";
import { retrieveKnowledgeChunks } from "./knowledge-ingestion";
import {
  filterKnowledgeChunksForSources,
  filterKnowledgeSourcesForSubject,
} from "./knowledge-source-access";
import {
  defaultAgenticHopLimit,
  hitsAreSufficient,
  mergeRetrievalHits,
  planAgenticQueries,
  planFollowUpQueries,
} from "./knowledge-agentic";
import { retrievePersistedVectorHits } from "./knowledge-vector-retrieval";
import type { KnowledgeVectorStore } from "./knowledge-vector-store";

export interface RunKnowledgeContext {
  citations: RunKnowledgeCitation[];
  hits: RetrievalHit[];
  knowledgeContext?: string;
  safety?: RunKnowledgeSafetySummary;
}

export interface RunKnowledgeSafetySummary {
  promptInjectionCategories: PromptInjectionCategory[];
  promptInjectionSkippedCount: number;
}

export interface RunKnowledgeCitation {
  chunkId: string;
  documentId: string;
  title: string;
  sourceUri?: string;
  sourceType?: string;
  provider?: string;
  retrievedAt?: string;
  accessedAt?: string;
  publishedAt?: string;
}

export async function buildRunKnowledgeContext(
  repository: RomeoRepository,
  input: {
    agentId: string;
    /**
     * When provided, search these knowledge bases instead of only the agent's
     * enabled bindings. `[]` disables retrieval for the turn.
     */
    knowledgeBaseIds?: string[];
    fetchImpl?: typeof fetch;
    query: string;
    safetySettings?: AgentSafetySettings;
    subject: AuthSubject;
    vectorStore?: KnowledgeVectorStore;
    /** When true, rewrite/decompose the query and retrieve across hops. */
    agentic?: boolean;
  },
): Promise<RunKnowledgeContext> {
  const knowledgeBaseIds = await resolveKnowledgeBaseIdsForRun(repository, {
    agentId: input.agentId,
    ...(input.knowledgeBaseIds === undefined
      ? {}
      : { knowledgeBaseIds: input.knowledgeBaseIds }),
  });
  const retrieve = (query: string) =>
    retrieveHitsForQuery(repository, {
      ...input,
      knowledgeBaseIds,
      query,
    });
  const merged = new Map<string, RetrievalHit>();
  const seenQueries = new Set<string>();
  let pending =
    input.agentic === true ? planAgenticQueries(input.query) : [input.query];
  const hopLimit = input.agentic === true ? defaultAgenticHopLimit : 1;
  for (let hop = 0; hop < hopLimit && pending.length > 0; hop += 1) {
    const unused = pending.filter((query) => {
      const key = query.toLowerCase();
      if (seenQueries.has(key)) return false;
      seenQueries.add(key);
      return true;
    });
    if (unused.length === 0) break;
    mergeRetrievalHits(
      merged,
      (await Promise.all(unused.map((query) => retrieve(query)))).flat(),
    );
    if (input.agentic !== true) break;
    const current = [...merged.values()];
    if (hitsAreSufficient(current, input.query)) break;
    pending = planFollowUpQueries(input.query, current);
  }
  const rawHits = [...merged.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
  const { hits, safety } = filterPromptInjectionGuardedHits(
    rawHits,
    input.safetySettings,
  );

  const knowledgeContext = renderKnowledgeContext(hits);
  return {
    citations: hits.map(citationFromRetrievalHit),
    hits,
    ...(knowledgeContext === undefined ? {} : { knowledgeContext }),
    ...(safety === undefined ? {} : { safety }),
  };
}

async function retrieveHitsForQuery(
  repository: RomeoRepository,
  input: {
    fetchImpl?: typeof fetch;
    knowledgeBaseIds: string[];
    query: string;
    subject: AuthSubject;
    vectorStore?: KnowledgeVectorStore;
  },
): Promise<RetrievalHit[]> {
  return (
    await Promise.all(
      input.knowledgeBaseIds.map(async (knowledgeBaseId) => {
        const [knowledgeBase, sources, chunks] = await Promise.all([
          repository.getKnowledgeBase(knowledgeBaseId),
          repository.listKnowledgeSources(knowledgeBaseId),
          repository.listKnowledgeChunks(knowledgeBaseId),
        ]);
        if (!knowledgeBase || chunks.length === 0) return [];
        const visibleSources = filterKnowledgeSourcesForSubject(
          sources,
          input.subject,
        );
        const visibleChunks = filterKnowledgeChunksForSources(
          chunks,
          visibleSources,
        );
        if (visibleChunks.length === 0) return [];
        const vectorHits = await retrievePersistedVectorHits({
          repository,
          subject: input.subject,
          knowledgeBase,
          chunks: visibleChunks,
          sources: visibleSources,
          query: input.query,
          maxResults: 3,
          ...(input.fetchImpl === undefined
            ? {}
            : { fetchImpl: input.fetchImpl }),
          ...(input.vectorStore === undefined
            ? {}
            : { vectorStore: input.vectorStore }),
        });
        const hits =
          vectorHits.length > 0
            ? vectorHits
            : retrieveKnowledgeChunks(
                visibleChunks,
                visibleSources,
                input.query,
                3,
              );
        return hits.map((hit) => ({
          ...hit,
          metadata: { ...hit.metadata, knowledgeBaseId: knowledgeBase.id },
        }));
      }),
    )
  ).flat();
}

export async function resolveKnowledgeBaseIdsForRun(
  repository: RomeoRepository,
  input: { agentId: string; knowledgeBaseIds?: string[] },
): Promise<string[]> {
  if (input.knowledgeBaseIds !== undefined) {
    return [
      ...new Set(
        input.knowledgeBaseIds
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    ];
  }
  return (await repository.listAgentKnowledgeBindings(input.agentId))
    .filter((binding) => binding.enabled)
    .map((binding) => binding.knowledgeBaseId);
}

export function citationFromRetrievalHit(
  hit: RetrievalHit,
): RunKnowledgeCitation {
  return {
    ...hit.citation,
    ...citationStringMetadata(hit, "sourceType"),
    ...citationStringMetadata(hit, "provider"),
    ...citationStringMetadata(hit, "retrievedAt"),
    ...citationStringMetadata(hit, "accessedAt"),
    ...citationStringMetadata(hit, "publishedAt"),
  };
}

function citationStringMetadata(
  hit: RetrievalHit,
  key: string,
): Record<string, string> {
  const value = hit.metadata[key];
  return typeof value === "string" && value.length > 0 ? { [key]: value } : {};
}

// Exported so bracket numbering has one owner: the budget may shed hits after retrieval, and a
// second renderer would desync the numbers from the citations array.
export function renderKnowledgeContext(
  hits: RetrievalHit[],
): string | undefined {
  if (hits.length === 0) return undefined;
  return hits
    .map((hit, index) => `[${index + 1}] ${hit.citation.title}: ${hit.content}`)
    .join("\n");
}

export const KNOWLEDGE_NO_MATCH_REPLY =
  "No matching documents were found in the connected knowledge bases.";

// Retrieved context rides the user turn, not the system prompt: that keeps messages[0] byte-stable
// for the life of the agent version, which is what provider prompt caching keys on.
export function knowledgeUserContent(
  knowledgeContext: string | undefined,
  userContent: string,
  groundingMode: AgentSafetySettings["knowledgeGroundingMode"] = "optional",
): string {
  const mode = groundingMode ?? "optional";
  if (knowledgeContext === undefined) {
    if (mode === "required") {
      return [
        "Knowledge grounding is required for this assistant.",
        "No documents matched the connected knowledge bases.",
        `Reply with exactly this sentence and nothing else: "${KNOWLEDGE_NO_MATCH_REPLY}"`,
        "Do not use outside knowledge.",
        "",
        `User request (do not answer from general knowledge): ${userContent}`,
      ].join("\n");
    }
    return userContent;
  }

  if (mode === "required") {
    return [
      "Knowledge context (authoritative — answer ONLY from this):",
      knowledgeContext,
      "",
      `If the context does not contain the answer, reply with exactly: "${KNOWLEDGE_NO_MATCH_REPLY}"`,
      "Cite sources by bracket number. Do not use outside knowledge.",
      "",
      userContent,
    ].join("\n");
  }

  if (mode === "prefer") {
    return [
      "Knowledge context:",
      knowledgeContext,
      "",
      "Prefer this context when it is relevant and cite sources by bracket number. If it does not help, you may answer normally.",
      "",
      userContent,
    ].join("\n");
  }

  // Product-neutral on purpose: this preamble rides in the USER turn, so it reaches the model even
  // in bare mode where the system prompt is withheld.
  return `Knowledge context:\n${knowledgeContext}\n\nUse this context when relevant and cite sources by bracket number.\n\n${userContent}`;
}

export function appendRunCitations(
  content: string,
  citations: RunKnowledgeCitation[],
): string {
  if (content.trim().length === 0 || citations.length === 0) return content;
  const citationLines = citations
    .map(
      (citation, index) =>
        `- [${index + 1}] ${citation.title} (${citation.chunkId})`,
    )
    .join("\n");
  return `${content}\n\nCitations:\n${citationLines}`;
}

// End-anchored so it can only match what appendRunCitations produces; a pathological title simply
// fails to match and leaves the footer intact rather than truncating real assistant content.
const runCitationFooter = /\n\nCitations:\n(?:- \[\d+\] [^\n]*\n?)+$/;

export function stripRunCitations(content: string): string {
  return content.replace(runCitationFooter, "");
}

function filterPromptInjectionGuardedHits(
  hits: RetrievalHit[],
  settings: AgentSafetySettings | undefined,
): { hits: RetrievalHit[]; safety?: RunKnowledgeSafetySummary } {
  if (
    settings === undefined ||
    !shouldScanPromptInjection(settings, "retrieved_context")
  )
    return { hits };

  const categories = new Set<PromptInjectionCategory>();
  const filteredHits: RetrievalHit[] = [];
  let skipped = 0;
  for (const hit of hits) {
    const inspection = inspectPromptInjection(hit.content);
    if (inspection.matched) {
      skipped += 1;
      inspection.categories.forEach((category) => categories.add(category));
    } else {
      filteredHits.push(hit);
    }
  }

  if (skipped === 0) return { hits: filteredHits };
  return {
    hits: filteredHits,
    safety: {
      promptInjectionCategories: [...categories].sort(),
      promptInjectionSkippedCount: skipped,
    },
  };
}
