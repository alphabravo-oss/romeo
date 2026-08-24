import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

interface ComposerDraftControl {
  caret: number;
  replaceDraft: (value: string, nextCaret: number) => void;
  setCaret: Dispatch<SetStateAction<number>>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/** Keeps controlled composer text, caret restoration, and autosizing in sync. */
export function useComposerDraftControl(
  draft: string,
  onDraftChange: (value: string) => void,
): ComposerDraftControl {
  const [caret, setCaret] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | undefined>(undefined);

  const replaceDraft = useCallback(
    (value: string, nextCaret: number) => {
      pendingCaret.current = nextCaret;
      setCaret(nextCaret);
      onDraftChange(value);
    },
    [onDraftChange],
  );

  // CSS cannot yet measure controlled textarea content consistently in every
  // supported engine. Reset before reading scrollHeight so the field can shrink.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    const restore = pendingCaret.current;
    if (restore === undefined) return;
    pendingCaret.current = undefined;
    textarea.setSelectionRange(restore, restore);
  }, [draft]);

  return { caret, replaceDraft, setCaret, textareaRef };
}
