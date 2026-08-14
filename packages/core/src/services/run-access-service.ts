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
import { workspaceIdsFromGrants } from "./access-visibility";

/** Stable, detail-free stream termination used after headers have been sent. */
export class RunStreamAccessEnded extends Error {
  readonly code = "run_stream_access_ended";

  constructor() {
    super("Run stream access ended.");
    this.name = "RunStreamAccessEnded";
  }
}

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

  /**
   * Rebuilds a long-lived stream principal from current credential, identity,
   * membership, and grant state. Callers intentionally receive no reason for
   * termination because the stream may already have emitted response headers.
   */
  async assertCurrentStreamAccess(
    runId: string,
    subject: AuthSubject,
  ): Promise<void> {
    try {
      const current = await this.currentStreamSubject(subject);
      await this.getAuthorizedRun(runId, current, "runs:read");
    } catch {
      throw new RunStreamAccessEnded();
    }
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

  private async currentStreamSubject(
    subject: AuthSubject,
  ): Promise<AuthSubject> {
    if (subject.sessionId !== undefined)
      return this.currentSessionSubject(subject);
    if (subject.apiKeyId !== undefined)
      return this.currentApiKeySubject(subject);
    if (subject.type === "service_account")
      return this.currentServiceAccountSubject(subject);
    const user = await this.repository.getCurrentUser(subject.id);
    if (
      user === undefined ||
      user.orgId !== subject.orgId ||
      user.disabledAt !== undefined
    )
      throw new Error("principal unavailable");
    return createUserAuthSubject(this.repository, user, {
      sessionScopes: subject.scopes,
    });
  }

  private async currentSessionSubject(
    subject: AuthSubject,
  ): Promise<AuthSubject> {
    const session = await this.repository.getUserSession(subject.sessionId!);
    const expiresAt = Date.parse(session?.expiresAt ?? "");
    if (
      session === undefined ||
      session.orgId !== subject.orgId ||
      session.userId !== subject.id ||
      session.revokedAt !== undefined ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    )
      throw new Error("credential unavailable");
    const user = await this.repository.getCurrentUser(session.userId);
    if (
      user === undefined ||
      user.orgId !== subject.orgId ||
      user.disabledAt !== undefined
    )
      throw new Error("principal unavailable");
    return createUserAuthSubject(this.repository, user, {
      sessionId: session.id,
      sessionScopes: session.scopes,
      // Session elevation remains bounded by the current session lifecycle.
      forceAdmin: session.isAdmin,
      ...(subject.supportSession === undefined
        ? {}
        : { supportSession: subject.supportSession }),
    });
  }

  private async currentApiKeySubject(
    subject: AuthSubject,
  ): Promise<AuthSubject> {
    const apiKey = await this.repository.getApiKey(subject.apiKeyId!);
    if (
      apiKey === undefined ||
      apiKey.orgId !== subject.orgId ||
      apiKey.revokedAt !== undefined
    )
      throw new Error("credential unavailable");
    if (apiKey.serviceAccountId !== undefined) {
      if (
        subject.type !== "service_account" ||
        apiKey.serviceAccountId !== subject.id
      )
        throw new Error("credential owner changed");
      return this.currentServiceAccountSubject(subject, apiKey.scopes);
    }
    if (
      subject.type !== "user" ||
      apiKey.userId === undefined ||
      apiKey.userId !== subject.id
    )
      throw new Error("credential owner changed");
    const user = await this.repository.getCurrentUser(apiKey.userId);
    if (
      user === undefined ||
      user.orgId !== subject.orgId ||
      user.disabledAt !== undefined
    )
      throw new Error("principal unavailable");
    const [workspaces, memberships, grants] = await Promise.all([
      this.repository.listWorkspaces(subject.orgId),
      this.repository.listGroupMemberships(subject.orgId, undefined, user.id),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    const groupIds = memberships.map((membership) => membership.groupId).sort();
    return {
      id: user.id,
      type: "user",
      apiKeyId: apiKey.id,
      orgId: subject.orgId,
      workspaceIds: workspaceIdsFromGrants(workspaces, grants, {
        id: user.id,
        type: "user",
        groupIds,
      }),
      groupIds,
      scopes: apiKey.scopes,
      isAdmin: false,
    };
  }

  private async currentServiceAccountSubject(
    subject: AuthSubject,
    credentialScopes: Scope[] = subject.scopes,
  ): Promise<AuthSubject> {
    const account = await this.repository.getServiceAccount(subject.id);
    if (
      account === undefined ||
      account.orgId !== subject.orgId ||
      account.disabledAt !== undefined
    )
      throw new Error("principal unavailable");
    const workspaces = await this.repository.listWorkspaces(subject.orgId);
    return {
      id: account.id,
      type: "service_account",
      name: account.name,
      ...(subject.apiKeyId === undefined ? {} : { apiKeyId: subject.apiKeyId }),
      orgId: account.orgId,
      workspaceIds: workspaces.map((workspace) => workspace.id),
      groupIds: [],
      scopes: credentialScopes.filter((scope) =>
        account.scopes.includes(scope),
      ),
      isAdmin: false,
    };
  }
}
