import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  ragPolicyQueryOptions,
  type RagPolicyReport,
} from "../features/rag-governance";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { RagPolicyHeader } from "./RagPolicyHeader";

export function RagPolicyQueryBoundary({
  children,
}: {
  children: (report: RagPolicyReport) => ReactNode;
}) {
  const { t } = useLocale();
  const policyQuery = useQuery(ragPolicyQueryOptions());
  return (
    <div className="grid gap-2">
      <RagPolicyHeader
        onRefresh={() => void policyQuery.refetch()}
        refreshing={policyQuery.isFetching}
      />
      <PanelState
        query={policyQuery}
        empty={t("noRagPolicy")}
        isEmpty={() => false}
      >
        {children}
      </PanelState>
    </div>
  );
}
