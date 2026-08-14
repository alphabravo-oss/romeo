import { Button, DropdownMenu, InlineError, Input, Textarea } from "@romeo/ui";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import Clock3 from "lucide-react/dist/esm/icons/clock-3.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import Square from "lucide-react/dist/esm/icons/square.mjs";
import Globe2 from "lucide-react/dist/esm/icons/globe-2.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { knowledgeBasesQueryOptions } from "../features/knowledge";
import { useLocale } from "../lib/i18n";
import { canPerformChatWriteAction } from "./chat-enterprise";
import { ChatComposerDialogs } from "./ChatComposerDialogs";
import { composerMenuId, useComposerMenu } from "./ChatComposerMenus";
import type { ChatComposerProps } from "./chat-composer-props";
import { listImageGenerationModels } from "./chat-composer-utils";
import {
  allowFileDrop,
  claimDroppedFiles,
  claimPastedFiles,
} from "./composer-attachment-input";
import { ComposerModelSelect } from "./ComposerModelSelect";
import { ComposerTurnModeControls } from "./ComposerTurnModeControls";
import { ContextMeter } from "./ContextMeter";
import { VoiceInputButton } from "./VoiceInputButton";
import {
  buildComposerCapabilityItems,
  ComposerPendingAttachments,
} from "./ChatComposerCapabilities";

export function ChatComposer({
  attachedUrls,
  chatAccess = "owner",
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
  knowledgeBaseIdsOverride,
  messageCount,
  messages,
  models,
  systemPrompt,
  defaultModelId,
  lastReplyModelId,
  onAddUrl,
  onAttachExistingFile,
  onAttachFiles,
  onCancel,
  onDraftChange,
  onGenerateImages,
  onInspectContext,
  onKnowledgeBaseIdsChange,
  onCancelAttachment,
  onMoveDocumentAttachment,
  onMoveImageAttachment,
  onRemoveDocumentAttachment,
  onRemoveImageAttachment,
  onRetryDocumentAttachment,
  onSelectDocumentPage,
  onRemoveUrl,
  customModels,
  selectedCustomModelId,
  onSelectCustomModel,
  onSelectModel,
  onToggleDefaultModel,
  onSubmit,
  onToggleWebSearch,
  onToggleAgenticRag,
  onRoutingModeChange,
  onResearchModeChange,
  onReasoningModeChange,
  onTranscribeAudio,
  onTranscriptionError,
  providers,
  selectedModelId,
  enterToSend,
  webSearchEnabled,
  agenticRagAvailable,
  agenticRagForced,
  agenticRagEnabled,
  routingMode,
  researchMode,
  reasoningMode,
  workspaceId,
}: ChatComposerProps) {
  const { t } = useLocale();
  const canSend = canPerformChatWriteAction(chatAccess, "send");
  const canAttach = canPerformChatWriteAction(chatAccess, "attach");
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false);
  const [fileLibraryOpen, setFileLibraryOpen] = useState(false);
  const [knowledgeLibraryOpen, setKnowledgeLibraryOpen] = useState(false);
  const [noteLibraryOpen, setNoteLibraryOpen] = useState(false);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const knowledgeBasesQuery = useQuery(
    knowledgeBasesQueryOptions(
      workspaceId,
      knowledgeBaseIdsOverride !== undefined,
    ),
  );
  const knowledgeOverrideLabel = useMemo(() => {
    if (knowledgeBaseIdsOverride === undefined) return undefined;
    if (knowledgeBaseIdsOverride.length === 0) {
      return t("composerKnowledgeNoneActive");
    }
    const names = knowledgeBaseIdsOverride.map(
      (id) =>
        knowledgeBasesQuery.data?.find((base) => base.id === id)?.name ?? id,
    );
    if (names.length === 1) return names[0];
    return t("composerKnowledgeSelectedCount", {
      count: String(names.length),
    });
  }, [knowledgeBaseIdsOverride, knowledgeBasesQuery.data, t]);
  const [caret, setCaret] = useState(0);
  const imageModels = useMemo(
    () => listImageGenerationModels(models, providers),
    [models, providers],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | undefined>(undefined);

  // Defer menu-selection caret restoration until React writes the textarea.
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
    if (event.key !== "Enter") return;
    if (!canSend) return;
    const submitWithModifier = event.metaKey || event.ctrlKey;
    if (enterToSend) {
      if (event.shiftKey) return;
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }
    // Enter inserts a newline; only Ctrl/Cmd+Enter sends.
    if (!submitWithModifier) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  // Consolidated capabilities surface (E3): attach, libraries, web/url, image,
  // and context inspect live in one menu so the composer stays clean.
  const composerMenuItems = buildComposerCapabilityItems({
    cameraInputRef,
    canAttach,
    canInspectContext,
    canSend,
    fileInputRef,
    hasImageModels: imageModels.length > 0,
    isInspectingContext,
    isStreaming,
    onInspectContext,
    openFileLibrary: () => setFileLibraryOpen(true),
    openImageDialog: () => setImageDialogOpen(true),
    openKnowledgeLibrary: () => setKnowledgeLibraryOpen(true),
    openNoteLibrary: () => setNoteLibraryOpen(true),
    openPromptLibrary: () => setPromptLibraryOpen(true),
    openUrlDialog: () => setUrlDialogOpen(true),
    t,
  });

  return (
    <>
      {isTemporaryChat && messageCount === 0 ? (
        <div className="rm-chat-mode" role="status">
          <Clock3 aria-hidden="true" size={14} />
          <strong>{t("temporaryChat")}</strong>
          <span aria-hidden="true">·</span>
          <span>{t("temporaryChatDescription")}</span>
        </div>
      ) : null}
      <form
        className="rm-composer-wrap"
        onDragOver={(event) => allowFileDrop(event, canAttach)}
        onDrop={(event) => claimDroppedFiles(event, canAttach, onAttachFiles)}
        onSubmit={(event) => {
          if (!canSend) {
            event.preventDefault();
            return;
          }
          onSubmit(event);
        }}
      >
        <label className="sr-only" htmlFor="prompt">
          {t("message")}
        </label>
        <ComposerPendingAttachments
          documentAttachments={documentAttachments}
          imageAttachments={imageAttachments}
          isStreaming={isStreaming}
          knowledgeOverrideLabel={knowledgeOverrideLabel}
          onClearKnowledgeOverride={() => onKnowledgeBaseIdsChange(undefined)}
          onCancelAttachment={onCancelAttachment}
          onMoveDocument={onMoveDocumentAttachment}
          onMoveImage={onMoveImageAttachment}
          onRemoveDocument={onRemoveDocumentAttachment}
          onRemoveImage={onRemoveImageAttachment}
          onRetryDocument={onRetryDocumentAttachment}
          onSelectDocumentPage={onSelectDocumentPage}
          selectedModel={models.find((model) => model.id === selectedModelId)}
        />
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
              if (!canSend) return;
              setCaret(event.currentTarget.selectionStart);
              onDraftChange(event.currentTarget.value);
            }}
            onKeyDown={handleDraftKeyDown}
            onPaste={(event) =>
              claimPastedFiles(event, canAttach, onAttachFiles)
            }
            placeholder={
              !canSend
                ? t("readOnlyChat")
                : messageCount === 0
                  ? t("prompt")
                  : t("sendMessage")
            }
            readOnly={!canSend}
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
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.docx,.pptx,.xlsx,text/plain,text/markdown,text/csv,application/json,text/html,audio/*,video/*"
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
          <Input
            accept="image/*"
            aria-label={t("trayCapturePhoto")}
            capture="environment"
            className="rm-ui-visually-hidden"
            disabled={isStreaming}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              onAttachFiles(files);
            }}
            ref={cameraInputRef}
            type="file"
          />
          <div className="rm-composer-actions">
            <DropdownMenu
              align="start"
              items={composerMenuItems}
              trigger={
                <Button
                  aria-label={t("capabilitiesMenu")}
                  className="rm-icon-button"
                  title={t("capabilitiesMenu")}
                  type="button"
                >
                  <Plus aria-hidden="true" size={18} />
                </Button>
              }
            />
            <ComposerModelSelect
              customModels={customModels ?? []}
              defaultModelId={defaultModelId}
              disabled={isStreaming}
              models={models}
              providers={providers}
              {...(onSelectCustomModel === undefined
                ? {}
                : { onSelectCustomModel })}
              onSelectModel={onSelectModel}
              onToggleDefaultModel={onToggleDefaultModel}
              requiresReasoning={
                reasoningMode !== "default" && reasoningMode !== "off"
              }
              requiresTools={agenticRagEnabled}
              requiresVision={
                imageAttachments.length > 0 || documentAttachments.length > 0
              }
              {...(selectedCustomModelId === undefined
                ? {}
                : { selectedCustomModelId })}
              selectedModelId={selectedModelId}
            />
            <ComposerTurnModeControls
              agenticRagAvailable={agenticRagAvailable}
              agenticRagEnabled={agenticRagEnabled}
              agenticRagForced={agenticRagForced}
              canSend={canSend}
              isStreaming={isStreaming}
              models={models}
              onAgenticRagChange={onToggleAgenticRag}
              onReasoningModeChange={onReasoningModeChange}
              onResearchModeChange={onResearchModeChange}
              onRoutingModeChange={onRoutingModeChange}
              onWebSearchChange={onToggleWebSearch}
              reasoningMode={reasoningMode}
              researchMode={researchMode}
              routingMode={routingMode}
              selectedModelId={selectedModelId}
              webSearchEnabled={webSearchEnabled}
            />
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
                messages={messages}
                onInspect={onInspectContext}
                preview={contextPreview}
                systemPrompt={systemPrompt}
              />
            ) : null}
            <div className="rm-composer-actions-end">
              <VoiceInputButton
                disabled={isStreaming || !canSend}
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
                  !canSend ||
                  (isStreaming
                    ? draft.trim() === ""
                    : draft.trim() === "" &&
                      imageAttachments.length === 0 &&
                      documentAttachments.length === 0)
                }
                title={
                  !canSend
                    ? t("readOnlyChat")
                    : isStreaming
                      ? t("queue")
                      : t("send")
                }
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
        {lastReplyModelId !== undefined &&
        selectedModelId !== undefined &&
        lastReplyModelId !== selectedModelId ? (
          <div className="rm-composer-model-hint">
            {t("nextMessageUsesModel", {
              model:
                models.find((model) => model.id === selectedModelId)
                  ?.displayName ?? selectedModelId,
            })}
          </div>
        ) : null}
        {error ? <InlineError role="alert">{error}</InlineError> : null}
      </form>
      <ChatComposerDialogs
        draft={draft}
        fileLibraryOpen={fileLibraryOpen}
        imageDialogOpen={imageDialogOpen}
        knowledgeBaseIdsOverride={knowledgeBaseIdsOverride}
        knowledgeLibraryOpen={knowledgeLibraryOpen}
        models={models}
        noteLibraryOpen={noteLibraryOpen}
        onAddUrl={onAddUrl}
        onAttachExistingFile={onAttachExistingFile}
        onDraftChange={onDraftChange}
        onGenerateImages={onGenerateImages}
        onKnowledgeBaseIdsChange={onKnowledgeBaseIdsChange}
        promptLibraryOpen={promptLibraryOpen}
        providers={providers}
        selectedModelId={selectedModelId}
        setFileLibraryOpen={setFileLibraryOpen}
        setImageDialogOpen={setImageDialogOpen}
        setKnowledgeLibraryOpen={setKnowledgeLibraryOpen}
        setNoteLibraryOpen={setNoteLibraryOpen}
        setPromptLibraryOpen={setPromptLibraryOpen}
        setUrlDialogOpen={setUrlDialogOpen}
        urlDialogOpen={urlDialogOpen}
        workspaceId={workspaceId}
      />
    </>
  );
}
