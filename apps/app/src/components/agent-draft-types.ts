import type {
  Agent,
  AgentMemoryPolicy,
  AgentSafetySettings,
} from "../features/managed-models/types";
import type { BaseModel, Provider } from "../features/providers/types";

export interface AgentDraftInput {
  agentId: string;
  name: string;
  description: string;
  icon: string;
  avatarUrl: string;
  baseModelId: string;
  systemPrompt: string;
  parameters: Record<string, unknown>;
  memoryPolicy: AgentMemoryPolicy;
  safetySettings: AgentSafetySettings;
  promptSuggestions: Array<{ title: string; prompt: string }>;
  tags: string[];
}

export interface AgentDraftFormProps {
  activeAgent: Agent | undefined;
  formId?: string;
  isSaving: boolean;
  models: BaseModel[];
  providers: Provider[];
  onDirtyChange: (dirty: boolean) => void;
  onNotice: (message: string) => void;
  onSave: (input: AgentDraftInput) => Promise<Agent>;
  showSubmit?: boolean;
}
