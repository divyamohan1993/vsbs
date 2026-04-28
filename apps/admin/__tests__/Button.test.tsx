import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../src/components/ui/Button";

describe("Button", () => {
  it("renders with primary variant by default", () => {
    render(<Button>Save</Button>);
    const el = screen.getByRole("button", { name: "Save" });
    expect(el.className).toContain("bg-accent");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        No
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("supports the danger variant", () => {
    render(<Button variant="danger">Cancel</Button>);
    expect(screen.getByRole("button").className).toContain("bg-danger");
  });
});
