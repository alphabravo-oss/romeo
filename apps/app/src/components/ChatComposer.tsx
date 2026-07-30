import { Button, DropdownMenu, Input, Textarea } from "@romeo/ui";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.mjs";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import Globe2 from "lucide-react/dist/esm/icons/globe-2.mjs";
import Images from "lucide-react/dist/esm/icons/images.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen.mjs";
import Paperclip from "lucide-react/dist/esm/icons/paperclip.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import ScanSearch from "lucide-react/dist/esm/icons/scan-search.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Square from "lucide-react/dist/esm/icons/square.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import Zap from "lucide-react/dist/esm/icons/zap.mjs";
import { useQuery } from "@tanstack/react-query";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { listPromptTemplatesPage } from "../features/prompts";
import { useLocale } from "../lib/i18n";
import { ChatComposerDialogs } from "./ChatComposerDialogs";
import type { ChatComposerProps } from "./chat-composer-props";
import {
  listImageGenerationModels,
  materializePrompt,
} from "./chat-composer-utils";
import { ComposerModelSelect } from "./ComposerModelSelect";
import { VoiceInputButton } from "./VoiceInputButton";

export function ChatComposer({
  attachedUrls,
  canInspectContext,
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
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
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
  const commandPrompts = useMemo(
    () =>
      (commandPromptsQuery.data?.items ?? [])
        .filter((prompt) =>
          prompt.name.toLowerCase().includes(commandQuery.toLowerCase()),
        )
        .slice(0, 8),
    [commandPromptsQuery.data?.items, commandQuery],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ponytail: replace this whole effect with `field-sizing: content` in
  // app.css once Safari/Firefox support is broad enough. Until then CSS cannot
  // measure content, so the height comes from scrollHeight. Keyed on `draft`
  // rather than an onInput handler because React fires no input event for the
  // programmatic writes (prompt library, notes, "/" menu, voice transcript).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto"; // reset first, or it can only ever grow
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Japanese/Chinese/Korean IMEs commit the candidate word with Enter. Without
    // this guard that keystroke submits a half-composed message.
    if (event.nativeEvent.isComposing) return;
    if (draft.startsWith("/") && commandPrompts.length > 0) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDraftChange("");
        setActiveCommandIndex(0);
        return;
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        setActiveCommandIndex((current) => {
          if (event.key === "Home") return 0;
          if (event.key === "End") return commandPrompts.length - 1;
          if (event.key === "ArrowDown")
            return (current + 1) % commandPrompts.length;
          return (current - 1 + commandPrompts.length) % commandPrompts.length;
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const selected =
          commandPrompts[
            Math.min(activeCommandIndex, commandPrompts.length - 1)
          ];
        if (selected !== undefined)
          onDraftChange(materializePrompt(selected.body));
        setActiveCommandIndex(0);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  // ponytail: the visible menu text replaces the icon-only aria-label/title pair
  // these actions used to carry, so only the inspect hint (which said something
  // the label does not) keeps a title. Upgrade path if a second action needs a
  // hint: give DropdownMenuItem a real `description` slot in @romeo/ui.
  const composerMenuItems = [
    {
      disabled: isStreaming,
      label: (
        <span className="rm-composer-menu-item">
          <Paperclip aria-hidden="true" size={16} />
          {t("attach")}
        </span>
      ),
      onSelect: () => fileInputRef.current?.click(),
    },
    {
      label: (
        <span className="rm-composer-menu-item">
          <Zap aria-hidden="true" size={16} />
          {t("promptLibrary")}
        </span>
      ),
      onSelect: () => setPromptLibraryOpen(true),
    },
    {
      label: (
        <span className="rm-composer-menu-item">
          <Library aria-hidden="true" size={16} />
          {t("files")}
        </span>
      ),
      onSelect: () => setFileLibraryOpen(true),
    },
    {
      label: (
        <span className="rm-composer-menu-item">
          <NotebookPen aria-hidden="true" size={16} />
          {t("notes")}
        </span>
      ),
      onSelect: () => setNoteLibraryOpen(true),
    },
    {
      label: (
        <span className="rm-composer-menu-item">
          <Globe2 aria-hidden="true" size={16} />
          {t("url")}
        </span>
      ),
      onSelect: () => setUrlDialogOpen(true),
    },
    {
      disabled: imageModels.length === 0,
      label: (
        <span className="rm-composer-menu-item">
          <Images aria-hidden="true" size={16} />
          {t("image")}
        </span>
      ),
      onSelect: () => setImageDialogOpen(true),
    },
    {
      disabled: !canInspectContext || isStreaming || isInspectingContext,
      label: (
        <span
          className="rm-composer-menu-item"
          title={canInspectContext ? t("inspectNext") : t("inspectFirst")}
        >
          <ScanSearch aria-hidden="true" size={16} />
          {t("inspect")}
        </span>
      ),
      onSelect: onInspectContext,
    },
  ];

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
      <form className="rm-composer-wrap" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="prompt">
          {t("message")}
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
                  aria-label={`${t("removeAttachment")}: ${attachment.fileName}`}
                  disabled={isStreaming}
                  onClick={() => onRemoveImageAttachment(attachment.id)}
                  title={`${t("removeAttachment")}: ${attachment.fileName}`}
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
                  aria-label={`${t("removeAttachment")}: ${attachment.fileName}`}
                  disabled={isStreaming}
                  onClick={() => onRemoveDocumentAttachment(attachment.id)}
                  title={`${t("removeAttachment")}: ${attachment.fileName}`}
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
            aria-activedescendant={
              draft.startsWith("/") && commandPrompts.length > 0
                ? `composer-command-${commandPrompts[Math.min(activeCommandIndex, commandPrompts.length - 1)]?.id}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls="composer-command-menu"
            id="prompt"
            aria-expanded={draft.startsWith("/") && commandPrompts.length > 0}
            aria-haspopup="listbox"
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onKeyDown={handleDraftKeyDown}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) onAttachFiles(files);
            }}
            placeholder={messageCount === 0 ? t("prompt") : t("sendMessage")}
            ref={textareaRef}
            rows={1}
            value={draft}
            aria-describedby="composer-status"
            role="combobox"
          />
          {draft.startsWith("/") && commandPrompts.length > 0 ? (
            <div
              className="rm-composer-command-menu"
              id="composer-command-menu"
              role="listbox"
              aria-label={t("promptTemplates")}
            >
              {commandPrompts.map((prompt, index) => (
                <Button
                  aria-selected={index === activeCommandIndex}
                  id={`composer-command-${prompt.id}`}
                  key={prompt.id}
                  onClick={() => {
                    onDraftChange(materializePrompt(prompt.body));
                    setActiveCommandIndex(0);
                  }}
                  onMouseEnter={() => setActiveCommandIndex(index)}
                  role="option"
                  type="button"
                >
                  <strong>/{prompt.name}</strong>
                  <span>{prompt.description ?? prompt.body.slice(0, 80)}</span>
                </Button>
              ))}
            </div>
          ) : null}
          {/* Stays mounted outside the menu: the menu item only forwards a click
              here, and the input itself remains a labelled keyboard target. */}
          <Input
            name="chat-image-attachment"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx,.pptx,.xlsx,text/plain,text/markdown,text/csv,application/json,text/html"
            aria-label={t("attach")}
            className="sr-only"
            disabled={isStreaming}
            id="chat-image-attachment"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              onAttachFiles(files);
            }}
            multiple
            ref={fileInputRef}
            type="file"
          />
          <div className="rm-composer-actions">
            <DropdownMenu
              align="start"
              items={composerMenuItems}
              trigger={
                <Button
                  aria-label={t("moreActions")}
                  className="rm-icon-button"
                  title={t("moreActions")}
                  type="button"
                >
                  <Plus aria-hidden="true" size={18} />
                </Button>
              }
            />
            <ComposerModelSelect
              disabled={isStreaming}
              models={models}
              providers={providers}
              onSelectModel={onSelectModel}
              selectedModelId={selectedModelId}
            />
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
            <div className="rm-composer-actions-end">
              <VoiceInputButton
                disabled={isStreaming}
                isTranscribing={isTranscribingVoice}
                onAudio={onTranscribeAudio}
                onError={onTranscriptionError}
              />
              {isStreaming ? (
                <Button
                  aria-label={t("stop")}
                  className="rm-icon-button stop"
                  onClick={onCancel}
                  title={t("stop")}
                  type="button"
                >
                  <Square aria-hidden="true" size={15} />
                </Button>
              ) : null}
              <Button
                aria-label={isStreaming ? t("queue") : t("send")}
                className="rm-send-button"
                disabled={
                  isStreaming
                    ? draft.trim() === ""
                    : draft.trim() === "" &&
                      imageAttachments.length === 0 &&
                      documentAttachments.length === 0
                }
                title={isStreaming ? t("queue") : t("send")}
                type="submit"
              >
                <ArrowUp aria-hidden="true" size={16} />
              </Button>
            </div>
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
                  aria-label={`${t("removeAttachment")}: ${url}`}
                  onClick={() => onRemoveUrl(url)}
                  title={`${t("removeAttachment")}: ${url}`}
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
