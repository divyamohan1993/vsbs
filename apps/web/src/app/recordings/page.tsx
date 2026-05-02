// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

// Recordings history. Server-fetched directly from the API base — server-side
// requests bypass /api/proxy/* because there is no browser CSP at this hop.

import Link from "next/link";
import type { Metadata } from "next";
import { GlassPanel, SpecLabel } from "../../components/luxe";
import {
  RecordingsHistoryList,
  type RecordingSummary,
} from "../../components/recordings/RecordingsHistoryList";

export const metadata: Metadata = {
  title: "Recordings · VSBS",
  description: "Past demo recordings of the VSBS autonomy stack.",
};

export const dynamic = "force-dynamic";

const API_BASE = process.env.VSBS_API_BASE ?? "http://localhost:8787";
const PAGE_SIZE = 10;

interface RecordingsListResponse {
  data: { items: RecordingSummary[] };
}

async function loadHistory(): Promise<RecordingSummary[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/recordings`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as RecordingsListResponse;
    return body.data.items.slice(0, PAGE_SIZE);
  } catch {
    return [];
  }
}

export default async function RecordingsIndexPage(): Promise<React.JSX.Element> {
  const items = await loadHistory();
  return (
    <section
      aria-labelledby="recordings-h"
      className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 py-6"
    >
      <GlassPanel variant="muted" as="section" className="flex flex-col gap-3">
        <SpecLabel>Recordings</SpecLabel>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1
              id="recordings-h"
              className="font-[family-name:var(--font-display)] text-[length:var(--text-h1)] text-pearl"
            >
              Past demo runs.
            </h1>
            <p className="text-[length:var(--text-body)] text-pearl-muted leading-[1.6]">
              The last {PAGE_SIZE} runs. Each archive replays its full timeline.
            </p>
          </div>
          <Link
            href={{ pathname: "/recordings/new" }}
            className="luxe-btn-primary inline-flex min-h-[44px] items-center justify-center gap-2 rounded-[var(--radius-sm)] px-5 py-2 text-[length:var(--text-control)] font-medium tracking-[var(--tracking-wide)]"
          >
            Record a demo
          </Link>
        </div>
      </GlassPanel>
      <RecordingsHistoryList items={items} />
    </section>
  );
}
