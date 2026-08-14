import { Button, Input, NativeSelect } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  addFolderItemMutationOptions,
  assignChatTagMutationOptions,
  createFolderMutationOptions,
  revokeChatShareMutationOptions,
  shareChatAccessMutationOptions,
  updateFolderMutationOptions,
} from "../features/collaboration/mutation-options";
import {
  chatSharesQueryOptions,
  shareTargetsQueryOptions,
} from "../features/collaboration";
import type { Chat } from "../features/types";
import { useLocale } from "../lib/i18n";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { toast } from "../lib/toast";
import { useConfirm } from "./ConfirmDialog";
import { FormDialog } from "./FormDialog";
import { ShareDialog } from "./WorkspaceShareDialog";

export type WorkspaceNavDialog =
  | { kind: "create-folder" }
  | { kind: "move"; chat: Chat; initialFolderId: string }
  | { kind: "rename"; chat: Chat }
  | { kind: "rename-folder"; folder: { id: string; name: string } }
  | { kind: "share"; chat: Chat }
  | { kind: "tag"; chat: Chat }
  | null;

interface WorkspaceNavDialogsProps {
  dialog: WorkspaceNavDialog;
  folders: Array<{ id: string; name: string }>;
  onClose: () => void;
  onFolderCreated?: (folderId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  tags: Array<{ id: string; name: string }>;
  workspaceId: string | undefined;
}

export function WorkspaceNavDialogs({
  dialog,
  folders,
  onClose,
  onFolderCreated,
  onRenameChat,
  tags,
  workspaceId,
}: WorkspaceNavDialogsProps) {
  const { t } = useLocale();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [value, setValue] = useState("");
  const [formError, setFormError] = useState("");
  const [shareTargetKey, setShareTargetKey] = useState("");
  const [shareCanWrite, setShareCanWrite] = useState(false);
  const sharingChat = dialog?.kind === "share" ? dialog.chat : null;
  const createFolderMutation = useMutation(createFolderMutationOptions());
  const updateFolderMutation = useMutation(updateFolderMutationOptions());
  const addFolderItemMutation = useMutation(addFolderItemMutationOptions());
  const assignTagMutation = useMutation(assignChatTagMutationOptions());
  const shareChatMutation = useMutation(shareChatAccessMutationOptions());
  const revokeChatShareMutation = useMutation(revokeChatShareMutationOptions());
  const shareTargetsQuery = useQuery(
    shareTargetsQueryOptions(
      { resourceId: sharingChat?.id },
      "",
      sharingChat !== null,
    ),
  );
  const chatSharesQuery = useQuery(
    chatSharesQueryOptions(sharingChat?.id, undefined, sharingChat !== null),
  );

  useEffect(() => {
    setValue(
      dialog?.kind === "rename"
        ? dialog.chat.title
        : dialog?.kind === "rename-folder"
          ? dialog.folder.name
          : dialog?.kind === "move"
            ? dialog.initialFolderId
            : "",
    );
    setFormError("");
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
        className="rm-form-dialog--sm"
        description={t("renameFolderDescription")}
        onClose={onClose}
        open={dialog?.kind === "rename-folder"}
        title={t("renameFolder")}
      >
        <form
          className="rm-form-dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (dialog?.kind !== "rename-folder" || workspaceId === undefined)
              return;
            const name = value.trim();
            if (name.length === 0) {
              setFormError(t("folderNameRequired"));
              return;
            }
            setFormError("");
            void updateFolderMutation
              .mutateAsync({
                folderId: dialog.folder.id,
                name,
                workspaceId,
              })
              .then(() => {
                toast(t("folderRenamed"), "success");
                onClose();
              })
              .catch((error: unknown) => {
                const message = safeUserErrorMessage(
                  error,
                  t("folderRenameFailed"),
                );
                setFormError(message);
                toast(message, "error");
              });
          }}
        >
          <label className="rm-form-field" htmlFor="rename-folder-name">
            <span>{t("name")}</span>
            <Input
              autoFocus
              id="rename-folder-name"
              name="rename-folder-name"
              onChange={(event) => {
                setValue(event.currentTarget.value);
                if (formError.length > 0) setFormError("");
              }}
              value={value}
            />
          </label>
          {formError.length > 0 ? (
            <p className="rm-form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="rm-form-actions">
            <Button onClick={onClose} type="button" variant="ghost">
              {t("cancel")}
            </Button>
            <Button
              disabled={
                value.trim().length === 0 || updateFolderMutation.isPending
              }
              type="submit"
              variant="primary"
            >
              {updateFolderMutation.isPending
                ? t("renamingFolder")
                : t("rename")}
            </Button>
          </div>
        </form>
      </FormDialog>

      <FormDialog
        className="rm-form-dialog--sm"
        description={t("createChatFolderDescription")}
        onClose={onClose}
        open={dialog?.kind === "create-folder"}
        title={t("createChatFolder")}
      >
        <form
          className="rm-form-dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            const name = value.trim();
            if (name.length === 0) {
              setFormError(t("folderNameRequired"));
              return;
            }
            if (workspaceId === undefined) {
              setFormError(t("folderCreateFailed"));
              toast(t("folderCreateFailed"), "error");
              return;
            }
            setFormError("");
            void createFolderMutation
              .mutateAsync({ workspaceId, name })
              .then((folder) => {
                toast(t("folderCreated"), "success");
                onFolderCreated?.(folder.id);
                onClose();
              })
              .catch((error: unknown) => {
                const message = safeUserErrorMessage(
                  error,
                  t("folderCreateFailed"),
                );
                setFormError(message);
                toast(message, "error");
              });
          }}
        >
          <label className="rm-form-field" htmlFor="create-folder-name">
            <span>{t("name")}</span>
            <Input
              autoFocus
              id="create-folder-name"
              name="create-folder-name"
              onChange={(event) => {
                setValue(event.currentTarget.value);
                if (formError.length > 0) setFormError("");
              }}
              placeholder={t("folderNamePlaceholder")}
              value={value}
            />
          </label>
          {formError.length > 0 ? (
            <p className="rm-form-error" role="alert">
              {formError}
            </p>
          ) : (
            <p className="rm-form-hint">{t("createChatFolderHint")}</p>
          )}
          <div className="rm-form-actions">
            <Button onClick={onClose} type="button" variant="ghost">
              {t("cancel")}
            </Button>
            <Button
              disabled={
                value.trim().length === 0 || createFolderMutation.isPending
              }
              type="submit"
              variant="primary"
            >
              {createFolderMutation.isPending
                ? t("creatingFolder")
                : t("createFolder")}
            </Button>
          </div>
        </form>
      </FormDialog>

      <FormDialog
        className="rm-form-dialog--sm"
        description={t("addToFolderDescription")}
        onClose={onClose}
        open={dialog?.kind === "move"}
        title={t("addToFolder")}
      >
        <form
          className="rm-form-dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              dialog?.kind !== "move" ||
              value.length === 0 ||
              workspaceId === undefined
            )
              return;
            setFormError("");
            void addFolderItemMutation
              .mutateAsync({
                folderId: value,
                folderIds: folders.map((folder) => folder.id),
                resourceType: "chat",
                resourceId: dialog.chat.id,
                workspaceId,
              })
              .then(() => {
                toast(t("chatAddedToFolder"), "success");
                onClose();
              })
              .catch((error: unknown) => {
                const message = safeUserErrorMessage(
                  error,
                  t("chatAddToFolderFailed"),
                );
                setFormError(message);
                toast(message, "error");
              });
          }}
        >
          <label className="rm-form-field" htmlFor="move-chat-folder">
            <span>{t("folder")}</span>
            <NativeSelect
              id="move-chat-folder"
              name="move-chat-folder"
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
          {formError.length > 0 ? (
            <p className="rm-form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="rm-form-actions">
            <Button onClick={onClose} type="button" variant="ghost">
              {t("cancel")}
            </Button>
            <Button
              disabled={value.length === 0 || addFolderItemMutation.isPending}
              type="submit"
              variant="primary"
            >
              {addFolderItemMutation.isPending
                ? t("addingToFolder")
                : t("addToFolder")}
            </Button>
          </div>
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
            .then(() => {
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
              .then(() => {
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
                <option key={tag.id} label={tag.name} value={tag.name}>
                  {tag.name}
                </option>
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
