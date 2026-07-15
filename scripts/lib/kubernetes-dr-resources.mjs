export function secret(name, stringData, labels = {}) {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { labels, name },
    stringData,
  };
}

export function service(name, port, labels = {}) {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { labels, name },
    spec: {
      ports: [{ name: "tcp", port, targetPort: port }],
      selector: { "app.kubernetes.io/name": name },
    },
  };
}

export function postgresDeployment(name, password, labels = {}) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { labels, name },
    spec: {
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": name } },
      template: {
        metadata: {
          labels: { ...labels, "app.kubernetes.io/name": name },
        },
        spec: {
          containers: [
            {
              env: [
                { name: "POSTGRES_DB", value: "romeo" },
                { name: "POSTGRES_USER", value: "romeo" },
                { name: "POSTGRES_PASSWORD", value: password },
              ],
              image: "pgvector/pgvector:pg18",
              name: "postgres",
              ports: [{ containerPort: 5432 }],
              readinessProbe: {
                exec: { command: ["pg_isready", "-U", "romeo", "-d", "romeo"] },
                failureThreshold: 20,
                periodSeconds: 5,
              },
            },
          ],
        },
      },
    },
  };
}

export function valkeyDeployment(name, labels = {}) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { labels, name },
    spec: {
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": name } },
      template: {
        metadata: {
          labels: { ...labels, "app.kubernetes.io/name": name },
        },
        spec: {
          containers: [
            {
              image: "valkey/valkey:9",
              name: "valkey",
              ports: [{ containerPort: 6379 }],
              readinessProbe: {
                exec: { command: ["valkey-cli", "ping"] },
                failureThreshold: 20,
                periodSeconds: 5,
              },
            },
          ],
        },
      },
    },
  };
}

export function rustfsDeployment(name, secretKey, labels = {}) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { labels, name },
    spec: {
      replicas: 1,
      selector: { matchLabels: { "app.kubernetes.io/name": name } },
      template: {
        metadata: {
          labels: { ...labels, "app.kubernetes.io/name": name },
        },
        spec: {
          containers: [
            {
              env: [
                { name: "RUSTFS_ACCESS_KEY", value: "romeo" },
                { name: "RUSTFS_SECRET_KEY", value: secretKey },
              ],
              image: "rustfs/rustfs:latest",
              name: "rustfs",
              ports: [{ containerPort: 9000 }],
            },
          ],
        },
      },
    },
  };
}

export function objectStoreInitJob(name, options) {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { labels: options.labels, name },
    spec: {
      backoffLimit: 6,
      template: {
        metadata: { labels: options.labels },
        spec: {
          containers: [
            {
              args: [
                'until mc alias set romeo "$S3_ENDPOINT" "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"; do sleep 2; done; mc mb --ignore-existing "romeo/$S3_BUCKET"',
              ],
              command: ["/bin/sh", "-lc"],
              env: [
                { name: "S3_ENDPOINT", value: options.endpoint },
                { name: "S3_ACCESS_KEY_ID", value: "romeo" },
                { name: "S3_SECRET_ACCESS_KEY", value: options.secretKey },
                { name: "S3_BUCKET", value: "romeo" },
              ],
              image: "minio/mc:latest",
              name: "mc",
            },
          ],
          restartPolicy: "Never",
        },
      },
    },
  };
}

export function persistentVolumeClaim(name, labels = {}) {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { labels, name },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: "1Gi" } },
    },
  };
}

export function maintenanceJob(options) {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { labels: options.labels, name: options.name },
    spec: {
      backoffLimit: options.backoffLimit ?? 1,
      template: {
        metadata: { labels: options.labels },
        spec: {
          containers: [
            {
              command: options.command,
              env: options.env,
              image: options.image,
              imagePullPolicy: options.imagePullPolicy ?? "IfNotPresent",
              name: "job",
              volumeMounts: [
                {
                  mountPath: options.mountPath ?? "/work",
                  name: "work",
                },
              ],
            },
          ],
          restartPolicy: "Never",
          volumes: [
            {
              name: "work",
              persistentVolumeClaim: { claimName: options.volumeClaim },
            },
          ],
        },
      },
    },
  };
}

export function seedJob(options) {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { labels: options.labels, name: options.name },
    spec: {
      backoffLimit: 1,
      template: {
        metadata: { labels: options.labels },
        spec: {
          containers: [
            {
              command: [
                "pnpm",
                "seed:postgres",
                "--",
                "--confirm-development-seed",
              ],
              env: [secretEnv("DATABASE_URL", options.databaseSecret)],
              image: options.image,
              imagePullPolicy: options.imagePullPolicy ?? "IfNotPresent",
              name: "seed",
            },
          ],
          restartPolicy: "Never",
        },
      },
    },
  };
}

export function toolboxPod(options) {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { labels: options.labels, name: options.name },
    spec: {
      containers: [
        {
          command: ["sleep", "3600"],
          image: options.image,
          imagePullPolicy: options.imagePullPolicy ?? "IfNotPresent",
          name: "toolbox",
          volumeMounts: [{ mountPath: "/work", name: "work" }],
        },
      ],
      restartPolicy: "Never",
      volumes: [
        {
          name: "work",
          persistentVolumeClaim: { claimName: options.volumeClaim },
        },
      ],
    },
  };
}

export function secretEnv(name, secretRef) {
  return {
    name,
    valueFrom: {
      secretKeyRef: { key: secretRef.key, name: secretRef.name },
    },
  };
}
