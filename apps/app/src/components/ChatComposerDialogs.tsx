import { Button, Input, NativeSelect, Textarea } from "@romeo/ui";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { BaseModel, Provider } from "../features/types";
import { listPromptTemplatesPage } from "../features/prompts";
import {
  listFilesPage,
  retryFileExtraction,
  type FileObject,
} from "../features/files";
import { listWorkspaceContentPage } from "../features/workspace-content";
import { ingestWebUrls } from "../features/web";
import { formatBytes } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { CatalogPager } from "./CatalogPager";
import {
  fileExtractionLabel,
  listImageGenerationModels,
  materializePrompt,
} from "./chat-composer-utils";
import { FormDialog } from "./FormDialog";

type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface ChatComposerDialogState {
  fileLibraryOpen: boolean;
  imageDialogOpen: boolean;
  noteLibraryOpen: boolean;
  promptLibraryOpen: boolean;
  setFileLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setImageDialogOpen: Dispatch<SetStateAction<boolean>>;
  setNoteLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setPromptLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setUrlDialogOpen: Dispatch<SetStateAction<boolean>>;
  urlDialogOpen: boolean;
}

interface ChatComposerDialogsProps extends ChatComposerDialogState {
  draft: string;
  models: BaseModel[];
  onAddUrl: (url: string) => void;
  onAttachExistingFile: (file: FileObject) => void;
  onDraftChange: (value: string) => void;
  onGenerateImages: (input: {
    modelId: string;
    prompt: string;
    size: ImageSize;
  }) => void;
  providers: Provider[];
  selectedModelId: string | undefined;
  workspaceId: string | undefined;
}

export function ChatComposerDialogs(props: ChatComposerDialogsProps) {
  const { locale, t } = useLocale();
  const queryClient = useQueryClient();
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

  const promptsQuery = useQuery({
    queryKey: [
      "promptTemplates",
      props.workspaceId,
      promptQuery.trim(),
      promptPage,
    ],
    queryFn: () =>
      listPromptTemplatesPage({
        workspaceId: props.workspaceId!,
        limit: 20,
        offset: promptPage * 20,
        ...(promptQuery.trim() === "" ? {} : { query: promptQuery }),
      }),
    enabled: props.workspaceId !== undefined && props.promptLibraryOpen,
  });
  const filesQuery = useQuery({
    queryKey: ["files", props.workspaceId, fileQuery.trim(), filePage],
    queryFn: () =>
      listFilesPage(props.workspaceId!, {
        limit: 20,
        offset: filePage * 20,
        query: fileQuery,
      }),
    enabled: props.workspaceId !== undefined && props.fileLibraryOpen,
  });
  const notesQuery = useQuery({
    queryKey: ["notes", props.workspaceId, noteQuery.trim(), notePage],
    queryFn: () =>
      listWorkspaceContentPage("notes", props.workspaceId!, {
        limit: 20,
        offset: notePage * 20,
        query: noteQuery,
      }),
    enabled: props.workspaceId !== undefined && props.noteLibraryOpen,
  });
  const retryExtraction = useMutation({
    mutationFn: retryFileExtraction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["files", props.workspaceId],
      });
    },
  });
  const ingestUrl = useMutation({
    mutationFn: async (url: string) => {
      if (saveUrlToLibrary && props.workspaceId !== undefined) {
        await ingestWebUrls({
          urls: [url],
          workspaceId: props.workspaceId,
          saveToLibrary: true,
        });
        await queryClient.invalidateQueries({
          queryKey: ["files", props.workspaceId],
        });
      }
      props.onAddUrl(url);
    },
  });
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
        {filesQuery.data?.items.map((file) => (
          <div className="rm-list-row flex items-center gap-2" key={file.id}>
            <Button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                props.onAttachExistingFile(file);
                props.setFileLibraryOpen(false);
              }}
              type="button"
            >
              <span>
                <strong>{file.fileName}</strong>
                <small className="block text-muted">
                  {file.mimeType} · {formatBytes(file.sizeBytes, locale)} ·{" "}
                  {fileExtractionLabel(file)}
                </small>
              </span>
            </Button>
            {file.extraction.status === "failed" ? (
              <Button
                aria-label={`${t("retry")} ${file.fileName}`}
                disabled={retryExtraction.isPending}
                onClick={() => retryExtraction.mutate(file.id)}
                type="button"
              >
                {t("retry")}
              </Button>
            ) : null}
          </div>
        ))}
        <CatalogPager
          onPageChange={setFilePage}
          page={filePage}
          pageSize={20}
          total={filesQuery.data?.total ?? 0}
        />
        {retryExtraction.isError ? (
          <p aria-live="polite" className="rm-composer-error">
            {retryExtraction.error.message}
          </p>
        ) : null}
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
        open={props.urlDialogOpen}
        title={t("attachWebpage")}
        onClose={() => props.setUrlDialogOpen(false)}
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            ingestUrl.mutate(urlValue, {
              onSuccess: () => {
                setUrlValue("");
                props.setUrlDialogOpen(false);
              },
            });
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
              {ingestUrl.error.message}
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

function CatalogSearch(props: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="rm-model-search">
      <Search aria-hidden="true" size={15} />
      <Input
        aria-label={props.label}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        placeholder={props.label}
        type="search"
        value={props.value}
      />
    </label>
  );
}

function EmptyCatalog(props: {
  filtered: boolean;
  filteredLabel: string;
  label: string;
}) {
  return (
    <p className="text-sm text-muted">
      {props.filtered ? props.filteredLabel : props.label}
    </p>
  );
}
