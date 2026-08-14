import { useCallback, useEffect, useRef } from "react";

interface ReaderBranchSelectionOptions {
  activeChatId: string | undefined;
  branchLeafMessageId: string | undefined;
  invalidSelection: boolean;
  onBranchSelection?: (
    leafMessageId: string | undefined,
    options?: { replace: boolean },
  ) => void;
  requestedLeafMessageId: string | undefined;
}

/** Keeps branch navigation reader-scoped and safe for background run settles. */
export function useReaderBranchSelection({
  activeChatId: selectedChatId,
  branchLeafMessageId,
  invalidSelection,
  onBranchSelection,
  requestedLeafMessageId,
}: ReaderBranchSelectionOptions) {
  const activeChatId = useRef(selectedChatId);
  activeChatId.current = selectedChatId;

  useEffect(() => {
    if (invalidSelection) {
      if (requestedLeafMessageId !== undefined) {
        onBranchSelection?.(undefined, { replace: true });
      }
      return;
    }
    if (
      requestedLeafMessageId === undefined &&
      branchLeafMessageId !== undefined
    ) {
      onBranchSelection?.(branchLeafMessageId, {
        replace: true,
      });
    }
  }, [
    branchLeafMessageId,
    invalidSelection,
    onBranchSelection,
    requestedLeafMessageId,
  ]);

  return useCallback(
    (chatId: string, leafMessageId: string) => {
      if (activeChatId.current === chatId) {
        onBranchSelection?.(leafMessageId, { replace: true });
      }
    },
    [onBranchSelection],
  );
}
