import { Button, StatusBadge } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  accessReviewReportQueryOptions,
  dataRightsCoverageQueryOptions,
  exportAccessReviewCsvMutationOptions,
  exportAccessReviewReportCsvMutationOptions,
  exportComplianceReportCsvMutationOptions,
} from "../features";
import type { DataRightsCoverageReport } from "../features/types";
import { downloadCsv } from "../lib/csv";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { PanelStats } from "./PanelStats";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";

type StorageClass = DataRightsCoverageReport["storageClasses"][number];
const storageClassColumn = createColumnHelper<StorageClass>();

function storageClassColumns(
  t: ReturnType<typeof useLocale>["t"],
): ColumnDef<StorageClass, any>[] {
  return [
    storageClassColumn.accessor("label", {
      header: t("govStorageClass"),
      cell: (cell) => <span className="font-medium">{cell.getValue()}</span>,
    }),
    storageClassColumn.accessor("deletionCoverage", {
      header: t("govDeletion"),
      cell: (cell) => <CoverageStatus value={cell.getValue()} />,
    }),
    storageClassColumn.accessor("exportCoverage", {
      header: t("govExport"),
      cell: (cell) => <CoverageStatus value={cell.getValue()} />,
    }),
    storageClassColumn.accessor("retentionCoverage", {
      header: t("govRetention"),
      cell: (cell) => <CoverageStatus value={cell.getValue()} />,
    }),
    storageClassColumn.accessor("containsCustomerContent", {
      header: t("govCustomerContent"),
      cell: (cell) => (cell.getValue() ? t("yes") : t("no")),
    }),
  ];
}

function CoverageStatus({ value }: { value: string }) {
  return (
    <StatusBadge tone={value === "implemented" ? "success" : "warning"}>
      {value.replaceAll("_", " ")}
    </StatusBadge>
  );
}

export function DataRightsTab() {
  const { t } = useLocale();
  const coverageQuery = useQuery(dataRightsCoverageQueryOptions());
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
      <DataTable
        columns={storageClassColumns(t)}
        data={report.storageClasses}
        empty={t("govNoStorageClasses")}
        getRowId={(entry) => entry.id}
        minTableWidth={720}
      />
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
  const reportQuery = useQuery(accessReviewReportQueryOptions());
  const complianceExportMutation = useMutation(
    exportComplianceReportCsvMutationOptions(),
  );
  const accessExportMutation = useMutation(
    exportAccessReviewCsvMutationOptions(),
  );
  const accessReportExportMutation = useMutation(
    exportAccessReviewReportCsvMutationOptions(),
  );
  const summary = reportQuery.data?.summary;

  async function handleComplianceExport() {
    try {
      const csv = await complianceExportMutation.mutateAsync();
      downloadCsv(csv, "romeo-compliance-report.csv");
    } catch {
      toast(t("govCouldNotExportComplianceReport"), "error");
    } finally {
      complianceExportMutation.reset();
    }
  }

  async function handleAccessExport() {
    try {
      const csv = await accessExportMutation.mutateAsync();
      downloadCsv(csv, "romeo-access-review.csv");
    } catch {
      toast(t("govCouldNotExportAccessReview"), "error");
    } finally {
      accessExportMutation.reset();
    }
  }

  async function handleAccessReportExport() {
    try {
      const csv = await accessReportExportMutation.mutateAsync();
      downloadCsv(csv, "romeo-access-review-report.csv");
    } catch {
      toast(t("govCouldNotExportAccessReviewReport"), "error");
    } finally {
      accessReportExportMutation.reset();
    }
  }

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
          onClick={() => void handleComplianceExport()}
        />
        <ReportExportButton
          isPending={accessExportMutation.isPending}
          label={t("govExportAccessReview")}
          onClick={() => void handleAccessExport()}
        />
        <ReportExportButton
          isPending={accessReportExportMutation.isPending}
          label={t("govExportAccessReviewReport")}
          onClick={() => void handleAccessReportExport()}
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
