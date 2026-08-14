import { Button } from "@romeo/ui";
import { useQueryClient } from "@tanstack/react-query";
import CloudOff from "lucide-react/dist/esm/icons/cloud-off.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import { useEffect, useRef, useState } from "react";

import {
  markMutationNetworkOffline,
  useOnlineStatus,
} from "../lib/connectivity";
import { useLocale } from "../lib/i18n";
import { revalidateAfterReconnect } from "../lib/reconnect-policy";
import { useRouterApiClient } from "../lib/router-context";
import {
  markActiveRunsOffline,
  releaseActiveRunsAfterReconnect,
} from "../lib/run-registry";
import { useWorkspace } from "./WorkspaceContext";

type ConnectivityDisplay =
  | "offline"
  | "online"
  | "reconnected"
  | "revalidating"
  | "revalidation_failed";

export function ConnectivityStatus() {
  const { t } = useLocale();
  const online = useOnlineStatus();
  const previousOnline = useRef(online);
  const recoveryGeneration = useRef(0);
  const handledRetryAttempt = useRef(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [display, setDisplay] = useState<ConnectivityDisplay>(
    online ? "online" : "offline",
  );
  const queryClient = useQueryClient();
  const apiClient = useRouterApiClient();
  const { chatSyncStatus, workspaceId } = useWorkspace();

  useEffect(() => {
    const wasOnline = previousOnline.current;
    previousOnline.current = online;
    const retryRequested = retryAttempt !== handledRetryAttempt.current;
    handledRetryAttempt.current = retryAttempt;
    const generation = recoveryGeneration.current + 1;
    recoveryGeneration.current = generation;
    if (!online) {
      markMutationNetworkOffline();
      markActiveRunsOffline();
      setDisplay("offline");
      return;
    }
    if (wasOnline && !retryRequested) return;

    setDisplay("revalidating");
    let reconnectedTimer: ReturnType<typeof setTimeout> | undefined;
    void revalidateAfterReconnect({ apiClient, queryClient, workspaceId })
      .then(() => {
        if (recoveryGeneration.current !== generation) return;
        releaseActiveRunsAfterReconnect();
        setDisplay("reconnected");
        reconnectedTimer = setTimeout(() => {
          if (recoveryGeneration.current === generation) setDisplay("online");
        }, 4_000);
      })
      .catch(() => {
        if (recoveryGeneration.current === generation) {
          setDisplay("revalidation_failed");
        }
      });
    return () => clearTimeout(reconnectedTimer);
  }, [apiClient, online, queryClient, retryAttempt, workspaceId]);

  if (display === "offline") {
    return (
      <div
        aria-live="polite"
        className="rm-connectivity-banner danger"
        role="status"
      >
        <CloudOff aria-hidden="true" size={15} />
        <span>
          <strong>{t("offline")}</strong> {t("offlineDescription")}{" "}
          <span className="rm-status neutral">{t("cachedDataLabel")}</span>
        </span>
      </div>
    );
  }

  if (display === "revalidating") {
    return (
      <div
        aria-live="polite"
        className="rm-connectivity-banner warning"
        role="status"
      >
        <RefreshCw aria-hidden="true" size={15} />
        <span>{t("reconnectRevalidating")}</span>
      </div>
    );
  }

  if (display === "revalidation_failed") {
    return (
      <div
        aria-live="polite"
        className="rm-connectivity-banner danger"
        role="status"
      >
        <CloudOff aria-hidden="true" size={15} />
        <span>{t("reconnectValidationFailed")}</span>
        <Button
          onClick={() => setRetryAttempt((attempt) => attempt + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("tryAgain")}
        </Button>
      </div>
    );
  }

  if (display === "reconnected") {
    return (
      <div
        aria-live="polite"
        className="rm-connectivity-banner success"
        role="status"
      >
        <RefreshCw aria-hidden="true" size={15} />
        <span>{t("reconnectedValidated")}</span>
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
