// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  RecordingsTimeline,
  type RecordingProgressEvent,
} from "../src/components/recordings/RecordingsTimeline";

function makeEvents(): RecordingProgressEvent[] {
  return [
    {
      ts: "2026-05-02T07:00:00.000Z",
      category: "recording",
      severity: "info",
      title: "Capture started",
      seq: 1,
    },
    {
      ts: "2026-05-02T07:00:01.000Z",
      category: "carla",
      severity: "info",
      title: "CARLA simulator handshake",
      detail: "town04 · 18 actors",
      seq: 2,
    },
    {
      ts: "2026-05-02T07:00:30.000Z",
      category: "scenario",
      severity: "watch",
      title: "Pedestrian dart-out",
      seq: 3,
    },
    {
      ts: "2026-05-02T07:01:30.000Z",
      category: "encoding",
      severity: "info",
      title: "Encoding composite",
      seq: 4,
    },
  ];
}

describe("RecordingsTimeline", () => {
  it("renders the empty hint when no events have arrived", () => {
    render(<RecordingsTimeline events={[]} connected={false} />);
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
    expect(screen.getByText(/awaiting stream/i)).toBeInTheDocument();
  });

  it("renders events in the supplied order with category and title", () => {
    render(<RecordingsTimeline events={makeEvents()} connected={true} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(items[0]!).getByText("Capture started")).toBeInTheDocument();
    expect(within(items[0]!).getByText("recording")).toBeInTheDocument();
    expect(within(items[1]!).getByText("CARLA simulator handshake")).toBeInTheDocument();
    expect(within(items[1]!).getByText("carla")).toBeInTheDocument();
    expect(within(items[1]!).getByText("town04 · 18 actors")).toBeInTheDocument();
    expect(within(items[2]!).getByText("Pedestrian dart-out")).toBeInTheDocument();
    expect(within(items[3]!).getByText("Encoding composite")).toBeInTheDocument();
  });

  it("flags the live state when the connected prop is true", () => {
    render(<RecordingsTimeline events={makeEvents()} connected={true} />);
    expect(screen.getByText(/stream live/i)).toBeInTheDocument();
  });

  it("uses the supplied empty hint when provided", () => {
    render(
      <RecordingsTimeline
        events={[]}
        connected={false}
        emptyHint="replaying timeline"
      />,
    );
    expect(screen.getByText(/replaying timeline/i)).toBeInTheDocument();
  });
});
