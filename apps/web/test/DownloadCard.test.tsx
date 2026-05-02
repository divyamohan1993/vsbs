// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DownloadCard } from "../src/components/recordings/DownloadCard";

describe("DownloadCard", () => {
  beforeEach(() => {
    document.head.querySelectorAll('link[rel="prefetch"]').forEach((n) => n.remove());
  });

  afterEach(() => {
    document.head.querySelectorAll('link[rel="prefetch"]').forEach((n) => n.remove());
  });

  it("renders the primary CTA as a download anchor with the encoder, size and duration", () => {
    render(
      <DownloadCard
        fileUrl="/api/proxy/recordings/abcdef12/file"
        posterUrl="/api/proxy/recordings/abcdef12/poster.jpg"
        sizeBytes={13_000_000}
        durationS={180}
        encoder="h264"
      />,
    );
    const cta = screen.getByTestId("download-cta");
    expect(cta).toHaveAttribute("href", "/api/proxy/recordings/abcdef12/file");
    expect(cta).toHaveAttribute("download");
    expect(cta).toHaveTextContent(/h264/i);
    expect(cta).toHaveTextContent(/12\.4 MB/);
    expect(cta).toHaveTextContent(/03:00/);
  });

  it("renders the composite poster with an accessible caption", () => {
    render(
      <DownloadCard
        fileUrl="/file"
        posterUrl="/poster.jpg"
        sizeBytes={1024}
        durationS={60}
        encoder="h264"
      />,
    );
    const img = screen.getByAltText(/composite preview, three frames from the run/i);
    expect(img).toHaveAttribute("src", "/poster.jpg");
    expect(img).toHaveAttribute("width", "960");
    expect(img).toHaveAttribute("height", "180");
  });

  it("prepends a prefetch link when the user hovers the CTA", async () => {
    render(
      <DownloadCard
        fileUrl="/api/proxy/recordings/abcdef12/file"
        posterUrl="/poster"
        sizeBytes={1024}
        durationS={60}
        encoder="h264"
      />,
    );
    const cta = screen.getByTestId("download-cta");
    await userEvent.hover(cta);
    const prefetch = document.head.querySelector(
      'link[rel="prefetch"][href="/api/proxy/recordings/abcdef12/file"]',
    );
    expect(prefetch).not.toBeNull();
  });

  it("copies the absolute share link via navigator.clipboard and fires onCopyLink", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onCopyLink = vi.fn();
    render(
      <DownloadCard
        fileUrl="/api/proxy/recordings/abcdef12/file"
        posterUrl="/poster"
        sizeBytes={1024}
        durationS={60}
        encoder="h264"
        onCopyLink={onCopyLink}
      />,
    );
    await userEvent.click(screen.getByTestId("copy-link"));
    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0]![0] as string;
    expect(arg.endsWith("/api/proxy/recordings/abcdef12/file")).toBe(true);
    expect(onCopyLink).toHaveBeenCalledWith(arg);
  });

  it("invokes onCopyError when navigator.clipboard.writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    const onCopyError = vi.fn();
    render(
      <DownloadCard
        fileUrl="/file"
        posterUrl="/poster"
        sizeBytes={1024}
        durationS={60}
        encoder="h264"
        onCopyError={onCopyError}
      />,
    );
    await userEvent.click(screen.getByTestId("copy-link"));
    expect(onCopyError).toHaveBeenCalledWith("denied");
  });
});
