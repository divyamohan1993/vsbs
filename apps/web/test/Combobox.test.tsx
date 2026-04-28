import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "../src/components/ui/Combobox";

const OPTIONS = [
  { value: "civic", label: "Honda Civic" },
  { value: "city", label: "Honda City" },
  { value: "swift", label: "Maruti Swift" },
];

describe("Combobox", () => {
  it("filters options as the user types", async () => {
    const onChange = vi.fn();
    render(<Combobox label="Vehicle" options={OPTIONS} value={null} onValueChange={onChange} />);
    const input = screen.getByLabelText("Vehicle");
    await userEvent.type(input, "Hon");
    expect(screen.getByRole("option", { name: "Honda Civic" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Maruti Swift" })).toBeNull();
  });

  it("emits the selected value on Enter", async () => {
    const onChange = vi.fn();
    render(<Combobox label="Vehicle" options={OPTIONS} value={null} onValueChange={onChange} />);
    const input = screen.getByLabelText("Vehicle");
    await userEvent.type(input, "Mar");
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("swift");
  });
});
