import { ApiError } from "../errors";
import { isPrivateNetworkHost } from "./network-host-policy";
import type { NormalizedBrowserTask } from "./browser-automation-task-types";

export interface BrowserTaskStepInput {
  approvalPrompt?: string;
  id?: string;
  name?: string;
  targetUrl?: string;
  task?: string;
}

export function normalizeBrowserTaskStep(
  step: BrowserTaskStepInput,
): NormalizedBrowserTask {
  if (step.targetUrl === undefined)
    throw invalidBrowserTask("Browser task steps require a targetUrl.");
  if (step.task === undefined || step.task.trim().length === 0)
    throw invalidBrowserTask("Browser task steps require a task.");

  let url: URL;
  try {
    url = new URL(step.targetUrl);
  } catch {
    throw invalidBrowserTask("Browser task targetUrl must be a valid URL.");
  }
  if (url.protocol !== "https:")
    throw invalidBrowserTask("Browser task targetUrl must use HTTPS.");
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.search.length > 0
  )
    throw invalidBrowserTask(
      "Browser task targetUrl must not include credentials, fragments, or query strings.",
    );
  if (isPrivateNetworkHost(url.hostname))
    throw invalidBrowserTask(
      "Browser task targetUrl must not target local or private hosts.",
    );
  return {
    targetUrl: `${url.origin}${url.pathname}`,
    targetOrigin: url.origin,
    targetHost: url.hostname,
    task: step.task.trim(),
  };
}

function invalidBrowserTask(message: string): ApiError {
  return new ApiError("invalid_workflow_step", message, 400);
}
