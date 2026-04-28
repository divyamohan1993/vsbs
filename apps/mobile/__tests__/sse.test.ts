

import { readSse } from "../src/lib/sse";

function readableFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let emitted = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(s));
      emitted = true;
    },
  });
}

describe("readSse", () => {
  it("parses a single named event with JSON data", async () => {
    const body = readableFromString("event: tool_call\ndata: {\"name\":\"vin\"}\n\n");
    const frames = [];
    for await (const f of readSse(body)) frames.push(f);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event).toBe("tool_call");
    expect(frames[0]?.data).toBe('{"name":"vin"}');
  });

  it("parses two events separated by blank lines", async () => {
    const body = readableFromString(
      "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n",
    );
    const frames = [];
    for await (const f of readSse(body)) frames.push(f);
    expect(frames.map((f) => f.event)).toEqual(["a", "b"]);
    expect(frames.map((f) => f.data)).toEqual(["1", "2"]);
  });

  it("ignores SSE comments (lines starting with :)", async () => {
    const body = readableFromString(":heartbeat\nevent: tick\ndata: ok\n\n");
    const frames = [];
    for await (const f of readSse(body)) frames.push(f);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.data).toBe("ok");
  });

  it("concatenates multi-line data fields with newline", async () => {
    const body = readableFromString("event: msg\ndata: line1\ndata: line2\n\n");
    const frames = [];
    for await (const f of readSse(body)) frames.push(f);
    expect(frames[0]?.data).toBe("line1\nline2");
  });
});
