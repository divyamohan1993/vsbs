// =============================================================================
// SSE parser for POST/GET streams. Mirrors apps/web/src/lib/sse.ts so the
// agent-trace UI behaves the same on web and mobile.
//
// EventSource on RN does not support POST + custom headers, so we use
// fetch + a streaming reader and parse `event:` + `data:` per WHATWG.
// =============================================================================

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

export async function* readSse(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<SseFrame, void, void> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let id: string | undefined;

  const flush = (): SseFrame | null => {
    if (dataLines.length === 0 && eventName === "message") return null;
    const frame: SseFrame = {
      event: eventName,
      data: dataLines.join("\n"),
      ...(id !== undefined ? { id } : {}),
    };
    eventName = "message";
    dataLines = [];
    id = undefined;
    return frame;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const recordEnd = findRecordEnd(buffer);
        if (recordEnd === -1) break;
        const record = buffer.slice(0, recordEnd);
        buffer = buffer.slice(recordEnd).replace(/^(\r\n\r\n|\n\n|\r\r)/, "");
        for (const rawLine of record.split(/\r\n|\n|\r/)) {
          if (rawLine === "") continue;
          if (rawLine.startsWith(":")) continue;
          const sep = rawLine.indexOf(":");
          const field = sep === -1 ? rawLine : rawLine.slice(0, sep);
          let value = sep === -1 ? "" : rawLine.slice(sep + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "event") eventName = value;
          else if (field === "data") dataLines.push(value);
          else if (field === "id") id = value;
        }
        const frame = flush();
        if (frame) yield frame;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* stream may already be closed */
    }
  }
}

function findRecordEnd(buffer: string): number {
  const candidates = ["\r\n\r\n", "\n\n", "\r\r"];
  let earliest = -1;
  for (const sep of candidates) {
    const idx = buffer.indexOf(sep);
    if (idx === -1) continue;
    const end = idx + sep.length;
    if (earliest === -1 || end < earliest) earliest = end;
  }
  return earliest;
}
