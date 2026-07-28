import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
  type Scope,
} from "@romeo/auth";

import type { RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { canReadChat, canWriteChat } from "./chat-access";
import { createUserAuthSubject } from "./auth-subject";

export class RunAccessService {
  constructor(private readonly repository: RomeoRepository) {}

  async getAuthorizedRun(
    runId: string,
    subject: AuthSubject,
    scope: "runs:read" | "runs:cancel",
  ): Promise<RunRecord> {
    assertScope(subject, scope);
    const run = await this.repository.getRun(runId);
    if (!run) throw notFound("Run");
    if (!canAccessOrg(subject, run.orgId))
      throw new AuthorizationError(
        "The run is outside the caller organization.",
      );
    if (!hasWorkspaceAccess(subject, run.workspaceId))
      throw new AuthorizationError(
        "The run is outside the caller workspace access.",
      );
    if (run.createdBy === subject.id || subject.isAdmin === true) return run;
    const chat = await this.repository.getChat(run.chatId);
    if (!chat) throw notFound("Chat");
    const grants = await this.repository.listResourceGrants(subject.orgId);
    const allowed =
      scope === "runs:read"
        ? canReadChat(subject, grants, chat)
        : canWriteChat(subject, grants, chat);
    if (!allowed)
      throw new AuthorizationError("The run is owned by another principal.");
    return run;
  }

  async subjectFromSnapshot(input: {
    orgId: string;
    workspaceId: string;
    principalId: string;
    principalType: "user" | "service_account";
    scopeSnapshot: Scope[];
  }): Promise<AuthSubject> {
    if (input.principalType === "service_account") {
      const account = await this.repository.getServiceAccount(
        input.principalId,
      );
      if (
        account === undefined ||
        account.orgId !== input.orgId ||
        account.disabledAt !== undefined
      )
        throw new ApiError(
          "run_actor_unavailable",
          "The run actor is no longer available.",
          409,
        );
      return {
        id: account.id,
        type: "service_account",
        name: account.name,
        orgId: account.orgId,
        workspaceIds: [input.workspaceId],
        groupIds: [],
        scopes: account.scopes.filter((scope) =>
          input.scopeSnapshot.includes(scope),
        ),
        isAdmin: false,
      };
    }
    const user = await this.repository.getCurrentUser(input.principalId);
    if (
      user === undefined ||
      user.orgId !== input.orgId ||
      user.disabledAt !== undefined
    )
      throw new ApiError(
        "run_actor_unavailable",
        "The run actor is no longer available.",
        409,
      );
    const subject = await createUserAuthSubject(this.repository, user, {
      sessionScopes: input.scopeSnapshot,
    });
    return {
      ...subject,
      workspaceIds: subject.workspaceIds.filter(
        (workspaceId) => workspaceId === input.workspaceId,
      ),
    };
  }
}
