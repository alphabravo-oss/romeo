import { Input, Button } from "@romeo/ui";
import Archive from "lucide-react/dist/esm/icons/archive.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import ShieldOff from "lucide-react/dist/esm/icons/shield-off.mjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { archiveChat, updateChatLegalHold } from "../features";
import { toast } from "../lib/toast";
import { useLocale } from "../lib/i18n";

export function ChatLifecyclePanel({
  activeChatId,
  onChatArchived,
}: {
  activeChatId: string | undefined;
  onChatArchived: (chatId: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [holdDays, setHoldDays] = useState(30);
  const [notice, setNotice] = useState<string>();
  const archiveMutation = useMutation({ mutationFn: archiveChat });
  const legalHoldMutation = useMutation({
    mutationFn: (input: {
      chatId: string;
      legalHoldUntil?: string | null;
      legalHoldReason?: string;
    }) => {
      const { chatId, ...body } = input;
      return updateChatLegalHold(chatId, body);
    },
  });
  const hasActiveChat = activeChatId !== undefined;
  const isBusy = archiveMutation.isPending || legalHoldMutation.isPending;

  async function handleArchive() {
    if (activeChatId === undefined) return;
    setNotice(undefined);
    try {
      const archived = await archiveMutation.mutateAsync(activeChatId);
      await onChatArchived(archived.id);
      setNotice(t("lifecycleChatArchivedNotice"));
      toast(t("lifecycleChatArchived"), "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : t("lifecycleUnableArchiveChat"),
      );
      toast(t("lifecycleArchiveChatFailed"), "error");
    }
  }

  async function handleHold() {
    if (activeChatId === undefined) return;
    setNotice(undefined);
    try {
      const legalHoldUntil = futureIsoTimestamp(holdDays);
      await legalHoldMutation.mutateAsync({
        chatId: activeChatId,
        legalHoldUntil,
      });
      await refreshLifecycleQueries(queryClient);
      setNotice(t("lifecycleHoldUpdatedNotice"));
      toast(t("lifecycleHoldUpdated"), "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : t("lifecycleUnableUpdateHold"),
      );
      toast(t("lifecycleHoldUpdateFailed"), "error");
    }
  }

  async function handleClearHold() {
    if (activeChatId === undefined) return;
    setNotice(undefined);
    try {
      await legalHoldMutation.mutateAsync({
        chatId: activeChatId,
        legalHoldUntil: null,
      });
      await refreshLifecycleQueries(queryClient);
      setNotice(t("lifecycleHoldClearedNotice"));
      toast(t("lifecycleHoldCleared"), "success");
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : t("lifecycleUnableClearHold"),
      );
      toast(t("lifecycleClearHoldFailed"), "error");
    }
  }

  return (
    <div className="mt-4 grid gap-2 text-sm">
      <div className="text-muted">{t("lifecycleChatLifecycle")}</div>
      <label className="text-muted" htmlFor="chat-legal-hold-days">
        {t("lifecycleHoldDays")}
      </label>
      <Input
        disabled={!hasActiveChat || isBusy}
        id="chat-legal-hold-days"
        max={3650}
        min={1}
        onChange={(event) => setHoldDays(Number(event.currentTarget.value))}
        type="number"
        value={holdDays}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button
          className="inline-flex items-center justify-center gap-2"
          disabled={!hasActiveChat || isBusy}
          onClick={() => void handleArchive()}
          type="button"
        >
          <Archive aria-hidden="true" size={16} />
          {t("lifecycleArchive")}
        </Button>
        <Button
          className="inline-flex items-center justify-center gap-2"
          disabled={!hasActiveChat || isBusy}
          onClick={() => void handleHold()}
          type="button"
        >
          <ShieldCheck aria-hidden="true" size={16} />
          {t("lifecycleHold")}
        </Button>
        <Button
          className="inline-flex items-center justify-center gap-2"
          disabled={!hasActiveChat || isBusy}
          onClick={() => void handleClearHold()}
          type="button"
        >
          <ShieldOff aria-hidden="true" size={16} />
          {t("lifecycleClear")}
        </Button>
      </div>
      {notice ? <div className="text-xs text-muted">{notice}</div> : null}
    </div>
  );
}

async function refreshLifecycleQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["chats"] }),
    queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
    queryClient.invalidateQueries({ queryKey: ["accessReview"] }),
  ]);
}

function futureIsoTimestamp(days: number): string {
  const boundedDays = Math.max(
    1,
    Math.min(3650, Number.isFinite(days) ? days : 30),
  );
  return new Date(Date.now() + boundedDays * 24 * 60 * 60 * 1000).toISOString();
}
