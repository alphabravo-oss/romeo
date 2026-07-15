import type { RomeoApi } from "../context";
import { updateAbuseControlPolicySchema } from "../schemas";
import type { UpdateAbuseControlPolicyRequest } from "../../domain/abuse-controls";

export function registerAbuseControlRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/abuse-controls", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").abuseControls.report(subject);
    return context.json({ data });
  });

  app.patch("/api/v1/admin/abuse-controls", async (context) => {
    const subject = context.get("subject");
    const body = updateAbuseControlPolicySchema.parse(await context.req.json());
    const policy = updatePolicyInput(body);
    const data = await context
      .get("services")
      .abuseControls.update({ subject, policy });
    return context.json({ data });
  });
}

function updatePolicyInput(
  body: ReturnType<typeof updateAbuseControlPolicySchema.parse>,
): UpdateAbuseControlPolicyRequest {
  const policy: UpdateAbuseControlPolicyRequest = {};
  if (body.suspension !== undefined) {
    const suspension: NonNullable<UpdateAbuseControlPolicyRequest["suspension"]> = {};
    if (body.suspension.suspended !== undefined)
      suspension.suspended = body.suspension.suspended;
    if (body.suspension.reasonCode !== undefined)
      suspension.reasonCode = body.suspension.reasonCode;
    policy.suspension = suspension;
  }
  if (body.entitlements !== undefined) {
    const entitlements: NonNullable<UpdateAbuseControlPolicyRequest["entitlements"]> = {};
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
    const killSwitches: NonNullable<UpdateAbuseControlPolicyRequest["killSwitches"]> = {};
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
