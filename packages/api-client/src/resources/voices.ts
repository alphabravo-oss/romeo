import { pathId } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  Agent,
  BindAgentVoiceInput,
  CreateVoiceProfileInput,
  GenerateMessageSpeechInput,
  PreviewVoiceInput,
  SpeechArtifact,
  TranscribeVoiceInput,
  TranscriptionResult,
  VoiceArtifactDeleteResult,
  VoiceCatalogSyncResult,
  VoiceProfile,
} from "../types";

export function createVoiceResource(transport: RomeoTransport) {
  return {
    list: () => transport.data<VoiceProfile[]>("GET", "/api/v1/voices"),
    create: (input: CreateVoiceProfileInput) =>
      transport.data<VoiceProfile>("POST", "/api/v1/voices", input),
    sync: () =>
      transport.data<VoiceCatalogSyncResult>("POST", "/api/v1/voices/sync"),
    preview: (input: PreviewVoiceInput) => {
      const { voiceProfileId, ...body } = input;
      return transport.data<SpeechArtifact>(
        "POST",
        `/api/v1/voices/${pathId(voiceProfileId)}/preview`,
        body,
      );
    },
    messageSpeech: (input: GenerateMessageSpeechInput) => {
      const { messageId, ...body } = input;
      return transport.data<SpeechArtifact>(
        "POST",
        `/api/v1/messages/${pathId(messageId)}/speech`,
        body,
      );
    },
    transcribe: (input: TranscribeVoiceInput) =>
      transport.data<TranscriptionResult>(
        "POST",
        "/api/v1/voice/transcriptions",
        input,
      ),
    deleteArtifact: (artifactId: string) =>
      transport.data<VoiceArtifactDeleteResult>(
        "DELETE",
        `/api/v1/voice-artifacts/${pathId(artifactId)}`,
      ),
    bindAgent: (input: BindAgentVoiceInput) => {
      const { agentId, ...body } = input;
      return transport.data<Agent>(
        "POST",
        `/api/v1/agents/${pathId(agentId)}/voice`,
        body,
      );
    },
  };
}
