import { Button, Input, Textarea } from "@romeo/ui";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.mjs";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import Globe2 from "lucide-react/dist/esm/icons/globe-2.mjs";
import Images from "lucide-react/dist/esm/icons/images.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen.mjs";
import Paperclip from "lucide-react/dist/esm/icons/paperclip.mjs";
import ScanSearch from "lucide-react/dist/esm/icons/scan-search.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Square from "lucide-react/dist/esm/icons/square.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import Zap from "lucide-react/dist/esm/icons/zap.mjs";
import { useQuery } from "@tanstack/react-query";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import type { BaseModel, Provider } from "../features/types";
import type { QueuedChatTurn } from "../features/runs";
import { listPromptTemplatesPage } from "../features/prompts";
import type { FileObject } from "../features/files";
import { useLocale } from "../lib/i18n";
import { ChatComposerDialogs } from "./ChatComposerDialogs";
import {
  listImageGenerationModels,
  materializePrompt,
} from "./chat-composer-utils";
import { ComposerModelSelect } from "./ComposerModelSelect";
import type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";
import { VoiceInputButton } from "./VoiceInputButton";

export function ChatComposer({
  attachedUrls,
  canInspectContext,
  canOverrideModel,
  documentAttachments,
  draft,
  error,
  imageAttachments,
  isInspectingContext,
  isStreaming,
  isTemporaryChat,
  isTranscribingVoice,
  messageCount,
  models,
  onAddUrl,
  onAttachExistingFile,
  onAttachFiles,
  onCancel,
  onCancelQueuedTurn,
  onDraftChange,
  onGenerateImages,
  onInspectContext,
  onRemoveDocumentAttachment,
  onRemoveImageAttachment,
  onRemoveUrl,
  onSelectModel,
  onSubmit,
  onToggleWebSearch,
  onTranscribeAudio,
  onTranscriptionError,
  providers,
  queuedTurns,
  selectedModelId,
  webSearchEnabled,
  workspaceId,
}: ChatComposerProps) {
  const { t } = useLocale();
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [fileLibraryOpen, setFileLibraryOpen] = useState(false);
  const [noteLibraryOpen, setNoteLibraryOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const commandQuery = draft.startsWith("/") ? draft.slice(1).trim() : "";
  const commandPromptsQuery = useQuery({
    queryKey: ["promptTemplates", workspaceId, "command", commandQuery],
    queryFn: () =>
      listPromptTemplatesPage({
        workspaceId: workspaceId!,
        limit: 8,
        offset: 0,
        ...(commandQuery === "" ? {} : { query: commandQuery }),
      }),
    enabled: workspaceId !== undefined && draft.startsWith("/"),
  });
  const imageModels = useMemo(
    () => listImageGenerationModels(models, providers),
    [models, providers],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    onSubmit(event);
    if (textareaRef.current !== null) textareaRef.current.style.height = "auto";
  }

  return (
    <>
      {isTemporaryChat ? (
        <div className="rm-chat-mode" role="status">
          <Clock3 aria-hidden="true" size={14} />
          <strong>{t("temporaryChat")}</strong>
          <span aria-hidden="true">·</span>
          <span>{t("temporaryChatDescription")}</span>
        </div>
      ) : null}
      <form className="rm-composer-wrap" onSubmit={handleComposerSubmit}>
        <label className="sr-only" htmlFor="prompt">
          Message
        </label>
        {imageAttachments.length > 0 ? (
          <div className="rm-pending-attachments">
            {imageAttachments.map((attachment) => (
              <div className="rm-pending-attachment" key={attachment.id}>
                <img
                  alt={attachment.fileName}
                  height={48}
                  src={attachment.previewUrl}
                  width={48}
                />
                <span className="truncate">{attachment.fileName}</span>
                <Button
                  aria-label={`Remove ${attachment.fileName}`}
                  disabled={isStreaming}
                  onClick={() => onRemoveImageAttachment(attachment.id)}
                  title={`Remove ${attachment.fileName}`}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {documentAttachments.length > 0 ? (
          <div className="rm-pending-attachments">
            {documentAttachments.map((attachment) => (
              <div
                className="rm-pending-attachment document"
                key={attachment.id}
              >
                <FileText aria-hidden="true" size={18} />
                <span className="truncate">{attachment.fileName}</span>
                <Button
                  aria-label={`Remove ${attachment.fileName}`}
                  disabled={isStreaming}
                  onClick={() => onRemoveDocumentAttachment(attachment.id)}
                  title={`Remove ${attachment.fileName}`}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="rm-composer">
          <Textarea
            name="prompt"
            id="prompt"
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onInput={(event) => {
              // ponytail: replace this whole handler with `field-sizing: content` in
              // app.css once Safari/Firefox support is broad enough. Until then CSS
              // cannot measure content, so the height comes from scrollHeight.
              const el = event.currentTarget;
              el.style.height = "auto"; // reset first, or it can only ever grow
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={handleDraftKeyDown}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) onAttachFiles(files);
            }}
            placeholder={messageCount === 0 ? t("prompt") : t("sendMessage")}
            ref={textareaRef}
            rows={4}
            value={draft}
            aria-describedby="composer-status"
          />
          {draft.startsWith("/") &&
          (commandPromptsQuery.data?.items.length ?? 0) > 0 ? (
            <div
              className="rm-composer-command-menu"
              role="listbox"
              aria-label={t("promptTemplates")}
            >
              {commandPromptsQuery
                .data!.items.filter((prompt) =>
                  prompt.name
                    .toLowerCase()
                    .includes(draft.slice(1).toLowerCase()),
                )
                .slice(0, 8)
                .map((prompt) => (
                  <Button
                    key={prompt.id}
                    onClick={() =>
                      onDraftChange(materializePrompt(prompt.body))
                    }
                    role="option"
                    type="button"
                  >
                    <strong>/{prompt.name}</strong>
                    <span>
                      {prompt.description ?? prompt.body.slice(0, 80)}
                    </span>
                  </Button>
                ))}
            </div>
          ) : null}
          <div className="rm-composer-actions">
            {canOverrideModel ? (
              <ComposerModelSelect
                disabled={isStreaming}
                models={models}
                providers={providers}
                onSelectModel={onSelectModel}
                selectedModelId={selectedModelId}
              />
            ) : null}
            <label
              className={`rm-icon-button ${isStreaming ? "disabled" : ""}`}
              htmlFor="chat-image-attachment"
              title={t("attach")}
            >
              <Paperclip aria-hidden="true" size={17} />
              <span className="sr-only">{t("attach")}</span>
            </label>
            <Input
              name="chat-image-attachment"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx,.pptx,.xlsx,text/plain,text/markdown,text/csv,application/json,text/html"
              className="sr-only"
              disabled={isStreaming}
              id="chat-image-attachment"
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                onAttachFiles(files);
              }}
              multiple
              type="file"
            />
            <Button
              aria-label={t("promptLibrary")}
              className="rm-icon-button"
              onClick={() => setPromptLibraryOpen(true)}
              title={t("promptLibrary")}
              type="button"
            >
              <Zap aria-hidden="true" size={17} />
            </Button>
            <Button
              aria-label={t("files")}
              className="rm-icon-button"
              onClick={() => setFileLibraryOpen(true)}
              title={t("files")}
              type="button"
            >
              <Library aria-hidden="true" size={17} />
            </Button>
            <Button
              aria-label={t("notes")}
              className="rm-icon-button"
              onClick={() => setNoteLibraryOpen(true)}
              title={t("notes")}
              type="button"
            >
              <NotebookPen aria-hidden="true" size={17} />
            </Button>
            <Button
              aria-label={t("url")}
              className="rm-icon-button"
              onClick={() => setUrlDialogOpen(true)}
              title={t("url")}
              type="button"
            >
              <Globe2 aria-hidden="true" size={17} />
            </Button>
            <Button
              aria-label={t("image")}
              className="rm-icon-button"
              disabled={imageModels.length === 0}
              onClick={() => setImageDialogOpen(true)}
              title={t("image")}
              type="button"
            >
              <Images aria-hidden="true" size={17} />
            </Button>
            <Button
              aria-pressed={webSearchEnabled}
              aria-label={t("search")}
              className={`rm-icon-button ${webSearchEnabled ? "active" : ""}`}
              onClick={() => onToggleWebSearch(!webSearchEnabled)}
              title={t("search")}
              type="button"
            >
              <Search aria-hidden="true" size={17} />
            </Button>
            <VoiceInputButton
              disabled={isStreaming}
              isTranscribing={isTranscribingVoice}
              onAudio={onTranscribeAudio}
              onError={onTranscriptionError}
            />
            <Button
              aria-label={t("inspect")}
              className="rm-icon-button"
              disabled={
                !canInspectContext || isStreaming || isInspectingContext
              }
              onClick={onInspectContext}
              title={canInspectContext ? t("inspectNext") : t("inspectFirst")}
              type="button"
            >
              <ScanSearch aria-hidden="true" size={17} />
            </Button>
            {isStreaming ? (
              <>
                <Button
                  aria-label={t("stop")}
                  className="rm-icon-button stop"
                  onClick={onCancel}
                  title={t("stop")}
                  type="button"
                >
                  <Square aria-hidden="true" size={15} />
                </Button>
                <Button
                  aria-label={t("queue")}
                  className="rm-send-button"
                  disabled={draft.trim() === ""}
                  title={t("queue")}
                  type="submit"
                >
                  <ArrowUp aria-hidden="true" size={16} />
                </Button>
              </>
            ) : (
              <Button
                aria-label={t("send")}
                className="rm-send-button"
                disabled={
                  draft.trim() === "" &&
                  imageAttachments.length === 0 &&
                  documentAttachments.length === 0
                }
                title={t("send")}
                type="submit"
              >
                <ArrowUp aria-hidden="true" size={16} />
              </Button>
            )}
          </div>
        </div>
        <div className="sr-only" id="composer-status" aria-live="polite">
          {isStreaming ? t("responseInProgress") : t("readyToSend")}
        </div>
        {attachedUrls.length > 0 ? (
          <div className="rm-pending-attachments">
            {attachedUrls.map((url) => (
              <div className="rm-pending-attachment document" key={url}>
                <Globe2 aria-hidden="true" size={16} />
                <span className="truncate">{url}</span>
                <Button
                  aria-label={`Remove ${url}`}
                  onClick={() => onRemoveUrl(url)}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {queuedTurns.length > 0 ? (
          <div className="rm-queued-turns grid gap-1" aria-live="polite">
            {queuedTurns.map((turn) => (
              <div className="flex items-center gap-2" key={turn.id}>
                <span className="min-w-0 flex-1 truncate">
                  {turn.status === "failed" ? t("failed") : t("queued")}:{" "}
                  {turn.content}
                </span>
                <Button
                  aria-label={`${t("removeQueued")}: ${turn.content}`}
                  onClick={() => onCancelQueuedTurn(turn.id)}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        {error ? <div className="rm-composer-error">{error}</div> : null}
      </form>
      <ChatComposerDialogs
        draft={draft}
        fileLibraryOpen={fileLibraryOpen}
        imageDialogOpen={imageDialogOpen}
        models={models}
        noteLibraryOpen={noteLibraryOpen}
        onAddUrl={onAddUrl}
        onAttachExistingFile={onAttachExistingFile}
        onDraftChange={onDraftChange}
        onGenerateImages={onGenerateImages}
        promptLibraryOpen={promptLibraryOpen}
        providers={providers}
        selectedModelId={selectedModelId}
        setFileLibraryOpen={setFileLibraryOpen}
        setImageDialogOpen={setImageDialogOpen}
        setNoteLibraryOpen={setNoteLibraryOpen}
        setPromptLibraryOpen={setPromptLibraryOpen}
        setUrlDialogOpen={setUrlDialogOpen}
        urlDialogOpen={urlDialogOpen}
        workspaceId={workspaceId}
      />
    </>
  );
}

interface ChatComposerProps {
  attachedUrls: string[];
  canInspectContext: boolean;
  canOverrideModel: boolean;
  documentAttachments: PendingDocumentAttachment[];
  draft: string;
  error: string | undefined;
  imageAttachments: PendingImageAttachment[];
  isInspectingContext: boolean;
  isStreaming: boolean;
  isTemporaryChat: boolean;
  isTranscribingVoice: boolean;
  messageCount: number;
  models: BaseModel[];
  onAddUrl: (url: string) => void;
  onAttachExistingFile: (file: FileObject) => void;
  onAttachFiles: (files: File[]) => void;
  onCancel: () => void;
  onCancelQueuedTurn: (turnId: string) => void;
  onDraftChange: (value: string) => void;
  onGenerateImages: (input: {
    modelId: string;
    prompt: string;
    size: "1024x1024" | "1024x1536" | "1536x1024";
  }) => void;
  onInspectContext: () => void;
  onRemoveDocumentAttachment: (attachmentId: string) => void;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onRemoveUrl: (url: string) => void;
  onSelectModel: (modelId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleWebSearch: (enabled: boolean) => void;
  onTranscribeAudio: (blob: Blob) => Promise<void>;
  onTranscriptionError: (message: string) => void;
  providers: Provider[];
  queuedTurns: QueuedChatTurn[];
  selectedModelId: string | undefined;
  webSearchEnabled: boolean;
  workspaceId: string | undefined;
}
