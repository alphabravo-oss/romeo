import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { useState, type FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Field, Input, Select } from "./forms";
import { Dialog, DropdownMenu } from "./overlays";

afterEach(cleanup);

Element.prototype.scrollIntoView = vi.fn();

describe("Romeo UI primitives", () => {
  it("renders accessible fields and pending buttons", () => {
    render(
      <>
        <Field
          description="Used for notifications"
          error="Required"
          label="Email"
          required
        >
          <Input name="email" />
        </Field>
        <Button pending>Save</Button>
      </>,
    );

    const input = screen.getByLabelText("Email *");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("description");
    expect(
      (screen.getByRole("button", { name: /save/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("delegates dialog focus, escape, and dismissal behavior to Radix", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog onOpenChange={onOpenChange} open title="Connection settings">
        <Input aria-label="Endpoint" autoFocus />
      </Dialog>,
    );

    expect(
      screen.getByRole("dialog", { name: "Connection settings" }),
    ).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("restores focus for externally controlled dialogs", async () => {
    const user = userEvent.setup();

    function ControlledDialog() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open settings</Button>
          <Dialog
            onOpenChange={setOpen}
            open={open}
            title="Connection settings"
          >
            <Input aria-label="Endpoint" autoFocus />
          </Dialog>
        </>
      );
    }

    render(<ControlledDialog />);
    const opener = screen.getByRole("button", { name: "Open settings" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(opener);
  });

  it("supports keyboard menu selection", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <DropdownMenu
        items={[{ label: "Rename", onSelect }]}
        trigger={<Button>Actions</Button>}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("labels grouped selects and keeps provider group semantics", async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Select
          aria-label="Model"
          options={[
            { group: "Local Ollama", label: "Llama 3.2", value: "llama" },
            { group: "Anthropic", label: "Claude", value: "claude" },
          ]}
          value="llama"
        />
      </form>,
    );

    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger.getAttribute("type")).toBe("button");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Local Ollama")).toBeTruthy();
    expect(screen.getByText("Anthropic")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Claude" })).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("has no axe violations in a representative primitive composition", async () => {
    render(
      <main>
        <h1>UI primitives</h1>
        <Field label="Name">
          <Input name="name" />
        </Field>
        <Button>Submit</Button>
      </main>,
    );

    const result = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });

  it("ships theme, mobile, and reduced-motion contracts", async () => {
    const styles = await readFile(
      join(process.cwd(), "src/styles.css"),
      "utf8",
    );
    expect(styles).toContain("--rm-ui-bg");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("@media (max-width: 640px)");
  });
});
