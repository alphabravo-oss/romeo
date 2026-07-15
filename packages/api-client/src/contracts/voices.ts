export interface VoiceProfile {
  id: string;
  orgId: string;
  providerId: string;
  providerVoiceId: string;
  name: string;
  language: string;
  styleTags: string[];
  cloningAllowed: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface CreateVoiceProfileInput {
  name: string;
  providerVoiceId: string;
  language: string;
  styleTags: string[];
}

export interface VoiceCatalogSyncResult {
  imported: number;
  existing: number;
  providerVoiceCount: number;
  profiles: VoiceProfile[];
}

export interface PreviewVoiceInput {
  voiceProfileId: string;
  text: string;
}

export interface GenerateMessageSpeechInput {
  messageId: string;
  voiceProfileId: string;
}

export interface TranscribeVoiceInput {
  audioBase64: string;
  contentType: string;
  fileName?: string;
  language?: string;
  prompt?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationMs?: number;
}

export interface SpeechArtifact {
  id: string;
  contentType: string;
  durationMs?: number;
  playbackUrl: string;
  deleteUrl: string;
  redaction: { rawStorageKeyReturned: false };
}

export interface VoiceArtifactDeleteResult {
  artifactId: string;
  deleted: boolean;
  deletedAt: string;
  storageKeyHash: string;
  redaction: { rawStorageKeyReturned: false };
}

export interface BindAgentVoiceInput {
  agentId: string;
  voiceProfileId: string;
}
