import type { DragEvent, MutableRefObject } from "react";

import {
  canPerformChatWriteAction,
  type ChatAccessLevel,
} from "./chat-enterprise";
import { isDragOverlayVisible, nextDragDepth } from "./drag-depth";

export function chatDropTargetProps(input: {
  chatAccess: ChatAccessLevel;
  dragDepth: MutableRefObject<number>;
  onAttachFiles: (files: File[]) => void;
  setDragActive: (active: boolean) => void;
}) {
  return {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      input.dragDepth.current = nextDragDepth(input.dragDepth.current, "enter");
      input.setDragActive(isDragOverlayVisible(input.dragDepth.current));
    },
    onDragOver: (event: DragEvent<HTMLElement>) => event.preventDefault(),
    onDragLeave: () => {
      input.dragDepth.current = nextDragDepth(input.dragDepth.current, "leave");
      input.setDragActive(isDragOverlayVisible(input.dragDepth.current));
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      input.dragDepth.current = nextDragDepth(input.dragDepth.current, "reset");
      input.setDragActive(false);
      if (!canPerformChatWriteAction(input.chatAccess, "attach")) return;
      input.onAttachFiles(Array.from(event.dataTransfer.files));
    },
  };
}
