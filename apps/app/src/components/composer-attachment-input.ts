export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (data === undefined || data === null) return [];
  return Array.from(data.files);
}

export function filesFromDrop(data: DataTransfer | null): File[] {
  return filesFromClipboard(data);
}

export function shouldClaimFilePaste(files: readonly File[]): boolean {
  return files.length > 0;
}

export function claimPastedFiles(
  event: { clipboardData: DataTransfer | null; preventDefault: () => void },
  canAttach: boolean,
  attach: (files: File[]) => void,
): void {
  if (!canAttach) return;
  const files = filesFromClipboard(event.clipboardData);
  if (!shouldClaimFilePaste(files)) return;
  event.preventDefault();
  attach(files);
}

export function allowFileDrop(
  event: {
    dataTransfer: DataTransfer;
    preventDefault: () => void;
  },
  canAttach: boolean,
): void {
  if (!canAttach || !event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

export function claimDroppedFiles(
  event: { dataTransfer: DataTransfer; preventDefault: () => void },
  canAttach: boolean,
  attach: (files: File[]) => void,
): void {
  if (!canAttach) return;
  const files = filesFromDrop(event.dataTransfer);
  if (files.length === 0) return;
  event.preventDefault();
  attach(files);
}

export function movePendingAttachment<T extends { id: string }>(
  items: readonly T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const index = items.findIndex((item) => item.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= items.length) return [...items];
  const copy = [...items];
  const [moved] = copy.splice(index, 1);
  if (moved === undefined) return [...items];
  copy.splice(next, 0, moved);
  return copy;
}

export function trayCompatibilityConstraint(input: {
  hasAudio: boolean;
  hasDocuments: boolean;
  hasImages: boolean;
  model:
    | {
        capabilities: {
          audioInput: boolean;
          toolCalling: boolean;
          vision: boolean;
        };
      }
    | undefined;
}): "audio" | "documents" | "vision" | undefined {
  if (input.model === undefined) return undefined;
  if (input.hasImages && !input.model.capabilities.vision) return "vision";
  if (input.hasAudio && !input.model.capabilities.audioInput) return "audio";
  if (input.hasDocuments && !input.model.capabilities.toolCalling)
    return "documents";
  return undefined;
}
