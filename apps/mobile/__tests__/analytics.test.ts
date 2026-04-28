

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

import { clearEvents, readEvents, track } from "../src/lib/analytics";

describe("PII-free analytics queue", () => {
  beforeEach(async () => {
    await clearEvents();
  });

  it("queues a tracked event in AsyncStorage", async () => {
    await track("app_open", {});
    const events = await readEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("app_open");
  });

  it("retains only the last 1000 events", async () => {
    for (let i = 0; i < 1100; i++) {
      await track("screen_view", { screen: `s-${i}` });
    }
    const events = await readEvents();
    expect(events.length).toBe(1000);
  });

  it("clearEvents wipes the queue", async () => {
    await track("app_open", {});
    await clearEvents();
    expect(await readEvents()).toHaveLength(0);
  });
});
