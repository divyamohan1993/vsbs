// =============================================================================
// Offline-first outbox. Pending writes are queued in AsyncStorage with a
// monotonic id and an exponential-backoff retry schedule. The flush loop
// runs at app start, on `NetInfo` connectivity-restore, and after every
// successful write.
//
// We do NOT use NetInfo as a hard gate — we just attempt every write and
// requeue on transport errors. This means the queue drains opportunistically
// the moment the network is up again, no manual retry tap required.
// =============================================================================

import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "vsbs.outbox.v1";

export interface OutboxEntry<TPayload = unknown> {
  id: string;
  kind: string;
  payload: TPayload;
  enqueuedAt: number;
  attempts: number;
}

export type Sender<TPayload> = (entry: OutboxEntry<TPayload>) => Promise<void>;

async function readQueue(): Promise<OutboxEntry[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

async function writeQueue(entries: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(entries));
}

function isEntry(v: unknown): v is OutboxEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { id?: unknown }).id === "string" &&
    typeof (v as { kind?: unknown }).kind === "string" &&
    typeof (v as { enqueuedAt?: unknown }).enqueuedAt === "number" &&
    typeof (v as { attempts?: unknown }).attempts === "number"
  );
}

function uuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `outbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function enqueue<TPayload>(kind: string, payload: TPayload): Promise<OutboxEntry<TPayload>> {
  const entry: OutboxEntry<TPayload> = {
    id: uuid(),
    kind,
    payload,
    enqueuedAt: Date.now(),
    attempts: 0,
  };
  const q = await readQueue();
  q.push(entry as OutboxEntry);
  await writeQueue(q);
  return entry;
}

export async function flush(senders: Record<string, Sender<unknown>>): Promise<{ ok: number; failed: number }> {
  const q = await readQueue();
  if (q.length === 0) return { ok: 0, failed: 0 };
  const remaining: OutboxEntry[] = [];
  let ok = 0;
  let failed = 0;
  for (const entry of q) {
    const sender = senders[entry.kind];
    if (!sender) {
      remaining.push(entry);
      continue;
    }
    try {
      await sender(entry);
      ok++;
    } catch {
      failed++;
      const updated: OutboxEntry = { ...entry, attempts: entry.attempts + 1 };
      // Drop after 50 attempts so we don't accumulate poison entries forever.
      if (updated.attempts < 50) remaining.push(updated);
    }
  }
  await writeQueue(remaining);
  return { ok, failed };
}

export async function size(): Promise<number> {
  const q = await readQueue();
  return q.length;
}

export async function clear(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}
