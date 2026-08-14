import { canonicalSecurityAuditMetadataKeysByAction } from "./audit-metadata-security";
import { canonicalAdminAuditMetadataKeysByAction } from "./audit-metadata-admin";
import { canonicalAccessAuditMetadataKeysByAction } from "./audit-metadata-access";
import { canonicalDataAuditMetadataKeysByAction } from "./audit-metadata-data";
import { canonicalChatAuditMetadataKeysByAction } from "./audit-metadata-chat";
import { canonicalRunAuditMetadataKeysByAction } from "./audit-metadata-run";
import { canonicalSystemAuditMetadataKeysByAction } from "./audit-metadata-system";

export const canonicalAuditMetadataKeysByAction = {
  ...canonicalSecurityAuditMetadataKeysByAction,
  ...canonicalAdminAuditMetadataKeysByAction,
  ...canonicalAccessAuditMetadataKeysByAction,
  ...canonicalDataAuditMetadataKeysByAction,
  ...canonicalChatAuditMetadataKeysByAction,
  ...canonicalRunAuditMetadataKeysByAction,
  ...canonicalSystemAuditMetadataKeysByAction,
} as const;
