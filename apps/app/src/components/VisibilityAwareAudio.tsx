import { useEffect, useRef } from "react";

import { useTranscriptRowVisibility } from "./transcript-row-visibility";
import { audioCaptionTrackUrl } from "./composer-tray-media";

export function VisibilityAwareAudio({
  captions,
  captionsLabel,
  src,
}: {
  captions: string;
  captionsLabel: string;
  src: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const visible = useTranscriptRowVisibility();
  useEffect(() => {
    if (!visible) audioRef.current?.pause();
  }, [visible]);
  return (
    <audio controls preload="none" ref={audioRef} src={src}>
      <track
        default
        kind="captions"
        label={captionsLabel}
        src={audioCaptionTrackUrl(captions)}
      />
    </audio>
  );
}
