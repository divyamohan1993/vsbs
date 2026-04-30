import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadPhoto, type CapturedPhoto } from "../src/lib/photo";

function makePhoto(overrides: Partial<CapturedPhoto> = {}): CapturedPhoto {
  return {
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
    width: 32,
    height: 32,
    mimeType: "image/jpeg",
    bytes: 3,
    ...overrides,
  };
}

describe("uploadPhoto enforces on-device redaction", () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          finding: { label: "ok", confidence: 1, rationale: "", suggestedActions: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects upload when redactionSummary is missing", async () => {
    const photo = makePhoto();
    await expect(uploadPhoto(photo, "intake-1", "dashcam")).rejects.toThrow(/redaction has not run/i);
  });

  it("rejects upload when redactionSummary.ok is false", async () => {
    const photo = makePhoto({
      redactionSummary: {
        faces: 0,
        plates: 0,
        durationMs: 1,
        detectorId: "halt",
        ok: false,
        reason: "detector-not-ready",
      },
    });
    await expect(uploadPhoto(photo, "intake-1", "dashcam")).rejects.toThrow(/redaction has not run/i);
  });

  it("submits the redaction summary as a multipart field when ok=true", async () => {
    let capturedBody: FormData | null = null;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = (init?.body as FormData) ?? null;
      return new Response(
        JSON.stringify({
          ok: true,
          finding: { label: "ok", confidence: 1, rationale: "", suggestedActions: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const photo = makePhoto({
      redactionSummary: {
        faces: 2,
        plates: 1,
        durationMs: 17,
        detectorId: "face+plate",
        ok: true,
      },
    });
    const result = await uploadPhoto(photo, "intake-1", "exterior");
    expect(result.ok).toBe(true);
    expect(capturedBody).not.toBeNull();
    const redaction = (capturedBody as unknown as FormData).get("redaction");
    expect(typeof redaction).toBe("string");
    const parsed = JSON.parse(redaction as string) as { faces: number; plates: number };
    expect(parsed.faces).toBe(2);
    expect(parsed.plates).toBe(1);
  });
});
