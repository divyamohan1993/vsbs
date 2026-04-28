import { describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip } from "../src/components/ui/Tooltip";

describe("Tooltip", () => {
  it("becomes visible after the configured delay", async () => {
    render(
      <Tooltip content="Help text" delayMs={50}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    await userEvent.hover(trigger);
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Help text");
  });
});
