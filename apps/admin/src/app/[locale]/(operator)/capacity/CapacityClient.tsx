"use client";

import { useEffect, useMemo, useState } from "react";

import { adminApi, AdminApiError } from "@/lib/api";
import { Card } from "@/components/ui/Card";

interface Cell {
  scId: string;
  dayOfWeek: number;
  hour: number;
  capacity: number;
  utilised: number;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface Labels {
  selectSc: string;
  scaleLabel: string;
  low: string;
  medium: string;
  high: string;
}

function colourForUtil(u: number): string {
  if (u < 0.4) return "oklch(74% 0.16 155)";
  if (u < 0.75) return "oklch(80% 0.15 90)";
  return "oklch(66% 0.22 25)";
}

export function CapacityClient({ labels }: { labels: Labels }) {
  const [serviceCentres, setSc] = useState<string[]>([]);
  const [selectedSc, setSelectedSc] = useState<string>("");
  const [cells, setCells] = useState<Cell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      try {
        const r = await adminApi.capacity.heatmap(selectedSc || undefined);
        if (cancelled) return;
        setCells(r.data.cells);
        setSc(r.data.serviceCentres);
        if (!selectedSc && r.data.serviceCentres.length > 0) {
          setSelectedSc(r.data.serviceCentres[0]!);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof AdminApiError ? e.message : String(e));
      }
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, [selectedSc]);

  const grid = useMemo(() => {
    const HOURS = Array.from({ length: 15 }, (_, i) => i + 7);
    const map = new Map<string, Cell>();
    for (const c of cells) {
      if (selectedSc && c.scId !== selectedSc) continue;
      map.set(`${c.dayOfWeek}-${c.hour}`, c);
    }
    return { hours: HOURS, map };
  }, [cells, selectedSc]);

  return (
    <Card
      title={labels.selectSc}
      actions={
        <label className="text-xs">
          <span className="sr-only">{labels.selectSc}</span>
          <select
            value={selectedSc}
            onChange={(e) => setSelectedSc(e.target.value)}
            aria-label={labels.selectSc}
            className="rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 text-sm"
          >
            {serviceCentres.map((sc) => (
              <option key={sc} value={sc}>
                {sc}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {error ? (
        <div role="alert" className="mb-3 rounded-md bg-danger px-3 py-2 text-sm text-danger-on">
          {error}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" role="grid" aria-label={`${selectedSc} utilisation, day x hour`}>
          <caption className="sr-only">
            Capacity heat map. Rows are days of the week, columns are hours of the day, cell colour shows utilisation.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="bg-surface-3 px-2 py-1 text-left">
                Day
              </th>
              {grid.hours.map((h) => (
                <th key={h} scope="col" className="bg-surface-3 px-1 py-1 text-center">
                  {h}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day, di) => (
              <tr key={day}>
                <th scope="row" className="bg-surface-3 px-2 py-1 text-left">
                  {day}
                </th>
                {grid.hours.map((h) => {
                  const cell = grid.map.get(`${di}-${h}`);
                  if (!cell) {
                    return <td key={h} className="px-1 py-1 text-center text-muted">·</td>;
                  }
                  const util = cell.capacity === 0 ? 0 : cell.utilised / cell.capacity;
                  const pct = Math.round(util * 100);
                  return (
                    <td key={h} className="p-0.5">
                      <button
                        type="button"
                        onClick={() => setSelectedCell(cell)}
                        aria-label={`${day} ${h}:00, ${cell.utilised} of ${cell.capacity} utilised, ${pct} percent`}
                        className="block w-full rounded px-1 py-2 text-center font-mono"
                        style={{
                          backgroundColor: colourForUtil(util),
                          color: "oklch(15% 0.02 260)",
                        }}
                      >
                        {pct}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted mt-3 text-xs" aria-label={labels.scaleLabel}>
        <span className="mr-3 inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: "oklch(74% 0.16 155)" }} />
          {labels.low}
        </span>
        <span className="mr-3 inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: "oklch(80% 0.15 90)" }} />
          {labels.medium}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: "oklch(66% 0.22 25)" }} />
          {labels.high}
        </span>
      </p>
      {selectedCell ? (
        <div role="region" aria-live="polite" className="mt-4 rounded-md border border-[var(--color-border)] bg-surface-3 p-3 text-sm">
          <div className="font-semibold">
            {DAYS[selectedCell.dayOfWeek]} {selectedCell.hour}:00 — {selectedCell.scId}
          </div>
          <div className="text-muted">
            {selectedCell.utilised} / {selectedCell.capacity} bays utilised (
            {Math.round((selectedCell.utilised / Math.max(1, selectedCell.capacity)) * 100)}%)
          </div>
        </div>
      ) : null}
    </Card>
  );
}
