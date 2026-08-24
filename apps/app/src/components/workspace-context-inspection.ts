import { RomeoApiError } from "@romeo/api-client";

import type { RunContextPreview } from "../features/chat";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import type { ComposerReasoningMode } from "./composer-reasoning-policy";
import { inspectWorkspaceRunContext } from "./workspace-controller-operations";

export async function inspectWorkspaceContext(input: {
  activeAgentId?: string;
  activeChatId?: string;
  agenticRagEnabled: boolean;
  attachedUrls: string[];
  content: string;
  contextWindowError: string;
  fallbackError: string;
  fileIds: string[];
  imageCount: number;
  modelId?: string;
  reasoningMode: ComposerReasoningMode;
  researchMode: "deep" | "standard";
  routingMode: "economy" | "selected";
  setContextPreview: (preview: RunContextPreview | undefined) => void;
  setContextPreviewError: (error: string | undefined) => void;
  setIsInspectingContext: (inspecting: boolean) => void;
  webSearchEnabled: boolean;
}): Promise<void> {
  if (input.activeChatId === undefined || input.activeAgentId === undefined)
    return;
  input.setIsInspectingContext(true);
  // Never present a previous preview as though it describes the request now
  // being inspected. Persisted run provenance remains independently visible.
  input.setContextPreview(undefined);
  input.setContextPreviewError(undefined);
  try {
    input.setContextPreview(
      await inspectWorkspaceRunContext({
        agentId: input.activeAgentId,
        agenticRagEnabled: input.agenticRagEnabled,
        attachedUrls: input.attachedUrls,
        chatId: input.activeChatId,
        content: input.content,
        fileIds: input.fileIds,
        imageCount: input.imageCount,
        modelId: input.modelId,
        reasoningMode: input.reasoningMode,
        researchMode: input.researchMode,
        routingMode: input.routingMode,
        webSearchEnabled: input.webSearchEnabled,
      }),
    );
  } catch (caught) {
    input.setContextPreviewError(
      contextInspectionUserError(
        caught,
        input.fallbackError,
        input.contextWindowError,
      ),
    );
  } finally {
    input.setIsInspectingContext(false);
  }
}

export function contextInspectionUserError(
  error: unknown,
  fallback: string,
  contextWindowError: string,
): string {
  return safeUserErrorMessage(
    error,
    error instanceof RomeoApiError &&
      error.code === "run_context_window_exceeded"
      ? contextWindowError
      : fallback,
  );
}
