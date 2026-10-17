import type { AuthSubject } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";
import type { BaseModel } from "@romeo/providers";

import type { BackgroundJob, RunRecord } from "../domain/entities";
import { createId } from "../ids";
import type { PersistedOutputPartRef } from "./persist-output-parts";
import type { RunExecutionStateService } from "./run-execution-state-service";
import type { RunKnowledgeCitation } from "./run-knowledge";

export const runExecutionFailedCode = "run_execution_failed";

/** Latest execution state, readable after an unexpected failure. */
export interface RunExecutionProgress {
  read?: () => {
    assistantContent: string;
    job: BackgroundJob;
    outputParts: PersistedOutputPartRef[];
  };
}

/**
 * Persists a run that failed unexpectedly (claim, policy lookup, repository
 * or streaming errors) through the normal terminal path, then releases the
 * execution job so the run does not wait for lease-expiry recovery. The
 * terminal event carries only a stable code, never the underlying error text.
 */
export async function failRunExecution(input: {
  citations: RunKnowledgeCitation[];
  completeRun: (
    run: RunRecord,
    event: RunEvent,
    assistantContent: string,
    model: BaseModel,
    citations: RunKnowledgeCitation[],
    subject: AuthSubject,
    outputParts: PersistedOutputPartRef[],
  ) => Promise<void>;
  executionState: RunExecutionStateService;
  model: BaseModel;
  progress: RunExecutionProgress;
  run: RunRecord;
  subject: AuthSubject;
}): Promise<void> {
  const progress = input.progress.read?.();
  await input.completeRun(
    input.run,
    {
      id: createId("event"),
      runId: input.run.id,
      sequence: 0,
      type: "run.failed",
      data: {
        errorCode: runExecutionFailedCode,
        message:
          "The response could not be completed because of an internal error. You can retry the message.",
        recoverable: true,
      },
      createdAt: new Date().toISOString(),
    },
    progress?.assistantContent ?? "",
    input.model,
    input.citations,
    input.subject,
    progress?.outputParts ?? [],
  );
  if (progress !== undefined)
    await input.executionState.finish(progress.job, "failed");
}
