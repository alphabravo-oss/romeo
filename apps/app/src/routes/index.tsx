import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceShell } from '../components/WorkspaceShell'

export const Route = createFileRoute('/')({
  component: WorkspaceShell
})
