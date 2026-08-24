import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { Button, Field, InlineError, Textarea } from "@romeo/ui";
import { useState } from "react";

import { createChat } from "../features/chats";
import type { Agent } from "../features/managed-models";
import { startRun, streamRunEvents } from "../features/runs";
import { refreshAgentTestRunQueries } from "../features/runs/mutation-options";
import { useLocale } from "../lib/i18n";
import { safeUserErrorMessage } from "../lib/safe-user-error";

interface AgentTestConsoleProps {
  activeAgent: Agent | undefined;
  workspaceId: string | undefined;
}

export function AgentTestConsole({
  activeAgent,
  workspaceId,
}: AgentTestConsoleProps) {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const [citations, setCitations] = useState<
    Array<{ chunkId: string; title: string }>
  >([]);
  const [result, setResult] = useState("");
  const [runId, setRunId] = useState<string>();
  const [status, setStatus] = useState<
    "idle" | "running" | "completed" | "failed"
  >("idle");
  const [error, setError] = useState<string>();

  const form = useForm({
    defaultValues: { prompt: t("agentDefaultTestPrompt") },
    onSubmit: async ({ value }) => {
      const content = value.prompt.trim();
      if (
        !activeAgent ||
        !workspaceId ||
        content.length === 0 ||
        status === "running"
      )
        return;

      setError(undefined);
      setCitations([]);
      setResult("");
      setRunId(undefined);
      setStatus("running");

      const abort = new AbortController();
      const timeout = window.setTimeout(
        () => abort.abort("agent test timeout"),
        60_000,
      );
      try {
        const chat = await createChat({
          workspaceId,
          title: `${t("agentTestTitlePrefix")} ${content.slice(0, 48)}`,
          temporary: true,
        });
        const run = await startRun({
          chatId: chat.id,
          agentId: activeAgent.id,
          content,
        });
        setRunId(run.id);
        let terminal: "completed" | "failed" | undefined;
        for await (const event of streamRunEvents(run.id, abort.signal)) {
          if (event.type === "retrieval.completed")
            setCitations(readCitations(event.data));
          if (event.type === "message.delta")
            appendDelta((event.data as { text?: string }).text ?? "");
          if (event.type === "run.failed") {
            terminal = "failed";
            break;
          }
          if (event.type === "run.completed") {
            terminal = "completed";
            break;
          }
        }
        setStatus(terminal ?? (abort.signal.aborted ? "failed" : "completed"));
        if (terminal === undefined && abort.signal.aborted) {
          setError(t("agentUnableRunTest"));
        }
        await refreshAgentTestRunQueries(queryClient, workspaceId);
      } catch (caught) {
        setError(safeUserErrorMessage(caught, t("agentUnableRunTest")));
        setStatus("failed");
      } finally {
        window.clearTimeout(timeout);
        abort.abort();
      }
    },
  });
  const promptValue = useStore(form.store, (state) => state.values.prompt);

  function appendDelta(delta: string) {
    setResult((current) => current + delta);
  }

  return (
    <div className="mt-5 grid gap-3 border-t border-border pt-4">
      <div className="text-sm text-muted">{t("agentTestConsole")}</div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="prompt">
          {(field) => (
            <Field label={t("agentTestPrompt")}>
              <Textarea
                name="prompt"
                disabled={!activeAgent || !workspaceId || status === "running"}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                rows={3}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
        <Button
          disabled={
            !activeAgent ||
            !workspaceId ||
            status === "running" ||
            promptValue.trim().length === 0
          }
          pending={status === "running"}
          type="submit"
        >
          {t("agentRunTest")}
        </Button>
      </form>
      {runId ? (
        <div className="break-all text-xs text-muted">{runId}</div>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {result ? (
        <div className="rounded-md border border-border p-3 text-sm leading-6">
          {result}
        </div>
      ) : null}
      {citations.length > 0 ? (
        <div className="grid gap-1 text-xs text-muted">
          {citations.map((citation, index) => (
            <div className="break-words" key={`${citation.chunkId}-${index}`}>
              [{index + 1}] {citation.title}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function readCitations(
  data: unknown,
): Array<{ chunkId: string; title: string }> {
  if (
    typeof data !== "object" ||
    data === null ||
    !("citations" in data) ||
    !Array.isArray(data.citations)
  )
    return [];
  return data.citations.flatMap((citation) => {
    if (typeof citation !== "object" || citation === null) return [];
    const chunkId =
      "chunkId" in citation && typeof citation.chunkId === "string"
        ? citation.chunkId
        : "";
    const title =
      "title" in citation && typeof citation.title === "string"
        ? citation.title
        : "";
    return chunkId && title ? [{ chunkId, title }] : [];
  });
}
