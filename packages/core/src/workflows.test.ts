import { describe, expect, it } from "vitest";

import { MemoryObjectStore } from "@romeo/storage";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("workflow API", () => {
  it("creates approval-gated workflows and completes runs after approval", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Review then notify",
        steps: [
          { type: "agent_run", name: "Draft", agentId: "agent_default" },
          {
            type: "approval",
            name: "Human review",
            approvalPrompt: "Approve the draft before notification.",
          },
          {
            type: "notification",
            name: "Notify requester",
            message: "Approved.",
          },
        ],
      }),
    });
    const workflow = await createResponse.json();
    const listResponse = await api.request(
      "/api/v1/workflows?workspaceId=workspace_default",
    );
    const list = await listResponse.json();

    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            requestId: "req_1",
            prompt: "Draft a release approval summary.",
          },
        }),
      },
    );
    const run = await runResponse.json();
    const agentStepOutput = run.data.steps[0].output;
    const modelRun = await waitForRun(api, agentStepOutput.runId);
    const modelMessagesResponse = await api.request(
      `/api/v1/chats/${agentStepOutput.chatId}/messages`,
    );
    const modelMessages = await modelMessagesResponse.json();
    const resumeResponse = await api.request(
      `/api/v1/workflow-runs/${run.data.id}/resume`,
      { method: "POST" },
    );
    const resumed = await resumeResponse.json();
    const approveResponse = await api.request(
      `/api/v1/workflow-runs/${resumed.data.id}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "Looks good." }),
      },
    );
    const approved = await approveResponse.json();
    const runListResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
    );
    const runList = await runListResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.run.approve",
    );
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(workflow.data.steps.map((step: { id: string }) => step.id)).toEqual([
      "step_1",
      "step_2",
      "step_3",
    ]);
    expect(list.data).toHaveLength(1);
    expect(runResponse.status).toBe(201);
    expect(run.data.status).toBe("waiting_run");
    expect(run.data.currentStepId).toBe("step_1");
    expect(run.data.steps[0]).toMatchObject({
      stepId: "step_1",
      status: "waiting_run",
      output: {
        agentId: "agent_default",
        executionMode: "model_run_started",
        runStatus: "running",
      },
    });
    expect(modelRun.status).toBe("completed");
    expect(modelMessages.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "Draft a release approval summary.",
        }),
        expect.objectContaining({ role: "assistant" }),
      ]),
    );
    expect(resumeResponse.status).toBe(200);
    expect(resumed.data.status).toBe("waiting_approval");
    expect(resumed.data.currentStepId).toBe("step_2");
    expect(resumed.data.steps[0]).toMatchObject({
      stepId: "step_1",
      status: "completed",
      output: { runStatus: "completed" },
    });
    expect(approveResponse.status).toBe(200);
    expect(approved.data.status).toBe("completed");
    expect(approved.data.currentStepId).toBeUndefined();
    expect(approved.data.steps[1]).toMatchObject({
      stepId: "step_2",
      status: "completed",
      output: { approvedBy: "user_dev_admin" },
    });
    expect(approved.data.steps[2]).toMatchObject({
      stepId: "step_3",
      status: "completed",
      output: { delivery: "not_configured" },
    });
    expect(runList.data).toHaveLength(1);
    expect(audit.data).toHaveLength(1);
  });

  it("rejects invalid workflow steps before creating a definition", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Invalid workflow",
        steps: [{ type: "agent_run", name: "Missing agent" }],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  it("hands completed agent output to a later agent step without storing raw content in step output", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Draft handoff flow",
        steps: [
          { type: "agent_run", name: "Draft", agentId: "agent_default" },
          {
            type: "agent_handoff",
            name: "Review",
            agentId: "agent_default",
            handoffFromStepId: "step_1",
            handoffPrompt:
              "Review the upstream draft and produce a final response.",
          },
          { type: "notification", name: "Record done", message: "Done." },
        ],
      }),
    });
    const workflow = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { prompt: "Draft a compact launch note." },
        }),
      },
    );
    const run = await runResponse.json();
    const draftOutput = run.data.steps[0].output;
    await waitForRun(api, draftOutput.runId);

    const handoffResponse = await api.request(
      `/api/v1/workflow-runs/${run.data.id}/resume`,
      { method: "POST" },
    );
    const handoff = await handoffResponse.json();
    const handoffOutput = handoff.data.steps[1].output;
    const handoffMessagesResponse = await api.request(
      `/api/v1/chats/${handoffOutput.chatId}/messages`,
    );
    const handoffMessages = await handoffMessagesResponse.json();
    await waitForRun(api, handoffOutput.runId);

    const completedResponse = await api.request(
      `/api/v1/workflow-runs/${handoff.data.id}/resume`,
      { method: "POST" },
    );
    const completed = await completedResponse.json();

    expect(createResponse.status).toBe(201);
    expect(workflow.data.steps[1]).toMatchObject({
      id: "step_2",
      type: "agent_handoff",
      agentId: "agent_default",
      handoffFromStepId: "step_1",
    });
    expect(handoffResponse.status).toBe(200);
    expect(handoff.data.status).toBe("waiting_run");
    expect(handoff.data.currentStepId).toBe("step_2");
    expect(handoffOutput).toMatchObject({
      executionMode: "agent_handoff_started",
      handoffFromStepId: "step_1",
      sourceChatId: draftOutput.chatId,
      sourceRunId: draftOutput.runId,
      runStatus: "running",
    });
    expect(handoffOutput.handoffContextCharacters).toBeGreaterThan(0);
    expect(JSON.stringify(handoffOutput)).not.toContain(
      "Draft a compact launch note.",
    );
    expect(JSON.stringify(handoffOutput)).not.toContain(
      "Romeo OpenAI-compatible response:",
    );
    expect(handoffMessages.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("Prior assistant output:"),
        }),
      ]),
    );
    expect(JSON.stringify(handoffMessages.data)).toContain(
      "Romeo OpenAI-compatible response:",
    );
    expect(completedResponse.status).toBe(200);
    expect(completed.data.status).toBe("completed");
    expect(completed.data.steps[1]).toMatchObject({
      stepId: "step_2",
      status: "completed",
      output: { runStatus: "completed" },
    });
    expect(completed.data.steps[2]).toMatchObject({
      stepId: "step_3",
      status: "completed",
      output: { delivery: "not_configured" },
    });
  });

  it("retries cancelled agent steps through explicit recovery policy", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Retry recovery flow",
        steps: [
          {
            type: "agent_run",
            name: "Draft",
            agentId: "agent_default",
            retryPolicy: { maxAttempts: 2 },
          },
          { type: "notification", name: "Record done", message: "Done." },
        ],
      }),
    });
    const workflow = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { prompt: "Draft a retryable note." } }),
      },
    );
    const run = await runResponse.json();
    const firstOutput = run.data.steps[0].output;
    const cancelResponse = await api.request(
      `/api/v1/runs/${firstOutput.runId}/cancel`,
      { method: "POST" },
    );
    const cancelled = await cancelResponse.json();

    const retryResponse = await api.request(
      `/api/v1/workflow-runs/${run.data.id}/resume`,
      { method: "POST" },
    );
    const retried = await retryResponse.json();
    const retryOutput = retried.data.steps[0].output;
    await waitForRun(api, retryOutput.runId);

    const completedResponse = await api.request(
      `/api/v1/workflow-runs/${retried.data.id}/resume`,
      { method: "POST" },
    );
    const completed = await completedResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.run.retry",
    );
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(workflow.data.steps[0]).toMatchObject({
      type: "agent_run",
      retryPolicy: { maxAttempts: 2 },
    });
    expect(cancelResponse.status).toBe(200);
    expect(cancelled.data.status).toBe("cancelled");
    expect(retryResponse.status).toBe(200);
    expect(retried.data.status).toBe("waiting_run");
    expect(retried.data.currentStepId).toBe("step_1");
    expect(retryOutput).toMatchObject({
      executionMode: "model_run_started",
      attempt: 2,
      maxAttempts: 2,
      previousAttempts: [{ runId: firstOutput.runId, status: "cancelled" }],
      runStatus: "running",
    });
    expect(retryOutput.runId).not.toBe(firstOutput.runId);
    expect(JSON.stringify(retryOutput)).not.toContain(
      "Draft a retryable note.",
    );
    expect(completedResponse.status).toBe(200);
    expect(completed.data.status).toBe("completed");
    expect(completed.data.steps[0]).toMatchObject({
      stepId: "step_1",
      status: "completed",
      output: { attempt: 2, runStatus: "completed" },
    });
    expect(audit.data).toHaveLength(1);
    expect(audit.data[0].metadata).toMatchObject({
      currentStepId: "step_1",
      linkedRunStatus: "cancelled",
      attempt: 2,
    });
    expect(JSON.stringify(audit.data[0].metadata)).not.toContain(
      "Draft a retryable note.",
    );
  });

  it("continues into escalation steps when recovery policy allows failed agent steps", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Escalation recovery flow",
        steps: [
          {
            type: "agent_run",
            name: "Draft",
            agentId: "agent_default",
            recoveryPolicy: { onFailure: "continue" },
          },
          {
            type: "tool_approval",
            name: "Escalate",
            toolChainName: "incident_escalation",
            riskLevel: "medium",
            inputKeys: ["incidentId"],
          },
        ],
      }),
    });
    const workflow = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { prompt: "Draft an incident update.", incidentId: "INC-123" },
        }),
      },
    );
    const run = await runResponse.json();
    const firstOutput = run.data.steps[0].output;
    await api.request(`/api/v1/runs/${firstOutput.runId}/cancel`, {
      method: "POST",
    });

    const recoveredResponse = await api.request(
      `/api/v1/workflow-runs/${run.data.id}/resume`,
      { method: "POST" },
    );
    const recovered = await recoveredResponse.json();
    const approveResponse = await api.request(
      `/api/v1/workflow-runs/${recovered.data.id}/approve`,
      { method: "POST" },
    );
    const approved = await approveResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.run.recover",
    );
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(workflow.data.steps[0]).toMatchObject({
      type: "agent_run",
      recoveryPolicy: { onFailure: "continue" },
    });
    expect(recoveredResponse.status).toBe(200);
    expect(recovered.data.status).toBe("waiting_approval");
    expect(recovered.data.currentStepId).toBe("step_2");
    expect(recovered.data.steps[0]).toMatchObject({
      stepId: "step_1",
      status: "completed",
      output: {
        runStatus: "cancelled",
        recoveryAction: "continued_after_failure",
      },
    });
    expect(recovered.data.steps[1]).toMatchObject({
      stepId: "step_2",
      type: "tool_approval",
      status: "waiting_approval",
      output: {
        approvalKind: "tool_chain",
        toolChainName: "incident_escalation",
        inputKeys: ["incidentId"],
      },
    });
    expect(JSON.stringify(recovered.data.steps)).not.toContain("INC-123");
    expect(approveResponse.status).toBe(200);
    expect(approved.data.status).toBe("completed");
    expect(audit.data).toHaveLength(1);
    expect(audit.data[0].metadata).toMatchObject({
      currentStepId: "step_2",
      linkedRunStatus: "cancelled",
      recoveryAction: "continue",
    });
    expect(JSON.stringify(audit.data[0].metadata)).not.toContain(
      "Draft an incident update.",
    );
  });

  it("runs multi-agent room steps and waits for every linked model run", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const agentResponse = await api.request("/api/v1/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Room reviewer",
        baseModelId: "model_openai_compatible_default",
        systemPrompt: "Review room context.",
        parameters: {},
        memoryPolicy: { mode: "disabled" },
      }),
    });
    const agent = await agentResponse.json();
    const publishResponse = await api.request(
      `/api/v1/agents/${agent.data.id}/versions`,
      { method: "POST" },
    );
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Room flow",
        steps: [
          {
            type: "agent_room",
            name: "Discuss",
            agentIds: ["agent_default", agent.data.id],
            roomPrompt: "Discuss a release note from different perspectives.",
          },
          { type: "notification", name: "Record done", message: "Done." },
        ],
      }),
    });
    const workflow = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();
    const roomOutput = run.data.steps[0].output;
    await Promise.all(
      roomOutput.runIds.map((runId: string) => waitForRun(api, runId)),
    );

    const completedResponse = await api.request(
      `/api/v1/workflow-runs/${run.data.id}/resume`,
      { method: "POST" },
    );
    const completed = await completedResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.run.resume",
    );
    const audit = await auditResponse.json();

    expect(agentResponse.status).toBe(201);
    expect(publishResponse.status).toBe(201);
    expect(createResponse.status).toBe(201);
    expect(workflow.data.steps[0]).toMatchObject({
      type: "agent_room",
      agentIds: ["agent_default", agent.data.id],
    });
    expect(runResponse.status).toBe(201);
    expect(run.data.status).toBe("waiting_run");
    expect(roomOutput).toMatchObject({
      executionMode: "agent_room_started",
      agentIds: ["agent_default", agent.data.id],
      attempt: 1,
      maxAttempts: 1,
    });
    expect(roomOutput.chatIds).toHaveLength(2);
    expect(roomOutput.runIds).toHaveLength(2);
    expect(JSON.stringify(roomOutput)).not.toContain("Discuss a release note");
    expect(completedResponse.status).toBe(200);
    expect(completed.data.status).toBe("completed");
    expect(completed.data.steps[0]).toMatchObject({
      stepId: "step_1",
      status: "completed",
    });
    expect(completed.data.steps[0].output.runStatuses).toEqual(
      expect.arrayContaining(
        roomOutput.runIds.map((runId: string) => ({
          runId,
          status: "completed",
        })),
      ),
    );
    expect(audit.data.at(-1).metadata).toMatchObject({
      linkedRunIds: roomOutput.runIds,
      linkedRunStatuses: ["completed", "completed"],
    });
    expect(JSON.stringify(audit.data.at(-1).metadata)).not.toContain(
      "Discuss a release note",
    );
  });

  it("gates tool chains with metadata-only workflow approvals", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Tool approval flow",
        steps: [
          {
            type: "tool_approval",
            name: "Approve ticket update",
            toolChainName: "ticket_update",
            riskLevel: "high",
            approvalPrompt: "Approve updating the external ticket.",
            inputKeys: ["ticketId", "status"],
          },
          { type: "notification", name: "Record done", message: "Done." },
        ],
      }),
    });
    const workflow = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            ticketId: "TICKET-123",
            status: "closed",
            rawSecret: "do-not-copy",
          },
        }),
      },
    );
    const run = await runResponse.json();
    const approvalOutput = run.data.steps[0].output;
    const approveResponse = await api.request(
      `/api/v1/workflow-runs/${run.data.id}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "Approved." }),
      },
    );
    const approved = await approveResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.run.approve",
    );
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(workflow.data.steps[0]).toMatchObject({
      type: "tool_approval",
      toolChainName: "ticket_update",
      riskLevel: "high",
    });
    expect(runResponse.status).toBe(201);
    expect(run.data.status).toBe("waiting_approval");
    expect(approvalOutput).toEqual({
      approvalKind: "tool_chain",
      approvalPrompt: "Approve updating the external ticket.",
      toolChainName: "ticket_update",
      riskLevel: "high",
      inputKeys: ["ticketId", "status"],
    });
    expect(JSON.stringify(approvalOutput)).not.toContain("TICKET-123");
    expect(JSON.stringify(approvalOutput)).not.toContain("do-not-copy");
    expect(approveResponse.status).toBe(200);
    expect(approved.data.status).toBe("completed");
    expect(approved.data.steps[0]).toMatchObject({
      stepId: "step_1",
      status: "completed",
      output: {
        approvalKind: "tool_chain",
        approvedBy: "user_dev_admin",
        toolChainName: "ticket_update",
      },
    });
    expect(JSON.stringify(audit.data[0].metadata)).not.toContain("TICKET-123");
    expect(JSON.stringify(audit.data[0].metadata)).not.toContain("Approved.");
  });

  it("queues approved browser tasks for an external worker with metadata-only readback", async () => {
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(new InMemoryRomeoRepository(), { objectStore });
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Browser approval flow",
        steps: [
          {
            type: "browser_task",
            name: "Inspect release page",
            targetUrl: "https://example.com/releases",
            task: "Open the page and verify release metadata.",
            approvalPrompt: "Approve browser sandbox execution.",
          },
          { type: "notification", name: "Record done", message: "Done." },
        ],
      }),
    });
    const workflow = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { rawSecret: "do-not-copy" } }),
      },
    );
    const run = await runResponse.json();
    const browserOutput = run.data.steps[0].output;
    const approveResponse = await api.request(
      `/api/v1/workflow-runs/${run.data.id}/approve`,
      { method: "POST" },
    );
    const approved = await approveResponse.json();
    const approvedBrowserOutput = approved.data.steps[0].output;
    const claimResponse = await api.request(
      "/api/v1/browser-automation-tasks/claim",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseSeconds: 300 }),
      },
    );
    const claim = await claimResponse.json();
    const artifactBytes = new Uint8Array([137, 80, 78, 71]);
    const artifactUploadResponse = await api.request(
      `/api/v1/browser-automation-tasks/${claim.data.job.id}/artifacts/uploads`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "screenshot",
          contentType: "image/png",
          sizeBytes: artifactBytes.byteLength,
        }),
      },
    );
    const artifactUpload = await artifactUploadResponse.json();
    await objectStore.putObject({
      key: artifactUpload.data.upload.key,
      body: artifactBytes,
      contentType: "image/png",
    });
    const completeResponse = await api.request(
      `/api/v1/browser-automation-tasks/${claim.data.job.id}/complete`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          result: {
            artifactCount: 1,
            artifacts: [
              {
                artifactId: artifactUpload.data.artifact.artifactId,
                type: "screenshot",
                contentType: "image/png",
                sizeBytes: artifactBytes.byteLength,
              },
            ],
            capturedBytes: 4096,
            durationMs: 1500,
            finalOrigin: "https://example.com/releases/details",
            navigationCount: 2,
            networkDeniedCount: 1,
            outputKeys: ["releaseStatus"],
            redactionApplied: true,
          },
        }),
      },
    );
    const completed = await completeResponse.json();
    const approveAuditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.browser_task.approve",
    );
    const approveAudit = await approveAuditResponse.json();
    const completeAuditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.browser_task.worker.complete",
    );
    const completeAudit = await completeAuditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(workflow.data.steps[0]).toMatchObject({
      type: "browser_task",
      targetUrl: "https://example.com/releases",
    });
    expect(runResponse.status).toBe(201);
    expect(run.data.status).toBe("waiting_approval");
    expect(browserOutput).toEqual({
      approvalKind: "browser_task",
      approvalPrompt: "Approve browser sandbox execution.",
      targetOrigin: "https://example.com",
      targetHost: "example.com",
      sandboxPolicy: {
        artifactCapture: "metadata_only",
        downloadPolicy: "blocked",
        executionDriver: "disabled",
        network: "target_origin_only",
        uploadPolicy: "blocked",
      },
      taskKeys: ["task"],
    });
    expect(JSON.stringify(browserOutput)).not.toContain("Open the page");
    expect(JSON.stringify(browserOutput)).not.toContain("do-not-copy");
    expect(approveResponse.status).toBe(200);
    expect(approved.data.status).toBe("waiting_run");
    expect(approved.data.currentStepId).toBe("step_1");
    expect(approved.data.steps[0]).toMatchObject({
      stepId: "step_1",
      status: "waiting_run",
      output: {
        approvalKind: "browser_task",
        approvedBy: "user_dev_admin",
        sandboxPolicy: {
          artifactCapture: "screenshots_and_traces",
          downloadPolicy: "metadata_only",
          executionDriver: "external_worker",
          network: "target_origin_only",
          uploadPolicy: "blocked",
        },
        targetHost: "example.com",
        workerQueue: "browser_automation",
      },
    });
    expect(approvedBrowserOutput.jobId).toMatch(/^job_/);
    expect(approvedBrowserOutput.taskHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(approvedBrowserOutput)).not.toContain(
      "Open the page",
    );
    expect(claimResponse.status).toBe(200);
    expect(claim.data).toMatchObject({
      claimed: true,
      workerQueue: "browser_automation",
      job: {
        id: approvedBrowserOutput.jobId,
        status: "running",
        type: "workflow.browser_task.dispatch_request",
      },
      request: {
        targetHost: "example.com",
        targetOrigin: "https://example.com",
        targetUrl: "https://example.com/releases",
        task: "Open the page and verify release metadata.",
      },
      workflow: {
        stepId: "step_1",
        workflowRunId: run.data.id,
        workspaceId: "workspace_default",
      },
    });
    expect(claim.data.request.taskHash).toBe(approvedBrowserOutput.taskHash);
    expect(artifactUploadResponse.status).toBe(202);
    expect(artifactUpload.data).toMatchObject({
      artifact: {
        artifactUrl: `/api/v1/browser-automation-artifacts/${artifactUpload.data.artifact.artifactId}`,
        contentType: "image/png",
        sizeBytes: artifactBytes.byteLength,
        type: "screenshot",
      },
      upload: {
        method: "PUT",
        headers: { "content-type": "image/png" },
      },
    });
    expect(artifactUpload.data.upload.key).toContain(
      `browser-automation/org_default/${claim.data.job.id}/`,
    );
    expect(completeResponse.status).toBe(200);
    expect(completed.data).toMatchObject({
      outcome: "completed",
      workerQueue: "browser_automation",
      result: {
        artifactCount: 1,
        artifacts: [
          {
            artifactId: artifactUpload.data.artifact.artifactId,
            artifactUrl: artifactUpload.data.artifact.artifactUrl,
            contentType: "image/png",
            sizeBytes: artifactBytes.byteLength,
            type: "screenshot",
          },
        ],
        capturedBytes: 4096,
        durationMs: 1500,
        finalHost: "example.com",
        finalOrigin: "https://example.com",
        finalPath: "/releases/details",
        navigationCount: 2,
        networkDeniedCount: 1,
        outputKeys: ["releaseStatus"],
        redactionApplied: true,
      },
    });
    const artifactReadResponse = await api.request(
      artifactUpload.data.artifact.artifactUrl,
    );
    const artifactReadBytes = new Uint8Array(
      await artifactReadResponse.arrayBuffer(),
    );
    expect(artifactReadResponse.status).toBe(200);
    expect(artifactReadResponse.headers.get("content-type")).toBe("image/png");
    expect([...artifactReadBytes]).toEqual([...artifactBytes]);
    const finalRunResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
    );
    const finalRuns = await finalRunResponse.json();
    expect(finalRuns.data[0]).toMatchObject({
      status: "completed",
      steps: [
        {
          stepId: "step_1",
          status: "completed",
          output: {
            completedBy: "user_dev_admin",
            jobId: approvedBrowserOutput.jobId,
            result: { finalHost: "example.com", outputKeys: ["releaseStatus"] },
          },
        },
        {
          stepId: "step_2",
          status: "completed",
          output: { delivery: "not_configured" },
        },
      ],
    });
    const registerAuditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.browser_task.artifact.register",
    );
    const registerAudit = await registerAuditResponse.json();
    expect(registerAudit.data[0].metadata).toMatchObject({
      artifactId: artifactUpload.data.artifact.artifactId,
      artifactType: "screenshot",
      contentType: "image/png",
      sizeBytes: artifactBytes.byteLength,
    });
    expect(JSON.stringify(completed.data)).not.toContain("Open the page");
    expect(JSON.stringify(completed.data)).not.toContain("do-not-copy");
    expect(JSON.stringify(completed.data)).not.toContain(
      "browser-automation/org_default",
    );
    expect(JSON.stringify(finalRuns)).not.toContain(
      "browser-automation/org_default",
    );
    expect(JSON.stringify(approveAudit.data[0].metadata)).not.toContain(
      "Open the page",
    );
    expect(JSON.stringify(completeAudit.data[0].metadata)).not.toContain(
      "Open the page",
    );
    expect(JSON.stringify(registerAudit.data[0].metadata)).not.toContain(
      "Open the page",
    );
    expect(JSON.stringify(approveAudit.data[0].metadata)).not.toContain(
      "do-not-copy",
    );
    expect(JSON.stringify(completeAudit.data[0].metadata)).not.toContain(
      "do-not-copy",
    );
    expect(JSON.stringify(registerAudit.data[0].metadata)).not.toContain(
      "do-not-copy",
    );
  });

  it("blocks browser artifact upload registration after tenant suspension", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Suspended browser artifacts",
        steps: [
          {
            type: "browser_task",
            name: "Inspect release page",
            targetUrl: "https://example.com/releases",
            task: "Open the page and verify release metadata.",
            approvalPrompt: "Approve browser sandbox execution.",
          },
        ],
      }),
    });
    const workflow = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();
    await api.request(`/api/v1/workflow-runs/${run.data.id}/approve`, {
      method: "POST",
    });
    const claimResponse = await api.request(
      "/api/v1/browser-automation-tasks/claim",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leaseSeconds: 300 }),
      },
    );
    const claim = await claimResponse.json();
    await api.request("/api/v1/admin/abuse-controls", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suspension: { suspended: true, reasonCode: "abuse_review" },
      }),
    });

    const artifactUploadResponse = await api.request(
      `/api/v1/browser-automation-tasks/${claim.data.job.id}/artifacts/uploads`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "screenshot",
          contentType: "image/png",
          sizeBytes: 4,
        }),
      },
    );
    const artifactUploadError = await artifactUploadResponse.json();

    expect(createResponse.status).toBe(201);
    expect(runResponse.status).toBe(201);
    expect(claimResponse.status).toBe(200);
    expect(artifactUploadResponse.status).toBe(403);
    expect(artifactUploadError.error.details).toMatchObject({
      action: "file.upload",
      reasonCodes: ["org_suspended"],
    });
  });

  it("routes notification steps with safe run-input conditions", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Conditional notifications",
        steps: [
          {
            type: "notification",
            name: "Skip requester",
            message: "Skipped.",
            condition: { inputKey: "route", equals: "skip" },
          },
          {
            type: "notification",
            name: "Notify requester",
            message: "Sent.",
            condition: { inputKey: "route", equals: "send" },
          },
        ],
      }),
    });
    const workflow = await createResponse.json();

    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { route: "send" } }),
      },
    );
    const run = await runResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.run.start",
    );
    const audit = await auditResponse.json();

    expect(createResponse.status).toBe(201);
    expect(workflow.data.steps[0]).toMatchObject({
      type: "notification",
      condition: { inputKey: "route", equals: "skip" },
    });
    expect(runResponse.status).toBe(201);
    expect(run.data.status).toBe("completed");
    expect(run.data.steps[0]).toMatchObject({
      stepId: "step_1",
      status: "completed",
      output: {
        delivery: "skipped",
        reason: "condition_not_met",
        conditionKey: "route",
      },
    });
    expect(run.data.steps[0].output).not.toHaveProperty("messageKeys");
    expect(run.data.steps[0].output).not.toHaveProperty("expected");
    expect(run.data.steps[1]).toMatchObject({
      stepId: "step_2",
      status: "completed",
      output: { delivery: "not_configured", messageKeys: ["message"] },
    });
    expect(JSON.stringify(audit.data[0].metadata)).not.toContain("send");
  });

  it("lists safe workflow templates and creates normal definitions from them", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const templatesResponse = await api.request("/api/v1/workflow-templates");
    const templates = await templatesResponse.json();
    const createResponse = await api.request(
      "/api/v1/workflow-templates/agent_review_approval/create",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          agentId: "agent_default",
          name: "Templated review flow",
        }),
      },
    );
    const workflow = await createResponse.json();
    const runResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      { method: "POST" },
    );
    const run = await runResponse.json();
    const agentRunId = run.data.steps[0].output.runId;
    await waitForRun(api, agentRunId);
    const resumeResponse = await api.request(
      `/api/v1/workflow-runs/${run.data.id}/resume`,
      { method: "POST" },
    );
    const resumed = await resumeResponse.json();
    const auditResponse = await api.request(
      "/api/v1/audit-logs?action=workflow.template.create",
    );
    const audit = await auditResponse.json();

    expect(templatesResponse.status).toBe(200);
    expect(
      templates.data.map((template: { id: string }) => template.id),
    ).toContain("agent_review_approval");
    expect(createResponse.status).toBe(201);
    expect(workflow.data).toMatchObject({
      name: "Templated review flow",
      description:
        "Template workflow: agent draft, human approval, notification ledger.",
    });
    expect(workflow.data.steps).toMatchObject([
      { id: "step_1", type: "agent_run", agentId: "agent_default" },
      { id: "step_2", type: "approval" },
      { id: "step_3", type: "notification" },
    ]);
    expect(run.data.status).toBe("waiting_run");
    expect(run.data.currentStepId).toBe("step_1");
    expect(run.data.steps[0].output).toMatchObject({
      agentId: "agent_default",
      executionMode: "model_run_started",
    });
    expect(resumeResponse.status).toBe(200);
    expect(resumed.data.status).toBe("waiting_approval");
    expect(resumed.data.currentStepId).toBe("step_2");
    expect(audit.data).toHaveLength(1);
    expect(audit.data[0].metadata).toMatchObject({
      templateId: "agent_review_approval",
    });
  });

  it("runs due scheduled workflows and advances the next run time", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Scheduled summary",
        steps: [
          { type: "agent_run", name: "Summarize", agentId: "agent_default" },
        ],
        schedule: { intervalMinutes: 5, nextRunAt: "2020-01-01T00:00:00.000Z" },
      }),
    });
    const workflow = await createResponse.json();
    const runDueResponse = await api.request(
      "/api/v1/workflows/schedules/run-due",
      { method: "POST" },
    );
    const runDue = await runDueResponse.json();
    const listResponse = await api.request(
      "/api/v1/workflows?workspaceId=workspace_default",
    );
    const list = await listResponse.json();
    const updated = list.data.find(
      (item: { id: string }) => item.id === workflow.data.id,
    );
    const runListResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
    );
    const runList = await runListResponse.json();
    const secondRunDueResponse = await api.request(
      "/api/v1/workflows/schedules/run-due",
      { method: "POST" },
    );
    const secondRunDue = await secondRunDueResponse.json();

    expect(createResponse.status).toBe(201);
    expect(workflow.data.schedule).toMatchObject({
      enabled: true,
      intervalMinutes: 5,
      nextRunAt: "2020-01-01T00:00:00.000Z",
    });
    expect(runDueResponse.status).toBe(200);
    expect(runDue.data.dueWorkflowCount).toBe(1);
    expect(runDue.data.startedRuns).toHaveLength(1);
    expect(runDue.data.startedRuns[0].input).toMatchObject({
      scheduled: true,
      scheduledAt: runDue.data.checkedAt,
    });
    expect(updated.schedule.nextRunAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(new Date(updated.schedule.nextRunAt).getTime()).toBeGreaterThan(
      new Date(runDue.data.checkedAt).getTime(),
    );
    expect(runList.data).toHaveLength(1);
    expect(secondRunDue.data.dueWorkflowCount).toBe(0);
  });
});

async function waitForRun(
  api: ReturnType<typeof createRomeoApi>,
  runId: string,
) {
  let run: { status: string } = { status: "running" };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await api.request(`/api/v1/runs/${runId}`);
    const body = await response.json();
    run = body.data;
    if (run.status !== "running" && run.status !== "queued") return run;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return run;
}
