import { describe, expect, it } from "vitest";
import { coreNamespace } from "../../src/coreAdapter";
import { createBridge } from "../../src/bridge";

describe("coreAdapter — the real @dualtran/core through the bridge", () => {
  it("translates a batch with an injected fetch (no network)", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        // Real response shape: [[["translated","original",...],...], null, "detectedLang", ...]
        text: async () => JSON.stringify([[["Bonjour le monde", "Hello world", null, null, 10]], null, "en"]),
      };
    };
    const bridge = createBridge({
      core: coreNamespace,
      fetchImpl,
      getSettings: () => ({
        engine: "google",
        sourceLanguage: "auto",
        targetLanguage: "fr",
        aiProvider: "",
        aiApiKey: "",
        aiModel: "",
        aiBaseUrl: "",
      }),
    });
    const out = await bridge.translateBlocks(["Hello world"]);
    expect(out).toEqual(["Bonjour le monde"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("translate.googleapis.com");
  });
});
