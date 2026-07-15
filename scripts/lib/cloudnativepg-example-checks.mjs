import { readFileSync } from "node:fs";

import { parseAllDocuments } from "yaml";

const examplePaths = [
  "deploy/cloudnativepg/objectstore.example.yaml",
  "deploy/cloudnativepg/cluster.example.yaml",
  "deploy/cloudnativepg/scheduled-backup.example.yaml",
  "deploy/cloudnativepg/on-demand-backup.example.yaml",
  "deploy/cloudnativepg/restore-cluster.example.yaml",
];

const barmanPluginName = "barman-cloud.cloudnative-pg.io";

export function checkCloudNativePgExamples() {
  const resources = examplePaths.flatMap((path) =>
    parseResources(readFileSync(path, "utf8"), path),
  );
  const byId = new Map(
    resources.map((resource) => [resourceId(resource), resource]),
  );

  const objectStore = requireResource(
    byId,
    "barmancloud.cnpg.io/v1",
    "ObjectStore",
    "romeo-pg-backups",
  );
  const restoreObjectStore = requireResource(
    byId,
    "barmancloud.cnpg.io/v1",
    "ObjectStore",
    "romeo-pg-restore-backups",
  );
  const cluster = requireResource(
    byId,
    "postgresql.cnpg.io/v1",
    "Cluster",
    "romeo-pg",
  );
  const scheduledBackup = requireResource(
    byId,
    "postgresql.cnpg.io/v1",
    "ScheduledBackup",
    "romeo-pg-daily",
  );
  const onDemandBackup = requireResource(
    byId,
    "postgresql.cnpg.io/v1",
    "Backup",
    "romeo-pg-manual",
  );
  const restoreCluster = requireResource(
    byId,
    "postgresql.cnpg.io/v1",
    "Cluster",
    "romeo-pg-restore",
  );

  assertObjectStore(objectStore, "romeo-pg");
  assertObjectStore(restoreObjectStore, "romeo-pg-restore");
  assertCluster(cluster, {
    name: "romeo-pg",
    objectStoreName: "romeo-pg-backups",
    expectInitDb: true,
  });
  assertScheduledBackup(scheduledBackup);
  assertBackup(onDemandBackup);
  assertCluster(restoreCluster, {
    name: "romeo-pg-restore",
    objectStoreName: "romeo-pg-restore-backups",
    expectRecovery: true,
  });
  assertRestoreSource(restoreCluster);

  return {
    resourceCount: resources.length,
    resources: resources
      .map((resource) => ({
        apiVersion: resource.apiVersion,
        kind: resource.kind,
        name: resource.metadata?.name,
      }))
      .sort((left, right) =>
        `${left.kind}/${left.name}`.localeCompare(
          `${right.kind}/${right.name}`,
        ),
      ),
  };
}

function parseResources(text, path) {
  return parseAllDocuments(text)
    .map((document) => document.toJSON())
    .filter((resource) => resource !== null && resource !== undefined)
    .map((resource) => ({ ...resource, __path: path }));
}

function resourceId(resource) {
  return `${resource.apiVersion}/${resource.kind}/${resource.metadata?.name}`;
}

function requireResource(byId, apiVersion, kind, name) {
  const resource = byId.get(`${apiVersion}/${kind}/${name}`);
  if (resource === undefined) {
    throw new Error(
      `CloudNativePG examples are missing ${apiVersion} ${kind}/${name}.`,
    );
  }
  return resource;
}

function assertObjectStore(objectStore, serverName) {
  const configuration = objectStore.spec?.configuration;
  const destinationPath = configuration?.destinationPath;
  if (
    typeof destinationPath !== "string" ||
    !destinationPath.startsWith("s3://") ||
    !destinationPath.includes(serverName)
  ) {
    throw new Error(
      `${objectStore.metadata?.name} ObjectStore must use an S3 destination scoped to ${serverName}.`,
    );
  }
  if (objectStore.spec?.retentionPolicy !== "30d") {
    throw new Error(
      `${objectStore.metadata?.name} ObjectStore must declare a 30d retention policy.`,
    );
  }
  for (const key of ["accessKeyId", "secretAccessKey", "region"]) {
    const ref = configuration?.s3Credentials?.[key];
    if (
      typeof ref?.name !== "string" ||
      ref.name.length === 0 ||
      typeof ref?.key !== "string" ||
      ref.key.length === 0
    ) {
      throw new Error(
        `${objectStore.metadata?.name} ObjectStore ${key} must be Secret-backed.`,
      );
    }
  }
  for (const section of ["wal", "data"]) {
    const value = configuration?.[section];
    if (value?.compression !== "gzip" || value?.encryption !== "AES256") {
      throw new Error(
        `${objectStore.metadata?.name} ObjectStore ${section} must enable gzip compression and AES256 encryption.`,
      );
    }
  }
}

function assertCluster(cluster, options) {
  if (cluster.spec?.instances < 3) {
    throw new Error(
      `${options.name} Cluster must run at least three instances.`,
    );
  }
  if (
    typeof cluster.spec?.imageName !== "string" ||
    !cluster.spec.imageName.includes("pgvector")
  ) {
    throw new Error(
      `${options.name} Cluster must use a pgvector-capable image.`,
    );
  }
  if (cluster.spec?.storage?.size === undefined) {
    throw new Error(`${options.name} Cluster must define data storage size.`);
  }
  if (cluster.spec?.walStorage?.size === undefined) {
    throw new Error(`${options.name} Cluster must define WAL storage size.`);
  }
  const plugin = cluster.spec?.plugins?.find(
    (item) => item.name === barmanPluginName,
  );
  if (plugin?.isWALArchiver !== true) {
    throw new Error(
      `${options.name} Cluster must enable plugin WAL archiving.`,
    );
  }
  if (plugin?.parameters?.barmanObjectName !== options.objectStoreName) {
    throw new Error(
      `${options.name} Cluster must archive to ${options.objectStoreName}.`,
    );
  }
  if (options.expectInitDb) {
    const initdb = cluster.spec?.bootstrap?.initdb;
    if (initdb?.database !== "romeo" || initdb?.owner !== "romeo") {
      throw new Error(
        `${options.name} initdb must create Romeo app DB/user.`,
      );
    }
    const statements = initdb.postInitApplicationSQL ?? [];
    if (
      !statements.some((statement) =>
        /^CREATE EXTENSION IF NOT EXISTS vector;$/iu.test(statement),
      )
    ) {
      throw new Error(`${options.name} initdb must install pgvector.`);
    }
  }
  if (options.expectRecovery) {
    if (cluster.spec?.bootstrap?.recovery?.source !== "romeo-pg-source") {
      throw new Error(
        `${options.name} restore Cluster must use recovery source.`,
      );
    }
  }
}

function assertScheduledBackup(backup) {
  if (backup.spec?.cluster?.name !== "romeo-pg") {
    throw new Error("ScheduledBackup must target romeo-pg.");
  }
  if (backup.spec?.method !== "plugin") {
    throw new Error("ScheduledBackup must use plugin backup method.");
  }
  if (backup.spec?.pluginConfiguration?.name !== barmanPluginName) {
    throw new Error("ScheduledBackup must use the Barman Cloud plugin.");
  }
  if (backup.spec?.backupOwnerReference !== "cluster") {
    throw new Error("ScheduledBackup must be owned by the source cluster.");
  }
  const fields = String(backup.spec?.schedule ?? "")
    .trim()
    .split(/\s+/u);
  if (fields.length !== 6) {
    throw new Error("ScheduledBackup must use CloudNativePG six-field cron.");
  }
}

function assertBackup(backup) {
  if (backup.spec?.cluster?.name !== "romeo-pg") {
    throw new Error("On-demand Backup must target romeo-pg.");
  }
  if (
    backup.spec?.method !== "plugin" ||
    backup.spec?.pluginConfiguration?.name !== barmanPluginName
  ) {
    throw new Error("On-demand Backup must use the Barman Cloud plugin.");
  }
}

function assertRestoreSource(cluster) {
  const source = cluster.spec?.externalClusters?.find(
    (item) => item.name === "romeo-pg-source",
  );
  if (source?.plugin?.name !== barmanPluginName) {
    throw new Error(
      "Restore Cluster must define a Barman Cloud source plugin.",
    );
  }
  const parameters = source.plugin.parameters ?? {};
  if (
    parameters.barmanObjectName !== "romeo-pg-backups" ||
    parameters.serverName !== "romeo-pg"
  ) {
    throw new Error(
      "Restore Cluster must recover from the source romeo-pg object store.",
    );
  }
}
