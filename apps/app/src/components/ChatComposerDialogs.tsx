import { Button, Input, NativeSelect, Textarea } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { promptTemplatePageQueryOptions } from "../features/prompts";
import { filesPageQueryOptions } from "../features/files";
import { knowledgeBasesQueryOptions } from "../features/knowledge";
import { workspaceContentPageQueryOptions } from "../features/workspace-content";
import { ingestWebUrlsMutationOptions } from "../features/web/mutation-options";
import { useLocale } from "../lib/i18n";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { CatalogPager } from "./CatalogPager";
import {
  listImageGenerationModels,
  materializePrompt,
} from "./chat-composer-utils";
import { FormDialog } from "./FormDialog";
import { CatalogSearch, EmptyCatalog } from "./CatalogSearch";
import { FileLibraryCatalog } from "./FileLibraryCatalog";
import type {
  ChatComposerDialogsProps,
  ImageSize,
} from "./chat-composer-dialog-types";

export type { ChatComposerDialogState } from "./chat-composer-dialog-types";

export function ChatComposerDialogs(props: ChatComposerDialogsProps) {
  const { t } = useLocale();
  const [promptQuery, setPromptQuery] = useState("");
  const [promptPage, setPromptPage] = useState(0);
  const [fileQuery, setFileQuery] = useState("");
  const [filePage, setFilePage] = useState(0);
  const [noteQuery, setNoteQuery] = useState("");
  const [notePage, setNotePage] = useState(0);
  const [urlValue, setUrlValue] = useState("");
  const [saveUrlToLibrary, setSaveUrlToLibrary] = useState(true);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageModelId, setImageModelId] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize>("1024x1024");
  const [draftKnowledgeIds, setDraftKnowledgeIds] = useState<string[]>([]);

  const promptsQuery = useQuery(
    promptTemplatePageQueryOptions({
      enabled: props.promptLibraryOpen,
      page: promptPage,
      pageSize: 20,
      query: promptQuery,
      workspaceId: props.workspaceId,
    }),
  );
  const filesQuery = useQuery(
    filesPageQueryOptions({
      enabled: props.fileLibraryOpen,
      page: filePage,
      pageSize: 20,
      query: fileQuery,
      workspaceId: props.workspaceId,
    }),
  );
  const notesQuery = useQuery(
    workspaceContentPageQueryOptions({
      enabled: props.noteLibraryOpen,
      kind: "notes",
      page: notePage,
      pageSize: 20,
      query: noteQuery,
      workspaceId: props.workspaceId,
    }),
  );
  const knowledgeBasesQuery = useQuery(
    knowledgeBasesQueryOptions(props.workspaceId, props.knowledgeLibraryOpen),
  );
  useEffect(() => {
    if (!props.knowledgeLibraryOpen) return;
    setDraftKnowledgeIds(props.knowledgeBaseIdsOverride ?? []);
  }, [props.knowledgeBaseIdsOverride, props.knowledgeLibraryOpen]);
  const ingestUrl = useMutation(ingestWebUrlsMutationOptions());
  const imageModels = useMemo(
    () => listImageGenerationModels(props.models, props.providers),
    [props.models, props.providers],
  );
  useEffect(() => {
    if (imageModels.some((model) => model.id === imageModelId)) return;
    setImageModelId(
      imageModels.find((model) => model.id === props.selectedModelId)?.id ??
        imageModels[0]?.id ??
        "",
    );
  }, [imageModelId, imageModels, props.selectedModelId]);

  return (
    <>
      <FormDialog
        open={props.promptLibraryOpen}
        title={t("promptLibrary")}
        onClose={() => props.setPromptLibraryOpen(false)}
      >
        <CatalogSearch
          label={t("searchPromptLibrary")}
          onChange={(value) => {
            setPromptQuery(value);
            setPromptPage(0);
          }}
          value={promptQuery}
        />
        {promptsQuery.isSuccess && promptsQuery.data.total === 0 ? (
          <EmptyCatalog
            filtered={promptQuery.trim() !== ""}
            filteredLabel={t("noMatchingPrompts")}
            label={t("noPrompts")}
          />
        ) : null}
        {promptsQuery.data?.items.map((prompt) => (
          <Button
            className="rm-list-row text-left"
            key={prompt.id}
            onClick={() => {
              props.onDraftChange(materializePrompt(prompt.body));
              props.setPromptLibraryOpen(false);
            }}
            type="button"
          >
            <span>
              <strong>{prompt.name}</strong>
              <small className="block text-muted">
                {prompt.description ?? prompt.body.slice(0, 120)}
              </small>
            </span>
          </Button>
        ))}
        <CatalogPager
          onPageChange={setPromptPage}
          page={promptPage}
          pageSize={20}
          total={promptsQuery.data?.total ?? 0}
        />
      </FormDialog>

      <FormDialog
        open={props.fileLibraryOpen}
        title={t("fileLibrary")}
        onClose={() => props.setFileLibraryOpen(false)}
      >
        <CatalogSearch
          label={t("searchReusableFiles")}
          onChange={(value) => {
            setFileQuery(value);
            setFilePage(0);
          }}
          value={fileQuery}
        />
        {filesQuery.isSuccess && filesQuery.data.total === 0 ? (
          <EmptyCatalog
            filtered={fileQuery.trim() !== ""}
            filteredLabel={t("noMatchingReusableFiles")}
            label={t("noReusableFiles")}
          />
        ) : null}
        <FileLibraryCatalog
          files={filesQuery.data?.items ?? []}
          onAttach={props.onAttachExistingFile}
          onClose={() => props.setFileLibraryOpen(false)}
          workspaceId={props.workspaceId}
        />
        <CatalogPager
          onPageChange={setFilePage}
          page={filePage}
          pageSize={20}
          total={filesQuery.data?.total ?? 0}
        />
      </FormDialog>

      <FormDialog
        open={props.noteLibraryOpen}
        title={t("insertNote")}
        onClose={() => props.setNoteLibraryOpen(false)}
      >
        <CatalogSearch
          label={t("searchNotes")}
          onChange={(value) => {
            setNoteQuery(value);
            setNotePage(0);
          }}
          value={noteQuery}
        />
        {notesQuery.isSuccess && notesQuery.data.total === 0 ? (
          <EmptyCatalog
            filtered={noteQuery.trim() !== ""}
            filteredLabel={t("noMatchingNotes")}
            label={t("noNotesAvailable")}
          />
        ) : null}
        {notesQuery.data?.items.map((note) => (
          <Button
            className="rm-list-row text-left"
            key={note.id}
            onClick={() => {
              props.onDraftChange(
                `${props.draft}${props.draft.trim() ? "\n\n" : ""}${note.body}`,
              );
              props.setNoteLibraryOpen(false);
            }}
            type="button"
          >
            <span>
              <strong>{note.title}</strong>
              <small className="block text-muted">
                {note.scope} · {note.body.slice(0, 120)}
              </small>
            </span>
          </Button>
        ))}
        <CatalogPager
          onPageChange={setNotePage}
          page={notePage}
          pageSize={20}
          total={notesQuery.data?.total ?? 0}
        />
      </FormDialog>

      <FormDialog
        open={props.knowledgeLibraryOpen}
        title={t("composerKnowledgePicker")}
        onClose={() => props.setKnowledgeLibraryOpen(false)}
      >
        <p className="text-sm text-muted">{t("composerKnowledgePickerHelp")}</p>
        {knowledgeBasesQuery.isSuccess &&
        knowledgeBasesQuery.data.length === 0 ? (
          <p className="text-sm text-muted">{t("knowledgeNoBases")}</p>
        ) : null}
        <div className="grid gap-2">
          {(knowledgeBasesQuery.data ?? []).map((base) => {
            const checked = draftKnowledgeIds.includes(base.id);
            return (
              <label
                className="flex items-start gap-2 text-sm"
                htmlFor={`composer-kb-${base.id}`}
                key={base.id}
              >
                <Input
                  checked={checked}
                  id={`composer-kb-${base.id}`}
                  name={`composer-kb-${base.id}`}
                  onChange={() => {
                    setDraftKnowledgeIds((current) =>
                      checked
                        ? current.filter((id) => id !== base.id)
                        : [...current, base.id],
                    );
                  }}
                  type="checkbox"
                />
                <span>
                  <strong className="block">{base.name}</strong>
                  {base.description ? (
                    <small className="block text-muted">
                      {base.description}
                    </small>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              props.onKnowledgeBaseIdsChange(undefined);
              props.setKnowledgeLibraryOpen(false);
            }}
            type="button"
            variant="ghost"
          >
            {t("composerKnowledgeUseDefaults")}
          </Button>
          <Button
            onClick={() => {
              props.onKnowledgeBaseIdsChange([]);
              props.setKnowledgeLibraryOpen(false);
            }}
            type="button"
            variant="ghost"
          >
            {t("composerKnowledgeNone")}
          </Button>
          <Button
            onClick={() => {
              props.onKnowledgeBaseIdsChange(draftKnowledgeIds);
              props.setKnowledgeLibraryOpen(false);
            }}
            type="button"
            variant="primary"
          >
            {t("composerKnowledgeApply")}
          </Button>
        </div>
      </FormDialog>

      <FormDialog
        open={props.urlDialogOpen}
        title={t("attachWebpage")}
        onClose={() => props.setUrlDialogOpen(false)}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!saveUrlToLibrary || props.workspaceId === undefined) {
              props.onAddUrl(urlValue);
              setUrlValue("");
              props.setUrlDialogOpen(false);
              return;
            }
            ingestUrl.mutate(
              {
                saveToLibrary: true,
                urls: [urlValue],
                workspaceId: props.workspaceId,
              },
              {
                onSuccess: (_result, variables) => {
                  props.onAddUrl(variables.urls[0] ?? "");
                  ingestUrl.reset();
                  setUrlValue("");
                  props.setUrlDialogOpen(false);
                },
              },
            );
          }}
        >
          <label htmlFor="webpage-url">{t("httpUrl")}</label>
          <Input
            autoComplete="off"
            id="webpage-url"
            name="webpage-url"
            onChange={(event) => setUrlValue(event.currentTarget.value)}
            placeholder="https://example.com/page…"
            required
            type="url"
            value={urlValue}
          />
          <label className="flex items-center gap-2 text-sm">
            <Input
              checked={saveUrlToLibrary}
              name="save-url-to-library"
              onChange={(event) =>
                setSaveUrlToLibrary(event.currentTarget.checked)
              }
              type="checkbox"
            />
            {t("saveReusableSource")}
          </label>
          {ingestUrl.isError ? (
            <p aria-live="polite" className="rm-composer-error">
              {safeUserErrorMessage(
                ingestUrl.error,
                t("unexpectedAsyncFailure"),
              )}
            </p>
          ) : null}
          <Button
            variant="primary"
            disabled={ingestUrl.isPending}
            type="submit"
          >
            {ingestUrl.isPending ? t("fetching") : t("attachUrl")}
          </Button>
        </form>
      </FormDialog>

      <FormDialog
        open={props.imageDialogOpen}
        title={t("generateImage")}
        onClose={() => props.setImageDialogOpen(false)}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (imageModelId === "") return;
            props.onGenerateImages({
              modelId: imageModelId,
              prompt: imagePrompt,
              size: imageSize,
            });
            props.setImageDialogOpen(false);
          }}
        >
          <label htmlFor="image-model">{t("imageModel")}</label>
          <NativeSelect
            name="image-model"
            id="image-model"
            onChange={(event) => setImageModelId(event.currentTarget.value)}
            required
            value={imageModelId}
          >
            {imageModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </NativeSelect>
          <label htmlFor="image-prompt">{t("imagePrompt")}</label>
          <Textarea
            name="image-prompt"
            id="image-prompt"
            onChange={(event) => setImagePrompt(event.currentTarget.value)}
            required
            rows={5}
            value={imagePrompt}
          />
          <label htmlFor="image-size">{t("imageSize")}</label>
          <NativeSelect
            name="image-size"
            id="image-size"
            onChange={(event) =>
              setImageSize(event.currentTarget.value as ImageSize)
            }
            value={imageSize}
          >
            <option value="1024x1024">{t("square")}</option>
            <option value="1024x1536">{t("portrait")}</option>
            <option value="1536x1024">{t("landscape")}</option>
          </NativeSelect>
          <Button
            variant="primary"
            disabled={imageModelId === ""}
            type="submit"
          >
            {t("generateAndAttach")}
          </Button>
        </form>
      </FormDialog>
    </>
  );
}
