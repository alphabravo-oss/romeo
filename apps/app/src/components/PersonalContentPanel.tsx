import { Input, Textarea, NativeSelect, Button } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Search from "lucide-react/dist/esm/icons/search.mjs";

import {
  createWorkspaceContent,
  deleteWorkspaceContent,
  listWorkspaceContentPage,
  updateWorkspaceContent,
  type ContentKind,
  type WorkspaceContentItem,
} from "../features/workspace-content";
import { toast } from "../lib/toast";
import { LocalizedDateTime } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { CatalogPager } from "./CatalogPager";
import { useConfirm } from "./ConfirmDialog";
import { FormDialog } from "./FormDialog";
import { useWorkspace } from "./WorkspaceContext";

export function PersonalContentPanel({ kind }: { kind: ContentKind }) {
  const pageSize = 25;
  const { t } = useLocale();
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
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
  const contentQuery = useQuery({
    queryKey: [kind, workspaceId, catalogQuery.trim(), page],
    queryFn: () =>
      listWorkspaceContentPage(kind, workspaceId!, {
        limit: pageSize,
        offset: page * pageSize,
        query: catalogQuery,
      }),
    enabled: workspaceId !== undefined,
  });
  const catalog = {
    items: contentQuery.data?.items ?? [],
    page,
    total: contentQuery.data?.total ?? 0,
  };
  const save = useMutation({
    mutationFn: async () => {
      if (workspaceId === undefined) throw new Error(t("noWorkspaceSelected"));
      return editing === "new"
        ? createWorkspaceContent(kind, {
            workspaceId,
            title,
            body,
            scope,
            enabled,
            pinned,
            ...(expiresAt === ""
              ? {}
              : { expiresAt: new Date(expiresAt).toISOString() }),
          })
        : updateWorkspaceContent(kind, editing!.id, {
            title,
            body,
            scope,
            enabled,
            pinned,
            expiresAt:
              expiresAt === "" ? null : new Date(expiresAt).toISOString(),
          });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [kind, workspaceId] });
      setEditing(null);
      toast(
        `${kind === "memories" ? t("memory") : t("note")} ${t("saved")}`,
        "success",
      );
    },
  });

  function open(item: WorkspaceContentItem | "new") {
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
    await updateWorkspaceContent(kind, item.id, update);
    await queryClient.invalidateQueries({ queryKey: [kind, workspaceId] });
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
    await deleteWorkspaceContent(kind, item.id);
    await queryClient.invalidateQueries({ queryKey: [kind, workspaceId] });
  }

  const label = kind === "memories" ? t("memory") : t("note");
  return (
    <section className="rm-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="rm-card-title">{label}</div>
          <p className="text-sm text-muted">
            {kind === "memories"
              ? t("memoryLibraryDescription")
              : t("noteLibraryDescription")}
          </p>
        </div>
        <Button variant="primary" onClick={() => open("new")} type="button">
          {kind === "memories" ? t("addMemory") : t("addNote")}
        </Button>
      </div>
      <label className="rm-model-search mt-4">
        <Search aria-hidden="true" size={15} />
        <Input
          aria-label={
            kind === "memories" ? t("searchMemories") : t("searchNotes")
          }
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
        {catalog.items.map((item) => (
          <article className="rm-list-row" key={item.id}>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {item.title}
                {item.expired ? ` · ${t("expired")}` : ""}
              </div>
              <div className="truncate text-sm text-muted">{item.body}</div>
              <div className="text-xs text-muted">
                {item.scope === "personal" ? t("personal") : t("workspace")} ·{" "}
                {t("updated")} <LocalizedDateTime value={item.updatedAt} />
              </div>
            </div>
            {kind === "memories" ? (
              <>
                <label className="text-sm">
                  <Input
                    checked={item.enabled}
                    onChange={() =>
                      void patch(item, { enabled: !item.enabled })
                    }
                    type="checkbox"
                  />{" "}
                  {t("enabled")}
                </label>
                <Button
                  onClick={() => void patch(item, { pinned: !item.pinned })}
                  type="button"
                >
                  {item.pinned ? t("unpin") : t("pin")}
                </Button>
              </>
            ) : (
              <Button
                onClick={() => void patch(item, { pinned: !item.pinned })}
                type="button"
              >
                {item.pinned ? t("unpin") : t("pin")}
              </Button>
            )}
            <Button onClick={() => open(item)} type="button">
              {t("edit")}
            </Button>
            <Button
              variant="danger"
              onClick={() => void remove(item)}
              type="button"
            >
              {t("delete")}
            </Button>
          </article>
        ))}
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
        onClose={() => setEditing(null)}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save.mutateAsync();
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
          {save.error ? (
            <div className="rm-composer-error">{save.error.message}</div>
          ) : null}
          <Button variant="primary" disabled={save.isPending} type="submit">
            {t("save")}
          </Button>
        </form>
      </FormDialog>
      {dialog}
    </section>
  );
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
