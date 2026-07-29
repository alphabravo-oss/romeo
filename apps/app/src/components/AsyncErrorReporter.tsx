import { useEffect, useRef } from "react";

import {
  createAsyncErrorDedupeState,
  shouldReportAsyncError,
} from "../lib/async-error";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";

export function AsyncErrorReporter() {
  const { t } = useLocale();
  const dedupe = useRef(createAsyncErrorDedupeState());

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!shouldReportAsyncError(dedupe.current, event.reason)) return;
      event.preventDefault();
      toast(t("unexpectedAsyncFailure"), "error");
    };
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () =>
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }, [t]);

  return null;
}
