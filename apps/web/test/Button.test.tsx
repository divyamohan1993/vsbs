import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../src/components/ui/Button";

describe("Button", () => {
  it("renders with default variant and size", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: /save/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("data-variant", "primary");
    expect(btn).toHaveAttribute("data-size", "md");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("invokes onClick on user activation", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onClick while disabled or loading", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button disabled onClick={onClick}>
        Send
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    rerender(
      <Button loading onClick={onClick}>
        Send
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("exposes aria-busy when loading and renders the spinner copy", () => {
    render(<Button loading loadingText="Saving">Save</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveTextContent("Saving");
  });

  it("supports the danger variant marker for screen-shot regression", () => {
    render(<Button variant="danger">Revoke</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "danger");
  });
});
