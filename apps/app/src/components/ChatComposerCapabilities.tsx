import BookOpen from "lucide-react/dist/esm/icons/book-open.mjs";
import Camera from "lucide-react/dist/esm/icons/camera.mjs";
import Globe2 from "lucide-react/dist/esm/icons/globe-2.mjs";
import Images from "lucide-react/dist/esm/icons/images.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen.mjs";
import Paperclip from "lucide-react/dist/esm/icons/paperclip.mjs";
import ScanSearch from "lucide-react/dist/esm/icons/scan-search.mjs";
import Zap from "lucide-react/dist/esm/icons/zap.mjs";
import type { RefObject } from "react";

import type { MessageKey } from "../lib/i18n";

export { ComposerPendingAttachments } from "./ComposerAttachmentTray";

export function buildComposerCapabilityItems(options: {
  cameraInputRef: RefObject<HTMLInputElement | null>;
  canAttach: boolean;
  canInspectContext: boolean;
  canSend: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  hasImageModels: boolean;
  isInspectingContext: boolean;
  isStreaming: boolean;
  onInspectContext: () => void;
  openFileLibrary: () => void;
  openImageDialog: () => void;
  openKnowledgeLibrary: () => void;
  openNoteLibrary: () => void;
  openPromptLibrary: () => void;
  openUrlDialog: () => void;
  t: (key: MessageKey) => string;
}) {
  const item = (Icon: typeof Paperclip, key: MessageKey) => (
    <span className="rm-composer-menu-item">
      <Icon aria-hidden="true" size={16} />
      {options.t(key)}
    </span>
  );
  return [
    {
      disabled: options.isStreaming || !options.canAttach,
      label: item(Paperclip, "attach"),
      onSelect: () => options.fileInputRef.current?.click(),
    },
    {
      disabled: options.isStreaming || !options.canAttach,
      label: item(Camera, "trayCapturePhoto"),
      onSelect: () => options.cameraInputRef.current?.click(),
    },
    {
      disabled: !options.canSend,
      label: item(Zap, "promptLibrary"),
      onSelect: options.openPromptLibrary,
    },
    {
      disabled: !options.canAttach,
      label: item(Library, "files"),
      onSelect: options.openFileLibrary,
    },
    {
      disabled: !options.canSend,
      label: item(BookOpen, "composerKnowledgePicker"),
      onSelect: options.openKnowledgeLibrary,
    },
    {
      disabled: !options.canSend,
      label: item(NotebookPen, "notes"),
      onSelect: options.openNoteLibrary,
    },
    {
      disabled: !options.canAttach,
      label: item(Globe2, "url"),
      onSelect: options.openUrlDialog,
    },
    {
      disabled: !options.hasImageModels || !options.canSend,
      label: item(Images, "image"),
      onSelect: options.openImageDialog,
    },
    {
      disabled:
        !options.canInspectContext ||
        options.isStreaming ||
        options.isInspectingContext,
      label: (
        <span
          className="rm-composer-menu-item"
          title={
            options.canInspectContext
              ? options.t("inspectNext")
              : options.t("inspectFirst")
          }
        >
          <ScanSearch aria-hidden="true" size={16} />
          {options.t("inspectContextCapability")}
        </span>
      ),
      onSelect: options.onInspectContext,
    },
  ];
}
