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

{{- define "romeo.workerServiceAccountName" -}}
{{- if .Values.workers.serviceAccount.create -}}
{{- default (printf "%s-worker" (include "romeo.fullname" .)) .Values.workers.serviceAccount.name -}}
{{- else -}}
{{- default (include "romeo.serviceAccountName" .) .Values.workers.serviceAccount.name -}}
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

{{- define "romeo.workerImage" -}}
{{- $repo := default .Values.image.repository .Values.workers.image.repository -}}
{{- $tag := default (.Values.image.tag | default .Chart.AppVersion) .Values.workers.image.tag -}}
{{- $digest := default .Values.image.digest .Values.workers.image.digest -}}
{{- if $digest -}}
{{- printf "%s@%s" $repo $digest -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
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
  {{- if ne .Values.env.HTTP_RATE_LIMIT_DRIVER "valkey" -}}
    {{- fail "production requires env.HTTP_RATE_LIMIT_DRIVER=valkey" -}}
  {{- end -}}
  {{- if ne .Values.env.QUOTA_COORDINATION_DRIVER "valkey" -}}
    {{- fail "production requires env.QUOTA_COORDINATION_DRIVER=valkey" -}}
  {{- end -}}
  {{- if not .Values.valkey.urlSecret.name -}}
    {{- fail "production distributed controls require valkey.urlSecret.name" -}}
  {{- end -}}
  {{- if ne .Values.env.FILE_MALWARE_SCAN_POLICY "required" -}}
    {{- fail "production requires env.FILE_MALWARE_SCAN_POLICY=required" -}}
  {{- end -}}
  {{- if not (regexMatch "^sha256:[a-fA-F0-9]{64}$" .Values.image.digest) -}}
    {{- if not .Values.imagePolicyException.enabled -}}
      {{- fail "production requires image.digest (sha256) or an explicit development-only imagePolicyException" -}}
    {{- end -}}
    {{- if lt (len (trim .Values.imagePolicyException.reason)) 16 -}}
      {{- fail "imagePolicyException.reason must document the development-only exception (minimum 16 characters)" -}}
    {{- end -}}
  {{- end -}}
  {{- if or (not .Values.podSecurityContext.runAsNonRoot) (not .Values.securityContext.readOnlyRootFilesystem) .Values.securityContext.allowPrivilegeEscalation -}}
    {{- fail "production requires app runAsNonRoot, readOnlyRootFilesystem, and allowPrivilegeEscalation=false" -}}
  {{- end -}}
  {{- if or (not .Values.workers.podSecurityContext.runAsNonRoot) (not .Values.workers.securityContext.readOnlyRootFilesystem) .Values.workers.securityContext.allowPrivilegeEscalation -}}
    {{- fail "production requires worker runAsNonRoot, readOnlyRootFilesystem, and allowPrivilegeEscalation=false" -}}
  {{- end -}}
  {{- if or (not .Values.networkPolicy.enabled) (empty .Values.networkPolicy.egress) -}}
    {{- fail "production requires a default-deny NetworkPolicy with an explicit networkPolicy.egress allowlist" -}}
  {{- end -}}
  {{- if and .Values.workers.toolDispatch.enabled (or (not .Values.workers.toolDispatch.networkPolicy.enabled) (empty .Values.workers.toolDispatch.networkPolicy.egress)) -}}
    {{- fail "production tool-dispatch workers require an explicit default-deny egress NetworkPolicy" -}}
  {{- end -}}
  {{- if and .Values.workers.browserAutomation.enabled (or (not .Values.workers.browserAutomation.networkPolicy.enabled) (empty .Values.workers.browserAutomation.networkPolicy.egress)) -}}
    {{- fail "production browser-automation workers require an explicit default-deny egress NetworkPolicy" -}}
  {{- end -}}
  {{- if or (not .Values.probes.readiness.enabled) (not .Values.probes.readiness.dependencyCheck.enabled) -}}
    {{- fail "production requires dependency-aware readiness" -}}
  {{- end -}}
  {{- if or (not .Values.migration.enabled) (not .Values.migration.useHelmHook) -}}
    {{- fail "production requires the pre-install/pre-upgrade migration hook" -}}
  {{- end -}}
{{- end -}}

{{- define "romeo.workerPullPolicy" -}}
{{- default .Values.image.pullPolicy .Values.workers.image.pullPolicy -}}
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
  "S3_ACCESS_KEY_ID"
  "S3_SECRET_ACCESS_KEY"
  "ROMEO_API_KEY"
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
  "DATA_CONNECTOR_GITHUB_TOKEN"
  "DELEGATED_OAUTH_GITHUB_CLIENT_SECRET"
  "DELEGATED_OAUTH_TOKEN_ENCRYPTION_KEY"
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
{{- if .Values.workers.apiKeySecret.name }}
- name: ROMEO_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.workers.apiKeySecret.name }}
      key: {{ .Values.workers.apiKeySecret.key }}
{{- else if or .Values.secrets.existingSecret .Values.secrets.create }}
- name: ROMEO_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "romeo.secretName" . }}
      key: ROMEO_API_KEY
      optional: true
{{- end }}
{{- end -}}
