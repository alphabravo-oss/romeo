import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const outDir = argValue("--out-dir") ?? join(root, "sdks", "python");
const packageDir = join(outDir, "romeo_client");
const openApiFile = argValue("--openapi-file");
const openApiUrl =
  argValue("--openapi-url") ?? "http://127.0.0.1:3000/api/v1/openapi.json";

const spec =
  openApiFile === undefined
    ? await fetchJson(openApiUrl)
    : JSON.parse(await readFile(openApiFile, "utf8"));
const operations = collectOperations(spec);

mkdirSync(packageDir, { recursive: true });
writeFileSync(join(outDir, "pyproject.toml"), pyproject(), "utf8");
writeFileSync(
  join(outDir, "README.md"),
  readme(spec, operations.length),
  "utf8",
);
writeFileSync(join(packageDir, "__init__.py"), initPy(), "utf8");
writeFileSync(join(packageDir, "client.py"), clientPy(), "utf8");
writeFileSync(join(packageDir, "errors.py"), errorsPy(), "utf8");
writeFileSync(join(packageDir, "openapi.py"), openApiPy(operations), "utf8");

console.log(
  `Generated Python SDK with ${operations.length} operations at ${outDir}`,
);

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(
      `Failed to fetch OpenAPI JSON from ${url}: ${response.status}`,
    );
  return response.json();
}

function collectOperations(spec) {
  const operations = [];
  const methods = new Set(["get", "post", "put", "patch", "delete"]);
  for (const path of Object.keys(spec.paths).sort()) {
    for (const method of Object.keys(spec.paths[path]).sort()) {
      if (!methods.has(method)) continue;
      const operation = spec.paths[path][method];
      operations.push({
        name: operationName(method, path),
        method: method.toUpperCase(),
        path: `/api/v1${path}`,
        summary: operation.summary ?? "",
      });
    }
  }
  return operations;
}

function operationName(method, path) {
  const parts = path
    .replace(/[{}]/g, "")
    .split("/")
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase(),
    )
    .filter(Boolean);
  return [method.toLowerCase(), ...parts].join("_");
}

function pyproject() {
  return `[project]
name = "romeo-client"
version = "0.1.0"
description = "Generated Python client for the Romeo API"
requires-python = ">=3.11"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"
`;
}

function readme(spec, operationCount) {
  return `# Romeo Python Client

This SDK is generated from ${spec.info.title} ${spec.info.version}. It uses only the Python standard library and exposes a generic OpenAPI operation caller plus small convenience methods for common workflows.

## Generate

\`\`\`sh
node scripts/generate-python-sdk.mjs --openapi-url http://127.0.0.1:3000/api/v1/openapi.json
\`\`\`

Generated operations: ${operationCount}

## Example

\`\`\`py
from romeo_client import RomeoClient

client = RomeoClient(base_url="http://127.0.0.1:3000", api_key="rmk_...")
print(client.health())
agents = client.list_agents("workspace_default")
chat = client.create_chat("workspace_default", "Python check")
run = client.start_run(chat["id"], agents[0]["id"], "Hello Romeo")
device = client.create_device_authorization("MacBook", ["me:read", "chats:read"], ttl_days=90)
rotated = client.refresh_device_authorization(device["refreshToken"])
workflow = client.create_workflow(
    "workspace_default",
    "Review flow",
    [{"type": "agent_run", "name": "Draft", "agentId": agents[0]["id"]}, {"type": "approval", "name": "Review"}],
)
\`\`\`
`;
}

function initPy() {
  return `from .client import RomeoClient
from .errors import RomeoApiError
from .openapi import OPERATIONS

__all__ = ["RomeoApiError", "RomeoClient", "OPERATIONS"]
`;
}

function errorsPy() {
  return `class RomeoApiError(Exception):
    def __init__(self, status_code, code, message, request_id=None, details=None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.request_id = request_id
        self.details = details or {}
`;
}

function clientPy() {
  return `import json
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

from .errors import RomeoApiError
from .openapi import OPERATIONS


class RomeoClient:
    def __init__(self, base_url: str = "http://127.0.0.1:3000", api_key: str | None = None, timeout: float = 30):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def request(
        self,
        method: str,
        path: str,
        query: dict[str, Any] | None = None,
        json_body: Any | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        url = self.base_url + path
        query = {key: value for key, value in (query or {}).items() if value is not None}
        if query:
            url += "?" + urlencode(query, doseq=True)

        request_headers = {"accept": "application/json"}
        if self.api_key:
            request_headers["authorization"] = "Bearer " + self.api_key
        if headers:
            request_headers.update(headers)

        body = None
        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            request_headers["content-type"] = "application/json"

        request = Request(url, data=body, headers=request_headers, method=method.upper())
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return self._decode(response.headers.get("content-type", ""), response.read())
        except HTTPError as error:
            payload = self._decode(error.headers.get("content-type", ""), error.read())
            envelope = payload.get("error", {}) if isinstance(payload, dict) else {}
            raise RomeoApiError(
                error.code,
                envelope.get("code", "http_error"),
                envelope.get("message", str(error)),
                envelope.get("request_id"),
                envelope.get("details", {}),
            ) from error

    def data(self, method: str, path: str, **kwargs: Any) -> Any:
        payload = self.request(method, path, **kwargs)
        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        return payload

    def operation(
        self,
        name: str,
        path_params: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
        json_body: Any | None = None,
    ) -> Any:
        operation = OPERATIONS[name]
        return self.data(operation["method"], self._format_path(operation["path"], path_params), query=query, json_body=json_body)

    def health(self) -> Any:
        return self.data("GET", "/api/v1/health")

    def me(self) -> Any:
        return self.data("GET", "/api/v1/me")

    def list_agents(self, workspace_id: str | None = None) -> Any:
        return self.data("GET", "/api/v1/agents", query={"workspaceId": workspace_id})

    def create_chat(self, workspace_id: str, title: str) -> Any:
        return self.data("POST", "/api/v1/chats", json_body={"workspaceId": workspace_id, "title": title})

    def start_run(self, chat_id: str, agent_id: str, content: str) -> Any:
        return self.data("POST", "/api/v1/runs", json_body={"chatId": chat_id, "agentId": agent_id, "content": content})

    def list_eval_ratings(self, run_id: str) -> Any:
        path = "/api/v1/eval-runs/" + quote(run_id, safe="") + "/ratings"
        return self.data("GET", path)

    def rate_eval_result(self, result_id: str, rating: str, comment: str | None = None) -> Any:
        path = "/api/v1/eval-run-results/" + quote(result_id, safe="") + "/rating"
        body = {"rating": rating}
        if comment is not None:
            body["comment"] = comment
        return self.data("POST", path, json_body=body)

    def complete_knowledge_upload(self, knowledge_base_id: str, source_id: str) -> Any:
        path = "/api/v1/knowledge-bases/" + quote(knowledge_base_id, safe="") + "/sources/" + quote(source_id, safe="") + "/complete"
        return self.data("POST", path)

    def extract_knowledge_source(self, knowledge_base_id: str, source_id: str) -> Any:
        path = "/api/v1/knowledge-bases/" + quote(knowledge_base_id, safe="") + "/sources/" + quote(source_id, safe="") + "/extract"
        return self.data("POST", path)

    def check_tool_connector_auth(self, connector_id: str) -> Any:
        path = "/api/v1/tool-connectors/" + quote(connector_id, safe="") + "/auth/check"
        return self.data("POST", path)

    def generate_message_speech(self, message_id: str, voice_profile_id: str) -> Any:
        path = "/api/v1/messages/" + quote(message_id, safe="") + "/speech"
        return self.data("POST", path, json_body={"voiceProfileId": voice_profile_id})

    def retry_due_webhooks(self) -> Any:
        return self.data("POST", "/api/v1/webhook-deliveries/retry-due")

    def retry_due_notifications(self) -> Any:
        return self.data("POST", "/api/v1/notification-deliveries/retry-due")

    def notification_policy(self) -> Any:
        return self.data("GET", "/api/v1/admin/notification-policy")

    def update_notification_policy(self, policy: dict[str, Any]) -> Any:
        return self.data("PATCH", "/api/v1/admin/notification-policy", json_body=policy)

    def enforce_retention(self) -> Any:
        return self.data("POST", "/api/v1/governance/retention/enforce")

    def preview_data_deletion(self, resource_type: str, resource_id: str) -> Any:
        return self.data("POST", "/api/v1/governance/data-deletions/preview", json_body={"resourceType": resource_type, "resourceId": resource_id})

    def execute_data_deletion(self, resource_type: str, resource_id: str, confirm_resource_id: str) -> Any:
        return self.data(
            "POST",
            "/api/v1/governance/data-deletions/execute",
            json_body={"resourceType": resource_type, "resourceId": resource_id, "confirmResourceId": confirm_resource_id},
        )

    def data_rights_coverage(self) -> Any:
        return self.data("GET", "/api/v1/governance/data-rights/coverage")

    def preview_data_export(
        self,
        scope: str,
        workspace_id: str | None = None,
        include_content: bool | None = None,
        include_object_bytes: bool | None = None,
        max_object_bytes: int | None = None,
    ) -> Any:
        body: dict[str, Any] = {"scope": scope}
        if workspace_id is not None:
            body["workspaceId"] = workspace_id
        if include_content is not None:
            body["includeContent"] = include_content
        if include_object_bytes is not None:
            body["includeObjectBytes"] = include_object_bytes
        if max_object_bytes is not None:
            body["maxObjectBytes"] = max_object_bytes
        return self.data("POST", "/api/v1/governance/data-exports/preview", json_body=body)

    def execute_data_export(
        self,
        scope: str,
        workspace_id: str | None = None,
        include_content: bool | None = None,
        include_object_bytes: bool | None = None,
        max_object_bytes: int | None = None,
    ) -> Any:
        body: dict[str, Any] = {"scope": scope}
        if workspace_id is not None:
            body["workspaceId"] = workspace_id
        if include_content is not None:
            body["includeContent"] = include_content
        if include_object_bytes is not None:
            body["includeObjectBytes"] = include_object_bytes
        if max_object_bytes is not None:
            body["maxObjectBytes"] = max_object_bytes
        return self.data("POST", "/api/v1/governance/data-exports/execute", json_body=body)

    def list_data_export_packages(self) -> Any:
        return self.data("GET", "/api/v1/governance/data-exports/packages")

    def create_data_export_package(
        self,
        scope: str,
        workspace_id: str | None = None,
        include_content: bool | None = None,
        include_object_bytes: bool | None = None,
        max_object_bytes: int | None = None,
    ) -> Any:
        body: dict[str, Any] = {"scope": scope}
        if workspace_id is not None:
            body["workspaceId"] = workspace_id
        if include_content is not None:
            body["includeContent"] = include_content
        if include_object_bytes is not None:
            body["includeObjectBytes"] = include_object_bytes
        if max_object_bytes is not None:
            body["maxObjectBytes"] = max_object_bytes
        return self.data("POST", "/api/v1/governance/data-exports/packages", json_body=body)

    def download_data_export_package(self, package_id: str) -> Any:
        path = "/api/v1/governance/data-exports/packages/" + quote(package_id, safe="") + "/content"
        return self.request("GET", path)

    def delete_data_export_package(self, package_id: str, confirm_package_id: str) -> Any:
        path = "/api/v1/governance/data-exports/packages/" + quote(package_id, safe="")
        return self.data("DELETE", path, json_body={"confirmPackageId": confirm_package_id})

    def list_device_authorizations(self) -> Any:
        return self.data("GET", "/api/v1/device-authorizations")

    def create_device_authorization(self, name: str, scopes: list[str], ttl_days: int | None = None) -> Any:
        body = {"name": name, "scopes": scopes}
        if ttl_days is not None:
            body["ttlDays"] = ttl_days
        return self.data("POST", "/api/v1/device-authorizations", json_body=body)

    def refresh_device_authorization(self, refresh_token: str) -> Any:
        return self.data("POST", "/api/v1/device-authorizations/refresh", json_body={"refreshToken": refresh_token})

    def revoke_device_authorization(self, device_authorization_id: str) -> Any:
        path = "/api/v1/device-authorizations/" + quote(device_authorization_id, safe="") + "/revoke"
        return self.data("POST", path)

    def list_workflows(self, workspace_id: str | None = None) -> Any:
        return self.data("GET", "/api/v1/workflows", query={"workspaceId": workspace_id})

    def create_workflow(self, workspace_id: str, name: str, steps: list[dict[str, Any]], description: str | None = None) -> Any:
        body = {"workspaceId": workspace_id, "name": name, "steps": steps}
        if description is not None:
            body["description"] = description
        return self.data("POST", "/api/v1/workflows", json_body=body)

    def start_workflow_run(self, workflow_id: str, run_input: dict[str, Any] | None = None) -> Any:
        path = "/api/v1/workflows/" + quote(workflow_id, safe="") + "/runs"
        body = {} if run_input is None else {"input": run_input}
        return self.data("POST", path, json_body=body)

    def approve_workflow_run(self, workflow_run_id: str, comment: str | None = None) -> Any:
        path = "/api/v1/workflow-runs/" + quote(workflow_run_id, safe="") + "/approve"
        body = {} if comment is None else {"comment": comment}
        return self.data("POST", path, json_body=body)

    def claim_browser_automation_task(self, lease_seconds: int | None = None) -> Any:
        body = {} if lease_seconds is None else {"leaseSeconds": lease_seconds}
        return self.data("POST", "/api/v1/browser-automation-tasks/claim", json_body=body)

    def renew_browser_automation_task(self, job_id: str, lease_seconds: int | None = None) -> Any:
        path = "/api/v1/browser-automation-tasks/" + quote(job_id, safe="") + "/renew-lease"
        body = {} if lease_seconds is None else {"leaseSeconds": lease_seconds}
        return self.data("POST", path, json_body=body)

    def create_browser_automation_artifact_upload(self, job_id: str, artifact_type: str, content_type: str, size_bytes: int) -> Any:
        path = "/api/v1/browser-automation-tasks/" + quote(job_id, safe="") + "/artifacts/uploads"
        body = {"type": artifact_type, "contentType": content_type, "sizeBytes": size_bytes}
        return self.data("POST", path, json_body=body)

    def complete_browser_automation_task(self, job_id: str, result: dict[str, Any]) -> Any:
        path = "/api/v1/browser-automation-tasks/" + quote(job_id, safe="") + "/complete"
        return self.data("POST", path, json_body={"result": result})

    def fail_browser_automation_task(self, job_id: str, error_code: str) -> Any:
        path = "/api/v1/browser-automation-tasks/" + quote(job_id, safe="") + "/fail"
        return self.data("POST", path, json_body={"errorCode": error_code})

    def expire_browser_automation_tasks(
        self,
        queued_timeout_seconds: int | None = None,
        running_timeout_seconds: int | None = None,
        limit: int | None = None,
    ) -> Any:
        body = {}
        if queued_timeout_seconds is not None:
            body["queuedTimeoutSeconds"] = queued_timeout_seconds
        if running_timeout_seconds is not None:
            body["runningTimeoutSeconds"] = running_timeout_seconds
        if limit is not None:
            body["limit"] = limit
        return self.data("POST", "/api/v1/browser-automation-tasks/expire", json_body=body)

    def stream_run_events(self, run_id: str):
        path = "/api/v1/runs/" + quote(run_id, safe="") + "/events"
        url = self.base_url + path
        headers = {"accept": "text/event-stream"}
        if self.api_key:
            headers["authorization"] = "Bearer " + self.api_key
        request = Request(url, headers=headers, method="GET")
        with urlopen(request, timeout=self.timeout) as response:
            event_type = None
            for raw_line in response:
                line = raw_line.decode("utf-8").strip()
                if line.startswith("event:"):
                    event_type = line[6:].strip()
                elif line.startswith("data:"):
                    data = json.loads(line[5:].strip())
                    if event_type is not None:
                        data["event"] = event_type
                    yield data

    def _format_path(self, path: str, path_params: dict[str, Any] | None) -> str:
        formatted = path
        for key, value in (path_params or {}).items():
            formatted = formatted.replace("{" + key + "}", quote(str(value), safe=""))
        if "{" in formatted:
            raise ValueError("Missing path parameter for " + formatted)
        return formatted

    def _decode(self, content_type: str, body: bytes) -> Any:
        if not body:
            return None
        text = body.decode("utf-8")
        if "application/json" in content_type:
            return json.loads(text)
        return text
`;
}

function openApiPy(operations) {
  const operationMap = Object.fromEntries(
    operations.map((operation) => [operation.name, operation]),
  );
  return `# Generated by scripts/generate-python-sdk.mjs. Do not edit by hand.

OPERATIONS = ${JSON.stringify(operationMap, null, 4)}
`;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}
