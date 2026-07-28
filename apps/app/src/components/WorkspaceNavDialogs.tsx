import { Button, Checkbox, Input, NativeSelect } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { addFolderItem, assignChatTag, createFolder } from "../features";
import {
  listChatShares,
  listShareTargets,
  revokeChatShare,
  shareChatAccess,
} from "../features/collaboration";
import type { Chat } from "../features/types";
import { useLocale } from "../lib/i18n";
import { useConfirm } from "./ConfirmDialog";
import { FormDialog } from "./FormDialog";

export type WorkspaceNavDialog =
  | { kind: "create-folder" }
  | { kind: "move"; chat: Chat; initialFolderId: string }
  | { kind: "rename"; chat: Chat }
  | { kind: "share"; chat: Chat }
  | { kind: "tag"; chat: Chat }
  | null;

interface WorkspaceNavDialogsProps {
  dialog: WorkspaceNavDialog;
  folders: Array<{ id: string; name: string }>;
  onClose: () => void;
  onRenameChat: (chatId: string, title: string) => void;
  tags: Array<{ id: string; name: string }>;
  workspaceId: string | undefined;
}

export function WorkspaceNavDialogs({
  dialog,
  folders,
  onClose,
  onRenameChat,
  tags,
  workspaceId,
}: WorkspaceNavDialogsProps) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [value, setValue] = useState("");
  const [shareTargetKey, setShareTargetKey] = useState("");
  const [shareCanWrite, setShareCanWrite] = useState(false);
  const sharingChat = dialog?.kind === "share" ? dialog.chat : null;
  const createFolderMutation = useMutation({ mutationFn: createFolder });
  const addFolderItemMutation = useMutation({ mutationFn: addFolderItem });
  const assignTagMutation = useMutation({ mutationFn: assignChatTag });
  const shareChatMutation = useMutation({ mutationFn: shareChatAccess });
  const revokeChatShareMutation = useMutation({ mutationFn: revokeChatShare });
  const shareTargetsQuery = useQuery({
    queryKey: ["shareTargets", sharingChat?.id],
    queryFn: () => listShareTargets(),
    enabled: sharingChat !== null,
  });
  const chatSharesQuery = useQuery({
    queryKey: ["chatShares", sharingChat?.id],
    queryFn: () => listChatShares(sharingChat!.id),
    enabled: sharingChat !== null,
  });

  useEffect(() => {
    setValue(
      dialog?.kind === "rename"
        ? dialog.chat.title
        : dialog?.kind === "move"
          ? dialog.initialFolderId
          : "",
    );
    setShareTargetKey("");
    setShareCanWrite(false);
  }, [dialog]);

  return (
    <>
      <FormDialog
        onClose={onClose}
        open={dialog?.kind === "rename"}
        title={t("renameChat")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog?.kind !== "rename" || value.trim().length === 0) return;
            onRenameChat(dialog.chat.id, value.trim());
            onClose();
          }}
        >
          <label className="grid gap-1 text-sm" htmlFor="rename-chat-title">
            <span className="text-muted">{t("title")}</span>
            <Input
              name="rename-chat-title"
              autoFocus
              id="rename-chat-title"
              onChange={(event) => setValue(event.currentTarget.value)}
              value={value}
            />
          </label>
          <Button variant="primary" type="submit">
            {t("rename")}
          </Button>
        </form>
      </FormDialog>

      <FormDialog
        onClose={onClose}
        open={dialog?.kind === "create-folder"}
        title={t("createChatFolder")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (workspaceId === undefined || value.trim().length === 0) return;
            void createFolderMutation
              .mutateAsync({ workspaceId, name: value.trim() })
              .then(async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["folders", workspaceId],
                });
                onClose();
              });
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("name")}</span>
            <Input
              name="value"
              autoFocus
              onChange={(event) => setValue(event.currentTarget.value)}
              value={value}
            />
          </label>
          <Button variant="primary" type="submit">
            {t("createFolder")}
          </Button>
        </form>
      </FormDialog>

      <FormDialog
        onClose={onClose}
        open={dialog?.kind === "move"}
        title={t("addToFolder")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog?.kind !== "move" || value.length === 0) return;
            void addFolderItemMutation
              .mutateAsync({
                folderId: value,
                resourceType: "chat",
                resourceId: dialog.chat.id,
              })
              .then(async () => {
                await queryClient.invalidateQueries({
                  queryKey: ["folderItems"],
                });
                onClose();
              });
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("folder")}</span>
            <NativeSelect
              name="value"
              onChange={(event) => setValue(event.currentTarget.value)}
              value={value}
            >
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <Button variant="primary" type="submit">
            {t("addToFolder")}
          </Button>
        </form>
      </FormDialog>

      <ShareDialog
        canWrite={shareCanWrite}
        chat={sharingChat}
        isPending={shareChatMutation.isPending}
        onCanWriteChange={setShareCanWrite}
        onClose={onClose}
        onRevoke={async (grantId) => {
          if (sharingChat === null) return;
          if (
            !(await ask({
              title: `${t("revoke")} ${t("currentAccess")}?`,
              confirmLabel: t("revoke"),
              tone: "danger",
            }))
          )
            return;
          await revokeChatShareMutation.mutateAsync({
            chatId: sharingChat.id,
            grantId,
          });
          await chatSharesQuery.refetch();
        }}
        onSubmit={(targetKey) => {
          if (sharingChat === null) return;
          const target = (shareTargetsQuery.data ?? []).find(
            (item) => `${item.principalType}:${item.principalId}` === targetKey,
          );
          if (target === undefined) return;
          void shareChatMutation
            .mutateAsync({
              chatId: sharingChat.id,
              principalType: target.principalType,
              principalId: target.principalId,
              permissions: shareCanWrite ? ["read", "write"] : ["read"],
            })
            .then(async () => {
              await chatSharesQuery.refetch();
              setShareTargetKey("");
            });
        }}
        revokeError={revokeChatShareMutation.isError}
        revokePending={revokeChatShareMutation.isPending}
        shareError={shareChatMutation.isError}
        shares={chatSharesQuery.data ?? []}
        sharesLoaded={chatSharesQuery.isSuccess}
        targetKey={shareTargetKey}
        targets={shareTargetsQuery.data ?? []}
        targetsLoaded={shareTargetsQuery.isSuccess}
        onTargetKeyChange={setShareTargetKey}
      />
      {confirmDialog}

      <FormDialog
        onClose={onClose}
        open={dialog?.kind === "tag"}
        title={t("tagChat")}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog?.kind !== "tag" || value.trim().length === 0) return;
            void assignTagMutation
              .mutateAsync({ chatId: dialog.chat.id, name: value.trim() })
              .then(async () => {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["chatTags"] }),
                  queryClient.invalidateQueries({ queryKey: ["chatsByTag"] }),
                ]);
                onClose();
              });
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="text-muted">{t("tag")}</span>
            <Input
              name="value"
              autoFocus
              list="rm-chat-tag-options"
              onChange={(event) => setValue(event.currentTarget.value)}
              placeholder={t("projectOrTopic")}
              value={value}
            />
            <datalist id="rm-chat-tag-options">
              {tags.map((tag) => (
                <option key={tag.id} value={tag.name} />
              ))}
            </datalist>
          </label>
          <Button variant="primary" type="submit">
            {t("addTag")}
          </Button>
        </form>
      </FormDialog>
    </>
  );
}

interface ShareDialogProps {
  canWrite: boolean;
  chat: Chat | null;
  isPending: boolean;
  onCanWriteChange: (value: boolean) => void;
  onClose: () => void;
  onRevoke: (grantId: string) => void;
  onSubmit: (targetKey: string) => void;
  onTargetKeyChange: (value: string) => void;
  revokeError: boolean;
  revokePending: boolean;
  shareError: boolean;
  shares: Array<{ id: string; permission: string; principalId: string }>;
  sharesLoaded: boolean;
  targetKey: string;
  targets: Array<{
    label: string;
    principalId: string;
    principalType: "group" | "service_account" | "user";
  }>;
  targetsLoaded: boolean;
}

function ShareDialog(props: ShareDialogProps) {
  const { t } = useLocale();
  return (
    <FormDialog
      onClose={props.onClose}
      open={props.chat !== null}
      title={t("shareChat")}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.targetKey.length > 0) props.onSubmit(props.targetKey);
        }}
      >
        <label className="grid gap-1 text-sm" htmlFor="share-chat-target">
          <span className="text-muted">{t("personOrGroup")}</span>
          <NativeSelect
            name="share-chat-target"
            id="share-chat-target"
            onChange={(event) =>
              props.onTargetKeyChange(event.currentTarget.value)
            }
            required
            value={props.targetKey}
          >
            <option value="">{t("selectShareTarget")}</option>
            {props.targets.map((target) => (
              <option
                key={`${target.principalType}:${target.principalId}`}
                value={`${target.principalType}:${target.principalId}`}
              >
                {target.label} · {target.principalType}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Checkbox
          checked={props.canWrite}
          label={t("allowEdits")}
          onCheckedChange={(checked) =>
            props.onCanWriteChange(checked === true)
          }
        />
        {props.targetsLoaded && props.targets.length === 0 ? (
          <p className="text-sm text-muted">{t("noEligibleShares")}</p>
        ) : null}
        {props.shareError ? (
          <p className="text-sm text-danger">{t("shareFailed")}</p>
        ) : null}
        <Button
          variant="primary"
          disabled={props.targetKey.length === 0 || props.isPending}
          type="submit"
        >
          {props.isPending ? t("sharing") : t("share")}
        </Button>
        <div className="grid gap-2 border-t border-border pt-3">
          <strong className="text-sm">{t("currentAccess")}</strong>
          {props.shares.map((grant) => (
            <div className="rm-list-row" key={grant.id}>
              <span className="min-w-0 flex-1 truncate text-sm">
                {grant.principalId} · {grant.permission}
              </span>
              <Button
                variant="danger"
                disabled={props.revokePending}
                onClick={() => props.onRevoke(grant.id)}
                type="button"
              >
                {t("revoke")}
              </Button>
            </div>
          ))}
          {props.sharesLoaded && props.shares.length === 0 ? (
            <p className="text-sm text-muted">{t("noAccessGrants")}</p>
          ) : null}
          {props.revokeError ? (
            <p className="text-sm text-danger">{t("revokeFailed")}</p>
          ) : null}
        </div>
      </form>
    </FormDialog>
  );
}
