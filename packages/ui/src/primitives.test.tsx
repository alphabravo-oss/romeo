import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { useState, type FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, Spinner } from "./button";
import { Field, Input, Select, Textarea } from "./forms";
import {
  AlertDialog,
  Dialog,
  DropdownMenu,
  useOverlayOpenerRef,
} from "./overlays";

afterEach(cleanup);

Element.prototype.scrollIntoView = vi.fn();

describe("Romeo UI primitives", () => {
  it("renders required fields with native validation semantics", () => {
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

    const input = screen.getByRole("textbox", {
      name: "Email",
    }) as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain("description");
    const button = screen.getByRole("button", { name: "Save" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("blocks native submission for a required Field control", async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Field label="Name" required>
          <Input name="name" />
        </Field>
        <Button type="submit">Save</Button>
      </form>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("separates visual required markers from control semantics", () => {
    render(
      <Field label="Nickname" visualRequiredIndicator>
        <Input name="nickname" />
      </Field>,
    );

    const input = screen.getByRole("textbox", {
      name: "Nickname",
    }) as HTMLInputElement;
    expect(input.required).toBe(false);
    expect(input.hasAttribute("aria-required")).toBe(false);
  });

  it("gives standalone progress indicators an explicit accessible name", () => {
    render(<Spinner aria-label="Loading records" />);
    expect(
      screen.getByRole("status", { name: "Loading records" }),
    ).toBeTruthy();
  });

  it("composes button styling onto a semantic link", () => {
    render(
      <Button asChild>
        <a href="/admin">Open admin</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Open admin" });
    expect(link.getAttribute("href")).toBe("/admin");
    expect(link.classList.contains("rm-ui-button")).toBe(true);
  });

  it("delegates dialog focus, escape, and dismissal behavior to Radix", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Dialog
        closeLabel="Close"
        onOpenChange={onOpenChange}
        open
        title="Connection settings"
      >
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
            closeLabel="Close"
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

  it("keeps an async alert dialog open and locked until confirmation succeeds", async () => {
    let resolveConfirm!: () => void;
    const confirmation = new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    });
    const user = userEvent.setup();
    render(
      <AlertDialog
        actionLabel="Delete"
        cancelLabel="Cancel"
        failureMessage="Delete failed. Try again."
        onConfirm={() => confirmation}
        title="Delete record"
        trigger={<Button>Open delete</Button>}
      >
        This cannot be undone.
      </AlertDialog>,
    );

    const opener = screen.getByRole("button", { name: "Open delete" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    resolveConfirm();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("shows a safe alert-dialog error and allows retry after rejection", async () => {
    const onConfirm = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("private backend detail"))
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(
      <AlertDialog
        actionLabel="Delete"
        cancelLabel="Cancel"
        failureMessage="Delete failed. Try again."
        onConfirm={onConfirm}
        title="Delete record"
        trigger={<Button>Open delete</Button>}
      >
        This cannot be undone.
      </AlertDialog>,
    );

    await user.click(screen.getByRole("button", { name: "Open delete" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Delete failed. Try again.",
    );
    expect(document.body.textContent).not.toContain("private backend detail");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alertdialog")).toBeNull();
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

  it("restores menu trigger focus when Escape closes the menu", async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu
        items={[{ label: "Rename" }]}
        trigger={<Button>Actions</Button>}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await user.keyboard("{Enter}{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("restores menu trigger focus after a menu-launched dialog closes", async () => {
    const user = userEvent.setup();

    function MenuDialog() {
      const [open, setOpen] = useState(false);
      const openerRef = useOverlayOpenerRef();
      return (
        <>
          <DropdownMenu
            items={[{ label: "Rename", onSelect: () => setOpen(true) }]}
            openerRef={openerRef}
            trigger={<Button>Actions</Button>}
          />
          <Dialog
            closeLabel="Close"
            onOpenChange={setOpen}
            open={open}
            openerRef={openerRef}
            title="Rename item"
          >
            <Input aria-label="Name" autoFocus />
          </Dialog>
        </>
      );
    }

    render(<MenuDialog />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await user.click(trigger);
    screen.getByRole("menuitem", { name: "Rename" }).click();
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps simultaneous menu-dialog opener ownership isolated", async () => {
    const user = userEvent.setup();

    function ConcurrentMenuDialogs() {
      const [firstOpen, setFirstOpen] = useState(false);
      const [secondOpen, setSecondOpen] = useState(false);
      const firstOpener = useOverlayOpenerRef();
      const secondOpener = useOverlayOpenerRef();
      return (
        <>
          <DropdownMenu
            items={[
              { label: "Rename first", onSelect: () => setFirstOpen(true) },
            ]}
            openerRef={firstOpener}
            trigger={<Button>First actions</Button>}
          />
          <DropdownMenu
            items={[
              { label: "Rename second", onSelect: () => setSecondOpen(true) },
            ]}
            openerRef={secondOpener}
            trigger={<Button>Second actions</Button>}
          />
          <Dialog
            closeLabel="Close"
            onOpenChange={setFirstOpen}
            open={firstOpen}
            openerRef={firstOpener}
            title="Rename first"
          >
            <Input aria-label="First name" autoFocus />
          </Dialog>
          <Dialog
            closeLabel="Close"
            onOpenChange={setSecondOpen}
            open={secondOpen}
            openerRef={secondOpener}
            title="Rename second"
          >
            <Input aria-label="Second name" autoFocus />
          </Dialog>
        </>
      );
    }

    render(<ConcurrentMenuDialogs />);
    const first = screen.getByRole("button", { name: "First actions" });
    const second = screen.getByRole("button", { name: "Second actions" });
    await user.click(first);
    await user.click(screen.getByRole("menuitem", { name: "Rename first" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(first);
    await user.click(second);
    await user.click(screen.getByRole("menuitem", { name: "Rename second" }));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(second);
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

  it("carries Field required and description semantics to custom selects", () => {
    render(
      <Field description="Choose one" label="Model" required>
        <Select options={[{ label: "Llama", value: "llama" }]} />
      </Field>,
    );

    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toContain("description");
  });

  it("omits empty descriptions and updates normalized relationships", async () => {
    function DynamicField() {
      const [error, setError] = useState<string>();
      return (
        <>
          <Field description="Helpful" error={error} label="Notes">
            <Textarea name="notes" />
          </Field>
          <Field label="Standalone">
            <Input name="standalone" />
          </Field>
          <Field error="Choose a model" label="Model">
            <Select options={[{ label: "Llama", value: "llama" }]} />
          </Field>
          <Button onClick={() => setError("Required")}>Show error</Button>
        </>
      );
    }
    const user = userEvent.setup();
    render(<DynamicField />);
    const notes = screen.getByRole("textbox", { name: "Notes" });
    expect(notes.getAttribute("aria-describedby")?.split(" ")).toHaveLength(1);
    expect(
      screen
        .getByRole("textbox", { name: "Standalone" })
        .hasAttribute("aria-describedby"),
    ).toBe(false);
    expect(
      screen
        .getByRole("combobox", { name: "Model" })
        .getAttribute("aria-describedby"),
    ).toContain("error");

    await user.click(screen.getByRole("button", { name: "Show error" }));
    expect(notes.getAttribute("aria-describedby")?.split(" ")).toHaveLength(2);
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
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain("overscroll-behavior: contain");
    expect(styles).toContain("scroll-margin-block");
    expect(styles).toContain("color: var(--rm-ui-status-danger)");
  });
});
