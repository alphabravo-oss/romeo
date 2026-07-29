import { Button, Input } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";

import type { RetrievalHit } from "../features/types";
import { useLocale } from "../lib/i18n";

export function KnowledgeQueryTab({
  enabled,
  hits,
  isPending,
  notice,
  onQuery,
}: {
  enabled: boolean;
  hits: readonly RetrievalHit[];
  isPending: boolean;
  notice: string | undefined;
  onQuery: (query: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const queryForm = useForm({
    defaultValues: { query: "" },
    onSubmit: ({ value }) => onQuery(value.query),
  });

  return (
    <div>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void queryForm.handleSubmit();
        }}
      >
        <label className="text-sm text-muted" htmlFor="knowledge-query">
          {t("knowledgeQuery")}
        </label>
        <queryForm.Field name="query">
          {(field) => (
            <Input
              name="query"
              id="knowledge-query"
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.currentTarget.value)
              }
              placeholder={t("knowledgeAskQuestion")}
              value={field.state.value}
            />
          )}
        </queryForm.Field>
        <Button disabled={!enabled || isPending} type="submit">
          {isPending ? t("knowledgeQuerying") : t("knowledgeQueryBase")}
        </Button>
      </form>

      {notice ? <div className="mt-3 text-sm text-muted">{notice}</div> : null}
      <div className="mt-2 grid gap-2 text-sm">
        {hits.map((hit) => (
          <div className="rounded-md border border-border p-2" key={hit.id}>
            <div className="font-medium">{hit.citation.title}</div>
            <div className="line-clamp-3 text-muted">{hit.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
