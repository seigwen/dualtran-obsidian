import { describe, expect, it, vi } from "vitest";
import { coreNamespace } from "../../src/coreAdapter";
import { modelsForProvider, projectProviders, type ModelsDevData, type ProviderDef } from "../../src/catalog";

/**
 * Contract tests against the real vendored @dualtran/core (no network).
 * The unit suite stubs these helpers; here we prove the aliases, the store and
 * the language table behave the way the settings UI assumes.
 */
const core = coreNamespace as any;

function makeCatalogue(size = 12): ModelsDevData {
  const data: ModelsDevData = {
    openai: {
      name: "OpenAI",
      api: "https://api.openai.com/v1",
      models: { "gpt-4o-mini": { name: "GPT-4o Mini" }, "gpt-4o": { name: "GPT-4o" } },
    },
    google: {
      name: "Google",
      api: "https://generativelanguage.googleapis.com/v1beta",
      models: { "gemini-2.5-flash": { name: "Gemini 2.5 Flash" } },
    },
  };
  for (let i = 0; i < size; i++) {
    data[`provider-${i}`] = { name: `Provider ${i}`, api: `https://api.provider-${i}.example/v1`, models: {} };
  }
  return data;
}

describe("@dualtran/core — catalogue contracts", () => {
  it("maps the internal provider id onto the models.dev id", () => {
    expect(core.resolveModelsDevId("google-gemini")).toBe("google");
    expect(core.resolveModelsDevId("moonshot")).toBe("moonshotai");
    expect(core.resolveModelsDevId("groq")).toBe("groq");
    expect(core.resolveModelsDevId("some-dynamic-provider")).toBe("some-dynamic-provider");
  });

  it("ships 21 built-in providers with unique ids", () => {
    const ids = core.BUILT_IN_PROVIDERS.map((p: ProviderDef) => p.id);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
    expect(ids).toContain("openai");
  });

  it("exposes a language table usable by the target-language dropdown", () => {
    const en = core.allLanguagesNames.en;
    expect(en["zh-CN"]).toBe("Chinese (Simplified)");
    expect(en.ja).toBe("Japanese");
    expect(en.auto).toBeUndefined();
    expect(core.codeToLanguageNameInEnglish("zh-CN")).toBe("Chinese (Simplified)");
  });

  it("returns a smart default that is part of the offered model list", () => {
    const models = [
      { value: "gpt-4o", text: "GPT-4o" },
      { value: "gpt-4o-mini", text: "GPT-4o Mini" },
    ];
    const picked = core.getSmartDefaultModel({ provider: "openai", models });
    expect(models.map((m) => m.value)).toContain(picked);
  });

  it("feeds the provider dropdown from the real built-in registry plus a models.dev payload", () => {
    const out = projectProviders({
      data: makeCatalogue(),
      builtIns: core.BUILT_IN_PROVIDERS,
      selectedId: "openai",
      resolveId: core.resolveModelsDevId,
    });
    expect(out[0]).toMatchObject({ id: "openai", source: "built-in" });
    // `google` is the models.dev id for the `google-gemini` built-in → deduped
    expect(out.map((p) => p.id)).not.toContain("google");
    expect(out.filter((p) => p.source === "models.dev").length).toBeGreaterThan(5);
    // and the alias still resolves to real models
    expect(
      modelsForProvider({ provider: "google-gemini", data: makeCatalogue(), resolveId: core.resolveModelsDevId })
    ).toEqual([{ value: "gemini-2.5-flash", text: "Gemini 2.5 Flash" }]);
  });

  it("creates a store that fetches models.dev once and memoizes the payload", async () => {
    const payload = makeCatalogue(15);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }));
    const store = core.createModelsDevStore({ fetch: fetchImpl, now: () => 1000 });
    const first = await store.getProvidersData();
    const second = await store.getProvidersData();
    expect(first).toEqual(payload);
    expect(second).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
