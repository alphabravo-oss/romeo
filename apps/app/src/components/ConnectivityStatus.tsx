import { useQueryClient } from "@tanstack/react-query";
import CloudOff from "lucide-react/dist/esm/icons/cloud-off.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import { useEffect, useRef } from "react";

import { useOnlineStatus } from "../lib/connectivity";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import { useWorkspace } from "./WorkspaceContext";

export function ConnectivityStatus() {
  const { t } = useLocale();
  const online = useOnlineStatus();
  const previousOnline = useRef(online);
  const queryClient = useQueryClient();
  const { chatSyncStatus } = useWorkspace();

  useEffect(() => {
    const wasOnline = previousOnline.current;
    previousOnline.current = online;
    if (!wasOnline && online) {
      toast(t("backOnline"), "success");
      void queryClient.resumePausedMutations();
      void queryClient.refetchQueries({ type: "active", stale: true });
    }
  }, [online, queryClient, t]);

  if (!online) {
    return (
      <div className="rm-connectivity-banner danger" role="alert">
        <CloudOff aria-hidden="true" size={15} />
        <span>
          <strong>{t("offline")}</strong> {t("offlineDescription")}
        </span>
      </div>
    );
  }

  if (chatSyncStatus === "degraded") {
    return (
      <div
        aria-live="polite"
        className="rm-connectivity-banner warning"
        role="status"
      >
        <RefreshCw aria-hidden="true" size={15} />
        <span>{t("chatSyncReconnecting")}</span>
      </div>
    );
  }

  return null;
}
