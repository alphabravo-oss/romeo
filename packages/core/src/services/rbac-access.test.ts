import { describe, expect, it } from "vitest";

import { hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";
import { defaultProviderCapabilities } from "@romeo/providers";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { assertUsableAgentModel } from "./agent-service-support";
import { createUserAuthSubject } from "./auth-subject";
import { CollaborationShareService } from "./collaboration-share-service";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import { KnowledgeService } from "./knowledge-service";
import { ProviderService } from "./provider-service";
import { WorkspaceService } from "./workspace-service";

const now = "2026-08-12T00:00:00.000Z";

function memberUser() {
  return {
    id: "user_rbac_member",
    orgId: "org_default",
    email: "member@romeo.local",
    name: "Member",
    role: "user" as const,
  };
}

describe("RBAC workspace membership", () => {
  it("limits non-admin subjects to granted workspaces and still lets admins through", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createWorkspace({
      id: "workspace_alpha",
      orgId: "org_default",
      name: "Alpha",
      slug: "alpha",
    });
    await repository.createWorkspace({
      id: "workspace_beta",
      orgId: "org_default",
      name: "Beta",
      slug: "beta",
    });
    const user = await repository.createUser(memberUser());
    await repository.createResourceGrant({
      id: "grant_ws_alpha",
      resourceType: "workspace",
      resourceId: "workspace_alpha",
      principalType: "user",
      principalId: user.id,
      permission: "read",
    });

    const member = await createUserAuthSubject(repository, user);
    expect(member.workspaceIds).toEqual(["workspace_alpha"]);
    expect(hasWorkspaceAccess(member, "workspace_alpha")).toBe(true);
    expect(hasWorkspaceAccess(member, "workspace_beta")).toBe(false);

    const admin = await createUserAuthSubject(repository, {
      id: "user_dev_admin",
      orgId: "org_default",
      email: "admin@romeo.local",
      name: "Admin",
      role: "global_admin",
    });
    expect(admin.workspaceIds).toEqual(
      expect.arrayContaining([
        "workspace_default",
        "workspace_alpha",
        "workspace_beta",
      ]),
    );
    expect(hasWorkspaceAccess(admin, "workspace_beta")).toBe(true);

    const workspaces = new WorkspaceService(repository);
    const memberBootstrap = await workspaces.bootstrap(member);
    expect(memberBootstrap.workspaces.map((workspace) => workspace.id)).toEqual(
      ["workspace_alpha"],
    );
    await expect(
      new KnowledgeService(repository).list("workspace_beta", member),
    ).rejects.toMatchObject({
      message: "The workspace is outside the caller access.",
    });

    const adminBootstrap = await workspaces.bootstrap(admin);
    expect(adminBootstrap.workspaces.map((workspace) => workspace.id)).toEqual(
      expect.arrayContaining([
        "workspace_default",
        "workspace_alpha",
        "workspace_beta",
      ]),
    );
  });
});

describe("RBAC model lists", () => {
  it("returns only granted enabled models and still denies use without a grant", async () => {
    const repository = new InMemoryRomeoRepository();
    const user = await repository.createUser(memberUser());
    const provider = await repository.createProvider({
      id: "provider_rbac",
      orgId: "org_default",
      type: "openai-compatible",
      name: "RBAC provider",
      baseUrl: "https://models.example.test/v1",
      enabled: true,
      capabilities: defaultProviderCapabilities("openai-compatible"),
    });
    await repository.upsertModels([
      {
        id: "model_allowed",
        providerId: provider.id,
        name: "allowed",
        displayName: "Allowed",
        enabled: true,
        capabilities: defaultProviderCapabilities("openai-compatible"),
        contextWindow: 8000,
      },
      {
        id: "model_hidden",
        providerId: provider.id,
        name: "hidden",
        displayName: "Hidden",
        enabled: true,
        capabilities: defaultProviderCapabilities("openai-compatible"),
        contextWindow: 8000,
      },
    ]);
    await repository.createResourceGrant({
      id: "grant_ws_model_test",
      resourceType: "workspace",
      resourceId: "workspace_default",
      principalType: "user",
      principalId: user.id,
      permission: "read",
    });
    await repository.createResourceGrant({
      id: "grant_provider_rbac",
      resourceType: "provider",
      resourceId: provider.id,
      principalType: "user",
      principalId: user.id,
      permission: "use",
    });
    await repository.createResourceGrant({
      id: "grant_model_allowed",
      resourceType: "model",
      resourceId: "model_allowed",
      principalType: "user",
      principalId: user.id,
      permission: "use",
    });

    const subject = await createUserAuthSubject(repository, user);
    const service = new ProviderService(repository);
    const listed = await service.models(subject);
    expect(listed.map((model) => model.id)).toEqual(["model_allowed"]);

    await expect(
      assertUsableAgentModel(repository, subject, "model_hidden"),
    ).rejects.toMatchObject({
      message: "Missing use permission for model:model_hidden",
    });
  });
});

describe("RBAC knowledge lists", () => {
  it("hides ungranted collections and still authorizes granted ones", async () => {
    const repository = new InMemoryRomeoRepository();
    const user = await repository.createUser(memberUser());
    await repository.createResourceGrant({
      id: "grant_ws_member_default",
      resourceType: "workspace",
      resourceId: "workspace_default",
      principalType: "user",
      principalId: user.id,
      permission: "read",
    });
    await repository.createKnowledgeBase({
      id: "kb_visible",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Visible",
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createKnowledgeBase({
      id: "kb_hidden",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Hidden",
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    });
    await repository.createResourceGrant({
      id: "grant_kb_visible",
      resourceType: "knowledge_base",
      resourceId: "kb_visible",
      principalType: "user",
      principalId: user.id,
      permission: "use",
    });

    const subject = await createUserAuthSubject(repository, user);
    const listed = await new KnowledgeService(repository).list(
      "workspace_default",
      subject,
    );
    expect(listed.map((item) => item.id)).toEqual(["kb_visible"]);

    await expect(
      getAuthorizedKnowledgeBase(repository, {
        knowledgeBaseId: "kb_hidden",
        subject,
        scope: "knowledge:query",
        permission: "use",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("knowledge_base:kb_hidden"),
    });
    await expect(
      getAuthorizedKnowledgeBase(repository, {
        knowledgeBaseId: "kb_visible",
        subject,
        scope: "knowledge:query",
        permission: "use",
      }),
    ).resolves.toMatchObject({ id: "kb_visible" });
  });
});

describe("RBAC grant and revoke", () => {
  it("grants and revokes model and knowledge access for users and groups", async () => {
    const repository = new InMemoryRomeoRepository();
    const member = await repository.createUser(memberUser());
    await repository.createGroup({
      id: "group_rbac",
      orgId: "org_default",
      name: "RBAC",
      slug: "rbac",
      createdAt: now,
    });
    const admin: AuthSubject = {
      id: "user_dev_admin",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: ["group_admins"],
      scopes: [],
      isAdmin: true,
      adminRole: "global_admin",
    };
    const shares = new CollaborationShareService(repository);

    const modelGrants = await shares.shareModel({
      subject: admin,
      modelId: "model_openai_compatible_default",
      share: {
        principalType: "user",
        principalId: member.id,
        permissions: ["use"],
      },
    });
    expect(modelGrants.map((grant) => grant.permission)).toEqual(["use"]);
    const listedModels = await shares.listModelShares(
      admin,
      "model_openai_compatible_default",
    );
    expect(
      listedModels.some(
        (grant) =>
          grant.principalId === member.id && grant.permission === "use",
      ),
    ).toBe(true);
    const revokedModel = await shares.revokeModelGrant({
      subject: admin,
      modelId: "model_openai_compatible_default",
      grantId: modelGrants[0]!.id,
    });
    expect(revokedModel.id).toBe(modelGrants[0]!.id);

    const knowledgeGrants = await shares.shareKnowledgeBase({
      subject: admin,
      knowledgeBaseId: "kb_default",
      share: {
        principalType: "group",
        principalId: "group_rbac",
        permissions: ["read", "use"],
      },
    });
    expect(knowledgeGrants.map((grant) => grant.permission).sort()).toEqual([
      "read",
      "use",
    ]);
    const listedKnowledge = await shares.listKnowledgeBaseShares(
      admin,
      "kb_default",
    );
    expect(
      listedKnowledge.some(
        (grant) =>
          grant.principalType === "group" &&
          grant.principalId === "group_rbac",
      ),
    ).toBe(true);
    const revokedKnowledge = await shares.revokeKnowledgeBaseGrant({
      subject: admin,
      knowledgeBaseId: "kb_default",
      grantId: knowledgeGrants[0]!.id,
    });
    expect(revokedKnowledge.id).toBe(knowledgeGrants[0]!.id);

    const workspaceGrants = await shares.shareWorkspace({
      subject: admin,
      workspaceId: "workspace_default",
      share: {
        principalType: "user",
        principalId: member.id,
        permissions: ["read"],
      },
    });
    expect(workspaceGrants).toHaveLength(1);
    const members = await shares.listWorkspaceMembers(
      admin,
      "workspace_default",
    );
    expect(members.some((grant) => grant.principalId === member.id)).toBe(true);
    await shares.revokeWorkspaceMember({
      subject: admin,
      workspaceId: "workspace_default",
      grantId: workspaceGrants[0]!.id,
    });
    const after = await shares.listWorkspaceMembers(
      admin,
      "workspace_default",
    );
    expect(after.some((grant) => grant.id === workspaceGrants[0]!.id)).toBe(
      false,
    );
  });
});
