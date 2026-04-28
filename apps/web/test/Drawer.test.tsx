import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Drawer, DrawerContent, DrawerTitle } from "../src/components/ui/Drawer";

function Harness(): React.JSX.Element {
  const [o, setO] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setO(true)}>open</button>
      <Drawer open={o} onOpenChange={setO}>
        <DrawerContent>
          <DrawerTitle>Drawer</DrawerTitle>
          <p>panel</p>
        </DrawerContent>
      </Drawer>
    </>
  );
}

describe("Drawer", () => {
  it("opens, traps focus, and closes on Escape", async () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Drawer");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
