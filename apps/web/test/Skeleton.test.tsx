import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "../src/components/ui/Skeleton";
import { Spinner } from "../src/components/ui/Spinner";

describe("Skeleton + Spinner", () => {
  it("Skeleton is decorative", () => {
    const { container } = render(<Skeleton className="h-6 w-24" />);
    const node = container.firstElementChild;
    expect(node?.getAttribute("aria-hidden")).toBe("true");
  });

  it("Spinner exposes a status role with default label", () => {
    const { getByRole } = render(<Spinner />);
    const node = getByRole("status");
    expect(node).toHaveAccessibleName("Loading");
  });
});
