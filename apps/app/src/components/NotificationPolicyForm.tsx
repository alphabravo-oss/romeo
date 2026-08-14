import { Button, Input, Textarea } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";

import {
  notificationPolicyQueryOptions,
  notificationChannelTypes,
  notificationTypes,
  updateNotificationPolicyMutationOptions,
} from "../features/notifications";
import type {
  NotificationPolicyReport,
  NotificationType,
  UpdateNotificationPolicyRequest,
} from "../features/notifications";
import { useLocale } from "../lib/i18n";
import { LocalizedDateTime } from "../lib/locale-format";
import { PanelState } from "../lib/panel-state";
import { toast } from "../lib/toast";
import { PanelStats } from "./PanelStats";
import { PageActions } from "./PageActions";

function linesToArray(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function arrayToLines(values: string[]): string {
  return values.join("\n");
}

function notificationTypeLabel(type: NotificationType): string {
  return type
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function NotificationPolicyForm() {
  const { t } = useLocale();
  const policyQuery = useQuery(notificationPolicyQueryOptions());

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">{t("deliveryPolicy")}</div>
        <PageActions
          onRefresh={() => void policyQuery.refetch()}
          refreshLabel={t("refresh")}
          refreshing={policyQuery.isFetching}
        />
      </div>
      <PanelState query={policyQuery} empty={t("noPolicyLoaded")}>
        {(report) => <PolicyEditor report={report} />}
      </PanelState>
    </div>
  );
}

function PolicyEditor(props: { report: NotificationPolicyReport }) {
  const { t } = useLocale();
  const { report } = props;
  const updateMutation = useMutation(updateNotificationPolicyMutationOptions());

  const form = useForm({
    defaultValues: {
      deliveryEnabled: report.policy.deliveryEnabled,
      allowedChannelTypes: report.policy.allowedChannelTypes,
      allowedWebhookHosts: arrayToLines(report.policy.allowedWebhookHosts),
      allowedSlackHosts: arrayToLines(report.policy.allowedSlackHosts),
      allowedTeamsHosts: arrayToLines(report.policy.allowedTeamsHosts),
      allowedEmailDomains: arrayToLines(report.policy.allowedEmailDomains),
      suppressedNotificationTypes: report.policy.suppressedNotificationTypes,
    },
    onSubmit: async ({ value }) => {
      try {
        const input: UpdateNotificationPolicyRequest = {
          deliveryEnabled: value.deliveryEnabled,
          allowedChannelTypes: value.allowedChannelTypes,
          allowedWebhookHosts: linesToArray(value.allowedWebhookHosts),
          allowedSlackHosts: linesToArray(value.allowedSlackHosts),
          allowedTeamsHosts: linesToArray(value.allowedTeamsHosts),
          allowedEmailDomains: linesToArray(value.allowedEmailDomains),
          suppressedNotificationTypes: value.suppressedNotificationTypes,
        };
        await updateMutation.mutateAsync(input);
        toast(t("notificationPolicyUpdated"), "success");
      } catch (caught) {
        toast(t("couldNotUpdatePolicy"), "error");
        throw caught;
      }
    },
  });

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          {
            label: t("delivery"),
            value: report.posture.deliveryEnabled
              ? t("enabled")
              : t("disabled"),
          },
          {
            label: t("channelTypes"),
            value: report.posture.channelTypeRestrictionActive
              ? t("restricted")
              : t("all"),
          },
          {
            label: t("hostAllowlists"),
            value:
              (report.posture.webhookHostRestrictionActive ? 1 : 0) +
              (report.posture.slackHostRestrictionActive ? 1 : 0) +
              (report.posture.teamsHostRestrictionActive ? 1 : 0),
          },
          {
            label: t("emailRestriction"),
            value: report.posture.emailDomainRestrictionActive
              ? t("on")
              : t("off"),
          },
          {
            label: t("suppressedTypes"),
            value: report.posture.suppressedNotificationTypeCount,
          },
        ]}
      />

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field name="deliveryEnabled">
          {(field) => (
            <label className="flex items-center gap-2 text-sm">
              <Input
                name="deliveryEnabled"
                checked={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{t("deliveryEnabled")}</span>
            </label>
          )}
        </form.Field>

        <form.Field name="allowedChannelTypes">
          {(field) => (
            <div className="grid gap-1">
              <div className="text-sm text-muted">
                {t("allowedChannelTypes")}
              </div>
              <div className="flex flex-wrap gap-3">
                {notificationChannelTypes.map((type) => {
                  const checked = field.state.value.includes(type);
                  return (
                    <label
                      className="flex items-center gap-2 text-sm"
                      key={type}
                    >
                      <Input
                        name="allowedChannelTypes"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.currentTarget.checked
                            ? [...field.state.value, type]
                            : field.state.value.filter(
                                (value) => value !== type,
                              );
                          field.handleChange(next);
                        }}
                        type="checkbox"
                      />
                      <span>{type}</span>
                    </label>
                  );
                })}
              </div>
              <div className="text-xs text-muted">
                {t("emptyChannelsAllowed")}
              </div>
            </div>
          )}
        </form.Field>

        <form.Field name="allowedTeamsHosts">
          {(field) => (
            <div className="grid gap-1">
              <label
                className="text-sm text-muted"
                htmlFor="policy-teams-hosts"
              >
                Allowed Teams hosts
              </label>
              <Textarea
                name="allowedTeamsHosts"
                id="policy-teams-hosts"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder="outlook.office.com"
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">
                {t("emptyHostRestriction")}
              </div>
            </div>
          )}
        </form.Field>

        <form.Field name="allowedWebhookHosts">
          {(field) => (
            <div className="grid gap-1">
              <label
                className="text-sm text-muted"
                htmlFor="policy-webhook-hosts"
              >
                {t("allowedWebhookHosts")}
              </label>
              <Textarea
                name="allowedWebhookHosts"
                id="policy-webhook-hosts"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={"hooks.example.com\n*.internal.example.com"}
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">
                {t("emptyHostRestriction")}
              </div>
            </div>
          )}
        </form.Field>

        <form.Field name="allowedSlackHosts">
          {(field) => (
            <div className="grid gap-1">
              <label
                className="text-sm text-muted"
                htmlFor="policy-slack-hosts"
              >
                {t("allowedSlackHosts")}
              </label>
              <Textarea
                name="allowedSlackHosts"
                id="policy-slack-hosts"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={"hooks.slack.com"}
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">
                {t("emptySlackRestriction")}
              </div>
            </div>
          )}
        </form.Field>

        <form.Field name="allowedEmailDomains">
          {(field) => (
            <div className="grid gap-1">
              <label
                className="text-sm text-muted"
                htmlFor="policy-email-domains"
              >
                {t("allowedEmailDomains")}
              </label>
              <Textarea
                name="allowedEmailDomains"
                id="policy-email-domains"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                placeholder={"example.com"}
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">
                {t("emptyEmailRestriction")}
              </div>
            </div>
          )}
        </form.Field>

        <form.Field name="suppressedNotificationTypes">
          {(field) => (
            <div className="grid gap-1">
              <div className="text-sm text-muted">
                {t("suppressedNotificationTypes")}
              </div>
              <div className="flex flex-wrap gap-3">
                {notificationTypes.map((option) => {
                  const checked = field.state.value.includes(option);
                  return (
                    <label
                      className="flex items-center gap-2 text-sm"
                      key={option}
                    >
                      <Input
                        name="suppressedNotificationTypes"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.currentTarget.checked
                            ? [...field.state.value, option]
                            : field.state.value.filter(
                                (value) => value !== option,
                              );
                          field.handleChange(next);
                        }}
                        type="checkbox"
                      />
                      <span>{notificationTypeLabel(option)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
          })}
        >
          {({ canSubmit, isSubmitting }) => (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                disabled={!canSubmit || isSubmitting}
                type="submit"
              >
                {isSubmitting ? t("saving") : t("savePolicy")}
              </Button>
              {report.updatedAt ? (
                <span className="text-xs text-muted">
                  {t("notificationUpdated")}{" "}
                  <LocalizedDateTime value={report.updatedAt} />
                  {report.updatedBy
                    ? ` ${t("updatedBy")} ${report.updatedBy}`
                    : ""}
                </span>
              ) : null}
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
