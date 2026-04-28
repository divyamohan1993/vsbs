"use client";

import { useMemo, useState, type ReactNode } from "react";

export interface Column<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  sortable?: boolean;
  sortBy?: (row: Row) => string | number;
  align?: "left" | "right";
}

export interface DataTableProps<Row> {
  caption: string;
  columns: ReadonlyArray<Column<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  emptyState: ReactNode;
  selectable?: boolean;
  onSelectionChange?: (selected: ReadonlyArray<string>) => void;
}

export function DataTable<Row>(props: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const sortedRows = useMemo(() => {
    if (!sort) return props.rows.slice();
    const col = props.columns.find((c) => c.id === sort.id);
    if (!col || !col.sortBy) return props.rows.slice();
    const sortBy = col.sortBy;
    const dir = sort.dir === "asc" ? 1 : -1;
    return props.rows.slice().sort((a, b) => {
      const va = sortBy(a);
      const vb = sortBy(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [props.rows, props.columns, sort]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    props.onSelectionChange?.(Array.from(next));
  }

  function toggleAll() {
    if (selected.size === props.rows.length) {
      setSelected(new Set());
      props.onSelectionChange?.([]);
    } else {
      const next = new Set(props.rows.map((r) => props.rowKey(r)));
      setSelected(next);
      props.onSelectionChange?.(Array.from(next));
    }
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <caption className="sr-only">{props.caption}</caption>
        <thead className="bg-surface-3 text-left">
          <tr>
            {props.selectable ? (
              <th scope="col" className="w-10 px-3 py-2">
                <label className="sr-only" htmlFor="dt-select-all">
                  Select all rows
                </label>
                <input
                  id="dt-select-all"
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === props.rows.length}
                  onChange={toggleAll}
                  aria-label="Select all rows"
                />
              </th>
            ) : null}
            {props.columns.map((col) => {
              const active = sort?.id === col.id;
              return (
                <th
                  key={col.id}
                  scope="col"
                  className={`px-3 py-2 font-semibold ${col.align === "right" ? "text-right" : "text-left"}`}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded px-1 py-0.5"
                      onClick={() => {
                        setSort((cur) => {
                          if (!cur || cur.id !== col.id) return { id: col.id, dir: "asc" };
                          return { id: col.id, dir: cur.dir === "asc" ? "desc" : "asc" };
                        });
                      }}
                      aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <span>{col.header}</span>
                      <span aria-hidden="true">{active ? (sort?.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td
                colSpan={props.columns.length + (props.selectable ? 1 : 0)}
                className="px-3 py-6 text-center text-muted"
              >
                {props.emptyState}
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => {
              const id = props.rowKey(row);
              return (
                <tr key={id} className="border-t border-[var(--color-border)] hover:bg-surface-3">
                  {props.selectable ? (
                    <td className="px-3 py-2">
                      <label className="sr-only" htmlFor={`dt-row-${id}`}>
                        Select row {id}
                      </label>
                      <input
                        id={`dt-row-${id}`}
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => toggle(id)}
                        aria-label={`Select row ${id}`}
                      />
                    </td>
                  ) : null}
                  {props.columns.map((col) => (
                    <td
                      key={col.id}
                      className={`px-3 py-2 ${col.align === "right" ? "text-right" : "text-left"}`}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
