import { Button, Field, Input, Select } from "@romeo/ui";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  addGroupMemberMutationOptions,
  createGroupMutationOptions,
  groupMembersQueryOptions,
  removeGroupMemberMutationOptions,
} from "../features/administration";
import { shareTargetsQueryOptions } from "../features/collaboration";
import type { Group, GroupMember } from "../features/administration";
import { useLocale } from "../lib/i18n";
import { PanelState } from "../lib/panel-state";
import { LocalizedDate } from "../lib/locale-format";
import { toast } from "../lib/toast";
import { AddButton, Section, StatRow } from "./console";
import { useConfirm } from "./ConfirmDialog";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { FormDialog } from "./FormDialog";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const groupCol = createColumnHelper<Group>();
const memberCol = createColumnHelper<GroupMember>();

export function GroupsPanel() {
  const { t } = useLocale();
  const { ask, dialog } = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");

  const table = useInventoriedServerTable<Group>("groups");
  const membersQuery = useQuery(groupMembersQueryOptions(selectedGroupId));
  const shareTargetsQuery = useQuery(
    shareTargetsQueryOptions(
      { context: "group-members" },
      "",
      selectedGroupId !== "",
    ),
  );
  const userTargets = (shareTargetsQuery.data ?? []).filter(
    (target) => target.principalType === "user",
  );

  const createMutation = useMutation(createGroupMutationOptions());
  const addMemberMutation = useMutation(addGroupMemberMutationOptions());
  const removeMemberMutation = useMutation(removeGroupMemberMutationOptions());

  const createForm = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      try {
        await createMutation.mutateAsync({
          name: value.name,
          slug: value.slug,
        });
        toast(t("groupsCreated"), "success");
        setAddOpen(false);
        createForm.reset();
      } catch (caught) {
        toast(t("groupsCouldNotCreate"), "error");
        throw caught;
      }
    },
  });

  const memberForm = useForm({
    defaultValues: { userId: "" },
    onSubmit: async ({ value }) => {
      if (selectedGroupId === "") {
        toast(t("groupsSelectFirst"), "error");
        return;
      }
      try {
        await addMemberMutation.mutateAsync({
          groupId: selectedGroupId,
          userId: value.userId,
        });
        toast(t("groupsMemberAdded"), "success");
        memberForm.reset();
      } catch (caught) {
        toast(t("groupsCouldNotAddMember"), "error");
        throw caught;
      }
    },
  });

  const groupColumns = useMemo<ColumnDef<Group, any>[]>(
    () => [
      groupCol.accessor("name", {
        header: t("groupsName"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      groupCol.accessor("slug", {
        header: t("groupsSlug"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      groupCol.accessor((row) => row.createdAt, {
        id: "createdAt",
        header: t("groupsCreatedAt"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDate value={c.getValue()} />
          </span>
        ),
      }),
      groupCol.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Button
            onClick={() => setSelectedGroupId(c.row.original.id)}
            type="button"
          >
            {selectedGroupId === c.row.original.id
              ? t("groupsSelected")
              : t("groupsMembers")}
          </Button>
        ),
      }),
    ],
    [selectedGroupId, t],
  );

  const memberColumns = useMemo<ColumnDef<GroupMember, any>[]>(
    () => [
      memberCol.accessor("userId", {
        header: t("groupsUser"),
        cell: (c) => (
          <span className="rm-mono" translate="no">
            {c.getValue()}
          </span>
        ),
      }),
      memberCol.accessor((row) => row.createdAt, {
        id: "createdAt",
        header: t("groupsAddedAt"),
        cell: (c) => (
          <span className="rm-cell-muted">
            <LocalizedDate value={c.getValue()} />
          </span>
        ),
      }),
      memberCol.display({
        id: "actions",
        header: "",
        cell: (c) => (
          <Button
            disabled={removeMemberMutation.isPending}
            onClick={() => void handleRemoveMember(c.row.original.userId)}
            type="button"
          >
            {t("groupsRemove")}
          </Button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeMemberMutation.isPending, t],
  );

  async function handleRemoveMember(userId: string) {
    if (selectedGroupId === "") return;
    if (
      !(await ask({
        title: t("groupsRemoveMemberTitle"),
        body: t("groupsRemoveMemberBody"),
        confirmLabel: t("groupsRemove"),
        tone: "danger",
      }))
    )
      return;
    try {
      await removeMemberMutation.mutateAsync({
        groupId: selectedGroupId,
        userId,
      });
      toast(t("groupsMemberRemoved"), "success");
    } catch {
      toast(t("groupsCouldNotRemoveMember"), "error");
    }
  }

  const selectedGroup = table.rows.find(
    (group) => group.id === selectedGroupId,
  );

  return (
    <>
      {/* No section title: the page header already reads "Groups". */}
      <Section
        actions={
          <AddButton onClick={() => setAddOpen(true)}>
            {t("groupsAdd")}
          </AddButton>
        }
      >
        <PanelState
          empty={t("groupsNone")}
          emptyAction={
            <AddButton onClick={() => setAddOpen(true)}>
              {t("groupsAdd")}
            </AddButton>
          }
          isEmpty={(page) =>
            page.items.length === 0 &&
            table.isFirstPage &&
            table.search.trim() === ""
          }
          query={table.query}
        >
          {() => (
            <>
              <StatRow
                items={[{ label: t("groupsTotal"), value: table.estimatedTotal }]}
              />
              <DataTable
                serverState={table.serverState}
                columns={groupColumns}
                data={table.rows}
                empty={t("groupsNone")}
              />
            </>
          )}
        </PanelState>
      </Section>

      {/* Membership is a peer group that appears once a group is selected, so
          it gets its own section rather than a bare label inside the one
          above. */}
      {selectedGroupId !== "" ? (
        <Section
          title={`${t("groupsMembersOf")} ${selectedGroup?.name ?? selectedGroupId}`}
        >
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void memberForm.handleSubmit();
            }}
          >
            <memberForm.Field
              name="userId"
              validators={{
                onChange: ({ value }: { value: string }) =>
                  !value?.trim() ? t("groupsUserIdRequired") : undefined,
              }}
            >
              {(field) => (
                <>
                  <Field label={t("groupsAddMember")}>
                    <Select
                      name="userId"
                      disabled={
                        shareTargetsQuery.isPending || userTargets.length === 0
                      }
                      onValueChange={field.handleChange}
                      options={userTargets.map((target) => ({
                        label: target.label,
                        value: target.principalId,
                      }))}
                      value={field.state.value}
                    />
                  </Field>
                  {field.state.meta.errors.length ? (
                    <div className="rm-composer-error" role="alert">
                      {field.state.meta.errors.join(", ")}
                    </div>
                  ) : null}
                </>
              )}
            </memberForm.Field>
            <memberForm.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
                isSubmitting: state.isSubmitting,
              })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button disabled={!canSubmit || isSubmitting} type="submit">
                  {isSubmitting ? t("groupsAdding") : t("groupsAddMember")}
                </Button>
              )}
            </memberForm.Subscribe>
          </form>
          <PanelState query={membersQuery} empty={t("groupsNoMembers")}>
            {(members) => (
              <DataTable
                columns={memberColumns}
                data={members}
                empty={t("groupsNoMembers")}
              />
            )}
          </PanelState>
        </Section>
      ) : null}

      <FormDialog
        open={addOpen}
        title={t("groupsNew")}
        onClose={() => setAddOpen(false)}
      >
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void createForm.handleSubmit();
          }}
        >
          <createForm.Field
            name="name"
            validators={{
              onChange: ({ value }: { value: string }) =>
                !value?.trim() ? t("groupsNameRequired") : undefined,
            }}
          >
            {(field) => (
              <>
                <Input
                  name="name"
                  onBlur={field.handleBlur}
                  onChange={(event) =>
                    field.handleChange(event.currentTarget.value)
                  }
                  aria-label={t("groupsNamePlaceholder")}
                  placeholder={t("groupsNamePlaceholder")}
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error" role="alert">
                    {field.state.meta.errors.join(", ")}
                  </div>
                ) : null}
              </>
            )}
          </createForm.Field>
          <createForm.Field name="slug">
            {(field) => (
              <Input
                name="slug"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value)
                }
                aria-label={t("groupsSlugOptional")}
                placeholder={t("groupsSlugOptional")}
                value={field.state.value}
              />
            )}
          </createForm.Field>
          <createForm.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? t("groupsCreating") : t("groupsCreate")}
              </Button>
            )}
          </createForm.Subscribe>
        </form>
      </FormDialog>
      {dialog}
    </>
  );
}
