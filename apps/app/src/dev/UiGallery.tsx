import {
  Button,
  Card,
  Checkbox,
  Dialog,
  DropdownMenu,
  EmptyState,
  Field,
  Input,
  Panel,
  Select,
  Separator,
  Skeleton,
  StatusBadge,
  Switch,
  Tabs,
  Textarea,
  Tooltip,
} from "@romeo/ui";
import { useState } from "react";

export default function UiGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  return (
    <main className="h-dvh overflow-auto bg-background p-6 text-foreground">
      <div className="mx-auto grid max-w-5xl gap-6">
        <header>
          <p className="m-0 text-xs font-semibold uppercase tracking-wider text-muted">
            Development only
          </p>
          <h1 className="my-1 text-2xl font-semibold">Romeo UI primitives</h1>
          <p className="m-0 text-muted">
            A single surface for visual, keyboard, responsive, and theme review.
          </p>
        </header>

        <Panel className="grid gap-4">
          <h2 className="m-0 text-base font-semibold">Actions and status</h2>
          <div className="flex flex-wrap gap-2">
            <Button>Default</Button>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button pending>Pending</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="neutral">Draft</StatusBadge>
            <StatusBadge tone="info">Running</StatusBadge>
            <StatusBadge tone="success">Healthy</StatusBadge>
            <StatusBadge tone="warning">Degraded</StatusBadge>
            <StatusBadge tone="danger">Failed</StatusBadge>
          </div>
        </Panel>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="grid gap-4">
            <h2 className="m-0 text-base font-semibold">Form controls</h2>
            <Field
              description="Shown to workspace members"
              label="Display name"
              required
            >
              <Input
                autoComplete="name"
                name="name"
                placeholder="Research assistant"
              />
            </Field>
            <Field error="Enter a valid endpoint" label="Endpoint">
              <Input name="endpoint" value="invalid" readOnly />
            </Field>
            <Field label="Provider">
              <Select
                defaultValue="anthropic"
                options={[
                  { label: "Anthropic", value: "anthropic" },
                  { label: "Ollama", value: "ollama" },
                  { label: "OpenAI compatible", value: "openai" },
                ]}
              />
            </Field>
            <Field label="System prompt">
              <Textarea
                name="system-prompt"
                placeholder="How should the model respond?"
              />
            </Field>
            <Checkbox defaultChecked label="Retain attachments" />
            <Switch
              checked={enabled}
              label="Personalization enabled"
              onCheckedChange={setEnabled}
            />
          </Card>

          <Card className="grid content-start gap-4">
            <h2 className="m-0 text-base font-semibold">States and overlays</h2>
            <Skeleton className="h-8" />
            <Skeleton className="h-20" />
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
              <DropdownMenu
                items={[
                  { label: "Rename" },
                  { label: "Duplicate" },
                  { danger: true, label: "Delete", separatorBefore: true },
                ]}
                trigger={<Button>Open menu</Button>}
              />
              <Tooltip content="Keyboard-accessible helper text">
                <Button variant="ghost">Hover or focus</Button>
              </Tooltip>
            </div>
            <EmptyState title="No managed models">
              Add a provider connection, then publish a governed model.
            </EmptyState>
          </Card>
        </div>

        <Panel>
          <Tabs
            defaultValue="overview"
            tabs={[
              {
                content: <p>General managed-model configuration.</p>,
                label: "Overview",
                value: "overview",
              },
              {
                content: <p>Workspace and group visibility rules.</p>,
                label: "Access",
                value: "access",
              },
              {
                content: <p>Published model versions and audit history.</p>,
                label: "Versions",
                value: "versions",
              },
            ]}
          />
        </Panel>
      </div>

      <Dialog
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => setDialogOpen(false)} variant="primary">
              Save changes
            </Button>
          </>
        }
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        title="Edit managed model"
        description="Changes apply to the next published version."
      >
        <Field label="Model name">
          <Input autoFocus name="model-name" defaultValue="Romeo Enterprise" />
        </Field>
      </Dialog>
    </main>
  );
}
