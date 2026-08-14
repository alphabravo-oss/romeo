import { useEffect, useRef } from "react";

import { useTranscriptRowVisibility } from "./transcript-row-visibility";

export function VisibilityAwareAudio({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const visible = useTranscriptRowVisibility();
  useEffect(() => {
    if (!visible) audioRef.current?.pause();
  }, [visible]);
  // The adjacent assistant text is the alternative for generated speech.
  // Metadata is deferred until the reader elects to play it.
  // oxlint-disable-next-line jsx-a11y/media-has-caption
  return <audio controls preload="none" ref={audioRef} src={src} />;
}
