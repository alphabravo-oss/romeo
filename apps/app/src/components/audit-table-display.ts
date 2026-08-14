import type { MessageKey } from "../lib/i18n";
import type { AuditCategory } from "./audit-table-query";

type Translate = (key: MessageKey) => string;

export function humanizeAuditAction(action: string): string {
  const words = action.replaceAll(".", " ").replaceAll("_", " ").trim();
  if (words.length === 0) return action;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function displayAuditActor(actorId: string, t: Translate): string {
  if (
    actorId.startsWith("system_") ||
    actorId.includes("service_account_audit")
  ) {
    return t("auditActorSystem");
  }
  const words = actorId.replace(/[._-]+/gu, " ").trim();
  if (words.length === 0) return actorId;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function classifyAuditAction(action: string): AuditCategory {
  if (
    action === "provider.models.sync" ||
    action === "worker.enqueue" ||
    action === "model.request" ||
    action.startsWith("worker.")
  ) {
    return "system";
  }
  if (
    action.startsWith("local_auth.") ||
    action.startsWith("auth.") ||
    action.startsWith("support.") ||
    action.startsWith("scim.") ||
    action.startsWith("directory_sync.")
  ) {
    return "security";
  }
  if (
    action.includes("share") ||
    action.includes("favorite") ||
    action.startsWith("group.") ||
    action.startsWith("api_key.") ||
    action.startsWith("service_account.")
  ) {
    return "access";
  }
  if (
    action.startsWith("knowledge.") ||
    action.startsWith("file.") ||
    action.startsWith("connector.") ||
    action.startsWith("folder.")
  ) {
    return "data";
  }
  if (action.startsWith("chat.") || action.startsWith("chat_experience.")) {
    return "chat";
  }
  if (
    action.startsWith("run.") ||
    action.startsWith("tool.") ||
    action.startsWith("eval.") ||
    action.startsWith("workflow.") ||
    action.startsWith("voice.")
  ) {
    return "run";
  }
  return "admin";
}

export function categoryMessageKey(category: AuditCategory): MessageKey {
  if (category === "security") return "auditCategorySecurity";
  if (category === "admin") return "auditCategoryAdmin";
  if (category === "access") return "auditCategoryAccess";
  if (category === "data") return "auditCategoryData";
  if (category === "chat") return "auditCategoryChat";
  if (category === "run") return "auditCategoryRun";
  return "auditCategorySystem";
}

export function categoryTone(
  category: AuditCategory,
): "danger" | "info" | "neutral" | "success" | "warning" {
  if (category === "security") return "danger";
  if (category === "admin") return "info";
  if (category === "system") return "neutral";
  if (category === "run") return "success";
  return "warning";
}
