// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Divya Mohan / dmj.one
//
// Lazy 3-up poster generator. Produces a single jpeg by sampling three
// frames spaced 300 frames apart and tiling them into a 3×1 strip.
// If ffmpeg is missing on the host we throw POSTER_UNAVAILABLE — callers
// surface it to the route as a 503; we never fall back to a fake image.

import { stat } from "node:fs/promises";

export class PosterUnavailableError extends Error {
  readonly code = "POSTER_UNAVAILABLE";
  constructor(message: string) {
    super(message);
  }
}

export interface PosterDeps {
  /**
   * Override Bun.spawn — used in tests. Must return an object whose `exited`
   * promise resolves to a numeric exit code.
   */
  spawn?: (init: {
    cmd: string[];
    cwd?: string;
    stdout?: "pipe" | "ignore";
    stderr?: "pipe" | "ignore";
  }) => { exited: Promise<number>; stderr?: ReadableStream<Uint8Array> | null };
  /** Override stat for tests. */
  statFn?: (p: string) => Promise<{ size: number }>;
}

export async function generatePoster(
  mp4Path: string,
  outPath: string,
  deps: PosterDeps = {},
): Promise<{ sizeBytes: number }> {
  const statFn = deps.statFn ?? (async (p: string) => stat(p));
  try {
    await statFn(mp4Path);
  } catch {
    throw new PosterUnavailableError(`source mp4 missing: ${mp4Path}`);
  }
  const spawn =
    deps.spawn ??
    ((globalThis as unknown as {
      Bun?: {
        spawn: (init: {
          cmd: string[];
          stdout?: "pipe" | "ignore";
          stderr?: "pipe" | "ignore";
        }) => { exited: Promise<number>; stderr?: ReadableStream<Uint8Array> | null };
      };
    }).Bun?.spawn);
  if (!spawn) {
    throw new PosterUnavailableError("Bun.spawn unavailable");
  }
  const proc = spawn({
    cmd: [
      "ffmpeg",
      "-i",
      mp4Path,
      "-vf",
      "select='not(mod(n,300))',scale=640:360,tile=3x1",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "-y",
      outPath,
    ],
    stdout: "ignore",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  if (exit !== 0) {
    throw new PosterUnavailableError(`ffmpeg exit=${exit}`);
  }
  const final = await statFn(outPath);
  return { sizeBytes: final.size };
}
