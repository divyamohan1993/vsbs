import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "../src/components/ui/Dialog";

function Harness({ onOpen }: { onOpen?: (open: boolean) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpen?.(v);
        setOpen(v);
      }}
    >
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogTitle>Confirm</DialogTitle>
        <DialogDescription>Are you sure?</DialogDescription>
        <DialogFooter>
          <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("opens on trigger and exposes a labelled dialog", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Confirm");
  });

  it("closes on Escape", async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /open/i }));
    await userEvent.keyboard("{Escape}");
    expect(onOpen).toHaveBeenLastCalledWith(false);
  });

  it("renders nothing when closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
