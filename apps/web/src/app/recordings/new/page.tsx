// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import type { Metadata } from "next";
import { GlassPanel, SpecLabel } from "../../../components/luxe";
import { RecordingsRunner } from "./RecordingsRunner";

export const metadata: Metadata = {
  title: "Record a demo · VSBS",
  description:
    "Capture a 4K, 60 fps demo of the VSBS autonomy stack. Live timeline, one-click download.",
};

export default async function RecordingsNewPage(): Promise<React.JSX.Element> {
  return (
    <section
      aria-labelledby="recordings-new-h"
      className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 py-6"
    >
      <GlassPanel variant="muted" as="section" className="flex flex-col gap-3">
        <SpecLabel>Recordings</SpecLabel>
        <h1
          id="recordings-new-h"
          className="font-[family-name:var(--font-display)] text-[length:var(--text-h1)] text-pearl"
        >
          Record a demo run.
        </h1>
        <p className="text-[length:var(--text-body)] text-pearl-muted leading-[1.6]">
          One file, one click. The pipeline streams every step here as it
          happens — recording, CARLA, scenario, encoding, done.
        </p>
      </GlassPanel>
      <RecordingsRunner />
    </section>
  );
}
