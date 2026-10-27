/**
 * Host-agnostic translation bridge over @dualtran/core.
 *
 * Everything is dependency-injected ({ core, fetchImpl, getSettings }) so the
 * unit suite runs against stub cores with zero module mocking and zero network.
 * The only real import of the vendored core lives in src/coreAdapter.ts.
 */
import { LOWEST_REASONING, type DualTranSettings } from "./settings";

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;

/**
 * The AI SDK calls a WHATWG `fetch` and reads `response.headers`/`response.body`,
 * so the AI path cannot use the thin FetchResponseLike adapter above — it needs
 * a real Response. requestUrl still backs it (Electron's net stack ignores CORS),
 * which is what keeps providers like Anthropic usable from the `app://` origin.
 */
export type ResponseFetchLike = (url: string, init?: FetchInitLike) => Promise<Response>;

export interface CoreLike {
  translateGoogle(args: {
    sourceArray: string[];
    sourceLanguage: string;
    targetLanguage: string;
    cache: unknown;
    fetchImpl: FetchLike | null;
  }): Promise<string[]>;
  streamChat(args: {
    provider: string;
    apiKey: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
    extra?: Record<string, unknown>;
    store?: unknown;
    fetch?: unknown;
    reasoningDepth?: string;
    onChunk?: (text: string) => void;
  }): Promise<{ totalChunks: number; streamError: unknown }>;
  buildTranslationMessages(args: { content: string; targetLanguageName: string }): {
    system: string;
    assistant: string;
  };
  codeToLanguageNameInEnglish?(code: string): string;
  formatAiError(error: unknown): { message: string };
}

/** Trim every block, drop the ones that became empty, keep the order. */
export function normalizeBlocks(blocks: string[]): string[] {
  return blocks.map((block) => block.trim()).filter((block) => block.length > 0);
}

/**
 * Adapt Obsidian's requestUrl() (no CORS on desktop or mobile) to the fetch
 * surface @dualtran/core expects: (url, init) → { ok, status, statusText, text() }.
 * throw:false keeps HTTP errors as data so the core maps them to its own
 * "Google translation failed: …" error messages instead of raw exceptions.
 */
export function createRequestUrlFetch(
  requestUrl: (req: { url: string; method?: string; headers?: unknown; body?: unknown; throw?: boolean }) => Promise<{
    status: number;
    text: string;
  }>
): FetchLike {
  return async (url, init = {}) => {
    const res = await requestUrl({
      url,
      method: init.method || "GET",
      headers: init.headers,
      body: init.body,
      throw: false,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: "",
      text: async () => res.text,
      // models.dev store and core client resolution read JSON bodies.
      json: async () => JSON.parse(res.text) as unknown,
    };
  };
}

export function createResponseFetch(
  requestUrl: (req: { url: string; method?: string; headers?: unknown; body?: unknown; throw?: boolean }) => Promise<{
    status: number;
    headers?: Record<string, string>;
    text: string;
  }>
): ResponseFetchLike {
  return async (url, init = {}) => {
    const res = await requestUrl({
      url,
      method: init.method || "GET",
      headers: init.headers,
      body: init.body,
      throw: false,
    });
    const headers = new Headers();
    const contentType = res.headers?.["content-type"] || res.headers?.["Content-Type"];
    if (contentType) headers.set("content-type", contentType);
    // 204/304 must not carry a body, otherwise the Response constructor throws.
    const body = res.status === 204 || res.status === 304 ? null : res.text;
    return new Response(body, { status: res.status, headers });
  };
}

export function createBridge({
  core,
  fetchImpl,
  getSettings,
  getStore,
  aiFetch,
  resolveReasoningDepth,
}: {
  core: CoreLike;
  fetchImpl: FetchLike | null;
  getSettings: () => DualTranSettings;
  /** models.dev store; lets the core resolve catalogue-only providers' endpoints. */
  getStore?: () => unknown;
  /** CORS-free transport for the AI SDK; without it the renderer's fetch applies. */
  aiFetch?: ResponseFetchLike;
  /** Model-aware effort resolution; defaults to the stored string (sentinel → ""). */
  resolveReasoningDepth?: (settings: DualTranSettings) => string;
}) {
  /** AI path: one streaming chat request per block, chunks joined in order. */
  async function translateBlocksAi(blocks: string[], settings: DualTranSettings): Promise<string[]> {
    const results: string[] = [];
    for (const content of blocks) {
      const targetLanguageName =
        core.codeToLanguageNameInEnglish?.(settings.targetLanguage) || settings.targetLanguage;
      const prompt = core.buildTranslationMessages({ content, targetLanguageName });
      // Message shape mirrors the extension's fetchSSE assembly (system prompt +
      // acknowledgment + content) so translation quality matches the product.
      const messages = [
        { role: "system", content: prompt.system },
        { role: "user", content: "I understand. Please give me the text." },
        { role: "user", content },
      ];
      let text = "";
      const reasoningDepth = resolveReasoningDepth
        ? resolveReasoningDepth(settings)
        : settings.aiReasoningDepth === LOWEST_REASONING
          ? ""
          : settings.aiReasoningDepth || "";
      const { totalChunks, streamError } = await core.streamChat({
        provider: settings.aiProvider,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
        messages,
        extra: settings.aiBaseUrl ? { baseURL: settings.aiBaseUrl } : {},
        store: getStore ? getStore() ?? null : null,
        fetch: aiFetch,
        reasoningDepth,
        onChunk: (chunk) => {
          text += chunk;
        },
      });
      if (streamError) {
        throw new Error(core.formatAiError(streamError).message);
      }
      if (totalChunks === 0) {
        throw new Error("No response from AI provider");
      }
      results.push(text);
    }
    return results;
  }

  return {
    /**
     * Translate a batch of text blocks. Google goes out as ONE batched request
     * (the core builds it); AI streams one request per block. Empty input
     * short-circuits without touching the engine.
     */
    async translateBlocks(blocks: string[]): Promise<string[]> {
      const normalized = normalizeBlocks(blocks);
      if (normalized.length === 0) {
        return [];
      }
      const settings = getSettings();
      if (settings.engine === "ai") {
        return translateBlocksAi(normalized, settings);
      }
      return core.translateGoogle({
        sourceArray: normalized,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        cache: null,
        fetchImpl,
      });
    },
  };
}
