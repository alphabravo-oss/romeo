import { Input, Button } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import { executeDataDeletion, previewDataDeletion } from "../features";
import type { DataDeletionPreview } from "../features/types";
import { toast } from "../lib/toast";
import { LocalizedDateTime } from "../lib/locale-format";
import { type MessageKey, useLocale } from "../lib/i18n";

export function DataDeletionPanel({
  activeChatId,
  onChatDeleted,
}: {
  activeChatId: string | undefined;
  onChatDeleted: (chatId: string) => Promise<void>;
}) {
  const { t } = useLocale();
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
        setNotice(t("deletionPreviewReadyNotice"));
        toast(t("deletionPreviewReady"), "success");
      } catch (caught) {
        setPreview(undefined);
        setNotice(
          caught instanceof Error ? caught.message : t("unablePreviewDeletion"),
        );
        toast(t("couldNotPreviewDeletion"), "error");
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
      setNotice(t("deletionCompleted"));
      toast(t("chatDeleted"), "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : t("unableDeleteData"),
      );
      toast(t("couldNotDeleteData"), "error");
    }
  }

  return (
    <div className="mt-4 grid gap-2 text-sm">
      <div className="text-muted">{t("dataDeletion")}</div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <label className="text-muted" htmlFor="data-deletion-chat-id">
          {t("chatId")}
        </label>
        <form.Field name="chatId">
          {(field) => (
            <Input
              name="chatId"
              id="data-deletion-chat-id"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              value={field.state.value}
            />
          )}
        </form.Field>
        <Button
          disabled={normalizedChatId.length === 0 || previewMutation.isPending}
          type="submit"
        >
          {previewMutation.isPending
            ? t("deletionPreviewing")
            : t("previewDeletion")}
        </Button>
      </form>
      {preview ? (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <div className="grid grid-cols-2 gap-2">
            {countRows(preview, t).map((row) => (
              <div className="min-w-0" key={row.label}>
                <div className="text-xs text-muted">{row.label}</div>
                <div className="font-medium">{row.value}</div>
              </div>
            ))}
          </div>
          {preview.legalHold ? (
            <div className="text-xs text-muted">
              {t("legalHoldUntil")}{" "}
              <LocalizedDateTime value={preview.legalHold.until} />
            </div>
          ) : null}
          <label className="text-muted" htmlFor="data-deletion-confirm-id">
            {t("confirmId")}
          </label>
          <Input
            id="data-deletion-confirm-id"
            onChange={(event) =>
              setConfirmResourceId(event.currentTarget.value)
            }
            value={confirmResourceId}
          />
          <Button
            disabled={!canExecute}
            onClick={() => void handleExecute()}
            type="button"
          >
            {executeMutation.isPending ? t("deleting") : t("deleteData")}
          </Button>
        </div>
      ) : null}
      {notice ? <div className="text-xs text-muted">{notice}</div> : null}
    </div>
  );
}

function countRows(
  preview: DataDeletionPreview,
  t: (key: MessageKey) => string,
): Array<{ label: string; value: number }> {
  return [
    { label: t("deletionMessages"), value: preview.counts.messages },
    { label: t("deletionMessageParts"), value: preview.counts.messageParts },
    { label: t("deletionRuns"), value: preview.counts.runs },
    { label: t("deletionRunSteps"), value: preview.counts.runSteps },
    { label: t("deletionRunEvents"), value: preview.counts.runEvents },
    { label: t("deletionComments"), value: preview.counts.chatComments },
    {
      label: t("deletionNotifications"),
      value: preview.counts.userNotifications,
    },
    {
      label: t("deletionDeliveries"),
      value: preview.counts.notificationDeliveries,
    },
    {
      label: t("deletionToolTraces"),
      value: preview.counts.runLinkedToolCalls,
    },
    { label: t("deletionUsageEvents"), value: preview.counts.usageEvents },
    { label: t("deletionGrants"), value: preview.counts.resourceGrants },
    { label: t("deletionFavorites"), value: preview.counts.resourceFavorites },
    {
      label: t("deletionFolderItems"),
      value: preview.counts.workspaceFolderItems,
    },
  ];
}
