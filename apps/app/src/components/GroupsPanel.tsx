import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { addGroupMember, createGroup, listGroupMembers, listGroups, removeGroupMember } from '../api/groups-client'
import type { Group, GroupMember } from '../api/groups-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'

const groupCol = createColumnHelper<Group>()
const memberCol = createColumnHelper<GroupMember>()

export function GroupsPanel() {
  const queryClient = useQueryClient()
  const { ask, dialog } = useConfirm()
  const [addOpen, setAddOpen] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: listGroups })
  const membersQuery = useQuery({
    queryKey: ['groups', selectedGroupId, 'members'],
    queryFn: () => listGroupMembers(selectedGroupId),
    enabled: selectedGroupId !== ''
  })

  const createMutation = useMutation({ mutationFn: createGroup })
  const addMemberMutation = useMutation({ mutationFn: addGroupMember })
  const removeMemberMutation = useMutation({ mutationFn: removeGroupMember })

  const createForm = useForm({
    defaultValues: { name: '', slug: '' },
    onSubmit: async ({ value }) => {
      try {
        await createMutation.mutateAsync({ name: value.name, slug: value.slug })
        await queryClient.invalidateQueries({ queryKey: ['groups'] })
        toast('Group created', 'success')
        setAddOpen(false)
        createForm.reset()
      } catch (caught) {
        toast('Could not create group', 'error')
        throw caught
      }
    }
  })

  const memberForm = useForm({
    defaultValues: { userId: '' },
    onSubmit: async ({ value }) => {
      if (selectedGroupId === '') {
        toast('Select a group first', 'error')
        return
      }
      try {
        await addMemberMutation.mutateAsync({ groupId: selectedGroupId, userId: value.userId })
        await queryClient.invalidateQueries({ queryKey: ['groups', selectedGroupId, 'members'] })
        toast('Member added', 'success')
        memberForm.reset()
      } catch (caught) {
        toast('Could not add member', 'error')
        throw caught
      }
    }
  })

  const groupColumns = useMemo<ColumnDef<Group, any>[]>(
    () => [
      groupCol.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      groupCol.accessor('slug', {
        header: 'Slug',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      groupCol.accessor((row) => new Date(row.createdAt).toLocaleDateString(), {
        id: 'createdAt',
        header: 'Created',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      groupCol.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <button className="rm-button" onClick={() => setSelectedGroupId(c.row.original.id)} type="button">
            {selectedGroupId === c.row.original.id ? 'Selected' : 'Members'}
          </button>
        )
      })
    ],
    [selectedGroupId]
  )

  const memberColumns = useMemo<ColumnDef<GroupMember, any>[]>(
    () => [
      memberCol.accessor('userId', {
        header: 'User',
        cell: (c) => <span className="rm-mono">{c.getValue()}</span>
      }),
      memberCol.accessor((row) => new Date(row.createdAt).toLocaleDateString(), {
        id: 'createdAt',
        header: 'Added',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      memberCol.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <button
            className="rm-button"
            disabled={removeMemberMutation.isPending}
            onClick={() => void handleRemoveMember(c.row.original.userId)}
            type="button"
          >
            Remove
          </button>
        )
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [removeMemberMutation.isPending]
  )

  async function handleRemoveMember(userId: string) {
    if (selectedGroupId === '') return
    if (!(await ask({ title: 'Remove member?', body: 'They lose access granted through this group.', confirmLabel: 'Remove', tone: 'danger' }))) return
    try {
      await removeMemberMutation.mutateAsync({ groupId: selectedGroupId, userId })
      await queryClient.invalidateQueries({ queryKey: ['groups', selectedGroupId, 'members'] })
      toast('Member removed', 'success')
    } catch {
      toast('Could not remove member', 'error')
    }
  }

  const selectedGroup = groupsQuery.data?.find((group) => group.id === selectedGroupId)

  return (
    <section className="rm-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="rm-card-title">Groups</div>
        <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
          + Add group
        </button>
      </div>

      <div className="mt-4">
        <PanelState
          query={groupsQuery}
          empty="No groups yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Add group
            </button>
          }
        >
          {(groups) => (
            <div className="grid gap-4">
              <PanelStats items={[{ label: 'Total groups', value: groups.length }]} />
              <DataTable columns={groupColumns} data={groups} empty="No groups yet." />
            </div>
          )}
        </PanelState>
      </div>

      {selectedGroupId !== '' ? (
        <div className="mt-4 grid gap-2">
          <div className="text-sm text-muted">Members of {selectedGroup?.name ?? selectedGroupId}</div>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void memberForm.handleSubmit()
            }}
          >
            <memberForm.Field
              name="userId"
              validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'User id is required' : undefined) }}
            >
              {(field) => (
                <>
                  <input
                    className="rm-input"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.currentTarget.value)}
                    placeholder="User id"
                    value={field.state.value}
                  />
                  {field.state.meta.errors.length ? (
                    <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
                  ) : null}
                </>
              )}
            </memberForm.Field>
            <memberForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
              {({ canSubmit, isSubmitting }) => (
                <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
                  {isSubmitting ? 'Adding' : 'Add member'}
                </button>
              )}
            </memberForm.Subscribe>
          </form>
          <PanelState query={membersQuery} empty="No members yet.">
            {(members) => <DataTable columns={memberColumns} data={members} empty="No members yet." />}
          </PanelState>
        </div>
      ) : null}

      <FormDialog open={addOpen} title="New group" onClose={() => setAddOpen(false)}>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void createForm.handleSubmit()
          }}
        >
          <createForm.Field
            name="name"
            validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
          >
            {(field) => (
              <>
                <input
                  className="rm-input"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  placeholder="Group name"
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
                ) : null}
              </>
            )}
          </createForm.Field>
          <createForm.Field name="slug">
            {(field) => (
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Slug (optional)"
                value={field.state.value}
              />
            )}
          </createForm.Field>
          <createForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, isSubmitting }) => (
              <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? 'Creating' : 'Create group'}
              </button>
            )}
          </createForm.Subscribe>
        </form>
      </FormDialog>
      {dialog}
    </section>
  )
}
