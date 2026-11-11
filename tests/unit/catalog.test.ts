import { describe, expect, it } from "vitest";
import {
  CUSTOM_MODEL_VALUE,
  effectiveBaseUrl,
  languageOptions,
  LOWEST_REASONING,
  modelReasoningOptions,
  modelsForProvider,
  normalizeApiBase,
  pickModelForProvider,
  reasoningDepthChoices,
  resolveEndpointOnProviderChange,
  resolveReasoningDepth,
  projectProviders,
  summarizeCatalog,
  type ModelsDevData,
  type ProviderDef,
} from "../../src/catalog";

const BUILT_INS: ProviderDef[] = [
  { id: "openai", name: "OpenAI", apiBase: "https://api.openai.com/v1/chat/completions" },
  { id: "google-gemini", name: "Google Gemini", apiBase: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "moonshot", name: "月之暗面 (Moonshot/Kimi)", apiBase: "https://api.moonshot.cn/v1/chat/completions" },
];

const ALIASES: Record<string, string> = {
  openai: "openai",
  "google-gemini": "google",
  moonshot: "moonshotai",
};
const resolveId = (id: string) => ALIASES[id] || id;

const DATA: ModelsDevData = {
  openai: {
    name: "OpenAI",
    api: "https://api.openai.com/v1",
    models: {
      "gpt-4o": { name: "GPT-4o" },
      "gpt-4o-mini": { name: "GPT-4o Mini" },
    },
  },
  google: {
    name: "Google",
    api: "https://generativelanguage.googleapis.com/v1beta",
    models: { "gemini-2.5-flash": { name: "Gemini 2.5 Flash" } },
  },
  moonshotai: {
    name: "Moonshot AI",
    api: "https://api.moonshot.ai/v1",
    models: { "kimi-k2": { name: "Kimi K2" } },
  },
  zeta: { name: "Zeta AI", api: "https://api.zeta.example/v1", models: { z1: { name: "Zeta One" } } },
  alpha: { name: "Alpha Labs", api: "https://api.alpha.example/v1", models: { a1: { name: "Alpha One" } } },
  templated: { name: "Templated", api: "https://${HOST}/v1", models: { t1: { name: "T One" } } },
  noapi: { name: "No API", models: { n1: { name: "N One" } } },
  idonly: { api: "https://api.idonly.example/v1", models: {} },
};

/** Case-insensitive label order — the same contract the conformance validator enforces. */
const byLabel = (values: string[]) => [...values].sort((a, b) => {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (left === right) return 0;
  return left < right ? -1 : 1;
});

describe("projectProviders", () => {
  it("merges built-ins and models.dev entries into ONE list sorted by visible label", () => {
    const out = projectProviders({ data: DATA, builtIns: BUILT_INS, selectedId: "openai", resolveId });
    expect(out.map((p) => p.label)).toEqual(byLabel(out.map((p) => p.label)));
    // No grouping: a catalogue entry sorts ahead of built-ins and a built-in
    // sorts ahead of a catalogue entry — the two sources interleave.
    const ids = out.map((p) => p.id);
    expect(ids.indexOf("alpha")).toBeLessThan(ids.indexOf("google-gemini"));
    expect(ids.indexOf("google-gemini")).toBeLessThan(ids.indexOf("zeta"));
    expect(out.find((p) => p.id === "alpha")?.source).toBe("models.dev");
    expect(out.find((p) => p.id === "google-gemini")?.source).toBe("built-in");
  });

  it("contains no separator, divider or disabled placeholder entry", () => {
    const out = projectProviders({ data: DATA, builtIns: BUILT_INS, selectedId: "openai", resolveId });
    for (const option of out) {
      expect(option.label).not.toMatch(/─{2,}|separator|divider|^more\b/i);
      expect(option.id).not.toMatch(/^__(separator|more)__$/);
      expect(option).not.toHaveProperty("disabled");
    }
  });

  it("lists every built-in and every distinct catalogue provider exactly once", () => {
    const out = projectProviders({ data: DATA, builtIns: BUILT_INS, selectedId: "openai", resolveId });
    const ids = out.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["openai", "google-gemini", "moonshot"]));
    expect(ids).toEqual(expect.arrayContaining(["alpha", "idonly", "zeta"]));
  });

  it("dedupes catalogue entries that alias a built-in provider", () => {
    const out = projectProviders({ data: DATA, builtIns: BUILT_INS, selectedId: "openai", resolveId });
    const ids = out.map((p) => p.id);
    expect(ids).not.toContain("google");
    expect(ids).not.toContain("moonshotai");
    // openai exists once (as the built-in, not twice)
    expect(ids.filter((id) => id === "openai")).toHaveLength(1);
  });

  it("skips providers whose api is missing or templated", () => {
    const out = projectProviders({ data: DATA, builtIns: BUILT_INS, selectedId: "openai", resolveId });
    const ids = out.map((p) => p.id);
    expect(ids).not.toContain("templated");
    expect(ids).not.toContain("noapi");
  });

  it("falls back to the id when a provider has no name, and sorts an unknown selection into place", () => {
    const out = projectProviders({
      data: DATA,
      builtIns: BUILT_INS,
      selectedId: "legacy-provider",
      resolveId,
    });
    expect(out.find((p) => p.id === "idonly")?.label).toBe("idonly");
    expect(out.some((p) => p.id === "legacy-provider")).toBe(true);
    // Still one alphabetical list — the kept entry is not tacked on at the end.
    expect(out.map((p) => p.label)).toEqual(byLabel(out.map((p) => p.label)));
  });

  it("works with no catalogue data at all (offline)", () => {
    const out = projectProviders({ data: null, builtIns: BUILT_INS, selectedId: "openai", resolveId });
    expect(out.map((p) => p.label)).toEqual(byLabel(BUILT_INS.map((p) => p.name)));
    expect(out.every((p) => p.source === "built-in")).toBe(true);
  });
});

describe("modelsForProvider", () => {
  it("resolves the internal provider id through the alias map and sorts by label", () => {
    const out = modelsForProvider({ provider: "google-gemini", data: DATA, resolveId });
    expect(out).toEqual([
      { value: "gemini-2.5-flash", text: "Gemini 2.5 Flash" },
      { value: CUSTOM_MODEL_VALUE, text: "Custom model" },
    ]);

    const openai = modelsForProvider({ provider: "openai", data: DATA, resolveId });
    expect(openai.map((m) => m.text)).toEqual(["GPT-4o", "GPT-4o Mini", "Custom model"]);
  });

  it("always puts the custom model id last, whatever its label collates to", () => {
    const out = modelsForProvider({ provider: "openai", data: DATA, resolveId, t: () => "Custom…" });
    expect(out[out.length - 1].value).toBe(CUSTOM_MODEL_VALUE);
    expect(out.slice(0, -1).map((m) => m.text)).toEqual(["GPT-4o", "GPT-4o Mini"]);
  });

  it("falls back to the model id when it has no name", () => {
    const out = modelsForProvider({ provider: "idonly", data: { idonly: { api: "https://x/v1", models: { m: {} } } }, resolveId });
    expect(out).toEqual([
      { value: "m", text: "m" },
      { value: CUSTOM_MODEL_VALUE, text: "Custom model" },
    ]);
  });

  it("returns only the custom entry for unknown providers or missing data", () => {
    expect(modelsForProvider({ provider: "nope", data: DATA, resolveId })).toEqual([
      { value: CUSTOM_MODEL_VALUE, text: "Custom model" },
    ]);
    expect(modelsForProvider({ provider: "openai", data: null, resolveId })).toEqual([
      { value: CUSTOM_MODEL_VALUE, text: "Custom model" },
    ]);
  });
});

describe("languageOptions", () => {
  it("sorts by name, labels with the code, drops auto and keeps an unknown current value", () => {
    const names = { en: "English", "zh-CN": "Chinese (Simplified)", ja: "Japanese", auto: "Detect" };
    const out = languageOptions({ names, current: "ko" });
    expect(out.map((o) => o.text)).toEqual([
      "Chinese (Simplified) (zh-CN)",
      "English (en)",
      "Japanese (ja)",
      "ko",
    ]);
    expect(out.map((o) => o.value)).not.toContain("auto");
  });

  it("does not duplicate the current value when it is already listed", () => {
    const out = languageOptions({ names: { en: "English" }, current: "en" });
    expect(out).toEqual([{ value: "en", text: "English (en)" }]);
  });
});

describe("pickModelForProvider", () => {
  const models = [
    { value: "a", text: "A" },
    { value: "b", text: "B" },
  ];
  const smartDefault = (args: { provider: string; models: { value: string }[] }) =>
    args.models.some((m) => m.value === "b") ? "b" : null;

  it("keeps the current model when the provider still lists it", () => {
    expect(pickModelForProvider({ models, current: "a", provider: "p", smartDefault })).toBe("a");
  });

  it("falls back to the smart default, then the first model", () => {
    expect(pickModelForProvider({ models, current: "gone", provider: "p", smartDefault })).toBe("b");
    expect(
      pickModelForProvider({ models, current: "gone", provider: "p", smartDefault: () => null })
    ).toBe("a");
  });

  it("returns an empty string when there is nothing to pick", () => {
    expect(pickModelForProvider({ models: [], current: "x", provider: "p", smartDefault })).toBe("");
  });
});

describe("summarizeCatalog", () => {
  it("reports offline when there is no data", () => {
    expect(summarizeCatalog(null)).toEqual({ providerCount: 0, modelCount: 0, offline: true });
  });

  it("counts providers and models", () => {
    expect(summarizeCatalog(DATA)).toEqual({ providerCount: 8, modelCount: 8, offline: false });
  });
});

describe("effectiveBaseUrl", () => {
  it("strips /chat/completions from a built-in endpoint", () => {
    expect(effectiveBaseUrl({ provider: "openai", data: null, builtIns: BUILT_INS, resolveId })).toBe(
      "https://api.openai.com/v1"
    );
  });

  it("prefers the catalogue endpoint for catalogue-only providers", () => {
    expect(effectiveBaseUrl({ provider: "zeta", data: DATA, builtIns: BUILT_INS, resolveId })).toBe(
      "https://api.zeta.example/v1"
    );
  });

  it("falls back to a built-in endpoint for aliased providers and returns '' when unknown", () => {
    expect(effectiveBaseUrl({ provider: "google-gemini", data: null, builtIns: BUILT_INS, resolveId })).toBe(
      "https://generativelanguage.googleapis.com/v1beta"
    );
    expect(effectiveBaseUrl({ provider: "nope", data: DATA, builtIns: BUILT_INS, resolveId })).toBe("");
  });
});

describe("resolveEndpointOnProviderChange", () => {
  const OPENAI = "https://api.openai.com/v1";
  const DEEPSEEK = "https://api.deepseek.com/v1";

  it("fills the new provider's default when the box is empty", () => {
    expect(
      resolveEndpointOnProviderChange({ current: "", previousDefault: "", nextDefault: DEEPSEEK })
    ).toBe(DEEPSEEK);
  });

  it("moves an untouched box (still holding the previous default) to the new default", () => {
    expect(
      resolveEndpointOnProviderChange({ current: OPENAI, previousDefault: OPENAI, nextDefault: DEEPSEEK })
    ).toBe(DEEPSEEK);
  });

  it("compares against the normalized previous default (trailing slash, /chat/completions)", () => {
    expect(
      resolveEndpointOnProviderChange({
        current: "https://api.openai.com/v1/chat/completions",
        previousDefault: "https://api.openai.com/v1/",
        nextDefault: DEEPSEEK,
      })
    ).toBe(DEEPSEEK);
  });

  it("never overwrites a value the user typed themselves", () => {
    const typed = "https://proxy.example/v1";
    expect(
      resolveEndpointOnProviderChange({ current: typed, previousDefault: OPENAI, nextDefault: DEEPSEEK })
    ).toBe(typed);
    expect(
      resolveEndpointOnProviderChange({ current: typed, previousDefault: "", nextDefault: DEEPSEEK })
    ).toBe(typed);
  });

  it("returns an empty string when the new provider has no api base", () => {
    expect(
      resolveEndpointOnProviderChange({ current: OPENAI, previousDefault: OPENAI, nextDefault: "" })
    ).toBe("");
  });
});

describe("normalizeApiBase", () => {
  it("trims slashes and drops a /chat/completions suffix", () => {
    expect(normalizeApiBase(" https://api.openai.com/v1/chat/completions ")).toBe("https://api.openai.com/v1");
    expect(normalizeApiBase("https://api.openai.com/v1///")).toBe("https://api.openai.com/v1");
    expect(normalizeApiBase(undefined)).toBe("");
  });
});

describe("constants", () => {
  it("exposes the sentinel value for the custom model id", () => {
    expect(CUSTOM_MODEL_VALUE.startsWith("__")).toBe(true);
  });
});

describe("modelReasoningOptions", () => {
  const REASONING_DATA = {
    openai: {
      api: "https://api.openai.com/v1",
      models: {
        "gpt-5": {
          name: "GPT-5",
          reasoning_options: [{ type: "effort", values: ["minimal", "low", "medium", "high"] }],
        },
        "gpt-4o": { name: "GPT-4o" },
      },
    },
    google: {
      api: "https://generativelanguage.googleapis.com/v1beta",
      models: {
        "gemini-2.5-flash": {
          name: "Gemini 2.5 Flash",
          reasoning_options: [{ type: "toggle" }, { type: "budget_tokens", min: 0, max: 24576 }],
        },
      },
    },
  };

  it("returns the model's declared reasoning options", () => {
    const options = modelReasoningOptions({
      data: REASONING_DATA as any,
      resolveId,
      provider: "openai",
      model: "gpt-5",
    });
    expect(options).toEqual([{ type: "effort", values: ["minimal", "low", "medium", "high"] }]);
  });

  it("returns an empty list for models without reasoning support or unknown ids", () => {
    expect(
      modelReasoningOptions({ data: REASONING_DATA as any, resolveId, provider: "openai", model: "gpt-4o" })
    ).toEqual([]);
    expect(
      modelReasoningOptions({ data: REASONING_DATA as any, resolveId, provider: "openai", model: "nope" })
    ).toEqual([]);
    expect(modelReasoningOptions({ data: null, resolveId, provider: "openai", model: "gpt-5" })).toEqual([]);
  });

  it("resolves provider aliases before looking the model up", () => {
    const options = modelReasoningOptions({
      data: REASONING_DATA as any,
      resolveId,
      provider: "google-gemini",
      model: "gemini-2.5-flash",
    });
    expect(options[0]).toMatchObject({ type: "toggle" });
  });
});

describe("resolveReasoningDepth", () => {
  const opts = (...values: string[]) => values.map((value) => ({ value }));
  const lowest = (values: string[]) => resolveReasoningDepth({ setting: LOWEST_REASONING, options: opts(...values) });

  it("maps the lowest sentinel onto the lowest accepted explicit level", () => {
    expect(lowest(["", "minimal", "low", "medium", "high"])).toBe("minimal");
    expect(lowest(["", "low", "medium"])).toBe("low");
    expect(lowest(["", "none", "high"])).toBe("none");
    expect(lowest(["", "low", "none"])).toBe("none");
  });

  it("sends nothing when the only explicit level is a toggle-on value", () => {
    expect(lowest(["", "high"])).toBe("");
    expect(lowest([""])).toBe("");
    expect(lowest([])).toBe("");
  });

  it("passes explicit choices through and keeps provider default empty", () => {
    expect(resolveReasoningDepth({ setting: "medium", options: opts("", "minimal", "medium") })).toBe("medium");
    expect(resolveReasoningDepth({ setting: "", options: opts("", "low") })).toBe("");
  });
});

describe("reasoningDepthChoices", () => {
  it("puts Lowest first, then Provider default, then the explicit levels", () => {
    const choices = reasoningDepthChoices({
      options: [
        { value: "", label: "Default" },
        { value: "minimal", label: "Minimal" },
        { value: "low", label: "Low" },
      ],
    });
    expect(choices.map((c) => c.value)).toEqual([LOWEST_REASONING, "", "minimal", "low"]);
    expect(choices[0].text).toBe("Lowest (default)");
    expect(choices[1].text).toBe("Provider default");
  });

  it("keeps only the two special entries when the model declares nothing", () => {
    const choices = reasoningDepthChoices({ options: [{ value: "", label: "Default" }] });
    expect(choices.map((c) => c.value)).toEqual([LOWEST_REASONING, ""]);
  });
});
