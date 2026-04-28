import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState, ErrorState, LoadingState, SuccessState } from "../src/components/states";

describe("states", () => {
  it("EmptyState renders the heading and an optional action", async () => {
    const onClick = vi.fn();
    render(<EmptyState heading="Nothing yet" body="Add some" action={{ label: "Add", onClick }} />);
    expect(screen.getByRole("status")).toHaveAccessibleName(/nothing yet/i);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("LoadingState announces a polite status", () => {
    render(<LoadingState heading="Loading…" />);
    const node = screen.getByRole("status");
    expect(node).toHaveAttribute("aria-live", "polite");
  });

  it("ErrorState uses role=alert", () => {
    render(<ErrorState heading="Boom" body="failed" />);
    const node = screen.getByRole("alert");
    expect(node).toHaveAccessibleName(/boom/i);
    expect(node).toHaveAttribute("aria-live", "assertive");
  });

  it("SuccessState uses status role", () => {
    render(<SuccessState heading="Done" />);
    expect(screen.getByRole("status")).toHaveAccessibleName(/done/i);
  });
});
