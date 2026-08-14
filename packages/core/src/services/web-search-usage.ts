import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { recordSubjectUsage } from "./record-usage";

export function recordRetrievalUnits(
  repository: RomeoRepository,
  subject: AuthSubject,
  input: {
    sourceId: string;
    quantity: number;
    operation: "search_result" | "url_content";
    provider?: string;
  },
): Promise<unknown> {
  return recordSubjectUsage(repository, subject, {
    orgId: subject.orgId,
    sourceType: "retrieval",
    sourceId: input.sourceId,
    metric: "retrieval.unit",
    quantity: input.quantity,
    unit: "retrieval_unit",
    metadata: {
      operation: input.operation,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
    },
  });
}
