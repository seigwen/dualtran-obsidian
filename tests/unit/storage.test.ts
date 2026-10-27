import { describe, expect, it, vi } from "vitest";
import { createObsidianStorage } from "../../src/storage";

function makeHost(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    loadLocalStorage: vi.fn((key: string) => (store.has(key) ? store.get(key) : null)),
    saveLocalStorage: vi.fn((key: string, data: unknown | null) => {
      if (data === null) store.delete(key);
      else store.set(key, data);
    }),
  };
}

describe("createObsidianStorage", () => {
  it("round-trips a value in the shape core's models.dev store expects", async () => {
    const host = makeHost();
    const storage = createObsidianStorage(host);
    const entry = { data: { openai: { name: "OpenAI" } }, ts: 123 };
    await storage.set({ "dualtran:modelsdev:v1": entry });
    expect(await storage.get("dualtran:modelsdev:v1")).toEqual({ "dualtran:modelsdev:v1": entry });
  });

  it("returns an empty object for a missing key", async () => {
    const storage = createObsidianStorage(makeHost());
    expect(await storage.get("absent")).toEqual({});
  });

  it("swallows host failures instead of breaking the settings pane", async () => {
    const host = {
      loadLocalStorage: vi.fn(() => {
        throw new Error("no storage");
      }),
      saveLocalStorage: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    const storage = createObsidianStorage(host);
    expect(await storage.get("k")).toEqual({});
    await expect(storage.set({ k: { ts: 1 } })).resolves.toBeUndefined();
  });
});
