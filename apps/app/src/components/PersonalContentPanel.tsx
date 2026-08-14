import { Input, Textarea, NativeSelect, Button } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Search from "lucide-react/dist/esm/icons/search.mjs";

import {
  deleteWorkspaceContentMutationOptions,
  saveWorkspaceContentMutationOptions,
  workspaceContentPageQueryOptions,
  type ContentKind,
  type WorkspaceContentItem,
} from "../features/workspace-content";
import { toast } from "../lib/toast";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { useLocale } from "../lib/i18n";
import { AddButton, Section } from "./console";
import { CatalogPager } from "./CatalogPager";
import { useConfirm } from "./ConfirmDialog";
import { FormDialog } from "./FormDialog";
import { PersonalContentTable } from "./PersonalContentTable";
import { useWorkspace } from "./WorkspaceContext";

export function PersonalContentPanel({ kind }: { kind: ContentKind }) {
  const pageSize = 25;
  const { t } = useLocale();
  const { workspaceId } = useWorkspace();
  const { ask, dialog } = useConfirm();
  const [editing, setEditing] = useState<WorkspaceContentItem | "new" | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [scope, setScope] = useState<"personal" | "workspace">("personal");
  const [enabled, setEnabled] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [page, setPage] = useState(0);
  const [saveError, setSaveError] = useState<string>();
  const contentQuery = useQuery(
    workspaceContentPageQueryOptions({
      enabled: true,
      kind,
      page,
      pageSize,
      query: catalogQuery,
      workspaceId,
    }),
  );
  const catalog = {
    items: contentQuery.data?.items ?? [],
    page,
    total: contentQuery.data?.total ?? 0,
  };
  const save = useMutation(saveWorkspaceContentMutationOptions());
  const deleteMutation = useMutation(deleteWorkspaceContentMutationOptions());
  const label = kind === "memories" ? t("memory") : t("note");

  async function handleSave() {
    setSaveError(undefined);
    try {
      if (workspaceId === undefined)
        throw new Error(t("settingsNoWorkspaceSelected"));
      await save.mutateAsync(
        editing === "new"
          ? {
              operation: "create",
              kind,
              workspaceId,
              input: {
                workspaceId,
                title,
                body,
                scope,
                enabled,
                pinned,
                ...(expiresAt === ""
                  ? {}
                  : { expiresAt: new Date(expiresAt).toISOString() }),
              },
            }
          : {
              operation: "update",
              kind,
              workspaceId,
              contentId: editing!.id,
              input: {
                title,
                body,
                scope,
                enabled,
                pinned,
                expiresAt:
                  expiresAt === "" ? null : new Date(expiresAt).toISOString(),
              },
            },
      );
      closeEditor();
      toast(`${label} ${t("saved")}`, "success");
    } catch (caught) {
      const message = safeUserErrorMessage(caught, `${label} ${t("failed")}`);
      setSaveError(message);
      toast(message, "error");
    } finally {
      save.reset();
    }
  }

  function closeEditor() {
    setEditing(null);
    setTitle("");
    setBody("");
    setExpiresAt("");
  }

  function open(item: WorkspaceContentItem | "new") {
    setSaveError(undefined);
    setEditing(item);
    setTitle(item === "new" ? "" : item.title);
    setBody(item === "new" ? "" : item.body);
    setScope(item === "new" ? "personal" : item.scope);
    setEnabled(item === "new" ? true : item.enabled);
    setPinned(item === "new" ? false : item.pinned);
    setExpiresAt(
      item === "new" || item.expiresAt === undefined
        ? ""
        : toLocalDateTime(item.expiresAt),
    );
  }

  async function patch(
    item: WorkspaceContentItem,
    update: { enabled?: boolean; pinned?: boolean },
  ) {
    if (workspaceId === undefined) return;
    try {
      await save.mutateAsync({
        operation: "update",
        kind,
        workspaceId,
        contentId: item.id,
        input: update,
      });
    } catch (caught) {
      toast(safeUserErrorMessage(caught, `${label} ${t("failed")}`), "error");
    } finally {
      save.reset();
    }
  }

  async function remove(item: WorkspaceContentItem) {
    if (
      !(await ask({
        title: `${t("delete")} ${label}?`,
        confirmLabel: t("delete"),
        tone: "danger",
      }))
    )
      return;
    try {
      if (workspaceId === undefined) return;
      await deleteMutation.mutateAsync({
        kind,
        workspaceId,
        contentId: item.id,
      });
    } catch (caught) {
      toast(safeUserErrorMessage(caught, `${label} ${t("failed")}`), "error");
    } finally {
      deleteMutation.reset();
    }
  }

  return (
    <Section
      actions={
        <AddButton onClick={() => open("new")}>
          {kind === "memories" ? t("addMemory") : t("addNote")}
        </AddButton>
      }
      description={
        kind === "memories"
          ? t("memoryLibraryDescription")
          : t("noteLibraryDescription")
      }
      title={label}
    >
      <label
        className="rm-model-search mt-4"
        htmlFor={`${kind}-catalog-search`}
      >
        <Search aria-hidden="true" size={15} />
        <Input
          aria-label={
            kind === "memories" ? t("searchMemories") : t("searchNotes")
          }
          id={`${kind}-catalog-search`}
          onChange={(event) => {
            setCatalogQuery(event.currentTarget.value);
            setPage(0);
          }}
          placeholder={
            kind === "memories" ? t("searchMemories") : t("searchNotes")
          }
          type="search"
          value={catalogQuery}
        />
      </label>
      <div className="mt-4 grid gap-2">
        <PersonalContentTable
          items={catalog.items}
          kind={kind}
          onEdit={open}
          onPatch={patch}
          onRemove={remove}
        />
        {contentQuery.isLoading ? <p>{t("loading")}</p> : null}
        {!contentQuery.isLoading && catalog.total === 0 ? (
          <p className="text-sm text-muted">
            {catalogQuery.trim()
              ? kind === "memories"
                ? t("noMatchingMemories")
                : t("noMatchingNotes")
              : kind === "memories"
                ? t("noMemories")
                : t("noNotes")}
          </p>
        ) : null}
      </div>
      <CatalogPager
        onPageChange={setPage}
        page={catalog.page}
        pageSize={pageSize}
        total={catalog.total}
      />
      <FormDialog
        open={editing !== null}
        title={
          editing === "new"
            ? kind === "memories"
              ? t("newMemory")
              : t("newNote")
            : kind === "memories"
              ? t("editMemory")
              : t("editNote")
        }
        onClose={closeEditor}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <label className="rm-field-name" htmlFor="content-title">
            {t("title")}
          </label>
          <Input
            name="content-title"
            id="content-title"
            maxLength={160}
            onChange={(event) => setTitle(event.currentTarget.value)}
            required
            value={title}
          />
          <label className="rm-field-name" htmlFor="content-scope">
            {t("visibility")}
          </label>
          <NativeSelect
            name="content-scope"
            id="content-scope"
            onChange={(event) =>
              setScope(event.currentTarget.value as typeof scope)
            }
            value={scope}
          >
            <option value="personal">{t("onlyMe")}</option>
            <option value="workspace">{t("workspace")}</option>
          </NativeSelect>
          <label className="rm-field-name" htmlFor="content-body">
            {t("content")}
          </label>
          <Textarea
            name="content-body"
            id="content-body"
            maxLength={250_000}
            onChange={(event) => setBody(event.currentTarget.value)}
            required
            rows={10}
            value={body}
          />
          <label className="flex items-center gap-2 text-sm">
            <Input
              name="enabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
              type="checkbox"
            />
            {t("enabled")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Input
              name="pinned"
              checked={pinned}
              onChange={(event) => setPinned(event.currentTarget.checked)}
              type="checkbox"
            />
            {t("pinned")}
          </label>
          <label className="rm-field-name" htmlFor="content-expiry">
            {t("expiryOptional")}
          </label>
          <Input
            name="content-expiry"
            id="content-expiry"
            min={toLocalDateTime(new Date().toISOString())}
            onChange={(event) => setExpiresAt(event.currentTarget.value)}
            type="datetime-local"
            value={expiresAt}
          />
          {saveError ? (
            <div className="rm-composer-error" role="alert">
              {saveError}
            </div>
          ) : null}
          <Button variant="primary" disabled={save.isPending} type="submit">
            {t("save")}
          </Button>
        </form>
      </FormDialog>
      {dialog}
    </Section>
  );
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
