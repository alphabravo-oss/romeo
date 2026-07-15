import { z } from "zod";

const scimEmailSchema = z
  .object({
    value: z.string().min(1).max(320).optional(),
    primary: z.boolean().optional(),
    type: z.string().max(40).optional(),
  })
  .passthrough();

const scimNameSchema = z
  .object({
    formatted: z.string().min(1).max(200).optional(),
    givenName: z.string().min(1).max(100).optional(),
    familyName: z.string().min(1).max(100).optional(),
  })
  .passthrough();

const scimMemberSchema = z
  .object({
    value: z.string().min(1).max(120).optional(),
    display: z.string().max(200).optional(),
  })
  .passthrough();

export const scimListQuerySchema = z.object({
  filter: z.string().max(500).optional(),
  startIndex: z.coerce.number().int().min(1).optional(),
  count: z.coerce.number().int().min(0).max(200).optional(),
});

export const scimUserBodySchema = z
  .object({
    schemas: z.array(z.string()).max(10).optional(),
    externalId: z.string().max(200).optional(),
    userName: z.string().min(1).max(320).optional(),
    displayName: z.string().min(1).max(200).optional(),
    name: scimNameSchema.optional(),
    emails: z.array(scimEmailSchema).max(10).optional(),
    active: z.boolean().optional(),
  })
  .passthrough();

export const scimGroupBodySchema = z
  .object({
    schemas: z.array(z.string()).max(10).optional(),
    externalId: z.string().max(200).optional(),
    displayName: z.string().min(1).max(160).optional(),
    members: z.array(scimMemberSchema).max(1000).optional(),
  })
  .passthrough();

export const scimPatchBodySchema = z
  .object({
    schemas: z.array(z.string()).max(10).optional(),
    Operations: z
      .array(
        z
          .object({
            op: z.string().min(1).max(20).optional(),
            path: z.string().min(1).max(500).optional(),
            value: z.unknown().optional(),
          })
          .passthrough(),
      )
      .min(1)
      .max(100),
  })
  .passthrough();
