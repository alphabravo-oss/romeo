import { describe, expect, it } from "vitest";

import {
  classifyAuditAction,
  isAuditNoise,
  isSystemAuditActor,
} from "./audit-classification";

describe("audit classification", () => {
  it("treats successful catalog syncs as background noise but keeps failures visible", () => {
    expect(
      isAuditNoise({ action: "provider.models.sync", outcome: "success" }),
    ).toBe(true);
    expect(
      isAuditNoise({ action: "provider.models.sync", outcome: "failure" }),
    ).toBe(false);
    expect(classifyAuditAction("chat.archive")).toBe("chat");
    expect(classifyAuditAction("local_auth.login")).toBe("security");
    expect(classifyAuditAction("model.pricing.update")).toBe("admin");
    expect(classifyAuditAction("folder.create")).toBe("data");
    expect(classifyAuditAction("run.completed")).toBe("run");
    expect(isSystemAuditActor("system_service_account_audit_abc")).toBe(true);
    expect(isSystemAuditActor("user_dev_admin")).toBe(false);
  });
});
