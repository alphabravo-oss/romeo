import type { GeneratedApiClient } from "@romeo/api-client/runtime/generated-client";

import { hasFlag, type ParsedArgs } from "./args";
import { CliUsageError } from "./cli-errors";
import type { CliIo } from "./io";
import type { ToolDispatchPinnedFetch } from "./dns-pinned-fetch";
import { executeAdministrationCommand } from "./administration-commands";
import { executeAuditCommand } from "./audit-commands";
import { executeBillingCommand } from "./billing-commands";
import { executeBrowserTaskCommand } from "./browser-task-commands";
import { executeChatCommand } from "./chat-commands";
import { executeCollaborationCommand } from "./collaboration-commands";
import { executeDeviceCommand } from "./device-commands";
import { executeEvalCommand } from "./eval-commands";
import { executeGovernanceCommand } from "./governance-commands";
import { executeDataConnectorCommand } from "./data-connector-commands";
import { executeKnowledgeCommand } from "./knowledge-commands";
import { executeManagedModelCommand } from "./managed-model-commands";
import { executeNotificationCommand } from "./notification-commands";
import { executeOperationalCommand } from "./operational-commands";
import { executeProviderCommand } from "./provider-commands";
import { executeSessionCommand } from "./session-commands";
import { executeToolCommand } from "./tool-commands";
import { executeVoiceCommand } from "./voice-commands";
import { executeWebhookCommand } from "./webhook-commands";
import { executeWorkflowCommand } from "./workflow-commands";
import { executeWorkerCommand } from "./worker-commands";

export interface CommandContext {
  generatedClient: GeneratedApiClient;
  dnsLookup?: (
    host: string,
  ) => Promise<Array<{ address: string; family?: number }>>;
  fetchImpl: typeof fetch;
  io: CliIo;
  pinnedFetchImpl?: ToolDispatchPinnedFetch;
  parsed: ParsedArgs;
  readFile: (path: string) => Promise<Uint8Array>;
}

export async function executeCommand(context: CommandContext): Promise<number> {
  const [area, action] = context.parsed.positionals;
  if (area === undefined || hasFlag(context.parsed.flags, "help", "h")) {
    printUsage(context.io);
    return 0;
  }

  const operationalCommand = executeOperationalCommand(area, action, context);
  if (operationalCommand !== undefined) return operationalCommand;
  const auditCommand = executeAuditCommand(area, action, context);
  if (auditCommand !== undefined) return auditCommand;
  const billingCommand = executeBillingCommand(area, action, context);
  if (billingCommand !== undefined) return billingCommand;
  const governanceCommand = executeGovernanceCommand(area, action, context);
  if (governanceCommand !== undefined) return governanceCommand;
  const providerCommand = executeProviderCommand(area, action, context);
  if (providerCommand !== undefined) return providerCommand;
  const administrationCommand = executeAdministrationCommand(
    area,
    action,
    context,
  );
  if (administrationCommand !== undefined) return administrationCommand;
  const collaborationCommand = executeCollaborationCommand(
    area,
    action,
    context,
  );
  if (collaborationCommand !== undefined) return collaborationCommand;
  const chatCommand = executeChatCommand(area, action, context);
  if (chatCommand !== undefined) return chatCommand;
  const notificationCommand = executeNotificationCommand(area, action, context);
  if (notificationCommand !== undefined) return notificationCommand;
  const voiceCommand = executeVoiceCommand(area, action, context);
  if (voiceCommand !== undefined) return voiceCommand;
  const dataConnectorCommand = executeDataConnectorCommand(
    area,
    action,
    context,
  );
  if (dataConnectorCommand !== undefined) return dataConnectorCommand;
  const deviceCommand = executeDeviceCommand(area, action, context);
  if (deviceCommand !== undefined) return deviceCommand;
  const sessionCommand = executeSessionCommand(area, action, context);
  if (sessionCommand !== undefined) return sessionCommand;
  const evalCommand = executeEvalCommand(area, action, context);
  if (evalCommand !== undefined) return evalCommand;
  const managedModelCommand = executeManagedModelCommand(area, action, context);
  if (managedModelCommand !== undefined) return managedModelCommand;
  const toolCommand = executeToolCommand(area, action, context);
  if (toolCommand !== undefined) return toolCommand;
  const knowledgeCommand = executeKnowledgeCommand(area, action, context);
  if (knowledgeCommand !== undefined) return knowledgeCommand;
  const webhookCommand = executeWebhookCommand(area, action, context);
  if (webhookCommand !== undefined) return webhookCommand;
  const workflowCommand = executeWorkflowCommand(area, action, context);
  if (workflowCommand !== undefined) return workflowCommand;
  const browserTaskCommand = executeBrowserTaskCommand(area, action, context);
  if (browserTaskCommand !== undefined) return browserTaskCommand;
  const workerCommand = executeWorkerCommand(area, action, context);
  if (workerCommand !== undefined) return workerCommand;

  throw new CliUsageError(
    `Unknown command: ${context.parsed.positionals.join(" ")}`,
  );
}

export { CliUsageError } from "./cli-errors";

function printUsage(io: CliIo): void {
  io.stdout.write(`Romeo CLI

Usage:
  romeo health [--base-url URL] [--api-key KEY]
  romeo providers summary
  romeo models list
  romeo models sync --provider ID
  romeo billing plan
  romeo billing entitlements
  romeo billing reconcile-entitlements
  romeo billing lifecycle
  romeo billing enforce-lifecycle
  romeo billing apply-plan --code pro --name "Pro" --quota run.started:1000:monthly,tool.call:5000:monthly
  romeo billing sync-external --provider stripe --event-id evt_123 --event invoice.paid --occurred-at 2026-08-13T20:00:00.000Z --external-customer cus_123 --external-subscription sub_123 --plan-code pro --plan-name "Pro" --quota run.started:1000:monthly
  romeo sessions request-impersonation --target-user user_123 --confirm-target-user user_123 --reason "Support ticket investigation" --ticket TICKET-123 --ttl-minutes 15
  romeo sessions approve-impersonation --request support_request_123
  romeo sessions impersonate --target-user user_123 --confirm-target-user user_123 --reason "Support ticket investigation" --ticket TICKET-123 --ttl-minutes 15
  romeo sessions impersonation-report
  romeo sessions impersonation-requests
  romeo groups list
  romeo groups create --name "Reviewers" [--slug reviewers]
  romeo groups members --group group_reviewers
  romeo groups add-member --group group_reviewers --user user_123
  romeo groups remove-member --group group_reviewers --user user_123
  romeo audit list [--action ACTION] [--outcome success|failure]
  romeo audit export [--action ACTION]
  romeo evals create --agent ID --prompt TEXT --expected TEXT [--must-contain TEXT[,TEXT]] [--must-not-contain TEXT[,TEXT]] [--expected-tool NAME[,NAME]] [--required-citation ID[,ID]] [--min-length N] [--max-length N]
  romeo evals run --suite ID
  romeo evals dashboard --agent ID
  romeo evals ratings --run ID
  romeo evals rate --result ID --rating pass|neutral|fail [--comment TEXT]
  romeo share agent --agent ID [--group group_reviewers]
  romeo share chat --chat ID [--group group_reviewers]
  romeo share kb --kb ID [--group group_reviewers]
  romeo share prompt --prompt ID [--group group_reviewers]
  romeo share targets [--query TEXT] [--limit N]
  romeo prompts list --workspace ID [--query TEXT]
  romeo prompts marketplace --workspace ID [--query TEXT]
  romeo prompts create --workspace ID --name NAME --body TEXT [--tags tag,tag] [--visibility private|workspace|marketplace]
  romeo prompts update --prompt ID [--name NAME] [--body TEXT] [--tags tag,tag] [--visibility private|workspace|marketplace]
  romeo comments list --chat ID
  romeo comments create --chat ID --body TEXT
  romeo notifications list
  romeo notifications read --notification ID
  romeo notifications channels
  romeo notifications channel-create [--type webhook] --url https://example.com/notifications [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type email --to user@example.com [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type mobile_push --token-ref romeo-secret://secret_device_token [--platform android|ios|web] [--collapse-key KEY] [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type slack --url https://hooks.slack.com/services/... [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type teams --url https://example.webhook.office.com/... [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications channel-create --type pagerduty --routing-key-ref vault://romeo/pagerduty-routing-key [--severity info|warning|error|critical] [--name NAME] [--enabled-notification-types chat_mention]
  romeo notifications deliveries
  romeo notifications retry-due
  romeo notifications policy
  romeo notifications policy-update [--delivery-enabled true|false] [--allowed-channel-types webhook,email,mobile_push,slack,teams,pagerduty] [--allowed-webhook-hosts hooks.example.com,*.example.net] [--allowed-slack-hosts hooks.slack.com] [--allowed-teams-hosts example.webhook.office.com] [--allowed-email-domains example.com] [--suppressed-notification-types chat_mention]
  romeo voices list
  romeo voices sync
  romeo gallery agents [--workspace ID]
  romeo favorites agent --agent ID
  romeo folders list --workspace ID
  romeo folders create --workspace ID --name NAME
  romeo folders share --folder ID [--group group_reviewers]
  romeo folders items --folder ID
  romeo folders add-item --folder ID --type agent|chat|knowledge_base --resource ID
  romeo folders delete-item --folder ID --item ID
  romeo devices list
  romeo devices create --name NAME --scopes me:read,chats:read [--ttl-days 90]
  romeo devices refresh --refresh-token TOKEN
  romeo devices revoke --device ID
  romeo connectors list [--workspace ID]
  romeo connectors create-local --workspace ID --kb ID [--name NAME] [--source-access-mode connector_owner]
  romeo connectors create-website --workspace ID --kb ID --url https://docs.example.com [--name NAME] [--sync-interval-minutes 60] [--source-access-mode connector_owner]
  romeo connectors create-rss --workspace ID --kb ID --url https://docs.example.com/feed.xml [--name NAME] [--max-items 20] [--sync-interval-minutes 60] [--source-access-mode connector_owner]
  romeo connectors sync --connector ID
  romeo connectors sync-local --connector ID --file path --mime-type text/markdown
  romeo workflows list [--workspace ID]
  romeo workflows templates
  romeo workflows create-template --template ID --workspace ID [--agent ID] [--name NAME] [--schedule-interval-minutes N]
  romeo workflows create --workspace ID --name NAME --agent ID [--handoff-agent ID] [--handoff-prompt TEXT] [--room-agents agent_a,agent_b] [--room-prompt TEXT] [--tool-approval NAME] [--tool-risk low|medium|high] [--tool-input-keys key1,key2] [--browser-url https://example.com/path] [--browser-task TEXT] [--retry-attempts 2] [--on-failure fail|continue] [--approval TEXT] [--schedule-interval-minutes N]
  romeo workflows run-due-schedules
  romeo workflows run --workflow ID
  romeo workflows resume --run ID
  romeo workflows approve --run ID [--comment TEXT]
  romeo workflows browser-task-claim [--lease-seconds 300]
  romeo workflows browser-task-renew --job ID [--lease-seconds 300]
  romeo workflows browser-artifact-upload --job ID --file path --type screenshot|trace --content-type image/png
  romeo workflows browser-tasks-expire [--queued-timeout-seconds 86400] [--running-timeout-seconds 3600] [--limit 100]
  romeo workflows browser-task-complete --job ID [--final-url https://example.com/path] [--artifact-count N] [--duration-ms N] [--navigation-count N] [--network-denied-count N] [--captured-bytes N] [--output-keys key,key] [--redaction-applied true|false]
  romeo workflows browser-task-fail --job ID --error-code browser_failed
  romeo governance retention [--days 365]
  romeo governance retention-enforce
  romeo governance data-delete-preview --chat ID
  romeo governance data-delete --chat ID --confirm ID
  romeo governance compliance-report
  romeo governance compliance-report-export
  romeo workspaces archive --workspace ID
  romeo workspaces export --workspace ID
  romeo access-review
  romeo access-review export
  romeo readiness
  romeo jobs list
  romeo jobs summary
  romeo sso settings
  romeo sso update [--enable|--disable] [--provider-preset keycloak] [--issuer-url URL] [--client-id ID] [--group-claim groups] [--admin-groups group_a,group_b] [--group-map external=group_id] [--workspace-group-map external=workspace_id] [--workspace-group-prefix workspace:]
  romeo sso test
  romeo sso deprovision-oidc --oidc-subject SUBJECT --confirm-oidc-subject SUBJECT [--issuer-url URL]
  romeo users list
  romeo users disable --user ID
  romeo agents list [--workspace ID]
  romeo tools auth-check --connector ID
  romeo tools connector-enable --connector ID
  romeo tools connector-disable --connector ID
  romeo tools operation-enable --connector ID --operation ID
  romeo tools operation-disable --connector ID --operation ID
  romeo tools operation-dispatch --connector ID --operation ID [--param key=value] [--approved --approval-request ID]
  romeo tools operation-enqueue --connector ID --operation ID [--param key=value] [--approved --approval-request ID] [--idempotency-key KEY]
  romeo tools dispatch-request-claim [--lease-seconds 300]
  romeo tools dispatch-request-renew --job ID [--lease-seconds 300]
  romeo tools dispatch-requests-expire [--queued-timeout-seconds 86400] [--running-timeout-seconds 3600] [--limit 100]
  romeo tools dispatch-request-complete --job ID --status 200 [--content-type application/json] [--body-bytes 0] [--truncated] [--schema-validation passed]
  romeo tools dispatch-request-fail --job ID --error-code worker_failed
  romeo tools dispatch-request-cancel --job ID [--reason-code operator_cancelled]
  romeo chat archive --chat ID
  romeo chat legal-hold --chat ID --until ISO_TIMESTAMP [--reason TEXT]
  romeo chat legal-hold-clear --chat ID
  romeo chat run --workspace ID --agent ID --prompt TEXT [--json]
  romeo agent export --agent ID
  romeo agent import --workspace ID --file agent.json
  romeo knowledge upload --kb ID --file path --mime-type text/markdown
  romeo knowledge extract --kb ID --source ID
  romeo knowledge index-embeddings --kb ID --provider ID --model MODEL [--batch-size 16]
  romeo connectors create-s3 --workspace ID --kb ID --bucket BUCKET [--prefix PREFIX] [--region us-east-1] [--secret-ref env://S3_TOKEN] [--source-access-mode connector_owner]
  romeo webhooks create --url https://hooks.example/romeo --events run.completed,run.failed
  romeo webhooks test --webhook ID
  romeo webhooks deliveries [--webhook ID]
  romeo webhooks retry-due
  romeo workers webhook-retry [--once] [--interval-ms 60000] [--max-iterations N]
  romeo workers notification-retry [--once] [--interval-ms 60000] [--max-iterations N]
  romeo workers tool-dispatch [--payload-file payloads.json] [--secret-resolver disabled|env|vault|aws-sm|gcp-sm|azure-kv|cloud] [--once] [--interval-ms 10000] [--max-iterations N] [--max-jobs N] [--lease-seconds 300] [--timeout-ms 10000] [--max-bytes 1000000]
  romeo workers browser-automation --runner-url https://browser-runner.internal/tasks [--once] [--interval-ms 10000] [--max-iterations N] [--max-jobs N] [--lease-seconds 300] [--timeout-ms 30000] [--max-bytes 20000]
  romeo workers knowledge-extraction --kb ID [--once] [--interval-ms 60000] [--max-iterations N] [--max-sources N]
  romeo workers data-connector-sync [--workspace ID] [--once] [--interval-ms 60000] [--max-iterations N] [--max-connectors N]
  romeo workers voice-catalog-sync [--once] [--interval-ms 86400000] [--max-iterations N]
  romeo workers workflow-resume [--workspace ID] [--once] [--interval-ms 60000] [--max-iterations N] [--max-workflows N] [--max-runs N]
  romeo workers retention-enforce [--once] [--interval-ms 86400000] [--max-iterations N]
  romeo workers billing-entitlement-reconcile [--once] [--interval-ms 300000] [--max-iterations N]
  romeo workers billing-lifecycle-enforce [--once] [--interval-ms 900000] [--max-iterations N]
`);
}
