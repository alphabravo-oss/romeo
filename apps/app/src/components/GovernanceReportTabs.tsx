import { Button } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  exportAccessReviewCsv,
  exportAccessReviewReportCsv,
  exportComplianceReportCsv,
  getAccessReviewReport,
  getDataRightsCoverage,
} from "../features";
import { downloadCsv } from "../lib/csv";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { PanelStats } from "./PanelStats";

export function DataRightsTab() {
  const { t } = useLocale();
  const coverageQuery = useQuery({
    queryKey: ["dataRightsCoverage"],
    queryFn: getDataRightsCoverage,
  });
  const report = coverageQuery.data;

  if (coverageQuery.isLoading)
    return <div className="text-muted text-sm">{t("govLoading")}</div>;
  if (!report)
    return (
      <div className="text-muted text-sm">{t("govCoverageUnavailable")}</div>
    );

  const implementedStorage = report.storageClasses.filter(
    (entry) => entry.deletionCoverage === "implemented",
  ).length;

  return (
    <div className="grid gap-4 text-sm">
      <PanelStats
        items={[
          {
            label: t("govStorageClasses"),
            value: report.storageClasses.length,
          },
          { label: t("govDeletionImplemented"), value: implementedStorage },
          {
            label: t("govDeletionWorkflows"),
            value: report.deletionWorkflows.length,
          },
          {
            label: t("govExportWorkflows"),
            value: report.exportWorkflows.length,
          },
          { label: t("govOpenGaps"), value: report.openGaps.length },
        ]}
      />
      <div className="text-muted">
        {t("generated")} <LocalizedDateTime value={report.generatedAt} />
      </div>
      <div className="grid gap-2">
        {report.storageClasses.map((entry) => (
          <div
            className="grid gap-1 rounded-md border border-border p-2"
            key={entry.id}
          >
            <div className="font-medium">{entry.label}</div>
            <div className="text-muted">
              {t("govDeleteLower")}: {entry.deletionCoverage} ·{" "}
              {t("govExportLower")}: {entry.exportCoverage} ·{" "}
              {t("govRetentionLower")}: {entry.retentionCoverage}
            </div>
          </div>
        ))}
      </div>
      {report.openGaps.length > 0 ? (
        <div className="rounded-md border border-border p-2">
          <div className="font-medium">{t("govOpenGaps")}</div>
          <ul className="ml-4 list-disc text-muted">
            {report.openGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function GovernanceReportsTab() {
  const { t } = useLocale();
  const reportQuery = useQuery({
    queryKey: ["accessReviewReport"],
    queryFn: getAccessReviewReport,
  });
  const complianceExportMutation = useMutation({
    mutationFn: exportComplianceReportCsv,
    onSuccess: (csv) => downloadCsv(csv, "romeo-compliance-report.csv"),
    onError: () => toast(t("govCouldNotExportComplianceReport"), "error"),
  });
  const accessExportMutation = useMutation({
    mutationFn: exportAccessReviewCsv,
    onSuccess: (csv) => downloadCsv(csv, "romeo-access-review.csv"),
    onError: () => toast(t("govCouldNotExportAccessReview"), "error"),
  });
  const accessReportExportMutation = useMutation({
    mutationFn: exportAccessReviewReportCsv,
    onSuccess: (csv) => downloadCsv(csv, "romeo-access-review-report.csv"),
    onError: () => toast(t("govCouldNotExportAccessReviewReport"), "error"),
  });
  const summary = reportQuery.data?.summary;

  return (
    <div className="grid gap-4 text-sm">
      {summary ? (
        <PanelStats
          items={[
            { label: t("govUsers"), value: summary.userCount },
            { label: t("govDisabledUsers"), value: summary.disabledUserCount },
            {
              label: t("govServiceAccounts"),
              value: summary.serviceAccountCount,
            },
            {
              label: t("govResourceGrants"),
              value: summary.resourceGrantCount,
            },
            {
              label: t("govRiskyToolConnectors"),
              value: summary.riskyToolConnectorCount,
            },
          ]}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ReportExportButton
          isPending={complianceExportMutation.isPending}
          label={t("govExportComplianceReport")}
          onClick={() => complianceExportMutation.mutate()}
        />
        <ReportExportButton
          isPending={accessExportMutation.isPending}
          label={t("govExportAccessReview")}
          onClick={() => accessExportMutation.mutate()}
        />
        <ReportExportButton
          isPending={accessReportExportMutation.isPending}
          label={t("govExportAccessReviewReport")}
          onClick={() => accessReportExportMutation.mutate()}
        />
      </div>
    </div>
  );
}

function ReportExportButton(props: {
  isPending: boolean;
  label: string;
  onClick: () => void;
}) {
  const { t } = useLocale();
  return (
    <Button disabled={props.isPending} onClick={props.onClick} type="button">
      {props.isPending ? t("govExporting") : props.label}
    </Button>
  );
}
