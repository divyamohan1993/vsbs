import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/components/ui/Tabs";

function Harness(): React.JSX.Element {
  const [v, setV] = useState("a");
  return (
    <Tabs value={v} onValueChange={setV}>
      <TabsList>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
        <TabsTrigger value="c">C</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Panel A</TabsContent>
      <TabsContent value="b">Panel B</TabsContent>
      <TabsContent value="c">Panel C</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("shows the initial panel and switches on click", async () => {
    render(<Harness />);
    expect(screen.getByText("Panel A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(screen.getByText("Panel B")).toBeInTheDocument();
    expect(screen.queryByText("Panel A")).toBeNull();
  });

  it("supports arrow-key navigation across tabs", async () => {
    render(<Harness />);
    const tabA = screen.getByRole("tab", { name: "A" });
    tabA.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText("Panel B")).toBeInTheDocument();
    await userEvent.keyboard("{End}");
    expect(screen.getByText("Panel C")).toBeInTheDocument();
    await userEvent.keyboard("{Home}");
    expect(screen.getByText("Panel A")).toBeInTheDocument();
  });
});
