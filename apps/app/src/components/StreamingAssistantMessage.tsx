import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import type { Message } from "../features/types";
import * as appQueryKeys from "../lib/app-query-keys";
import { getStreamingAssistantMessage } from "../lib/run-registry";

/** The sole React observer for a growing assistant row. */
export function StreamingAssistantMessage(props: {
  children: (message: Message) => ReactNode;
  fallback: Message;
  onContentChange: () => void;
}) {
  const { data } = useQuery<Message>({
    queryKey: appQueryKeys.streamingMessage(
      props.fallback.chatId,
      props.fallback.id,
    ),
    queryFn: skipToken,
    initialData: () =>
      getStreamingAssistantMessage(props.fallback.chatId, props.fallback.id) ??
      props.fallback,
    gcTime: 30_000,
    staleTime: Number.POSITIVE_INFINITY,
    notifyOnChangeProps: ["data"],
  });
  const liveMessage = data ?? props.fallback;
  const onContentChange = props.onContentChange;
  useEffect(() => {
    onContentChange();
  }, [liveMessage, onContentChange]);
  return props.children(liveMessage);
}
