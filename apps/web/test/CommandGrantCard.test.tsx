import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommandGrantCard, type CommandGrantSummary } from "../src/components/autonomy/CommandGrantCard";

const ACTIVE: CommandGrantSummary = {
  id: "00000000-0000-4000-8000-000000000000",
  status: "active",
  scope: ["acceptHandoff", "performScope:park"],
  tier: "ipp-l4",
  ttlSeconds: 600,
  ttlRemainingSeconds: 300,
  canonicalBytesPreview: "{...}",
  signatureHash: "sha256:abcd",
  algorithm: "ML-DSA",
  witnessChain: [{ witnessId: "vsbs-concierge", merkleRoot: "0x1" }],
  issuedAt: new Date().toISOString(),
  oem: "mercedes-ipp",
};

describe("CommandGrantCard", () => {
  it("renders an empty card when no grant is provided", () => {
    render(<CommandGrantCard grant={null} />);
    expect(screen.getByText(/No grant is active/i)).toBeInTheDocument();
  });

  it("renders ttl progress and scope badges when active", () => {
    render(<CommandGrantCard grant={ACTIVE} />);
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: /grant time remaining/i });
    expect(bar).toHaveAttribute("aria-valuenow", "300");
    expect(bar).toHaveAttribute("aria-valuemax", "600");
    expect(screen.getByText("acceptHandoff")).toBeInTheDocument();
  });
});
