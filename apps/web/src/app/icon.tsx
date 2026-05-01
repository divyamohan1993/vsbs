// Brand mark, rendered server-side as a 32x32 PNG via next/og's ImageResponse.
// Replaces the 404 on /favicon.ico and gives every tab the obsidian + champagne
// VSBS sigil. Matches the colour tokens in apps/web/src/app/globals.css.

import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          background:
            "radial-gradient(ellipse at 30% 25%, #1b2230 0%, #11151d 55%, #08090c 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#c9a36a",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          fontWeight: 700,
          fontSize: 20,
          letterSpacing: -0.5,
          borderRadius: 6,
        }}
      >
        V
      </div>
    ),
    { ...size },
  );
}
