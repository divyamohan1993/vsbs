

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve();
      },
      removeItem: (k: string) => {
        store.delete(k);
        return Promise.resolve();
      },
    },
  };
});

import { clear, enqueue, flush, size } from "../src/lib/offline";

describe("offline outbox", () => {
  beforeEach(async () => {
    await clear();
  });

  it("enqueue + size + clear round-trip", async () => {
    await enqueue("photo-upload", { url: "/path" });
    expect(await size()).toBe(1);
    await clear();
    expect(await size()).toBe(0);
  });

  it("flush invokes the matching sender and removes the entry", async () => {
    await enqueue("photo-upload", { url: "/a" });
    let invoked = 0;
    const result = await flush({
      "photo-upload": async () => {
        invoked++;
      },
    });
    expect(invoked).toBe(1);
    expect(result.ok).toBe(1);
    expect(await size()).toBe(0);
  });

  it("flush requeues an entry on transport failure with attempts++", async () => {
    await enqueue("photo-upload", { url: "/a" });
    const result = await flush({
      "photo-upload": async () => {
        throw new Error("network down");
      },
    });
    expect(result.ok).toBe(0);
    expect(result.failed).toBe(1);
    expect(await size()).toBe(1);
  });

  it("flush leaves entries with no registered sender in place", async () => {
    await enqueue("unknown-kind", {});
    const result = await flush({});
    expect(result.ok).toBe(0);
    expect(await size()).toBe(1);
  });
});
