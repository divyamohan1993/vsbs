import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Alert,
  Avatar,
  Badge,
  Checkbox,
  Input,
  Progress,
  RadioGroup,
  Slider,
  Switch,
  Textarea,
  Toggle,
} from "../src/components/ui/Form";

describe("Form primitives", () => {
  it("Input forwards value and accepts changes", async () => {
    let v = "";
    function Harness(): React.JSX.Element {
      return (
        <Input
          aria-label="vin"
          value={v}
          onChange={(e) => {
            v = e.target.value;
          }}
        />
      );
    }
    const { rerender } = render(<Harness />);
    const input = screen.getByLabelText("vin");
    await userEvent.type(input, "1HGCM82633A");
    rerender(<Harness />);
    expect(v.length).toBeGreaterThan(0);
  });

  it("Textarea has a sane minimum height and accepts a value", () => {
    render(<Textarea aria-label="notes" defaultValue="hello" />);
    const ta = screen.getByLabelText("notes");
    expect(ta).toHaveValue("hello");
  });

  it("Switch toggles aria-checked", async () => {
    let on = false;
    function Harness(): React.JSX.Element {
      return (
        <Switch
          checked={on}
          label="autonomy"
          onCheckedChange={(v) => {
            on = v;
          }}
        />
      );
    }
    const { rerender } = render(<Harness />);
    const sw = screen.getByRole("switch", { name: "autonomy" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    rerender(<Harness />);
    expect(on).toBe(true);
  });

  it("Checkbox emits a state change", async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onChange} label="agree" />);
    await userEvent.click(screen.getByLabelText("agree"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("RadioGroup emits the selected value", async () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        name="size"
        value="m"
        onValueChange={onChange}
        options={[
          { value: "s", label: "Small" },
          { value: "m", label: "Medium" },
          { value: "l", label: "Large" },
        ]}
      />,
    );
    await userEvent.click(screen.getByLabelText("Large"));
    expect(onChange).toHaveBeenCalledWith("l");
  });

  it("Toggle press toggles aria-pressed", async () => {
    let pressed = false;
    function Harness(): React.JSX.Element {
      return (
        <Toggle
          pressed={pressed}
          label="bold"
          onPressedChange={(p) => {
            pressed = p;
          }}
        />
      );
    }
    const { rerender } = render(<Harness />);
    expect(screen.getByRole("button", { name: "bold" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "bold" }));
    rerender(<Harness />);
    expect(pressed).toBe(true);
  });

  it("Slider exposes accessible value props", () => {
    render(<Slider value={45} onValueChange={() => undefined} label="volume" min={0} max={100} />);
    const r = screen.getByRole("slider");
    expect(r).toHaveAttribute("aria-valuemin", "0");
    expect(r).toHaveAttribute("aria-valuemax", "100");
    expect(r).toHaveAttribute("aria-valuenow", "45");
  });

  it("Progress reports its value through aria", () => {
    render(<Progress value={62} label="loading" />);
    const r = screen.getByRole("progressbar", { name: "loading" });
    expect(r).toHaveAttribute("aria-valuenow", "62");
    expect(r).toHaveAttribute("aria-valuemin", "0");
  });

  it("Avatar shows initials when no src is supplied", () => {
    render(<Avatar initials="dm" alt="Divya" />);
    const node = screen.getByLabelText("Divya");
    expect(node).toHaveTextContent("DM");
  });

  it("Badge uses warning tone class", () => {
    render(<Badge tone="warning">caution</Badge>);
    expect(screen.getByText("caution")).toBeInTheDocument();
  });

  it("Alert uses role=alert for danger tones", () => {
    render(
      <Alert tone="danger" title="Stop">
        critical
      </Alert>,
    );
    expect(screen.getByRole("alert")).toHaveAccessibleName(/stop/i);
  });
});
