import type { AuthSubject, Scope } from "@romeo/auth";

export interface OpenWebUiPermissions {
  workspace: Record<string, boolean>;
  features: Record<string, boolean>;
  chat: Record<string, boolean>;
  sharing: Record<string, boolean>;
  settings: Record<string, boolean>;
  access_grants: Record<string, boolean>;
}

export function isOpenWebUiAdmin(subject: AuthSubject): boolean {
  return (
    subject.isAdmin === true ||
    subject.groupIds.includes("group_admins") ||
    subject.scopes.includes("admin:read") ||
    subject.scopes.includes("admin:write")
  );
}

export function permissionsForSubject(
  subject: AuthSubject,
): OpenWebUiPermissions {
  const can = (scope: Scope) => subject.scopes.includes(scope);
  const canAny = (...scopes: Scope[]) => scopes.some((scope) => can(scope));
  return {
    workspace: {
      models: canAny("models:read", "models:use"),
      models_import: can("models:read"),
      models_export: can("models:read"),
      knowledge: can("knowledge:read"),
      prompts: can("agents:read"),
      prompts_import: can("agents:write"),
      prompts_export: can("agents:read"),
      tools: canAny("tools:use", "tools:manage"),
      tools_import: can("tools:manage"),
      tools_export: can("tools:manage"),
      skills: false,
    },
    features: {
      api_keys: can("admin:write"),
      automations: canAny("runs:create", "agents:run"),
      calendar: false,
      channels: can("chats:read"),
      code_interpreter: false,
      direct_tool_servers: can("tools:manage"),
      folders: can("chats:read"),
      image_generation: false,
      memories: false,
      notes: false,
      web_search: false,
    },
    chat: {
      call: can("runs:create"),
      continue_response: can("runs:create"),
      controls: can("runs:create"),
      delete_message: can("chats:write"),
      edit: can("chats:write"),
      export: can("chats:read"),
      file_upload: can("chats:write"),
      multiple_models: false,
      rate_response: false,
      regenerate_response: can("runs:create"),
      share: can("chats:read"),
      stt: can("voices:use"),
      temporary: can("runs:create"),
      temporary_enforced: false,
      tts: can("voices:use"),
      valves: false,
      web_upload: can("knowledge:write"),
    },
    sharing: {
      knowledge: can("knowledge:read"),
      models: can("models:read"),
      notes: false,
      prompts: can("agents:read"),
      public_chats: false,
      public_knowledge: false,
      public_models: false,
      public_notes: false,
      public_prompts: false,
      public_skills: false,
      public_tools: false,
      skills: false,
      tools: can("tools:use"),
    },
    settings: { interface: true },
    access_grants: { allow_users: false },
  };
}
