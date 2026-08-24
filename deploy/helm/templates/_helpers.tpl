{{/*
Common names and labels.
*/}}
{{- define "romeo.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "romeo.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "romeo.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "romeo.selectorLabels" -}}
app.kubernetes.io/name: {{ include "romeo.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "romeo.labels" -}}
helm.sh/chart: {{ include "romeo.chart" . }}
{{ include "romeo.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "romeo.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "romeo.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "romeo.identityServiceAccountName" -}}
{{- $root := index . "root" -}}
{{- $identity := index . "identity" -}}
{{- $component := index . "component" -}}
{{- if $identity.serviceAccount.create -}}
{{- default (printf "%s-%s" (include "romeo.fullname" $root) $component) $identity.serviceAccount.name -}}
{{- else -}}
{{- required (printf "%s serviceAccount.name is required when create=false" $component) $identity.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "romeo.configMapName" -}}
{{- printf "%s-config" (include "romeo.fullname" .) -}}
{{- end -}}

{{- define "romeo.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secret" (include "romeo.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "romeo.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end -}}

{{- define "romeo.opsImage" -}}
{{- if .Values.opsImage.digest -}}
{{- printf "%s@%s" .Values.opsImage.repository .Values.opsImage.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.opsImage.repository (.Values.opsImage.tag | default .Chart.AppVersion) -}}
{{- end -}}
{{- end -}}

{{/* Fail closed when a production install weakens mandatory deployment controls. */}}
{{- define "romeo.validateProduction" -}}
{{- if not .Values.global.production -}}
  {{- fail "the Romeo Helm chart is production-only; use development-only Compose for local environments" -}}
{{- end -}}
  {{- if ne .Values.env.ROMEO_ENV "production" -}}
    {{- fail "production requires env.ROMEO_ENV=production" -}}
  {{- end -}}
  {{- if .Values.secrets.create -}}
    {{- fail "production forbids chart-created Secrets; provision secrets.existingSecret with an external secret workflow" -}}
  {{- end -}}
  {{- if not (trim .Values.secrets.existingSecret) -}}
    {{- fail "production requires secrets.existingSecret" -}}
  {{- end -}}
  {{- range $name, $value := .Values.secretEnv -}}
    {{- if not (empty ($value | toString | trim)) -}}
      {{- fail (printf "production forbids inline secretEnv.%s; populate secrets.existingSecret instead" $name) -}}
    {{- end -}}
  {{- end -}}
  {{- if ne .Values.env.HTTP_RATE_LIMIT_DRIVER "valkey" -}}
    {{- fail "production requires env.HTTP_RATE_LIMIT_DRIVER=valkey" -}}
  {{- end -}}
  {{- if ne .Values.env.REPOSITORY_DRIVER "postgres" -}}
    {{- fail "production requires env.REPOSITORY_DRIVER=postgres" -}}
  {{- end -}}
  {{- if ne .Values.env.OBJECT_STORE_DRIVER "s3" -}}
    {{- fail "production requires env.OBJECT_STORE_DRIVER=s3" -}}
  {{- end -}}
  {{- if or (ne .Values.env.S3_READINESS_REQUIRE_ENCRYPTION "true") (ne .Values.env.S3_READINESS_REQUIRE_VERSIONING "true") (ne .Values.env.S3_READINESS_REQUIRE_LIFECYCLE "true") -}}
    {{- fail "production S3 readiness requires encryption, versioning, and lifecycle posture checks" -}}
  {{- end -}}
  {{- if ne .Values.env.REALTIME_EVENT_DRIVER "valkey" -}}
    {{- fail "production requires env.REALTIME_EVENT_DRIVER=valkey" -}}
  {{- end -}}
  {{- if ne .Values.env.QUOTA_COORDINATION_DRIVER "valkey" -}}
    {{- fail "production requires env.QUOTA_COORDINATION_DRIVER=valkey" -}}
  {{- end -}}
  {{- if ne .Values.env.EDGE_TRUSTED_PROXY_MODE "trusted_proxy" -}}
    {{- fail "production requires env.EDGE_TRUSTED_PROXY_MODE=trusted_proxy" -}}
  {{- end -}}
  {{- if not (trim .Values.env.EDGE_TRUSTED_PROXY_CIDRS) -}}
    {{- fail "production requires env.EDGE_TRUSTED_PROXY_CIDRS" -}}
  {{- end -}}
  {{- if not .Values.valkey.urlSecret.name -}}
    {{- fail "production distributed controls require valkey.urlSecret.name" -}}
  {{- end -}}
  {{- if eq .Values.env.FILE_MALWARE_SCAN_ENABLED "true" -}}
    {{- if ne .Values.env.FILE_MALWARE_SCAN_POLICY "required" -}}
      {{- fail "FILE_MALWARE_SCAN_ENABLED=true requires env.FILE_MALWARE_SCAN_POLICY=required" -}}
    {{- end -}}
    {{- if not (trim .Values.env.CLAMAV_ADDRESS) -}}
      {{- fail "production malware scanning requires env.CLAMAV_ADDRESS" -}}
    {{- end -}}
    {{- if eq .Values.env.FILE_MALWARE_SCAN_EXCEPTION_ENABLED "true" -}}
      {{- fail "FILE_MALWARE_SCAN_EXCEPTION_ENABLED must be false when scanning is enabled" -}}
    {{- end -}}
  {{- else -}}
    {{- if ne .Values.env.FILE_MALWARE_SCAN_POLICY "off" -}}
      {{- fail "FILE_MALWARE_SCAN_ENABLED=false requires env.FILE_MALWARE_SCAN_POLICY=off" -}}
    {{- end -}}
    {{- if ne .Values.env.FILE_MALWARE_SCAN_EXCEPTION_ENABLED "true" -}}
      {{- fail "production malware scanning may be disabled only by an explicit exception" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.env.FILE_MALWARE_SCAN_EXCEPTION_OWNER)) 3 -}}
      {{- fail "FILE_MALWARE_SCAN_EXCEPTION_OWNER must identify the accountable owner" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.env.FILE_MALWARE_SCAN_EXCEPTION_REASON)) 16 -}}
      {{- fail "FILE_MALWARE_SCAN_EXCEPTION_REASON must document the reviewed exception" -}}
    {{- end -}}
    {{- if not (regexMatch "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$" .Values.env.FILE_MALWARE_SCAN_EXCEPTION_EXPIRES_AT) -}}
      {{- fail "FILE_MALWARE_SCAN_EXCEPTION_EXPIRES_AT must be a UTC timestamp; runtime validation enforces expiry" -}}
    {{- end -}}
  {{- end -}}
  {{- if eq .Values.env.POSTGRES_TLS_EXCEPTION_ENABLED "true" -}}
    {{- if ne .Values.env.POSTGRES_TLS_EXCEPTION_SCOPE "in_cluster" -}}
      {{- fail "POSTGRES_TLS_EXCEPTION_SCOPE must be in_cluster" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.env.POSTGRES_TLS_EXCEPTION_OWNER)) 3 -}}
      {{- fail "POSTGRES_TLS_EXCEPTION_OWNER must identify the accountable owner" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.env.POSTGRES_TLS_EXCEPTION_REASON)) 16 -}}
      {{- fail "POSTGRES_TLS_EXCEPTION_REASON must document the reviewed exception" -}}
    {{- end -}}
    {{- if not (regexMatch "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$" .Values.env.POSTGRES_TLS_EXCEPTION_EXPIRES_AT) -}}
      {{- fail "POSTGRES_TLS_EXCEPTION_EXPIRES_AT must be a UTC timestamp; runtime validation enforces expiry" -}}
    {{- end -}}
  {{- end -}}
  {{- if eq .Values.env.VALKEY_SECURITY_EXCEPTION_ENABLED "true" -}}
    {{- if ne .Values.env.VALKEY_SECURITY_EXCEPTION_SCOPE "in_cluster" -}}
      {{- fail "VALKEY_SECURITY_EXCEPTION_SCOPE must be in_cluster" -}}
    {{- end -}}
    {{- if ne .Values.env.VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED "true" -}}
      {{- fail "VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED must be true for the in-cluster exception" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.env.VALKEY_SECURITY_EXCEPTION_OWNER)) 3 -}}
      {{- fail "VALKEY_SECURITY_EXCEPTION_OWNER must identify the accountable owner" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.env.VALKEY_SECURITY_EXCEPTION_REASON)) 16 -}}
      {{- fail "VALKEY_SECURITY_EXCEPTION_REASON must document the reviewed exception" -}}
    {{- end -}}
    {{- if not (regexMatch "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$" .Values.env.VALKEY_SECURITY_EXCEPTION_EXPIRES_AT) -}}
      {{- fail "VALKEY_SECURITY_EXCEPTION_EXPIRES_AT must be a UTC timestamp; runtime validation enforces expiry" -}}
    {{- end -}}
  {{- end -}}
  {{- if or (eq .Values.env.NOTIFICATION_DELIVERY_DRIVER "configured") (eq .Values.env.NOTIFICATION_DELIVERY_DRIVER "pagerduty-events") (eq .Values.env.NOTIFICATION_DELIVERY_DRIVER "slack-webhook") (eq .Values.env.NOTIFICATION_DELIVERY_DRIVER "teams-webhook") (eq .Values.env.NOTIFICATION_DELIVERY_DRIVER "webhook") -}}
    {{- if ne .Values.env.NOTIFICATION_WEBHOOK_EGRESS_POLICY "require_allowlist" -}}
      {{- fail "webhook-capable notification delivery requires env.NOTIFICATION_WEBHOOK_EGRESS_POLICY=require_allowlist" -}}
    {{- end -}}
    {{- if not (trim .Values.env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS) -}}
      {{- fail "webhook-capable notification delivery requires env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS" -}}
    {{- end -}}
    {{- if not (regexMatch "^(\\*\\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(,(\\*\\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$" .Values.env.NOTIFICATION_WEBHOOK_ALLOWED_HOSTS) -}}
      {{- fail "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS must be normalized lowercase comma-separated DNS hosts or wildcard subdomain rules" -}}
    {{- end -}}
  {{- end -}}
  {{- if not (regexMatch "^sha256:[a-fA-F0-9]{64}$" .Values.image.digest) -}}
    {{- if not .Values.imagePolicyException.enabled -}}
      {{- fail "production requires image.digest (sha256) or an explicit development-only imagePolicyException" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.imagePolicyException.reason)) 16 -}}
      {{- fail "imagePolicyException.reason must document the development-only exception (minimum 16 characters)" -}}
    {{- end -}}
  {{- end -}}
  {{- $opsEnabled := or .Values.migration.enabled .Values.backup.enabled .Values.workers.dataConnectorSync.enabled .Values.workers.webhookRetry.enabled .Values.workers.notificationRetry.enabled .Values.workers.retentionEnforce.enabled .Values.workers.billingEntitlementReconcile.enabled .Values.workers.billingLifecycleEnforce.enabled .Values.workers.toolDispatch.enabled .Values.workers.browserAutomation.enabled .Values.workers.knowledgeExtraction.enabled .Values.workers.voiceCatalogSync.enabled -}}
  {{- if and $opsEnabled (not (regexMatch "^sha256:[a-fA-F0-9]{64}$" .Values.opsImage.digest)) -}}
    {{- fail "production operational workloads require opsImage.digest (sha256)" -}}
  {{- end -}}
  {{- if eq .Values.backup.mode "managed-verified" -}}
    {{- if not .Values.backup.enabled -}}
      {{- fail "backup.mode=managed-verified requires backup.enabled=true" -}}
    {{- end -}}
    {{- $backupDestinations := list .Values.backup.uploadUrlSecret.name .Values.backup.readbackUrlSecret.name .Values.backup.manifestUploadUrlSecret.name .Values.backup.manifestReadbackUrlSecret.name .Values.backup.statusUploadUrlSecret.name .Values.backup.statusReadbackUrlSecret.name .Values.backup.policyReadbackUrlSecret.name -}}
    {{- range $backupDestinations -}}
      {{- if not . -}}
        {{- fail "managed-verified backups require upload/readback Secret references for backup, manifest, status, and destination lifecycle policy" -}}
      {{- end -}}
    {{- end -}}
  {{- else if eq .Values.backup.mode "externally-managed" -}}
    {{- if .Values.backup.enabled -}}
      {{- fail "backup.mode=externally-managed requires backup.enabled=false" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.backup.externalManagement.owner)) 3 -}}
      {{- fail "externally-managed backups require backup.externalManagement.owner" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.backup.externalManagement.evidenceReference)) 16 -}}
      {{- fail "externally-managed backups require a reviewed backup.externalManagement.evidenceReference" -}}
    {{- end -}}
    {{- if not (regexMatch "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$" .Values.backup.externalManagement.observedAt) -}}
      {{- fail "externally-managed backups require backup.externalManagement.observedAt as a UTC timestamp" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.backup.externalManagement.statusReference)) 16 -}}
      {{- fail "externally-managed backups require a live backup.externalManagement.statusReference" -}}
    {{- end -}}
    {{- if not .Values.backup.externalManagement.alertsConfigured -}}
      {{- fail "externally-managed backups require alerting" -}}
    {{- end -}}
  {{- end -}}
  {{- $retiredWorkers := list .Values.workers.dataConnectorSync.enabled .Values.workers.webhookRetry.enabled .Values.workers.notificationRetry.enabled .Values.workers.retentionEnforce.enabled .Values.workers.billingEntitlementReconcile.enabled .Values.workers.billingLifecycleEnforce.enabled .Values.workers.voiceCatalogSync.enabled -}}
  {{- range $retiredWorkers -}}
    {{- if . -}}
      {{- fail "production forbids tenant-token scheduled CronJobs now owned by the all-tenant scheduled-work coordinator" -}}
    {{- end -}}
  {{- end -}}
  {{- if ne .Values.env.SCHEDULED_TENANT_WORK_OWNER .Values.essentialOperations.scheduledTenantWork.mode -}}
    {{- fail "env.SCHEDULED_TENANT_WORK_OWNER must match essentialOperations.scheduledTenantWork.mode" -}}
  {{- end -}}
  {{- if eq .Values.essentialOperations.scheduledTenantWork.mode "external" -}}
    {{- $external := .Values.essentialOperations.scheduledTenantWork.externalManagement -}}
    {{- if or (lt (len (trim $external.owner)) 3) (lt (len (trim $external.evidenceReference)) 16) (lt (len (trim $external.statusReference)) 16) (not $external.alertsConfigured) (not $external.evidenceConfigMap.name) (not $external.evidenceConfigMap.key) -}}
      {{- fail "external scheduled-work ownership requires owner, reviewed evidence, live status, alerts, and a mounted evidence ConfigMap" -}}
    {{- end -}}
  {{- else if ne .Values.essentialOperations.scheduledTenantWork.mode "internal" -}}
    {{- fail "essentialOperations.scheduledTenantWork.mode must be internal or external" -}}
  {{- end -}}
  {{- $externalOperations := dict "objectStoreBackup" .Values.essentialOperations.objectStoreBackup "disasterRecovery" .Values.essentialOperations.disasterRecovery -}}
  {{- range $name, $operation := $externalOperations -}}
    {{- if lt (len (trim $operation.owner)) 3 -}}
      {{- fail (printf "essentialOperations.%s requires an accountable owner" $name) -}}
    {{- end -}}
    {{- if lt (len (trim $operation.evidenceReference)) 16 -}}
      {{- fail (printf "essentialOperations.%s requires reviewed evidence" $name) -}}
    {{- end -}}
    {{- if not (regexMatch "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{3})?Z$" $operation.observedAt) -}}
      {{- fail (printf "essentialOperations.%s.observedAt must be a UTC timestamp" $name) -}}
    {{- end -}}
    {{- if lt (len (trim $operation.statusReference)) 16 -}}
      {{- fail (printf "essentialOperations.%s requires a live statusReference" $name) -}}
    {{- end -}}
    {{- if not $operation.alertsConfigured -}}
      {{- fail (printf "essentialOperations.%s requires alerting" $name) -}}
    {{- end -}}
  {{- end -}}
  {{- $identities := dict "tool-dispatch" (dict "audience" "tool_dispatch" "worker" .Values.workers.toolDispatch) "browser-automation" (dict "audience" "browser_automation" "worker" .Values.workers.browserAutomation) "knowledge-extraction" (dict "audience" "knowledge_extraction" "worker" .Values.workers.knowledgeExtraction) -}}
  {{- $credentialNames := list -}}
  {{- $migrationSa := include "romeo.identityServiceAccountName" (dict "root" . "identity" (dict "serviceAccount" .Values.migration.serviceAccount) "component" "migration") -}}
  {{- $serviceAccountNames := list (include "romeo.serviceAccountName" .) $migrationSa -}}
  {{- if eq (include "romeo.serviceAccountName" .) $migrationSa -}}
    {{- fail "migration ServiceAccount must be distinct from the app ServiceAccount" -}}
  {{- end -}}
  {{- if .Values.migration.serviceAccount.automountServiceAccountToken -}}
    {{- fail "migration must not automount the Kubernetes API token" -}}
  {{- end -}}
  {{- if .Values.backup.enabled -}}
    {{- $backupSa := include "romeo.identityServiceAccountName" (dict "root" . "identity" (dict "serviceAccount" .Values.backup.serviceAccount) "component" "postgres-backup") -}}
    {{- if or .Values.backup.serviceAccount.automountServiceAccountToken (has $backupSa $serviceAccountNames) -}}
      {{- fail "backup requires a distinct ServiceAccount without an automounted Kubernetes API token" -}}
    {{- end -}}
    {{- $serviceAccountNames = append $serviceAccountNames $backupSa -}}
  {{- end -}}
  {{- range $component, $entry := $identities -}}
    {{- $worker := $entry.worker -}}
    {{- if $worker.enabled -}}
      {{- if or (not $worker.identity.credentialSecret.name) (not $worker.identity.credentialSecret.key) -}}
        {{- fail (printf "%s requires a distinct broker credential Secret reference" $component) -}}
      {{- end -}}
      {{- $previous := $worker.identity.previousCredentialSecret -}}
      {{- if ne (not (empty $previous.name)) (not (empty $previous.key)) -}}
        {{- fail (printf "%s previous broker credential Secret name and key must be configured together" $component) -}}
      {{- end -}}
      {{- if and $previous.name (eq $previous.name $worker.identity.credentialSecret.name) (eq $previous.key $worker.identity.credentialSecret.key) -}}
        {{- fail (printf "%s previous broker credential must not reuse the current Secret reference" $component) -}}
      {{- end -}}
      {{- if ne $worker.identity.audience $entry.audience -}}
        {{- fail (printf "%s identity audience must exactly match its workload" $component) -}}
      {{- end -}}
      {{- if or (ne (len $worker.identity.scopes) 1) (ne (index $worker.identity.scopes 0) (printf "worker:%s" $entry.audience)) -}}
        {{- fail (printf "%s identity must have only its exact worker scope" $component) -}}
      {{- end -}}
      {{- if $worker.identity.serviceAccount.automountServiceAccountToken -}}
        {{- fail (printf "%s must not automount the Kubernetes API token" $component) -}}
      {{- end -}}
      {{- $sa := include "romeo.identityServiceAccountName" (dict "root" $ "identity" $worker.identity "component" $component) -}}
      {{- if has $worker.identity.credentialSecret.name $credentialNames -}}
        {{- fail "worker broker credential Secret names must be distinct" -}}
      {{- end -}}
      {{- if and $previous.name (has $previous.name $credentialNames) -}}
        {{- fail "worker previous broker credential Secret names must be distinct from other audiences" -}}
      {{- end -}}
      {{- if has $sa $serviceAccountNames -}}
        {{- fail "worker Kubernetes service accounts must be distinct" -}}
      {{- end -}}
      {{- $credentialNames = append $credentialNames $worker.identity.credentialSecret.name -}}
      {{- if $previous.name -}}
        {{- $credentialNames = append $credentialNames $previous.name -}}
      {{- end -}}
      {{- $serviceAccountNames = append $serviceAccountNames $sa -}}
    {{- end -}}
  {{- end -}}
  {{- if or (not .Values.podSecurityContext.runAsNonRoot) (not .Values.securityContext.readOnlyRootFilesystem) .Values.securityContext.allowPrivilegeEscalation -}}
    {{- fail "production requires app runAsNonRoot, readOnlyRootFilesystem, and allowPrivilegeEscalation=false" -}}
  {{- end -}}
  {{- if or (not .Values.workers.podSecurityContext.runAsNonRoot) (not .Values.workers.securityContext.readOnlyRootFilesystem) .Values.workers.securityContext.allowPrivilegeEscalation -}}
    {{- fail "production requires worker runAsNonRoot, readOnlyRootFilesystem, and allowPrivilegeEscalation=false" -}}
  {{- end -}}
  {{- if or (not .Values.networkPolicy.enabled) (empty .Values.networkPolicy.ingressFrom) (empty .Values.networkPolicy.egress) -}}
    {{- fail "production requires a default-deny NetworkPolicy with explicit ingress and egress allowlists" -}}
  {{- end -}}
  {{- if and .Values.workers.toolDispatch.enabled (or (not .Values.workers.toolDispatch.networkPolicy.enabled) (empty .Values.workers.toolDispatch.networkPolicy.egress)) -}}
    {{- fail "production tool-dispatch workers require an explicit default-deny egress NetworkPolicy" -}}
  {{- end -}}
  {{- if and .Values.workers.browserAutomation.enabled (or (not .Values.workers.browserAutomation.networkPolicy.enabled) (empty .Values.workers.browserAutomation.networkPolicy.egress)) -}}
    {{- fail "production browser-automation workers require an explicit default-deny egress NetworkPolicy" -}}
  {{- end -}}
  {{- if and .Values.workers.knowledgeExtraction.enabled (not .Values.workers.knowledgeExtraction.networkPolicy.enabled) -}}
    {{- fail "production knowledge-extraction workers require an explicit default-deny egress NetworkPolicy" -}}
  {{- end -}}
  {{- if or (not .Values.probes.readiness.enabled) (not .Values.probes.readiness.dependencyCheck.enabled) -}}
    {{- fail "production requires dependency-aware readiness" -}}
  {{- end -}}
  {{- if or (not .Values.migration.enabled) (not .Values.migration.useHelmHook) -}}
    {{- fail "production requires the pre-install/pre-upgrade migration hook" -}}
  {{- end -}}
{{- end -}}

{{- define "romeo.opsPullPolicy" -}}
{{- .Values.opsImage.pullPolicy -}}
{{- end -}}

{{- define "romeo.databaseUrlSecretName" -}}
{{- if eq .Values.postgres.mode "cloudnativepg" -}}
{{- default (include "romeo.secretName" .) .Values.postgres.cloudnativepg.databaseUrlSecret.name -}}
{{- else -}}
{{- default (include "romeo.secretName" .) .Values.postgres.databaseUrlSecret.name -}}
{{- end -}}
{{- end -}}

{{- define "romeo.databaseUrlSecretKey" -}}
{{- if eq .Values.postgres.mode "cloudnativepg" -}}
{{- default "DATABASE_URL" .Values.postgres.cloudnativepg.databaseUrlSecret.key -}}
{{- else -}}
{{- default "DATABASE_URL" .Values.postgres.databaseUrlSecret.key -}}
{{- end -}}
{{- end -}}

{{- define "romeo.sensitiveEnvKeys" -}}
{{- list
  "DATABASE_URL"
  "VALKEY_URL"
  "SESSION_SECRET"
  "SESSION_SECRET_PREVIOUS"
  "LOCAL_AUTH_SECRET_ENCRYPTION_KEY"
  "LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS"
  "MANAGED_SECRET_ENCRYPTION_KEY"
  "MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS"
  "WEBHOOK_SIGNING_KEY"
  "WEBHOOK_SIGNING_KEY_PREVIOUS"
  "S3_ACCESS_KEY_ID"
  "S3_SECRET_ACCESS_KEY"
  "ROMEO_API_KEY"
  "TOOL_DISPATCH_BROKER_TOKEN"
  "TOOL_DISPATCH_BROKER_TOKEN_PREVIOUS"
  "BROWSER_AUTOMATION_BROKER_TOKEN"
  "BROWSER_AUTOMATION_BROKER_TOKEN_PREVIOUS"
  "KNOWLEDGE_EXTRACTION_BROKER_TOKEN"
  "KNOWLEDGE_EXTRACTION_BROKER_TOKEN_PREVIOUS"
  "VAULT_TOKEN"
  "AWS_ACCESS_KEY_ID"
  "AWS_SECRET_ACCESS_KEY"
  "AWS_SESSION_TOKEN"
  "GCP_ACCESS_TOKEN"
  "AZURE_ACCESS_TOKEN"
  "NOTIFICATION_RESEND_API_KEY"
  "NOTIFICATION_SMTP_PASSWORD"
  "NOTIFICATION_SMTP_USER"
  "VOICE_OPENAI_API_KEY"
  "BILLING_STRIPE_WEBHOOK_SECRET"
  "BILLING_GENERIC_WEBHOOK_SECRET"
  "POSTGRES_BACKUP_UPLOAD_URL"
  "POSTGRES_BACKUP_READBACK_URL"
  "POSTGRES_BACKUP_MANIFEST_UPLOAD_URL"
  "POSTGRES_BACKUP_MANIFEST_READBACK_URL"
  "POSTGRES_BACKUP_STATUS_UPLOAD_URL"
  "POSTGRES_BACKUP_STATUS_READBACK_URL"
  "DATA_CONNECTOR_GITHUB_TOKEN"
  "DELEGATED_OAUTH_GITHUB_CLIENT_SECRET"
  "DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY"
  "DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY_PREVIOUS"
  "TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY"
  "QDRANT_API_KEY_REF"
  | toJson -}}
{{- end -}}

{{- define "romeo.nodeWritableEnv" -}}
- name: HOME
  value: /tmp
- name: XDG_CACHE_HOME
  value: /tmp/.cache
- name: COREPACK_HOME
  value: /tmp/.cache/corepack
- name: PNPM_HOME
  value: /tmp/.local/share/pnpm
{{- end -}}

{{- define "romeo.workerBaseEnv" -}}
{{- include "romeo.nodeWritableEnv" . }}
- name: ROMEO_BASE_URL
  value: {{ printf "http://%s:%v" (include "romeo.fullname" .) .Values.service.port | quote }}
{{- end -}}

{{- define "romeo.workerIdentityEnv" -}}
{{- $root := index . "root" -}}
{{- $identity := index . "identity" -}}
{{- $tokenEnv := index . "tokenEnv" -}}
{{- include "romeo.nodeWritableEnv" $root }}
- name: ROMEO_BASE_URL
  value: {{ printf "http://%s:%v" (include "romeo.fullname" $root) $root.Values.service.port | quote }}
- name: ROMEO_WORKER_BROKER_ALLOW_INSECURE_HTTP
  value: "true"
- name: {{ $tokenEnv }}
  valueFrom:
    secretKeyRef:
      name: {{ $identity.credentialSecret.name | quote }}
      key: {{ $identity.credentialSecret.key | quote }}
- name: ROMEO_WORKER_AUDIENCE
  value: {{ $identity.audience | quote }}
- name: ROMEO_WORKER_SCOPES
  value: {{ join "," $identity.scopes | quote }}
{{- end -}}
