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
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { useLocale } from "../lib/i18n";
import { ChatComposerDialogs } from "./ChatComposerDialogs";
import { composerMenuId, useComposerMenu } from "./ChatComposerMenus";
import type { ChatComposerProps } from "./chat-composer-props";
import { listImageGenerationModels } from "./chat-composer-utils";
import { ComposerModelSelect } from "./ComposerModelSelect";
import { ContextMeter } from "./ContextMeter";
import { VoiceInputButton } from "./VoiceInputButton";

export function ChatComposer({
  attachedUrls,
  canInspectContext,
  contextPreview,
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
  const [caret, setCaret] = useState(0);
  const imageModels = useMemo(
    () => listImageGenerationModels(models, providers),
    [models, providers],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | undefined>(undefined);

  // A menu selection can land mid-sentence, and React writing .value on a
  // controlled textarea drops the caret at the end. The write is deferred to the
  // layout effect below, which runs after the new value is in the DOM.
  const replaceDraft = useCallback(
    (value: string, nextCaret: number) => {
      pendingCaret.current = nextCaret;
      setCaret(nextCaret);
      onDraftChange(value);
    },
    [onDraftChange],
  );
  const composerMenu = useComposerMenu({
    caret,
    draft,
    onAttachExistingFile,
    onReplaceDraft: replaceDraft,
    workspaceId,
  });

  // ponytail: replace the sizing half of this effect with `field-sizing: content`
  // in app.css once Safari/Firefox support is broad enough. Until then CSS cannot
  // measure content, so the height comes from scrollHeight. Keyed on `draft`
  // rather than an onInput handler because React fires no input event for the
  // programmatic writes (prompt library, notes, "/" menu, voice transcript).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto"; // reset first, or it can only ever grow
    el.style.height = `${el.scrollHeight}px`;
    const restore = pendingCaret.current;
    if (restore === undefined) return;
    pendingCaret.current = undefined;
    el.setSelectionRange(restore, restore);
  }, [draft]);

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Japanese/Chinese/Korean IMEs commit the candidate word with Enter. Without
    // this guard that keystroke submits a half-composed message.
    if (event.nativeEvent.isComposing) return;
    if (composerMenu.handleKeyDown(event)) return;
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
            aria-activedescendant={composerMenu.activeOptionId}
            aria-autocomplete="list"
            aria-controls={composerMenuId}
            id="prompt"
            aria-expanded={composerMenu.open}
            aria-haspopup="listbox"
            onChange={(event) => {
              setCaret(event.currentTarget.selectionStart);
              onDraftChange(event.currentTarget.value);
            }}
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
          {composerMenu.listbox}
          {/* Stays mounted outside the menu: the menu item only forwards a click
              here, and the input itself remains a labelled keyboard target. */}
          <Input
            name="chat-image-attachment"
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx,.pptx,.xlsx,text/plain,text/markdown,text/csv,application/json,text/html"
            aria-label={t("attach")}
            className="rm-ui-visually-hidden"
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
            {canInspectContext ? (
              <ContextMeter
                contextWindow={
                  models.find((model) => model.id === selectedModelId)
                    ?.contextWindow
                }
                // Deliberately not disabled while inspecting: the click that
                // starts an inspection would then disable the control under the
                // keyboard user who pressed it, dropping focus to the body.
                disabled={isStreaming}
                draft={draft}
                onInspect={onInspectContext}
                preview={contextPreview}
              />
            ) : null}
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
