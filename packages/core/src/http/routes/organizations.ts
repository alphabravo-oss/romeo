import type { RomeoApi } from "../context";
import {
  createTenantOrganizationSchema,
  tenantDeletionFinalizationExecuteSchema,
  tenantDeletionFinalizationEvidenceSchema,
  tenantOrganizationConfirmationSchema,
  tenantOrganizationReasonSchema,
  updateTenantOrganizationSchema,
} from "../schemas";

export function registerOrganizationRoutes(app: RomeoApi): void {
  app.get("/api/v1/admin/organizations", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").tenantAdmin.list(subject);
    return context.json({ data });
  });

  app.post("/api/v1/admin/organizations", async (context) => {
    const subject = context.get("subject");
    const body = createTenantOrganizationSchema.parse(await context.req.json());
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

  app.get("/api/v1/admin/organizations/:orgId", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").tenantAdmin.get({
      subject,
      orgId: context.req.param("orgId"),
    });
    return context.json({ data });
  });

  app.patch("/api/v1/admin/organizations/:orgId", async (context) => {
    const subject = context.get("subject");
    const body = updateTenantOrganizationSchema.parse(await context.req.json());
    const data = await context.get("services").tenantAdmin.update({
      subject,
      orgId: context.req.param("orgId"),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.slug === undefined ? {} : { slug: body.slug }),
    });
    return context.json({ data });
  });

  app.post("/api/v1/admin/organizations/:orgId/suspend", async (context) => {
    const subject = context.get("subject");
    const body = tenantOrganizationReasonSchema.parse(await context.req.json());
    const data = await context.get("services").tenantAdmin.suspend({
      subject,
      orgId: context.req.param("orgId"),
      confirmOrgId: body.confirmOrgId,
      reasonCode: body.reasonCode,
    });
    return context.json({ data });
  });

  app.post("/api/v1/admin/organizations/:orgId/reactivate", async (context) => {
    const subject = context.get("subject");
    const body = tenantOrganizationConfirmationSchema.parse(
      await context.req.json(),
    );
    const data = await context.get("services").tenantAdmin.reactivate({
      subject,
      orgId: context.req.param("orgId"),
      confirmOrgId: body.confirmOrgId,
    });
    return context.json({ data });
  });

  app.post(
    "/api/v1/admin/organizations/:orgId/deletion-request",
    async (context) => {
      const subject = context.get("subject");
      const body = tenantOrganizationReasonSchema.parse(
        await context.req.json(),
      );
      const data = await context.get("services").tenantAdmin.requestDeletion({
        subject,
        orgId: context.req.param("orgId"),
        confirmOrgId: body.confirmOrgId,
        reasonCode: body.reasonCode,
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/admin/organizations/:orgId/deletion-request/cancel",
    async (context) => {
      const subject = context.get("subject");
      const body = tenantOrganizationConfirmationSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .tenantAdmin.cancelDeletionRequest({
          subject,
          orgId: context.req.param("orgId"),
          confirmOrgId: body.confirmOrgId,
        });
      return context.json({ data });
    },
  );

  app.get(
    "/api/v1/admin/organizations/:orgId/deletion-finalization-preview",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .tenantAdmin.deletionFinalizationPreview({
          subject,
          orgId: context.req.param("orgId"),
        });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/admin/organizations/:orgId/deletion-finalization-evidence",
    async (context) => {
      const subject = context.get("subject");
      const body = tenantDeletionFinalizationEvidenceSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .tenantAdmin.recordDeletionFinalizationEvidence({
          subject,
          orgId: context.req.param("orgId"),
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
    },
  );

  app.post(
    "/api/v1/admin/organizations/:orgId/deletion-finalization/execute",
    async (context) => {
      const subject = context.get("subject");
      const body = tenantDeletionFinalizationExecuteSchema.parse(
        await context.req.json(),
      );
      const data = await context
        .get("services")
        .tenantAdmin.executeDeletionFinalization({
          subject,
          orgId: context.req.param("orgId"),
          confirmOrgId: body.confirmOrgId,
          confirmPermanentDeletion: body.confirmPermanentDeletion,
        });
      return context.json({ data });
    },
  );
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
