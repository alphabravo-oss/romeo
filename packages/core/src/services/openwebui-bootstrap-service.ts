import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";
import type {
  OpenWebUiConfigResponse,
  OpenWebUiSessionUserResponse,
  OpenWebUiVersionResponse,
  OpenWebUiVersionUpdatesResponse,
} from "@romeo/contracts";

import type { RomeoRepository } from "../domain/repository";
import {
  isOpenWebUiAdmin,
  permissionsForSubject,
} from "./openwebui-permissions";

const romeoVersion = "0.1.0";
const deploymentId = "romeo";

export class OpenWebUiBootstrapService {
  constructor(private readonly repository: RomeoRepository) {}

  config(): OpenWebUiConfigResponse {
    return {
      status: true,
      name: "Romeo",
      version: romeoVersion,
      default_locale: "en-US",
      oauth: { providers: {}, auto_redirect: false },
      features: {
        auth: true,
        auth_trusted_header: false,
        enable_signup_password_confirmation: false,
        enable_ldap: false,
        enable_signup: false,
        enable_login_form: true,
        enable_websocket: false,
        enable_api_keys: true,
        enable_password_change_form: false,
        enable_version_update_check: false,
        enable_public_active_users_count: false,
        enable_easter_eggs: false,
        enable_direct_connections: false,
        enable_folders: true,
        folder_max_file_count: 100,
        enable_channels: true,
        enable_calendar: false,
        enable_automations: true,
        enable_notes: false,
        enable_web_search: false,
        enable_code_execution: false,
        enable_code_interpreter: false,
        enable_image_generation: false,
        enable_autocomplete_generation: false,
        enable_community_sharing: false,
        enable_message_rating: false,
        enable_user_webhooks: true,
        enable_user_status: false,
        enable_admin_export: true,
        enable_admin_chat_access: false,
        enable_admin_analytics: true,
        enable_google_drive_integration: false,
        enable_onedrive_integration: false,
        enable_memories: false,
      },
      default_models: [],
      default_pinned_models: [],
      default_prompt_suggestions: [],
      code: { engine: "disabled", interpreter_engine: "disabled" },
      audio: {
        tts: {
          engine: "romeo",
          voice: "Romeo Neutral",
          split_on: "punctuation",
        },
        stt: { engine: "romeo" },
      },
      file: {
        max_size: 10 * 1024 * 1024,
        max_count: 20,
        image_compression: { width: 1600, height: 1600 },
      },
      permissions: {},
      ui: {
        pending_user_overlay_title: "",
        pending_user_overlay_content: "",
        response_watermark: "",
        iframe_csp: "",
      },
      license_metadata: null,
    };
  }

  version(): OpenWebUiVersionResponse {
    return { version: romeoVersion, deployment_id: deploymentId };
  }

  versionUpdates(): OpenWebUiVersionUpdatesResponse {
    return { current: romeoVersion, latest: romeoVersion };
  }

  async sessionUser(
    subject: AuthSubject,
  ): Promise<OpenWebUiSessionUserResponse> {
    assertScope(subject, "me:read");
    if (subject.type !== "user") {
      throw new AuthorizationError(
        "OpenWebUI session compatibility is available only for user subjects.",
      );
    }
    const user = await this.repository.getCurrentUser(subject.id);
    if (
      user === undefined ||
      user.orgId !== subject.orgId ||
      user.disabledAt !== undefined
    ) {
      throw new AuthorizationError("User session is no longer active.");
    }
    return {
      token: null,
      token_type: "Bearer",
      expires_at: null,
      id: user.id,
      email: user.email,
      name: user.name,
      role: isOpenWebUiAdmin(subject) ? "admin" : "user",
      profile_image_url: "",
      permissions: permissionsForSubject(subject),
      bio: null,
      gender: null,
      date_of_birth: null,
      status_emoji: "",
      status_message: "",
      status_expires_at: null,
    };
  }
}
