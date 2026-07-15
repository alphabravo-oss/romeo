import type {
  DataExportCounts,
  DataExportLimits,
  DataExportPackage,
  DataExportPackageList,
  DataExportPackageSummary,
  DataExportResolvedRequest,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

const registrySchema = "romeo.data-export-package-registry.v1";
const registryLimit = 200;

const countKeys: Array<keyof DataExportCounts> = [
  "workspaces",
  "agents",
  "promptTemplates",
  "chats",
  "messages",
  "messageParts",
  "chatComments",
  "knowledgeBases",
  "knowledgeSources",
  "knowledgeChunks",
  "fileObjects",
  "fileObjectBytesIncluded",
  "knowledgeSourceBytesIncluded",
  "dataConnectors",
  "dataConnectorSyncs",
  "workflows",
  "workflowRuns",
  "usageEvents",
  "backgroundJobs",
];

export async function listRegisteredDataExportPackages(input: {
  repository: RomeoRepository;
  orgId: string;
}): Promise<DataExportPackageList> {
  return {
    schema: "romeo.data-export-package-list.v1",
    orgId: input.orgId,
    packages: await readRegistry(input.repository, input.orgId),
    redaction: {
      packageContentReturned: false,
      rawObjectKeysReturned: false,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function registerDataExportPackage(input: {
  repository: RomeoRepository;
  package: DataExportPackage;
}): Promise<void> {
  const existing = await readRegistry(input.repository, input.package.orgId);
  const summary = summarizePackage(input.package);
  await writeRegistry(input.repository, input.package.orgId, [
    summary,
    ...existing.filter((item) => item.packageId !== summary.packageId),
  ]);
}

export async function removeRegisteredDataExportPackage(input: {
  repository: RomeoRepository;
  orgId: string;
  packageId: string;
}): Promise<void> {
  const existing = await readRegistry(input.repository, input.orgId);
  await writeRegistry(
    input.repository,
    input.orgId,
    existing.filter((item) => item.packageId !== input.packageId),
  );
}

function summarizePackage(
  packaged: DataExportPackage,
): DataExportPackageSummary {
  return {
    schema: "romeo.data-export-package-summary.v1",
    packageId: packaged.packageId,
    orgId: packaged.orgId,
    request: packaged.request,
    counts: packaged.counts,
    limits: packaged.limits,
    warnings: packaged.warnings,
    exclusions: packaged.exclusions,
    artifact: packaged.artifact,
    createdAt: packaged.createdAt,
  };
}

async function readRegistry(
  repository: RomeoRepository,
  orgId: string,
): Promise<DataExportPackageSummary[]> {
  const setting = await repository.getSystemSetting(registryKey(orgId));
  const value = setting?.value;
  if (
    value === undefined ||
    value.schema !== registrySchema ||
    value.orgId !== orgId ||
    !Array.isArray(value.packages)
  ) {
    return [];
  }
  return value.packages
    .map(readSummary)
    .filter((item): item is DataExportPackageSummary => item !== undefined)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function writeRegistry(
  repository: RomeoRepository,
  orgId: string,
  packages: DataExportPackageSummary[],
): Promise<void> {
  await repository.upsertSystemSetting({
    key: registryKey(orgId),
    value: {
      schema: registrySchema,
      orgId,
      packages: packages
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, registryLimit),
    },
    updatedAt: new Date().toISOString(),
  });
}

function registryKey(orgId: string): string {
  return `governance.data_export_packages.${encodeURIComponent(orgId)}`;
}

function readSummary(value: unknown): DataExportPackageSummary | undefined {
  if (!isRecord(value)) return undefined;
  const request = readRequest(value.request);
  const counts = readCounts(value.counts);
  const limits = readLimits(value.limits);
  const artifact = readArtifact(value.artifact);
  if (
    value.schema !== "romeo.data-export-package-summary.v1" ||
    typeof value.packageId !== "string" ||
    typeof value.orgId !== "string" ||
    typeof value.createdAt !== "string" ||
    request === undefined ||
    counts === undefined ||
    limits === undefined ||
    artifact === undefined ||
    !Array.isArray(value.warnings) ||
    !Array.isArray(value.exclusions) ||
    !value.warnings.every((item) => typeof item === "string") ||
    !value.exclusions.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  return {
    schema: "romeo.data-export-package-summary.v1",
    packageId: value.packageId,
    orgId: value.orgId,
    request,
    counts,
    limits,
    warnings: value.warnings,
    exclusions: value.exclusions,
    artifact,
    createdAt: value.createdAt,
  };
}

function readRequest(value: unknown): DataExportResolvedRequest | undefined {
  if (!isRecord(value)) return undefined;
  if (
    (value.scope !== "org" && value.scope !== "workspace") ||
    typeof value.includeContent !== "boolean" ||
    typeof value.includeObjectBytes !== "boolean" ||
    typeof value.maxObjectBytes !== "number"
  ) {
    return undefined;
  }
  if (
    value.workspaceId !== undefined &&
    typeof value.workspaceId !== "string"
  ) {
    return undefined;
  }
  return {
    scope: value.scope,
    ...(value.workspaceId === undefined
      ? {}
      : { workspaceId: value.workspaceId }),
    includeContent: value.includeContent,
    includeObjectBytes: value.includeObjectBytes,
    maxObjectBytes: value.maxObjectBytes,
  };
}

function readCounts(value: unknown): DataExportCounts | undefined {
  if (!isRecord(value)) return undefined;
  const counts: Partial<DataExportCounts> = {};
  for (const key of countKeys) {
    const count = value[key];
    if (typeof count !== "number") return undefined;
    counts[key] = count;
  }
  return counts as DataExportCounts;
}

function readLimits(value: unknown): DataExportLimits | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.maxObjectBytes !== "number" ||
    typeof value.maxTotalObjectBytes !== "number"
  ) {
    return undefined;
  }
  return {
    maxObjectBytes: value.maxObjectBytes,
    maxTotalObjectBytes: value.maxTotalObjectBytes,
  };
}

function readArtifact(
  value: unknown,
): DataExportPackageSummary["artifact"] | undefined {
  if (!isRecord(value) || !isRecord(value.storage)) return undefined;
  if (
    value.contentType !== "application/json" ||
    typeof value.sizeBytes !== "number" ||
    typeof value.sha256 !== "string" ||
    typeof value.downloadUrl !== "string" ||
    value.storage.driver !== "object_store" ||
    typeof value.storage.objectKeyHash !== "string" ||
    value.storage.rawObjectKeyReturned !== false
  ) {
    return undefined;
  }
  return {
    contentType: "application/json",
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    downloadUrl: value.downloadUrl,
    storage: {
      driver: "object_store",
      objectKeyHash: value.storage.objectKeyHash,
      rawObjectKeyReturned: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
