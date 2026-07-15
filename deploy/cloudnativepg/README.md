# Romeo CloudNativePG Examples

These manifests are examples for operator-managed Postgres. They are intentionally outside the Romeo Helm chart so the chart consumes a database contract instead of owning the CloudNativePG operator lifecycle.

Prerequisites:

- CloudNativePG operator installed in the cluster.
- Barman Cloud CNPG-I plugin installed when using these backup and restore examples.
- A pgvector-capable PostgreSQL image compatible with the CloudNativePG operator, replacing `registry.example.com/romeo/postgresql-pgvector:18`.
- S3-compatible bucket, lifecycle policy, and credential Secrets referenced by the `ObjectStore` resources.
- Romeo runtime Secrets, Valkey, object storage, and Helm values configured separately.

Files:

- `objectstore.example.yaml`: Barman Cloud plugin object-store target for WAL archiving and physical base backups.
- `cluster.example.yaml`: primary `romeo-pg` cluster with app database `romeo`, owner `romeo`, `CREATE EXTENSION vector`, WAL storage, and plugin WAL archiving.
- `scheduled-backup.example.yaml`: daily scheduled physical backup using the Barman Cloud plugin. CloudNativePG uses a six-field schedule with seconds.
- `on-demand-backup.example.yaml`: manual backup request for promotion or drill gates.
- `restore-cluster.example.yaml`: isolated replacement cluster bootstrapped from the `romeo-pg` backup object store, with a separate object store for new WAL archiving after restore.

Romeo consumes the CloudNativePG-generated app Secret through the Helm values in `deploy/helm/cloudnativepg-values.example.yaml`. CloudNativePG's app Secret convention is `<cluster-name>-app`; for `romeo-pg` that is `romeo-pg-app`. The Secret key is `uri`, and the Romeo chart maps that key into the `DATABASE_URL` environment variable.

Minimal flow:

```sh
kubectl apply -n romeo -f deploy/cloudnativepg/objectstore.example.yaml
kubectl apply -n romeo -f deploy/cloudnativepg/cluster.example.yaml
kubectl apply -n romeo -f deploy/cloudnativepg/scheduled-backup.example.yaml
helm upgrade --install romeo deploy/helm \
  -n romeo \
  -f deploy/helm/cloudnativepg-values.example.yaml
```

Restore drill flow:

```sh
kubectl apply -n romeo-drill -f deploy/cloudnativepg/restore-cluster.example.yaml
helm upgrade --install romeo-drill deploy/helm \
  -n romeo-drill \
  -f deploy/helm/cloudnativepg-values.example.yaml \
  --set-string postgres.cloudnativepg.clusterName=romeo-pg-restore \
  --set-string postgres.cloudnativepg.databaseUrlSecret.name=romeo-pg-restore-app \
  --set-string postgres.cloudnativepg.databaseUrlSecret.key=uri
```

After every restore, run `pnpm validate:postgres` against the restored app Secret URI, start Romeo with `DEV_SEEDED_LOGIN=false`, verify `/api/v1/admin/readiness`, and read representative chats, knowledge records, query results, and artifact bytes through the API before declaring the drill successful.
