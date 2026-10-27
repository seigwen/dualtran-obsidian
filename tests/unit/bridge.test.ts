import { describe, expect, it, vi } from "vitest";
import { createBridge, createRequestUrlFetch, createResponseFetch, normalizeBlocks } from "../../src/bridge";
import { LOWEST_REASONING } from "../../src/settings";

const googleSettings = {
  engine: "google",
  sourceLanguage: "auto",
  targetLanguage: "en",
  aiProvider: "openai",
  aiApiKey: "",
  aiModel: "",
  aiBaseUrl: "",
} as const;

function makeCore(overrides: Record<string, unknown> = {}) {
  return {
    translateGoogle: vi.fn(async ({ sourceArray }: any) => sourceArray.map((t: string) => `T:${t}`)),
    streamChat: vi.fn(async () => ({ totalChunks: 0, streamError: null })),
    buildTranslationMessages: vi.fn(() => ({ system: "SYS", assistant: "ACK" })),
    codeToLanguageNameInEnglish: vi.fn((c: string) => (c === "en" ? "English" : c)),
    formatAiError: vi.fn((e: any) => ({ message: String((e && e.message) || e) })),
    ...overrides,
  };
}

describe("normalizeBlocks", () => {
  it("trims, drops empty entries and keeps order", () => {
    expect(normalizeBlocks(["  a  ", "", "   ", "b"])).toEqual(["a", "b"]);
  });
});

describe("createRequestUrlFetch", () => {
  it("maps the fetch init onto requestUrl and wraps the response", async () => {
    const requestUrl = vi.fn(async () => ({ status: 200, text: "hello" }));
    const fetchImpl = createRequestUrlFetch(requestUrl as any);
    const res = await fetchImpl("https://example.com/x", {
      method: "POST",
      headers: { a: "1" },
      body: "B",
    });
    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://example.com/x",
      method: "POST",
      headers: { a: "1" },
      body: "B",
      throw: false,
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("flags non-2xx responses as not ok without throwing at the adapter layer", async () => {
    const fetchImpl = createRequestUrlFetch((async () => ({ status: 429, text: "slow down" })) as any);
    const res = await fetchImpl("https://example.com/x", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("slow down");
  });

  it("propagates requestUrl rejections (offline surface)", async () => {
    const fetchImpl = createRequestUrlFetch((async () => {
      throw new Error("offline");
    }) as any);
    await expect(fetchImpl("https://example.com/x", {})).rejects.toThrow("offline");
  });
});

describe("createBridge — google engine", () => {
  it("delegates a normalized batch to core.translateGoogle with the injected fetch", async () => {
    const core = makeCore();
    const fetchImpl = vi.fn();
    const bridge = createBridge({ core, fetchImpl, getSettings: () => googleSettings as any });
    const out = await bridge.translateBlocks(["Hello", "  World  ", ""]);
    expect(out).toEqual(["T:Hello", "T:World"]);
    expect(core.translateGoogle).toHaveBeenCalledTimes(1);
    const arg = core.translateGoogle.mock.calls[0][0] as any;
    expect(arg.sourceArray).toEqual(["Hello", "World"]);
    expect(arg.sourceLanguage).toBe("auto");
    expect(arg.targetLanguage).toBe("en");
    expect(arg.fetchImpl).toBe(fetchImpl);
    expect(arg.cache).toBeNull();
  });

  it("short-circuits empty input without calling the engine", async () => {
    const core = makeCore();
    const bridge = createBridge({ core, fetchImpl: null, getSettings: () => googleSettings as any });
    expect(await bridge.translateBlocks(["", "  "])).toEqual([]);
    expect(core.translateGoogle).not.toHaveBeenCalled();
  });

  it("propagates engine failures (no silent empty translation)", async () => {
    const core = makeCore({
      translateGoogle: vi.fn(async () => {
        throw new Error("Google translation failed: HTTP 429");
      }),
    });
    const bridge = createBridge({ core, fetchImpl: null, getSettings: () => googleSettings as any });
    await expect(bridge.translateBlocks(["Hello"])).rejects.toThrow("Google translation failed: HTTP 429");
  });
});

describe("createBridge — ai engine", () => {
  const aiSettings = {
    ...googleSettings,
    engine: "ai",
    aiProvider: "openai",
    aiApiKey: "k",
    aiModel: "gpt-test",
    aiBaseUrl: "https://proxy.example/v1",
  };

  it("streams one chat request per block and assembles the chunks", async () => {
    const core = makeCore({
      streamChat: vi.fn(async ({ onChunk }: any) => {
        onChunk("Hola ");
        onChunk("mundo");
        return { totalChunks: 2, streamError: null };
      }),
    });
    const bridge = createBridge({ core, fetchImpl: null, getSettings: () => aiSettings as any });
    expect(await bridge.translateBlocks(["Hello world"])).toEqual(["Hola mundo"]);
    const arg = core.streamChat.mock.calls[0][0] as any;
    expect(arg.provider).toBe("openai");
    expect(arg.apiKey).toBe("k");
    expect(arg.model).toBe("gpt-test");
    expect(arg.extra).toEqual({ baseURL: "https://proxy.example/v1" });
    expect(arg.messages.map((m: any) => m.role)).toEqual(["system", "user", "user"]);
    expect(arg.messages[0].content).toBe("SYS");
    expect(arg.messages[1].content).toBe("I understand. Please give me the text.");
    expect(arg.messages[2].content).toBe("Hello world");
    expect(core.buildTranslationMessages).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Hello world", targetLanguageName: "English" })
    );
  });

  it("throws the formatted provider error when the stream reports one", async () => {
    const core = makeCore({
      streamChat: vi.fn(async () => ({ totalChunks: 0, streamError: { statusCode: 401 } })),
      formatAiError: vi.fn(() => ({ message: "Invalid or missing API key" })),
    });
    const bridge = createBridge({ core, fetchImpl: null, getSettings: () => aiSettings as any });
    await expect(bridge.translateBlocks(["x"])).rejects.toThrow("Invalid or missing API key");
  });

  it("throws when the stream produced no chunks", async () => {
    const core = makeCore({ streamChat: vi.fn(async () => ({ totalChunks: 0, streamError: null })) });
    const bridge = createBridge({ core, fetchImpl: null, getSettings: () => aiSettings as any });
    await expect(bridge.translateBlocks(["x"])).rejects.toThrow(/No response from AI provider/);
  });

  it("omits extra when no base URL is configured", async () => {
    const core = makeCore({
      streamChat: vi.fn(async ({ onChunk }: any) => {
        onChunk("OK");
        return { totalChunks: 1, streamError: null };
      }),
    });
    const bridge = createBridge({ core, fetchImpl: null, getSettings: () => ({ ...aiSettings, aiBaseUrl: "" }) as any });
    await bridge.translateBlocks(["x"]);
    expect((core.streamChat.mock.calls[0][0] as any).extra).toEqual({});
  });
});

describe("createRequestUrlFetch — json()", () => {
  it("parses the text body into an object", async () => {
    const fetchImpl = createRequestUrlFetch((async () => ({ status: 200, text: '{"a":1}' })) as any);
    const res = await fetchImpl("https://example.com/x", {});
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("rejects when the body is not JSON", async () => {
    const fetchImpl = createRequestUrlFetch((async () => ({ status: 200, text: "<html>" })) as any);
    const res = await fetchImpl("https://example.com/x", {});
    await expect(res.json()).rejects.toThrow();
  });
});

describe("createBridge — models.dev store", () => {
  const aiSettings = {
    ...googleSettings,
    engine: "ai",
    aiProvider: "openai",
    aiModel: "gpt-test",
    aiBaseUrl: "",
  };

  it("forwards the store to core.streamChat so catalogue-only providers resolve their endpoint", async () => {
    const store = { getProvidersData: vi.fn(async () => ({})) };
    const core = makeCore({
      streamChat: vi.fn(async ({ onChunk }: any) => {
        onChunk("OK");
        return { totalChunks: 1, streamError: null };
      }),
    });
    const bridge = createBridge({
      core,
      fetchImpl: null,
      getSettings: () => aiSettings as any,
      getStore: () => store,
    });
    await bridge.translateBlocks(["x"]);
    expect((core.streamChat.mock.calls[0][0] as any).store).toBe(store);
  });

  it("passes null when no store is configured (unchanged legacy behaviour)", async () => {
    const core = makeCore({
      streamChat: vi.fn(async ({ onChunk }: any) => {
        onChunk("OK");
        return { totalChunks: 1, streamError: null };
      }),
    });
    const bridge = createBridge({ core, fetchImpl: null, getSettings: () => aiSettings as any });
    await bridge.translateBlocks(["x"]);
    expect((core.streamChat.mock.calls[0][0] as any).store).toBeNull();
  });

  it("forwards the host transport to core.streamChat (renderer fetch is CORS-bound)", async () => {
    const aiFetch = vi.fn();
    const core = makeCore({
      streamChat: vi.fn(async ({ onChunk }: any) => {
        onChunk("OK");
        return { totalChunks: 1, streamError: null };
      }),
    });
    const bridge = createBridge({
      core,
      fetchImpl: null,
      getSettings: () => aiSettings as any,
      aiFetch,
    });
    await bridge.translateBlocks(["x"]);
    expect((core.streamChat.mock.calls[0][0] as any).fetch).toBe(aiFetch);
  });
});

describe("createResponseFetch — requestUrl behind a real Response", () => {
  it("returns a Response the AI SDK can read (status, text, content-type)", async () => {
    const requestUrl = vi.fn(async () => ({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      text: "data: hi\n\n",
    }));
    const aiFetch = createResponseFetch(requestUrl as any);
    const res = await aiFetch("https://api.example.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer k" },
      body: "{}",
    });
    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://api.example.com/v1/chat/completions",
      method: "POST",
      headers: { Authorization: "Bearer k" },
      body: "{}",
      throw: false,
    });
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe("data: hi\n\n");
  });

  it("keeps error statuses readable so the SDK can surface the API message", async () => {
    const aiFetch = createResponseFetch((async () => ({
      status: 401,
      headers: { "content-type": "application/json" },
      text: '{"error":{"message":"Incorrect API key provided"}}',
    })) as any);
    const res = await aiFetch("https://api.example.com/v1/chat/completions", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Incorrect API key");
  });

  it("does not put a body on 204 responses", async () => {
    const aiFetch = createResponseFetch((async () => ({ status: 204, headers: {}, text: "" })) as any);
    const res = await aiFetch("https://api.example.com/x", {});
    expect(res.status).toBe(204);
  });

  it("propagates transport rejections", async () => {
    const aiFetch = createResponseFetch((async () => {
      throw new Error("net::ERR_NAME_NOT_RESOLVED");
    }) as any);
    await expect(aiFetch("https://api.example.com/x", {})).rejects.toThrow("net::ERR_NAME_NOT_RESOLVED");
  });
});

describe("createBridge — reasoning effort", () => {
  const aiSettings = {
    ...googleSettings,
    engine: "ai",
    aiProvider: "openai",
    aiModel: "gpt-5",
    aiBaseUrl: "",
  };

  it("forwards the resolved reasoning depth to core.streamChat", async () => {
    const core = makeCore({
      streamChat: vi.fn(async ({ onChunk }: any) => {
        onChunk("OK");
        return { totalChunks: 1, streamError: null };
      }),
    });
    const bridge = createBridge({
      core,
      fetchImpl: null,
      getSettings: () => aiSettings as any,
      resolveReasoningDepth: () => "minimal",
    });
    await bridge.translateBlocks(["x"]);
    expect((core.streamChat.mock.calls[0][0] as any).reasoningDepth).toBe("minimal");
  });

  it("never leaks the lowest sentinel to the core when no resolver is injected", async () => {
    const core = makeCore({
      streamChat: vi.fn(async ({ onChunk }: any) => {
        onChunk("OK");
        return { totalChunks: 1, streamError: null };
      }),
    });
    const bridge = createBridge({
      core,
      fetchImpl: null,
      getSettings: () => ({ ...aiSettings, aiReasoningDepth: LOWEST_REASONING }) as any,
    });
    await bridge.translateBlocks(["x"]);
    expect((core.streamChat.mock.calls[0][0] as any).reasoningDepth).toBe("");
  });

  it("passes an explicit level through unchanged without a resolver", async () => {
    const core = makeCore({
      streamChat: vi.fn(async ({ onChunk }: any) => {
        onChunk("OK");
        return { totalChunks: 1, streamError: null };
      }),
    });
    const bridge = createBridge({
      core,
      fetchImpl: null,
      getSettings: () => ({ ...aiSettings, aiReasoningDepth: "high" }) as any,
    });
    await bridge.translateBlocks(["x"]);
    expect((core.streamChat.mock.calls[0][0] as any).reasoningDepth).toBe("high");
  });
});
