import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  browserLocalStorage,
  browserSessionStorage,
  purgeLegacyWorkspaceDrafts,
  readWorkspaceDraft,
  visibleWorkspaceDraft,
  workspaceDraftKey,
  writeWorkspaceDraft,
  type WorkspaceDraftState,
} from "../lib/draft-storage";

export function useWorkspaceDraft(scope: {
  chatId: string | undefined;
  subjectId: string | undefined;
  workspaceId: string | undefined;
}) {
  const [draftState, setDraftState] = useState<WorkspaceDraftState>({
    value: "",
  });
  const draftKey = workspaceDraftKey({
    ...(scope.chatId === undefined ? {} : { chatId: scope.chatId }),
    ...(scope.subjectId === undefined ? {} : { subjectId: scope.subjectId }),
    ...(scope.workspaceId === undefined
      ? {}
      : { workspaceId: scope.workspaceId }),
  });
  const draft = visibleWorkspaceDraft(draftState, draftKey);
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>(
    (next) => {
      setDraftState((current) => {
        const currentValue = visibleWorkspaceDraft(current, draftKey);
        return {
          ...(draftKey === undefined ? {} : { key: draftKey }),
          value: typeof next === "function" ? next(currentValue) : next,
        };
      });
    },
    [draftKey],
  );

  useEffect(() => purgeLegacyWorkspaceDrafts(browserLocalStorage()), []);
  useEffect(() => {
    setDraftState({
      ...(draftKey === undefined ? {} : { key: draftKey }),
      value:
        draftKey === undefined
          ? ""
          : readWorkspaceDraft(browserSessionStorage(), draftKey),
    });
  }, [draftKey]);
  useEffect(() => {
    if (draftKey === undefined || draftState.key !== draftKey) return;
    writeWorkspaceDraft(browserSessionStorage(), draftKey, draftState.value);
  }, [draftKey, draftState]);

  return { draft, setDraft };
}
