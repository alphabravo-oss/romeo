import {
  cancelTenantDeletionRoute,
  createTenantOrganizationRoute,
  executeTenantDeletionFinalizationRoute,
  getTenantOrganizationRoute,
  listTenantOrganizationsRoute,
  previewTenantDeletionFinalizationRoute,
  reactivateTenantOrganizationRoute,
  recordTenantDeletionEvidenceRoute,
  requestTenantDeletionRoute,
  suspendTenantOrganizationRoute,
  updateTenantOrganizationRoute,
} from "@romeo/contracts";
import type { RomeoApi } from "../context";

export function registerOrganizationRoutes(app: RomeoApi): void {
  app.openapi(listTenantOrganizationsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").tenantAdmin.list(subject);
    return context.json({ data });
  });

  app.openapi(createTenantOrganizationRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").tenantAdmin.create({
      subject,
      name: body.name,
      ...(body.slug === undefined ? {} : { slug: body.slug }),
      ...(body.defaultWorkspace === undefined
        ? {}
        : { defaultWorkspace: cleanDefaultWorkspace(body.defaultWorkspace) }),
      ...(body.initialAdmin === undefined
        ? {}
        : { initialAdmin: cleanInitialAdmin(body.initialAdmin) }),
    });
    return context.json({ data }, 201);
  });

  app.openapi(getTenantOrganizationRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").tenantAdmin.get({
      subject,
      orgId: context.req.valid("param").orgId,
    });
    return context.json({ data });
  });

  app.openapi(updateTenantOrganizationRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").tenantAdmin.update({
      subject,
      orgId: context.req.valid("param").orgId,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.slug === undefined ? {} : { slug: body.slug }),
    });
    return context.json({ data });
  });

  app.openapi(suspendTenantOrganizationRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").tenantAdmin.suspend({
      subject,
      orgId: context.req.valid("param").orgId,
      confirmOrgId: body.confirmOrgId,
      reasonCode: body.reasonCode,
    });
    return context.json({ data });
  });

  app.openapi(reactivateTenantOrganizationRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").tenantAdmin.reactivate({
      subject,
      orgId: context.req.valid("param").orgId,
      confirmOrgId: body.confirmOrgId,
    });
    return context.json({ data });
  });

  app.openapi(requestTenantDeletionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").tenantAdmin.requestDeletion({
      subject,
      orgId: context.req.valid("param").orgId,
      confirmOrgId: body.confirmOrgId,
      reasonCode: body.reasonCode,
    });
    return context.json({ data });
  });

  app.openapi(cancelTenantDeletionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .tenantAdmin.cancelDeletionRequest({
        subject,
        orgId: context.req.valid("param").orgId,
        confirmOrgId: body.confirmOrgId,
      });
    return context.json({ data });
  });

  app.openapi(previewTenantDeletionFinalizationRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .tenantAdmin.deletionFinalizationPreview({
        subject,
        orgId: context.req.valid("param").orgId,
      });
    return context.json({ data });
  });

  app.openapi(recordTenantDeletionEvidenceRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .tenantAdmin.recordDeletionFinalizationEvidence({
        subject,
        orgId: context.req.valid("param").orgId,
        confirmOrgId: body.confirmOrgId,
        controls: body.controls.map((control) => ({
          control: control.control,
          ...(control.evidenceRefHash === undefined
            ? {}
            : { evidenceRefHash: control.evidenceRefHash }),
          status: control.status,
        })),
      });
    return context.json({ data });
  });

  app.openapi(executeTenantDeletionFinalizationRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .tenantAdmin.executeDeletionFinalization({
        subject,
        orgId: context.req.valid("param").orgId,
        confirmOrgId: body.confirmOrgId,
        confirmPermanentDeletion: body.confirmPermanentDeletion,
      });
    return context.json({ data });
  });
}

function cleanDefaultWorkspace(input: {
  name?: string | undefined;
  slug?: string | undefined;
}): { name?: string; slug?: string } {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.slug === undefined ? {} : { slug: input.slug }),
  };
}

function cleanInitialAdmin(input: {
  email: string;
  name: string;
  password?: string | undefined;
}): { email: string; name: string; password?: string } {
  return {
    email: input.email,
    name: input.name,
    ...(input.password === undefined ? {} : { password: input.password }),
  };
}
