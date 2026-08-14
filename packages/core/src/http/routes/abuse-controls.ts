import {
  getAbuseControlsRoute,
  simulateAbuseControlsRoute,
  UpdateAbuseControlPolicySchema,
  updateAbuseControlsRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";
import type { UpdateAbuseControlPolicyRequest } from "../../domain/abuse-controls";
import type { AbuseControlSimulationRequest } from "../../domain/abuse-controls";

export function registerAbuseControlRoutes(app: RomeoApi): void {
  app.openapi(getAbuseControlsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").abuseControls.report(subject);
    return context.json({ data });
  });

  app.openapi(updateAbuseControlsRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const policy = updatePolicyInput(body);
    const data = await context
      .get("services")
      .abuseControls.update({ subject, policy });
    return context.json({ data });
  });

  app.openapi(simulateAbuseControlsRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const request: AbuseControlSimulationRequest = {
      action: body.action,
      ...(body.agentId === undefined ? {} : { agentId: body.agentId }),
      ...(body.connectorId === undefined
        ? {}
        : { connectorId: body.connectorId }),
      ...(body.providerId === undefined ? {} : { providerId: body.providerId }),
      ...(body.toolId === undefined ? {} : { toolId: body.toolId }),
      ...(body.workerClass === undefined
        ? {}
        : { workerClass: body.workerClass }),
      ...(body.workspaceId === undefined
        ? {}
        : { workspaceId: body.workspaceId }),
    };
    const data = await context
      .get("services")
      .abuseControls.simulate({ subject, request });
    return context.json({ data });
  });
}

function updatePolicyInput(
  body: ReturnType<typeof UpdateAbuseControlPolicySchema.parse>,
): UpdateAbuseControlPolicyRequest {
  const policy: UpdateAbuseControlPolicyRequest = {};
  if (body.suspension !== undefined) {
    const suspension: NonNullable<
      UpdateAbuseControlPolicyRequest["suspension"]
    > = {};
    if (body.suspension.suspended !== undefined)
      suspension.suspended = body.suspension.suspended;
    if (body.suspension.reasonCode !== undefined)
      suspension.reasonCode = body.suspension.reasonCode;
    policy.suspension = suspension;
  }
  if (body.entitlements !== undefined) {
    const entitlements: NonNullable<
      UpdateAbuseControlPolicyRequest["entitlements"]
    > = {};
    if (body.entitlements.enforceBillingStatus !== undefined)
      entitlements.enforceBillingStatus =
        body.entitlements.enforceBillingStatus;
    if (body.entitlements.denyWhenBillingPlanMissing !== undefined)
      entitlements.denyWhenBillingPlanMissing =
        body.entitlements.denyWhenBillingPlanMissing;
    if (body.entitlements.allowedBillingStatuses !== undefined)
      entitlements.allowedBillingStatuses =
        body.entitlements.allowedBillingStatuses;
    policy.entitlements = entitlements;
  }
  if (body.killSwitches !== undefined) {
    const killSwitches: NonNullable<
      UpdateAbuseControlPolicyRequest["killSwitches"]
    > = {};
    if (body.killSwitches.connectorIds !== undefined)
      killSwitches.connectorIds = body.killSwitches.connectorIds;
    if (body.killSwitches.providerIds !== undefined)
      killSwitches.providerIds = body.killSwitches.providerIds;
    if (body.killSwitches.toolIds !== undefined)
      killSwitches.toolIds = body.killSwitches.toolIds;
    if (body.killSwitches.workerClasses !== undefined)
      killSwitches.workerClasses = body.killSwitches.workerClasses;
    policy.killSwitches = killSwitches;
  }
  return policy;
}
