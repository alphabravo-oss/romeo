# Helm Template Notes

The chart now renders the core production surface:

- app Deployment and Service
- pre-install/pre-upgrade migration Job
- ConfigMap and Secret wiring
- app and worker ServiceAccounts with token automount disabled by default
- PodDisruptionBudget
- optional Ingress
- optional NetworkPolicy
- optional worker CronJobs
- optional Postgres backup CronJob

The chart intentionally does not install a Postgres operator. Use `postgres.mode=external` for hosted or separately managed Postgres, and `postgres.mode=cloudnativepg` when a CloudNativePG cluster and app connection Secret are managed outside this chart.
