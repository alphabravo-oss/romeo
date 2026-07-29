import { Button, StatusBadge } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";

import {
  getEdgeSecurityPosture,
  type EdgeSecurityPostureCheck,
  type EdgeSecurityPostureReport,
} from "../features/edge-security";
import { type MessageKey, useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { PanelState } from "../lib/panel-state";
import { PanelStats } from "./PanelStats";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

const postureCheckColumn = createColumnHelper<EdgeSecurityPostureCheck>();

function postureCheckColumns(
  t: ReturnType<typeof useLocale>["t"],
): ColumnDef<EdgeSecurityPostureCheck, any>[] {
  return [
    postureCheckColumn.accessor("id", {
      header: t("abuseCheck"),
      cell: (cell) => (
        <span className="font-medium">
          {humanizeCheckValue(cell.getValue())}
        </span>
      ),
    }),
    postureCheckColumn.accessor("status", {
      header: t("abuseStatus"),
      cell: (cell) => (
        <StatusBadge tone={cell.getValue() === "pass" ? "success" : "warning"}>
          {humanizeCheckValue(cell.getValue())}
        </StatusBadge>
      ),
    }),
    postureCheckColumn.accessor("message", {
      header: t("abuseMessage"),
      cell: (cell) => (
        <span className="whitespace-normal">{cell.getValue()}</span>
      ),
    }),
    postureCheckColumn.accessor(
      (check) =>
        Object.entries(check.details)
          .map(([key, value]) => `${humanizeCheckValue(key)}: ${String(value)}`)
          .join(" · "),
      {
        id: "details",
        header: t("abuseDetails"),
        cell: (cell) => (
          <span className="whitespace-normal text-xs text-muted">
            {cell.getValue()}
          </span>
        ),
      },
    ),
  ];
}

export function EdgeSecurityPostureTab() {
  const { t } = useLocale();
  const postureQuery = useQuery({
    queryKey: ["edgeSecurityPosture"],
    queryFn: getEdgeSecurityPosture,
  });

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("abuseEdgeSecurityPosture")}</div>
        <Button
          disabled={postureQuery.isFetching}
          onClick={() => void postureQuery.refetch()}
          type="button"
        >
          {postureQuery.isFetching ? t("refreshing") : t("refresh")}
        </Button>
      </div>
      <PanelState
        query={postureQuery}
        empty={t("abuseNoPostureLoaded")}
        isEmpty={() => false}
      >
        {(report) => <EdgeSecurityPostureView report={report} />}
      </PanelState>
    </div>
  );
}

function EdgeSecurityPostureView(props: { report: EdgeSecurityPostureReport }) {
  const { t } = useLocale();
  const { report } = props;
  const passCount = report.checks.filter(
    (check) => check.status === "pass",
  ).length;
  const warnCount = report.checks.filter(
    (check) => check.status === "warn",
  ).length;

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          {
            label: t("abuseStatus"),
            value:
              report.status === "ready"
                ? t("abuseReady")
                : t("abuseAttentionRequired"),
          },
          { label: t("abuseChecksPassing"), value: passCount },
          { label: t("abuseChecksWarning"), value: warnCount },
          { label: t("abuseAppOrigin"), value: report.appOrigin.scheme },
          { label: t("abuseWafMode"), value: report.ingress.wafMode },
        ]}
      />

      <PostureStats
        title={t("abuseTls")}
        items={[
          [
            "abuseAppOriginHttps",
            report.tls.appOriginHttps ? t("abuseYes") : t("abuseNo"),
          ],
          [
            "abuseHsts",
            report.tls.hstsEnabled ? t("abuseEnabled") : t("abuseDisabled"),
          ],
          ["abuseHstsMaxAge", report.tls.hstsMaxAgeSeconds],
          [
            "abuseIncludeSubdomains",
            report.tls.hstsIncludeSubdomains ? t("abuseYes") : t("abuseNo"),
          ],
          [
            "abusePreload",
            report.tls.hstsPreload ? t("abuseYes") : t("abuseNo"),
          ],
          ["abuseTermination", report.tls.termination],
        ]}
      />

      <PostureStats
        title={t("abuseProxyIngress")}
        items={[
          ["abuseProxyMode", report.proxy.mode],
          [
            "abuseForwardedHeadersTrusted",
            report.proxy.forwardedHeadersTrusted ? t("abuseYes") : t("abuseNo"),
          ],
          ["abuseAllowedOriginRules", report.ingress.allowedOriginRuleCount],
        ]}
      />

      <PostureStats
        title={t("abuseRateLimits")}
        items={[
          ["abuseDriver", report.limits.rateLimit.driver],
          [
            "abuseDistributed",
            report.limits.rateLimit.distributed ? t("abuseYes") : t("abuseNo"),
          ],
          ["abuseWindowSeconds", report.limits.rateLimit.windowSeconds],
          ["abuseAuthenticatedMax", report.limits.rateLimit.authenticatedMax],
          ["abuseAuthMax", report.limits.rateLimit.authMax],
          ["abusePublicMax", report.limits.rateLimit.publicMax],
          ["abuseWebhookMax", report.limits.rateLimit.webhookMax],
        ]}
      />

      <PostureStats
        title={t("abuseSizeLimitsBytes")}
        items={[
          ["abuseRequestBody", report.limits.requestBodyMaxBytes],
          ["abuseDirectUpload", report.limits.files.directUploadMaxBytes],
          ["abuseInline", report.limits.files.inlineMaxBytes],
          [
            "abuseMessageAttachment",
            report.limits.files.messageAttachmentMaxBytes,
          ],
          ["abuseResumableUpload", report.limits.files.resumableUploadMaxBytes],
        ]}
      />

      <div className="rm-card-header">
        <div className="rm-card-title">{t("abuseChecks")}</div>
        <span className="text-xs text-muted">
          {t("generated")} <LocalizedDateTime value={report.generatedAt} />
        </span>
      </div>
      <DataTable
        columns={postureCheckColumns(t)}
        data={report.checks}
        empty={t("abuseNoChecks")}
        getRowId={(check) => check.id}
        minTableWidth={820}
      />
    </div>
  );
}

function humanizeCheckValue(value: string): string {
  return value.replaceAll("_", " ");
}

function PostureStats(props: {
  title: string;
  items: Array<[MessageKey, string | number]>;
}) {
  const { t } = useLocale();
  return (
    <>
      <div className="rm-card-title">{props.title}</div>
      <PanelStats
        items={props.items.map(([label, value]) => ({
          label: t(label),
          value,
        }))}
      />
    </>
  );
}
