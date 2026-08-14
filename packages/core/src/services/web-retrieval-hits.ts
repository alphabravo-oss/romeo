import type { AuthSubject } from "@romeo/auth";
import type { RetrievalHit } from "@romeo/rag";

import { resultToHit, type WebSearchResult } from "./web-search-support";

export async function collectWebRetrievalHits(
  subject: AuthSubject,
  input: { query: string; search: boolean; urls: string[] },
  operations: {
    search(subject: AuthSubject, query: string): Promise<WebSearchResult[]>;
    ingest(
      subject: AuthSubject,
      urls: string[],
    ): Promise<Array<WebSearchResult & { content: string }>>;
  },
): Promise<RetrievalHit[]> {
  const [searchResults, urlResults] = await Promise.all([
    input.search
      ? operations.search(subject, input.query)
      : Promise.resolve([]),
    input.urls.length === 0
      ? Promise.resolve([])
      : operations.ingest(subject, input.urls),
  ]);
  return [
    ...searchResults.map((result, index) =>
      resultToHit(result, result.snippet, 1 - index * 0.01),
    ),
    ...urlResults.map((result, index) =>
      resultToHit(result, result.content, 0.95 - index * 0.01),
    ),
  ];
}
