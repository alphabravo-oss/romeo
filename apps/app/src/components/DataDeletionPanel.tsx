import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import { executeDataDeletion, previewDataDeletion } from "../api/client";
import type { DataDeletionPreview } from "../api/types";
import { toast } from "../lib/toast";

export function DataDeletionPanel({
  activeChatId,
  onChatDeleted,
}: {
  activeChatId: string | undefined;
  onChatDeleted: (chatId: string) => Promise<void>;
}) {
  const [confirmResourceId, setConfirmResourceId] = useState("");
  const [preview, setPreview] = useState<DataDeletionPreview>();
  const [notice, setNotice] = useState<string>();
  const previewMutation = useMutation({ mutationFn: previewDataDeletion });
  const executeMutation = useMutation({ mutationFn: executeDataDeletion });

  const form = useForm({
    defaultValues: { chatId: "" },
    onSubmit: async ({ value }) => {
      const normalized = value.chatId.trim();
      if (normalized.length === 0) return;
      setNotice(undefined);
      setConfirmResourceId("");
      try {
        const nextPreview = await previewMutation.mutateAsync({
          resourceType: "chat",
          resourceId: normalized,
        });
        setPreview(nextPreview);
        setNotice("Preview ready.");
        toast("Deletion preview ready", "success");
      } catch (caught) {
        setPreview(undefined);
        setNotice(
          caught instanceof Error
            ? caught.message
            : "Unable to preview deletion.",
        );
        toast("Could not preview deletion", "error");
      }
    },
  });
  const chatId = useStore(form.store, (state) => state.values.chatId);
  const normalizedChatId = chatId.trim();
  const canExecute =
    preview?.resourceId === normalizedChatId &&
    preview.legalHold === undefined &&
    confirmResourceId === normalizedChatId &&
    !executeMutation.isPending;

  useEffect(() => {
    if (activeChatId !== undefined && chatId.length === 0)
      form.setFieldValue("chatId", activeChatId);
  }, [activeChatId, chatId.length, form]);

  async function handleExecute() {
    if (!canExecute) return;
    setNotice(undefined);
    try {
      const result = await executeMutation.mutateAsync({
        resourceType: "chat",
        resourceId: normalizedChatId,
        confirmResourceId,
      });
      setPreview(undefined);
      setConfirmResourceId("");
      await onChatDeleted(result.resourceId);
      setNotice("Deletion completed.");
      toast("Chat deleted", "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Unable to delete data.",
      );
      toast("Could not delete data", "error");
    }
  }

  return (
    <div className="mt-4 grid gap-2 text-sm">
      <div className="text-muted">Data deletion</div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <label
          className="text-muted"
          htmlFor="data-deletion-chat-id"
        >
          Chat ID
        </label>
        <form.Field name="chatId">
          {(field) => (
            <input
              className="rm-input"
              id="data-deletion-chat-id"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              value={field.state.value}
            />
          )}
        </form.Field>
        <button
          className="rm-button"
          disabled={normalizedChatId.length === 0 || previewMutation.isPending}
          type="submit"
        >
          {previewMutation.isPending ? "Previewing" : "Preview deletion"}
        </button>
      </form>
      {preview ? (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            {countRows(preview).map((row) => (
              <div className="min-w-0" key={row.label}>
                <div className="text-xs text-muted">
                  {row.label}
                </div>
                <div className="font-medium">{row.value}</div>
              </div>
            ))}
          </div>
          {preview.legalHold ? (
            <div className="text-xs text-muted">
              Legal hold until{" "}
              {new Date(preview.legalHold.until).toLocaleString()}
            </div>
          ) : null}
          <label
            className="text-muted"
            htmlFor="data-deletion-confirm-id"
          >
            Confirm ID
          </label>
          <input
            className="rm-input"
            id="data-deletion-confirm-id"
            onChange={(event) =>
              setConfirmResourceId(event.currentTarget.value)
            }
            value={confirmResourceId}
          />
          <button
            className="rm-button"
            disabled={!canExecute}
            onClick={() => void handleExecute()}
            type="button"
          >
            {executeMutation.isPending ? "Deleting" : "Delete data"}
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="text-xs text-muted">{notice}</div>
      ) : null}
    </div>
  );
}

function countRows(
  preview: DataDeletionPreview,
): Array<{ label: string; value: number }> {
  return [
    { label: "Messages", value: preview.counts.messages },
    { label: "Message parts", value: preview.counts.messageParts },
    { label: "Runs", value: preview.counts.runs },
    { label: "Run steps", value: preview.counts.runSteps },
    { label: "Run events", value: preview.counts.runEvents },
    { label: "Comments", value: preview.counts.chatComments },
    { label: "Notifications", value: preview.counts.userNotifications },
    { label: "Deliveries", value: preview.counts.notificationDeliveries },
    { label: "Tool traces", value: preview.counts.runLinkedToolCalls },
    { label: "Usage events", value: preview.counts.usageEvents },
    { label: "Grants", value: preview.counts.resourceGrants },
    { label: "Favorites", value: preview.counts.resourceFavorites },
    { label: "Folder items", value: preview.counts.workspaceFolderItems },
  ];
}
