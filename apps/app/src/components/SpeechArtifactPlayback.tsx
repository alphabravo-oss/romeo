import type { SpeechArtifact } from "../features/voices";
import { useLocale } from "../lib/i18n";
import { formatSpeechArtifact } from "./ChatMessageMetadata";
import { VisibilityAwareAudio } from "./VisibilityAwareAudio";

export function SpeechArtifactPlayback({
  artifact,
  captions,
}: {
  artifact: SpeechArtifact;
  captions: string;
}) {
  const { t } = useLocale();
  return (
    <div className="rm-speech-artifact">
      <span>{formatSpeechArtifact(artifact)}</span>
      {artifact.playbackUrl ? (
        <VisibilityAwareAudio
          captions={captions}
          captionsLabel={t("trayAudioCaptions")}
          src={artifact.playbackUrl}
        />
      ) : null}
    </div>
  );
}
