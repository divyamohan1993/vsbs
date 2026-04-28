import { describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "../src/components/ui/Toast";

function Pusher({ tone }: { tone?: "info" | "success" | "warning" | "danger" }): React.JSX.Element {
  const { push } = useToast();
  return (
    <button type="button" onClick={() => push({ title: "Hi", tone })}>
      push
    </button>
  );
}

describe("Toast", () => {
  it("renders pushed toast with assertive aria-live for danger", async () => {
    render(
      <ToastProvider>
        <Pusher tone="danger" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "push" }));
    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "assertive");
    expect(live).toHaveTextContent("Hi");
  });

  it("uses polite aria-live for non-danger toasts", async () => {
    render(
      <ToastProvider>
        <Pusher tone="success" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "push" }));
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("dismisses a toast when the close affordance is used", async () => {
    render(
      <ToastProvider>
        <Pusher tone="info" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "push" }));
    expect(screen.getByText("Hi")).toBeInTheDocument();
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /dismiss notification/i }));
    });
    expect(screen.queryByText("Hi")).toBeNull();
  });
});
