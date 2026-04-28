import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable, type Column } from "../src/components/ui/DataTable";

interface Row {
  id: string;
  n: number;
}

const rows: Row[] = [
  { id: "a", n: 3 },
  { id: "b", n: 1 },
  { id: "c", n: 2 },
];

const columns: Column<Row>[] = [
  { id: "id", header: "Id", sortable: true, sortBy: (r) => r.id, cell: (r) => r.id },
  { id: "n", header: "N", sortable: true, sortBy: (r) => r.n, cell: (r) => r.n },
];

describe("DataTable", () => {
  it("renders rows", () => {
    render(<DataTable<Row> caption="t" columns={columns} rows={rows} rowKey={(r) => r.id} emptyState="empty" />);
    expect(screen.getByRole("table", { name: "t" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(rows.length + 1);
  });

  it("toggles sort direction when clicking a column header", async () => {
    render(<DataTable<Row> caption="t" columns={columns} rows={rows} rowKey={(r) => r.id} emptyState="empty" />);
    const nButton = screen.getByRole("button", { name: /N/ });
    await userEvent.click(nButton);
    let cells = screen.getAllByRole("cell");
    expect(cells[1]?.textContent).toBe("1");
    await userEvent.click(nButton);
    cells = screen.getAllByRole("cell");
    expect(cells[1]?.textContent).toBe("3");
  });

  it("emits selection events", async () => {
    const onSel = vi.fn();
    render(
      <DataTable<Row>
        caption="t"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        emptyState="empty"
        selectable
        onSelectionChange={onSel}
      />,
    );
    const checks = screen.getAllByRole("checkbox");
    expect(checks.length).toBeGreaterThan(1);
    await userEvent.click(checks[1]!);
    expect(onSel).toHaveBeenLastCalledWith(["a"]);
  });

  it("renders the empty state when rows is empty", () => {
    render(
      <DataTable<Row> caption="t" columns={columns} rows={[]} rowKey={(r) => r.id} emptyState="No rows" />,
    );
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });
});
