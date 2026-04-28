import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusPill } from "../src/components/ui/StatusPill";

describe("StatusPill", () => {
  it("renders the supplied children", () => {
    render(<StatusPill tone="success">accepted</StatusPill>);
    expect(screen.getByText("accepted")).toBeInTheDocument();
  });

  it("applies the danger tone class", () => {
    render(<StatusPill tone="danger">red</StatusPill>);
    const el = screen.getByText("red");
    expect(el.className).toContain("bg-danger");
  });

  it("applies the warn tone class", () => {
    render(<StatusPill tone="warn">amber</StatusPill>);
    expect(screen.getByText("amber").className).toContain("bg-warn");
  });
});
