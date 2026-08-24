import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  ragPolicyQueryOptions,
  ragPostureQueryOptions,
  type RagPolicyReport,
} from "../features/rag-governance";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { RagPolicyHeader } from "./RagPolicyHeader";

export function RagPolicyQueryBoundary({
  children,
}: {
  children: (report: RagPolicyReport, qdrantAvailable: boolean) => ReactNode;
}) {
  const { t } = useLocale();
  const policyQuery = useQuery(ragPolicyQueryOptions());
  const postureQuery = useQuery(ragPostureQueryOptions());
  const qdrantAvailable =
    postureQuery.data?.vector.externalStore.driver === "qdrant" &&
    postureQuery.data.vector.externalStore.endpointConfigured === true;
  return (
    <div className="grid gap-2">
      <RagPolicyHeader
        onRefresh={() => {
          void policyQuery.refetch();
          void postureQuery.refetch();
        }}
        refreshing={policyQuery.isFetching || postureQuery.isFetching}
      />
      <PanelState
        query={policyQuery}
        empty={t("noRagPolicy")}
        isEmpty={() => false}
      >
        {(report) => children(report, qdrantAvailable)}
      </PanelState>
    </div>
  );
}
