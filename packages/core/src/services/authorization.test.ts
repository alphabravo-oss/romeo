import type { AuthSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { AgentService } from "./agent-service";
import { ChatService } from "./chat-service";
import { DataConnectorService } from "./data-connector-service";
import { GovernanceService } from "./governance-service";
import { KnowledgeService } from "./knowledge-service";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunService } from "./run-service";
import { canManageServiceAccount } from "./service-account-access";
import { UsageService } from "./usage-service";
import { VoiceService } from "./voice-service";
import { WorkflowService } from "./workflow-service";

const otherUser: AuthSubject = {
  id: "user_other",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: ["chats:read", "runs:read", "runs:cancel"],
  isAdmin: false,
};

describe("service authorization", () => {
  it("blocks chat reads for resources owned by another principal", async () => {
    const chats = new ChatService(new InMemoryRomeoRepository());
    await expect(chats.get("chat_welcome", otherUser)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("blocks run reads and cancels for resources owned by another principal", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createRun({
      id: "run_other_owned",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: "user_dev_admin",
      createdAt: new Date().toISOString(),
    });

    const runs = new RunService(repository, new RunEventSequencer());
    await expect(runs.get("run_other_owned", otherUser)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      runs.cancel("run_other_owned", otherUser),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("blocks agent creation when the caller lacks model grants", async () => {
    const subject: AuthSubject = {
      id: "user_without_model_grant",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["agents:create", "models:use"],
      isAdmin: false,
    };
    const agents = new AgentService(new InMemoryRomeoRepository());

    await expect(
      agents.create({
        subject,
        workspaceId: "workspace_default",
        name: "Unauthorized model agent",
        baseModelId: "model_openai_compatible_default",
        systemPrompt: "Nope.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("filters and blocks agents when the caller lacks object grants", async () => {
    const subject: AuthSubject = {
      id: "user_without_agent_grant",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["agents:read", "agents:write", "models:use"],
      isAdmin: false,
    };
    const agents = new AgentService(new InMemoryRomeoRepository());

    await expect(agents.list("workspace_default", subject)).resolves.toEqual(
      [],
    );
    await expect(
      agents.update({
        subject,
        agentId: "agent_default",
        systemPrompt: "Unauthorized edit.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("creates owner grants for non-admin agent creators", async () => {
    const subject: AuthSubject = {
      id: "user_agent_creator",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: ["group_admins"],
      scopes: ["agents:create", "agents:read", "agents:write", "models:use"],
      isAdmin: false,
    };
    const repository = new InMemoryRomeoRepository();
    const agents = new AgentService(repository);

    const created = await agents.create({
      subject,
      workspaceId: "workspace_default",
      name: "Granted creator agent",
      baseModelId: "model_openai_compatible_default",
      systemPrompt: "Creator can keep editing this agent.",
    });

    await expect(agents.list("workspace_default", subject)).resolves.toEqual([
      created,
    ]);
    await expect(
      agents.update({
        subject,
        agentId: created.id,
        systemPrompt: "Creator edit.",
      }),
    ).resolves.toMatchObject({
      id: created.id,
      systemPrompt: "Creator edit.",
    });
  });

  it("blocks knowledge queries when the caller lacks KB grants", async () => {
    const subject: AuthSubject = {
      id: "user_without_kb_grant",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["knowledge:query"],
      isAdmin: false,
    };
    const knowledge = new KnowledgeService(new InMemoryRomeoRepository());

    await expect(
      knowledge.query({
        subject,
        knowledgeBaseId: "kb_default",
        query: "secret",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("blocks voice preview when the caller lacks voice grants", async () => {
    const subject: AuthSubject = {
      id: "user_without_voice_grant",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["voices:use"],
      isAdmin: false,
    };
    const voices = new VoiceService(new InMemoryRomeoRepository());

    await expect(
      voices.preview({
        subject,
        voiceProfileId: "voice_default",
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("blocks usage reads without the usage scope", async () => {
    const subject: AuthSubject = {
      id: "user_without_usage_scope",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: ["group_admins"],
      scopes: [],
      isAdmin: false,
    };
    const usage = new UsageService(new InMemoryRomeoRepository());

    await expect(
      Promise.resolve().then(() => usage.list(subject)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("blocks data connector sync outside caller workspace access", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createDataConnector({
      id: "connector_workspace_denied",
      orgId: "org_default",
      workspaceId: "workspace_default",
      knowledgeBaseId: "kb_default",
      type: "local_import",
      name: "Workspace denied connector",
      config: { mode: "manual" },
      status: "active",
      createdBy: "user_dev_admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const subject: AuthSubject = {
      id: "user_connector_workspace_denied",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_other"],
      groupIds: [],
      scopes: ["knowledge:read", "knowledge:write"],
      isAdmin: false,
    };
    const connectors = new DataConnectorService(
      repository,
      new KnowledgeService(repository),
    );

    await expect(
      connectors.sync({
        subject,
        connectorId: "connector_workspace_denied",
        items: [
          {
            fileName: "denied.md",
            mimeType: "text/markdown",
            content: "should not import",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      repository.listDataConnectorSyncs(
        "org_default",
        "connector_workspace_denied",
      ),
    ).resolves.toEqual([]);
  });

  it("blocks workflow resume outside caller workspace access", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createWorkflowDefinition({
      id: "workflow_workspace_denied",
      orgId: "org_default",
      workspaceId: "workspace_default",
      name: "Workspace denied workflow",
      steps: [
        {
          id: "step_1",
          type: "agent_run",
          name: "Draft",
          agentId: "agent_default",
        },
      ],
      enabled: true,
      createdBy: "user_dev_admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await repository.createWorkflowRun({
      id: "workflow_run_workspace_denied",
      orgId: "org_default",
      workspaceId: "workspace_default",
      workflowId: "workflow_workspace_denied",
      status: "waiting_run",
      input: {},
      steps: [
        {
          stepId: "step_1",
          type: "agent_run",
          status: "waiting_run",
          output: { runId: "run_missing" },
        },
      ],
      currentStepId: "step_1",
      createdBy: "user_dev_admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const subject: AuthSubject = {
      id: "user_workflow_workspace_denied",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_other"],
      groupIds: [],
      scopes: ["agents:run"],
      isAdmin: false,
    };
    const workflows = new WorkflowService(repository, {} as never);

    await expect(
      workflows.resume({
        subject,
        workflowRunId: "workflow_run_workspace_denied",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      repository.getWorkflowRun("workflow_run_workspace_denied"),
    ).resolves.toMatchObject({
      status: "waiting_run",
      currentStepId: "step_1",
    });
  });

  it("blocks cross-org governed data deletion without deleting the target", async () => {
    const repository = new InMemoryRomeoRepository();
    const governance = new GovernanceService(
      repository,
      new MemoryObjectStore(),
    );
    const subject: AuthSubject = {
      id: "user_other_org_admin",
      type: "user",
      orgId: "org_other",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["admin:write"],
      isAdmin: true,
    };

    await expect(
      governance.executeDataDeletion({
        subject,
        resourceType: "chat",
        resourceId: "chat_welcome",
        confirmResourceId: "chat_welcome",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(repository.getChat("chat_welcome")).resolves.toBeDefined();
  });

  it("does not treat an org admin as a cross-org global admin", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createRun({
      id: "run_cross_org_denied",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: "user_dev_admin",
      createdAt: new Date().toISOString(),
    });
    const subject: AuthSubject = {
      id: "user_other_org_admin",
      type: "user",
      orgId: "org_other",
      workspaceIds: ["workspace_default"],
      groupIds: ["group_admins"],
      scopes: [
        "agents:read",
        "chats:read",
        "knowledge:read",
        "runs:read",
        "admin:write",
      ],
      isAdmin: true,
      adminRole: "org_admin",
    };

    await expect(
      new ChatService(repository).get("chat_welcome", subject),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      new RunService(repository, new RunEventSequencer()).get(
        "run_cross_org_denied",
        subject,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      new AgentService(repository).list("workspace_default", subject),
    ).resolves.toEqual([]);
    await expect(
      new KnowledgeService(repository).list("workspace_default", subject),
    ).resolves.toEqual([]);
    expect(
      canManageServiceAccount(subject, {
        id: "service_account_default",
        orgId: "org_default",
        name: "Default service account",
        scopes: ["agents:run"],
        createdBy: "user_dev_admin",
        createdAt: new Date().toISOString(),
      }),
    ).toBe(false);
  });

  it("keeps explicit global admin cross-org override separate from org admin", async () => {
    const repository = new InMemoryRomeoRepository();
    const subject: AuthSubject = {
      id: "user_platform_admin",
      type: "user",
      orgId: "org_other",
      workspaceIds: [],
      groupIds: ["group_admins"],
      scopes: ["agents:read", "chats:read", "runs:read"],
      isAdmin: true,
      adminRole: "global_admin",
    };

    await expect(
      new AgentService(repository).list("workspace_default", subject),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "agent_default" }),
      ]),
    );
    await expect(
      new ChatService(repository).get("chat_welcome", subject),
    ).resolves.toMatchObject({ id: "chat_welcome" });
  });
});
