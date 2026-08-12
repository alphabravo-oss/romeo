import { Button, EmptyState, Input, NativeSelect, Textarea } from "@romeo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { useEffect, useState } from "react";

import {
  getWebSearchConfiguration,
  updateWebSearchConfiguration,
} from "../features/web";
import { toast } from "../lib/toast";
import { LocalizedDateTime } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";
import { Section } from "./console";
import { AdminDisclosure } from "./AdminDisclosure";
import { SettingsSection } from "./SettingsSection";

export function WebSearchPanel() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["webSearchConfiguration"],
    queryFn: getWebSearchConfiguration,
  });
  const [provider, setProvider] = useState<"brave" | "searxng" | "tavily">(
    "searxng",
  );
  const [endpointUrl, setEndpointUrl] = useState("");
  const [credentialRef, setCredentialRef] = useState("");
  const [allowedDomains, setAllowedDomains] = useState("");
  const [blockedDomains, setBlockedDomains] = useState("");
  const [maxResults, setMaxResults] = useState(5);
  const [freshnessMaxAgeDays, setFreshnessMaxAgeDays] = useState("");
  const [unknownPublicationDatePolicy, setUnknownPublicationDatePolicy] =
    useState<"allow" | "exclude">("allow");
  const [unreachableUrlPolicy, setUnreachableUrlPolicy] = useState<
    "fail" | "skip"
  >("fail");
  useEffect(() => {
    if (!query.data) return;
    setProvider(query.data.provider);
    setEndpointUrl(query.data.endpointUrl);
    setAllowedDomains(query.data.allowedDomains.join("\n"));
    setBlockedDomains(query.data.blockedDomains.join("\n"));
    setMaxResults(query.data.maxResults);
    setFreshnessMaxAgeDays(
      query.data.freshnessMaxAgeDays === null
        ? ""
        : String(query.data.freshnessMaxAgeDays),
    );
    setUnknownPublicationDatePolicy(query.data.unknownPublicationDatePolicy);
    setUnreachableUrlPolicy(query.data.unreachableUrlPolicy);
  }, [query.data]);
  const save = useMutation({
    mutationFn: () =>
      updateWebSearchConfiguration({
        provider,
        endpointUrl,
        maxResults,
        allowedDomains: lines(allowedDomains),
        blockedDomains: lines(blockedDomains),
        freshnessMaxAgeDays:
          freshnessMaxAgeDays.trim() === ""
            ? null
            : Number(freshnessMaxAgeDays),
        unknownPublicationDatePolicy,
        unreachableUrlPolicy,
        ...(credentialRef.trim()
          ? { credentialRef: credentialRef.trim() }
          : {}),
      }),
    onSuccess: async () => {
      setCredentialRef("");
      await queryClient.invalidateQueries({
        queryKey: ["webSearchConfiguration"],
      });
      toast(t("searchSettingsSaved"), "success");
    },
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateWebSearchConfiguration({ enabled }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["webSearchConfiguration"] }),
  });
  const enabled = query.data?.enabled === true;
  const isDirty =
    query.data !== undefined &&
    (provider !== query.data.provider ||
      endpointUrl !== query.data.endpointUrl ||
      credentialRef.trim() !== "" ||
      allowedDomains !== query.data.allowedDomains.join("\n") ||
      blockedDomains !== query.data.blockedDomains.join("\n") ||
      maxResults !== query.data.maxResults ||
      freshnessMaxAgeDays !==
        (query.data.freshnessMaxAgeDays === null
          ? ""
          : String(query.data.freshnessMaxAgeDays)) ||
      unknownPublicationDatePolicy !==
        query.data.unknownPublicationDatePolicy ||
      unreachableUrlPolicy !== query.data.unreachableUrlPolicy);

  return (
    <Section
      actions={
        <label>
          <Input
            checked={enabled}
            disabled={toggle.isPending || (enabled && isDirty)}
            onChange={(event) => toggle.mutate(event.currentTarget.checked)}
            type="checkbox"
          />{" "}
          {t("enabled")}
        </label>
      }
      description={t("searchGovernanceDescription")}
      title={t("governedWebSearch")}
    >
      {enabled ? (
        <form
          className="mt-4 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <SettingsSection
            description={t("webSearchProviderDescription")}
            title={t("webSearchProviderSection")}
          >
            <label className="rm-field-name" htmlFor="search-provider">
              {t("providerPreset")}
            </label>
            <NativeSelect
              name="search-provider"
              id="search-provider"
              onChange={(event) =>
                setProvider(event.currentTarget.value as typeof provider)
              }
              value={provider}
            >
              <option value="searxng">SearXNG</option>
              <option value="brave">Brave Search</option>
              <option value="tavily">Tavily</option>
            </NativeSelect>
            <label className="rm-field-name" htmlFor="search-endpoint">
              {t("endpointUrl")}
            </label>
            <Input
              name="search-endpoint"
              id="search-endpoint"
              onChange={(event) => setEndpointUrl(event.currentTarget.value)}
              required
              type="url"
              value={endpointUrl}
            />
            <label className="rm-field-name" htmlFor="search-secret">
              {t("managedCredentialReference")}
            </label>
            <Input
              name="search-secret"
              id="search-secret"
              onChange={(event) => setCredentialRef(event.currentTarget.value)}
              placeholder={
                query.data?.credentialConfigured
                  ? t("credentialConfiguredReplace")
                  : "romeo-secret://…"
              }
              value={credentialRef}
            />
            <div
              className="rounded-md border border-border p-3 text-sm"
              aria-live="polite"
            >
              {t("providerHealth")}:{" "}
              <strong>{query.data?.health.status ?? t("unknown")}</strong>
              {query.data?.health.latencyMs === undefined
                ? null
                : ` · ${query.data.health.latencyMs} ms`}
              {query.data?.health.lastCheckedAt === undefined ? null : (
                <>
                  {" "}
                  · {t("checked")}{" "}
                  <LocalizedDateTime value={query.data.health.lastCheckedAt} />
                </>
              )}
              {query.data?.health.lastErrorCode === undefined
                ? null
                : ` · ${query.data.health.lastErrorCode}`}
            </div>
          </SettingsSection>
          <AdminDisclosure
            description={t("webSearchPolicyDescription")}
            title={t("webSearchPolicySection")}
          >
            <SettingsSection
              description={t("webSearchPolicyDescription")}
              title={t("webSearchPolicySection")}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  {t("allowedDomainsPerLine")}
                  <Textarea
                    name="allowedDomains"
                    className="mt-1"
                    onChange={(event) =>
                      setAllowedDomains(event.currentTarget.value)
                    }
                    rows={5}
                    value={allowedDomains}
                  />
                </label>
                <label>
                  {t("blockedDomainsPerLine")}
                  <Textarea
                    name="blockedDomains"
                    className="mt-1"
                    onChange={(event) =>
                      setBlockedDomains(event.currentTarget.value)
                    }
                    rows={5}
                    value={blockedDomains}
                  />
                </label>
              </div>
              <label>
                {t("maximumResults")}{" "}
                <Input
                  name="maxResults"
                  max={10}
                  min={1}
                  onChange={(event) =>
                    setMaxResults(event.currentTarget.valueAsNumber)
                  }
                  type="number"
                  value={maxResults}
                />
              </label>
              <div className="grid gap-3 md:grid-cols-3">
                <label>
                  {t("maximumSourceAge")}
                  <Input
                    name="freshnessMaxAgeDays"
                    className="mt-1"
                    min={1}
                    max={3650}
                    onChange={(event) =>
                      setFreshnessMaxAgeDays(event.currentTarget.value)
                    }
                    type="number"
                    value={freshnessMaxAgeDays}
                  />
                </label>
                <label>
                  {t("unknownPublicationDates")}
                  <NativeSelect
                    name="unknownPublicationDatePolicy"
                    className="mt-1"
                    onChange={(event) =>
                      setUnknownPublicationDatePolicy(
                        event.currentTarget
                          .value as typeof unknownPublicationDatePolicy,
                      )
                    }
                    value={unknownPublicationDatePolicy}
                  >
                    <option value="allow">{t("allow")}</option>
                    <option value="exclude">{t("exclude")}</option>
                  </NativeSelect>
                </label>
                <label>
                  {t("unreachableUrls")}
                  <NativeSelect
                    name="unreachableUrlPolicy"
                    className="mt-1"
                    onChange={(event) =>
                      setUnreachableUrlPolicy(
                        event.currentTarget
                          .value as typeof unreachableUrlPolicy,
                      )
                    }
                    value={unreachableUrlPolicy}
                  >
                    <option value="fail">{t("failRequest")}</option>
                    <option value="skip">{t("skipUnreachable")}</option>
                  </NativeSelect>
                </label>
              </div>
            </SettingsSection>
          </AdminDisclosure>
          {save.error ? (
            <div className="rm-composer-error">{save.error.message}</div>
          ) : null}
          <Button variant="primary" disabled={save.isPending} type="submit">
            {t("saveConfiguration")}
          </Button>
        </form>
      ) : (
        <EmptyState
          icon={<Search aria-hidden size={24} />}
          title={t("webSearchDisabledTitle")}
        >
          {t("webSearchDisabledDescription")}
        </EmptyState>
      )}
    </Section>
  );
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/gu)
    .map((item) => item.trim())
    .filter(Boolean);
}
