import { Button } from "@romeo/ui";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Circle from "lucide-react/dist/esm/icons/circle.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";
import Zap from "lucide-react/dist/esm/icons/zap.mjs";
import type { ComponentProps, ReactNode } from "react";

import type { RunContextPreview } from "../features/chat";
import type { ChatSuggestion } from "../features/chat-experience";
import { useLocale } from "../lib/i18n";
import type { ChatPanelProps } from "./chat-panel-types";
import { suggestionSubtitle } from "./chat-suggestions";
import { ContextInspector } from "./ContextInspector";

export function ChatEmptyState(props: {
  activation: ChatPanelProps["activation"];
  chatId?: string | undefined;
  composer: ReactNode;
  contextPreview: RunContextPreview | undefined;
  contextPreviewError: string | undefined;
  dragActive: boolean;
  dropTargetProps: ComponentProps<"section">;
  isInspectingContext: boolean;
  nextTurnAuthorName: string | undefined;
  onCloseContext: () => void;
  onDraftChange: (value: string) => void;
  showContextInspector: boolean;
  showStarterPrompts: boolean;
  suggestions: ChatSuggestion[];
}) {
  const { t } = useLocale();
  const steps = [
    {
      complete: props.activation.providerReady,
      label: t("activationProvider"),
    },
    { complete: props.activation.modelReady, label: t("activationModel") },
    {
      complete: props.activation.assistantReady,
      label: t("activationAssistant"),
    },
    {
      complete: props.activation.conversationComplete,
      label: t("activationFirstOutcome"),
    },
  ];
  const completeCount = steps.filter((step) => step.complete).length;
  return (
    <section
      className={`rm-chat-panel rm-chat-panel-empty ${props.dragActive ? "drag-active" : ""}`}
      {...props.dropTargetProps}
    >
      {props.dragActive ? (
        <div className="rm-drop-overlay">{t("dropFilesToAttach")}</div>
      ) : null}
      <div className="rm-placeholder">
        <div className="rm-placeholder-inner">
          <div className="rm-placeholder-head">
            <div className="rm-placeholder-logo">
              <BotMessageSquare aria-hidden="true" size={20} />
            </div>
            <div className="rm-placeholder-copy">
              <h1 className="rm-placeholder-title">
                {props.nextTurnAuthorName ?? t("newChat")}
              </h1>
              <p className="rm-placeholder-subtitle">{t("prompt")}</p>
            </div>
          </div>
          {props.composer}
          {completeCount < steps.length ? (
            <section
              aria-labelledby="workspace-activation-title"
              className="rm-activation"
            >
              <div className="rm-activation__header">
                <div>
                  <h2 id="workspace-activation-title">
                    {t("activationTitle")}
                  </h2>
                  <p>{t("activationDescription")}</p>
                </div>
                <span
                  aria-label={t("activationProgress", {
                    complete: completeCount,
                    total: steps.length,
                  })}
                >
                  {completeCount}/{steps.length}
                </span>
              </div>
              <ol className="rm-activation__steps">
                {steps.map((step) => (
                  <li
                    className={step.complete ? "complete" : ""}
                    key={step.label}
                  >
                    {step.complete ? (
                      <Check aria-hidden="true" size={14} />
                    ) : (
                      <Circle aria-hidden="true" size={14} />
                    )}
                    <span>{step.label}</span>
                  </li>
                ))}
              </ol>
              {props.activation.isAdmin &&
              (!props.activation.providerReady ||
                !props.activation.modelReady) ? (
                <a
                  className="rm-activation__setup"
                  href="/admin?section=providers"
                >
                  {t("activationOpenSetup")}
                </a>
              ) : null}
            </section>
          ) : null}
          {props.showStarterPrompts && props.suggestions.length > 0 ? (
            <div className="rm-suggestions">
              <div className="rm-suggestions-label">
                <Zap aria-hidden="true" size={12} />
                <span>{t("suggested")}</span>
              </div>
              <div className="rm-suggestion-grid">
                {props.suggestions.slice(0, 6).map((suggestion, index) => {
                  const subtitle = suggestionSubtitle(suggestion.prompt);
                  return (
                    <Button
                      className="rm-suggestion"
                      key={`${suggestion.title}-${index}`}
                      onClick={() => props.onDraftChange(suggestion.prompt)}
                      title={suggestion.title}
                      type="button"
                    >
                      <Sparkles aria-hidden="true" size={16} />
                      <span className="rm-suggestion-text">
                        <span className="rm-suggestion-title">
                          {suggestion.title}
                        </span>
                        {subtitle === "" ||
                        subtitle === suggestion.title ? null : (
                          <span className="rm-suggestion-subtitle">
                            {subtitle}
                          </span>
                        )}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {props.showContextInspector ? (
        <ContextInspector
          {...(props.chatId === undefined ? {} : { chatId: props.chatId })}
          {...(props.contextPreviewError === undefined
            ? {}
            : { error: props.contextPreviewError })}
          loading={props.isInspectingContext}
          onClose={props.onCloseContext}
          {...(props.contextPreview === undefined
            ? {}
            : { preview: props.contextPreview })}
        />
      ) : null}
    </section>
  );
}
