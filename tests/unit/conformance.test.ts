/**
 * Host conformance gate (SPEC 2.1.0).
 *
 * Builds the shared payload contract from the REAL settings surface — the same
 * pure functions `src/main.ts` renders with, the shipped locale files and the
 * vendored core's built-in registry / alias map — then runs `validatePayload`
 * against it. No network: the models.dev payload comes from `tests/fixtures/`.
 *
 * Two states are shipped: the unconfigured one a fresh install shows (provider
 * `""`, disabled model/reasoning pickers, empty endpoint) and the configured
 * one after a provider is chosen. `buildPayload` emits the configured state —
 * the conformance contract's own scenario — while `buildUnconfiguredPayload`
 * proves the empty state validates under the same rules.
 *
 * This file doubles as the `npm run conformance` payload generator
 * (`conformance.json.payload`).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import * as catalog from "../../src/catalog";
import { LOCALE_CODES } from "../../src/i18n";
import { DEFAULT_SETTINGS, LOWEST_REASONING } from "../../src/settings";
// @ts-expect-error — the conformance kit is plain ESM JavaScript.
import { SPEC_VERSION, selfTest, validatePayload } from "../../scripts/conformance/validate.mjs";
// @ts-expect-error — plain ESM JavaScript.
import { scanFiles } from "../../scripts/conformance/scan.mjs";
import { coreNamespace } from "../../src/coreAdapter";

type ModelsDevData = catalog.ModelsDevData;
type ProviderDef = catalog.ProviderDef;

/**
 * Read the catalogue through the module namespace, not named imports: the gate
 * must observe the source as it is on disk right now (a named-import cache hit
 * across a mid-session edit would validate a stale copy of the settings surface).
 */
const {
  CUSTOM_MODEL_VALUE,
  CUSTOM_PROVIDER_ID,
  endpointState,
  languageOptions,
  modelPickerState,
  modelsForProvider,
  projectProviders,
  providerIsUnconfigured,
  providerPlaceholderOption,
  providerPickerOptions,
  reasoningDepthChoices,
  resolveEndpointOnProviderChange,
  resolveReasoningDepth,
} = catalog;

/**
 * Repo root. Under vitest this resolves from the test file's location; the
 * `npm run conformance` payload command bundles this module into
 * `scripts/conformance/`, so it passes the root explicitly via
 * `DUALTRAN_REPO_ROOT`.
 */
const ROOT = process.env.DUALTRAN_REPO_ROOT
  ? path.resolve(process.env.DUALTRAN_REPO_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "dualtran-obsidian";

/** Locale files shipped next to the bundle (the same copy `scripts/build-i18n.mjs` embeds). */
const LOCALES_DIR = path.join(ROOT, "locales");

interface LocaleCatalogue {
  [key: string]: { message?: string };
}

function readJson(relative: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

function localeMessages(locale: string): Record<string, string> {
  const raw = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, locale, "messages.json"), "utf8")
  ) as LocaleCatalogue;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw || {})) {
    if (entry && typeof entry.message === "string") out[key] = entry.message;
  }
  return out;
}

/** English source strings — the pane passes `plugin.t` in the real app. */
const EN = localeMessages("en");
const t = (key: string): string => EN[key] ?? key;

/** i18n keys `src/main.ts` actually renders (the setting pane + the commands). */
function usedKeys(): string[] {
  const source = fs.readFileSync(path.join(ROOT, "src", "main.ts"), "utf8");
  const keys = new Set<string>();
  for (const match of source.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) keys.add(match[1]);
  return [...keys].sort();
}

const ALIASES = readJson("tests/fixtures/conformance/provider-aliases.json") as Record<string, string>;
const resolveId = (id: string): string => {
  if (ALIASES[id]) return ALIASES[id];
  try {
    const core = coreNamespace as unknown as { resolveModelsDevId?: (value: string) => string };
    const resolved = typeof core.resolveModelsDevId === "function" ? core.resolveModelsDevId(id) : id;
    return typeof resolved === "string" && resolved ? resolved : id;
  } catch {
    return id;
  }
};

/** Built-in registry exactly as the settings pane reads it (vendor tarball, no network). */
const BUILT_INS: ProviderDef[] = (() => {
  const core = coreNamespace as unknown as { BUILT_IN_PROVIDERS?: ProviderDef[] };
  return Array.isArray(core.BUILT_IN_PROVIDERS) ? core.BUILT_IN_PROVIDERS : [];
})();

const DATA = readJson("tests/fixtures/conformance/models-dev-sample.json") as ModelsDevData;
const LANGUAGE_NAMES = readJson("tests/fixtures/conformance/language-names.json") as Record<string, string>;

/** Real provider list exactly as the picker projects it (custom entry last). */
function pickerProviders(selectedId: string) {
  return providerPickerOptions({ data: DATA, builtIns: BUILT_INS, selectedId, resolveId, t });
}

/** The provider scenario ends on — a catalogue provider with a usable api. */
function endpointProvider(data: ModelsDevData): { id: string; api: string } {
  for (const [id, entry] of Object.entries(data)) {
    const api = String(entry?.api || "").trim();
    if (api && /^https?:\/\//i.test(api) && !/\$\{/.test(api)) return { id, api };
  }
  throw new Error("models-dev-sample.json has no provider with a usable api");
}

function endpointScenario(data: ModelsDevData): Record<string, unknown> {
  const target = endpointProvider(data);
  const provider = pickerProviders("").find((option) => option.id === target.id);
  if (!provider) throw new Error(`provider ${target.id} is not in the projected list`);

  const apiOf = (id: string): string => endpointState({ provider: id, stored: "", data, builtIns: BUILT_INS, resolveId }).value;
  const switched = pickerProviders("")
    .map((option) => option.id)
    .filter((id) => id !== CUSTOM_PROVIDER_ID && id !== target.id)
    .find((id) => apiOf(id) && apiOf(id) !== apiOf(target.id));
  if (!switched) throw new Error("no second provider with a distinct endpoint to switch to");

  // The pane's endpoint input while still unconfigured (fresh install).
  const empty = endpointState({ provider: "", stored: "" });
  // R3: the provider change writes the api into the *value* of the box.
  const after = resolveEndpointOnProviderChange({
    current: empty.value,
    previousDefault: "",
    nextDefault: apiOf(target.id),
  });
  // …then the user edits it and switches provider: the override must survive.
  const userEdited = "https://proxy.example/v1";
  const afterSwitch = resolveEndpointOnProviderChange({
    current: userEdited,
    previousDefault: apiOf(target.id),
    nextDefault: apiOf(switched),
  });

  return {
    provider: target.id,
    providerApi: apiOf(target.id),
    before: empty.value,
    after,
    userEdited,
    afterSwitch,
  };
}

function reasoningCases(options: string[]): Array<{ setting: string; options: string[]; value: string }> {
  // `resolveReasoningDepth` takes `{ value }` entries, not raw strings.
  const entries = options.map((value) => ({ value }));
  return [
    {
      setting: LOWEST_REASONING,
      options,
      value: resolveReasoningDepth({ setting: LOWEST_REASONING, options: entries }),
    },
  ];
}

function localeMatrix() {
  const locales = [...LOCALE_CODES];
  const files: Record<string, Record<string, string>> = {};
  for (const locale of locales) files[locale] = localeMessages(locale);
  const keys = Object.keys(files.en || {}).sort();
  const referenced = usedKeys();
  const missing = referenced.filter((key) => !keys.includes(key));
  if (missing.length) throw new Error(`main.ts uses undeclared i18n keys: ${missing.join(", ")}`);
  return { locales, files, keys, referenced };
}

function byProviderMap() {
  const byProvider: Record<string, Array<{ value: string; label: string }>> = {};
  for (const provider of pickerProviders("")) {
    // The conformance contract owns the alphabetical list, so it sees the
    // catalogue entries only. The shipped picker still appends the free-text
    // entry last — asserted separately in `customModelLast()` below.
    const models = modelsForProvider({ provider: provider.id, data: DATA, resolveId }).filter(
      (model) => model.value !== CUSTOM_MODEL_VALUE
    );
    if (models.length === 0) continue;
    byProvider[provider.id] = models.map((model) => ({ value: model.value, label: model.text }));
  }
  return byProvider;
}

function staticHits(): unknown[] {
  const staticConfig = readJson("conformance.json") as { static?: { files?: string[]; patterns?: string[] } };
  return staticConfig.static ? scanFiles(ROOT, staticConfig.static) : [];
}

/**
 * Unconfigured payload: exactly what a fresh install renders before the user
 * picks a provider. `current` is "" and the placeholder is selected+disabled.
 */
export async function buildUnconfiguredPayload(): Promise<Record<string, unknown>> {
  const providers = pickerProviders("");
  const byProvider = byProviderMap();
  const i18n = localeMatrix();
  const endpoint = endpointState({ provider: "", stored: "" });
  const model = modelPickerState({ provider: "", current: "", data: DATA, resolveId, t });
  const reasoningChoices = reasoningDepthChoices({ options: [], t });
  const reasoning = {
    control: "select",
    disabled: true,
    default: LOWEST_REASONING,
    placeholder: t("providerRequiredForModel"),
    options: reasoningChoices.map((choice) => ({ value: choice.value, label: choice.text })),
    stored: DEFAULT_SETTINGS.aiReasoningDepth,
    resolved: {
      none: reasoningCases(["none", "minimal", "low"]),
      minimal: reasoningCases(["minimal", "low", "medium"]),
      low: reasoningCases(["low", "medium", "high"]),
      "none-declared": reasoningCases(["high"]),
    },
  };

  return {
    spec: SPEC_VERSION,
    host: HOST,
    state: "unconfigured",
    version: packageJson.version,
    language: {
      control: "select",
      current: "en",
      options: languageOptions({ names: LANGUAGE_NAMES, current: "en" }).map((option) => ({
        value: option.value,
        label: option.text,
      })),
    },
    provider: {
      control: "select",
      current: "",
      placeholder: {
        ...providerPlaceholderOption({ t }),
        selected: true,
      },
      fallback: "",
      options: providers.map((option) => ({ value: option.id, label: option.label, source: option.source })),
    },
    model: {
      control: "select",
      disabled: model.disabled,
      selectedProvider: "",
      selectedModel: "",
      placeholder: model.placeholder,
      options: model.options,
      byProvider,
    },
    endpoint: {
      control: "input",
      current: endpoint.value,
      placeholder: endpoint.placeholder,
      autofill: endpointScenario(DATA),
    },
    reasoning,
    i18n: {
      locales: i18n.locales,
      keys: i18n.keys,
      sourceLocale: "en",
      used: i18n.referenced,
      files: i18n.files,
    },
    static: { hits: staticHits() },
  };
}

/** Configured payload: the scenario after the user picked a provider. */
export async function buildPayload(): Promise<Record<string, unknown>> {
  const scenario = endpointScenario(DATA);
  const selectedProvider = scenario.provider as string;
  const providers = pickerProviders(selectedProvider);
  const byProvider = byProviderMap();
  const selectedModels = byProvider[selectedProvider] || [];
  const selectedModel = selectedModels[0]?.value ?? "";
  const i18n = localeMatrix();
  const endpoint = endpointState({
    provider: selectedProvider,
    stored: "",
    data: DATA,
    builtIns: BUILT_INS,
    resolveId,
  });
  const model = modelPickerState({
    provider: selectedProvider,
    current: selectedModel,
    data: DATA,
    resolveId,
    t,
  });

  return {
    spec: SPEC_VERSION,
    host: HOST,
    state: "configured",
    version: packageJson.version,
    language: {
      control: "select",
      current: "en",
      options: languageOptions({ names: LANGUAGE_NAMES, current: "en" }).map((option) => ({
        value: option.value,
        label: option.text,
      })),
    },
    provider: {
      control: "select",
      current: selectedProvider,
      placeholder: {
        ...providerPlaceholderOption({ t }),
        selected: false,
      },
      fallback: "",
      options: providers.map((option) => ({ value: option.id, label: option.label, source: option.source })),
    },
    model: {
      control: "select",
      disabled: model.disabled,
      selectedProvider,
      selectedModel,
      placeholder: model.placeholder,
      options: selectedModels.map((option) => ({ value: option.value, label: option.label })),
      byProvider,
    },
    endpoint: {
      control: "input",
      current: endpoint.value,
      placeholder: endpoint.placeholder,
      autofill: scenario,
    },
    reasoning: {
      control: "select",
      disabled: false,
      default: LOWEST_REASONING,
      resolved: {
        none: reasoningCases(["none", "minimal", "low"]),
        minimal: reasoningCases(["minimal", "low", "medium"]),
        low: reasoningCases(["low", "medium", "high"]),
        "none-declared": reasoningCases(["high"]),
      },
    },
    i18n: {
      locales: i18n.locales,
      keys: i18n.keys,
      sourceLocale: "en",
      used: i18n.referenced,
      files: i18n.files,
    },
    static: { hits: staticHits() },
  };
}

export default buildPayload;

const CONFIG = () => readJson("conformance.json") as Record<string, unknown>;

describe("host conformance (SPEC 2.1.0)", () => {
  it("catches every negative control before trusting the payload", () => {
    expect(SPEC_VERSION).toBe("2.1.0");
    expect(selfTest()).toBeGreaterThanOrEqual(15);
  });

  it("pins the free-text model entry last for every provider (R2)", () => {
    const providers = projectProviders({ data: DATA, builtIns: BUILT_INS, selectedId: "", resolveId });
    let checked = 0;
    for (const provider of providers) {
      const models = modelsForProvider({ provider: provider.id, data: DATA, resolveId });
      if (models.length < 2) continue;
      expect(models[models.length - 1].value).toBe(CUSTOM_MODEL_VALUE);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps the custom provider last and off the alphabetical list (R2)", () => {
    const providers = pickerProviders("");
    const custom = providers.filter((option) => option.source === "custom");
    expect(custom.map((option) => option.id)).toEqual([CUSTOM_PROVIDER_ID]);
    expect(providers[providers.length - 1].id).toBe(CUSTOM_PROVIDER_ID);
  });

  it("validates the unconfigured payload (empty provider, disabled pickers)", async () => {
    const payload = await buildUnconfiguredPayload();
    const summary = validatePayload(payload, CONFIG());
    expect(summary).toMatchObject({ host: HOST, spec: SPEC_VERSION, localeCount: 38 });
    expect(summary.providers).toBeGreaterThanOrEqual(5);
    expect(summary.languages).toBeGreaterThanOrEqual(30);

    const provider = payload.provider as {
      current: string;
      placeholder: { value: string; label: string; disabled: boolean; selected: boolean };
      fallback: string;
      options: Array<{ value: string }>;
    };
    expect(provider.current).toBe("");
    expect(provider.placeholder).toEqual({
      value: "",
      label: "Select a provider",
      disabled: true,
      selected: true,
    });
    expect(provider.fallback).toBe("");
    expect(provider.options.some((option) => option.value === "")).toBe(false);

    const model = payload.model as { disabled: boolean; options: unknown[]; selectedProvider: string };
    expect(model.disabled).toBe(true);
    expect(model.options).toEqual([]);
    expect(model.selectedProvider).toBe("");

    const endpoint = payload.endpoint as { current: string; placeholder: string };
    expect(endpoint.current).toBe("");
    expect(endpoint.placeholder).toBe("https://");

    const reasoning = payload.reasoning as { disabled: boolean; default: string; stored: string };
    expect(reasoning.disabled).toBe(true);
    expect(reasoning.default).toBe(LOWEST_REASONING);
    expect(reasoning.stored).toBe(LOWEST_REASONING);
  });

  it("validates the configured payload (provider chosen)", async () => {
    const payload = await buildPayload();
    const summary = validatePayload(payload, CONFIG());
    expect(summary).toMatchObject({ host: HOST, spec: SPEC_VERSION, localeCount: 38 });

    const provider = payload.provider as {
      current: string;
      placeholder: { selected: boolean };
      options: Array<{ value: string }>;
    };
    // The endpoint scenario picks the first catalogue provider with a usable
    // api (DeepSeek in the sample); any real provider must be in the picker.
    expect(provider.current).not.toBe("");
    expect(provider.options.some((option) => option.value === provider.current)).toBe(true);
    expect(provider.placeholder.selected).toBe(false);

    const model = payload.model as { disabled: boolean; selectedProvider: string };
    expect(model.disabled).toBe(false);
    expect(model.selectedProvider).toBe(provider.current);

    const endpoint = payload.endpoint as { current: string; autofill: { providerApi: string } };
    expect(endpoint.current).toBe(endpoint.autofill.providerApi);

    const reasoning = payload.reasoning as { disabled: boolean };
    expect(reasoning.disabled).toBe(false);
  });

  it("writes the provider api into the endpoint value, not a placeholder (R3)", async () => {
    const payload = (await buildPayload()) as {
      endpoint: { autofill: { before: string; after: string; providerApi: string; afterSwitch: string; userEdited: string } };
    };
    const { before, after, providerApi, afterSwitch, userEdited } = payload.endpoint.autofill;
    // A fresh install holds an empty box…
    expect(before).toBe("");
    // …and the pane fills it with the provider api as the *value*.
    expect(after).toMatch(/^https:\/\//);
    expect(after).toBe(providerApi);
    // A typed override survives a provider switch.
    expect(afterSwitch).toBe(userEdited);
    // The pane must write the default into the value: a placeholder alone fails this.
    const source = fs.readFileSync(path.join(ROOT, "src", "main.ts"), "utf8");
    expect(source).not.toMatch(/setPlaceholder\(\s*defaultBaseUrl/);
  });

  it("keeps the empty state free of OpenAI endpoints and models (SPEC 2.1)", async () => {
    const payload = await buildUnconfiguredPayload();
    const endpoint = payload.endpoint as { current: unknown; placeholder: unknown };
    expect(endpoint.current).toBe("");
    const model = payload.model as { options: unknown[]; selectedModel: string; selectedProvider: string };
    expect(model.options).toEqual([]);
    expect(model.selectedModel).toBe("");
    expect(model.selectedProvider).toBe("");
    // The *selected* state carries no OpenAI endpoint or model. The picker
    // still lists OpenAI as a real, choosable provider, and byProvider keeps
    // its catalogue models — those are options, not defaults.
    const selected = JSON.stringify({
      current: (payload.provider as { current: string }).current,
      fallback: (payload.provider as { fallback: string }).fallback,
      model: { options: model.options, selectedModel: model.selectedModel },
      endpoint: { current: endpoint.current, placeholder: endpoint.placeholder },
      reasoning: (payload.reasoning as { default: string }).default,
    });
    expect(selected).not.toMatch(/api\.openai\.com/);
    expect(selected).not.toMatch(/gpt-/i);
    expect((payload.provider as { fallback: string }).fallback).toBe("");
  });

  it("refuses to translate with an empty provider (providerRequiredError, no fetch)", async () => {
    const { createBridge } = await import("../../src/bridge");
    const core = {
      translateGoogle: async () => [] as string[],
      streamChat: async () => {
        throw new Error("streamChat must not run without a provider");
      },
      buildTranslationMessages: () => ({ system: "", assistant: "" }),
      codeToLanguageNameInEnglish: () => "",
      formatAiError: () => ({ message: "" }),
    };
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      throw new Error("no network in conformance");
    };
    const bridge = createBridge({
      core: core as never,
      fetchImpl: fetchImpl as never,
      getSettings: () => ({ ...DEFAULT_SETTINGS, engine: "ai" }),
      providerRequiredError: () => EN.providerRequiredError,
    });
    await expect(bridge.translateBlocks(["Hello"])).rejects.toThrow(EN.providerRequiredError);
    expect(calls).toBe(0);
  });

  it("carries the three provider i18n keys in every locale (R5)", async () => {
    const EN_STRINGS = {
      providerPlaceholder: "Select a provider",
      providerRequiredForModel: "Select a provider first",
      providerRequiredError: "Choose an AI provider in settings before translating.",
    } as const;
    const files = (await buildUnconfiguredPayload()).i18n as { locales: string[]; files: Record<string, Record<string, string>> };
    for (const locale of files.locales) {
      for (const [key, expected] of Object.entries(EN_STRINGS)) {
        expect(typeof files.files[locale][key], `${locale}: ${key}`).toBe("string");
        expect(files.files[locale][key].trim().length, `${locale}: ${key}`).toBeGreaterThan(0);
        if (locale === "en") expect(files.files[locale][key]).toBe(expected);
      }
    }
    expect(files.files.zh_CN.providerPlaceholder).toBe("请选择 AI 提供商");
    expect(files.files.zh_CN.providerRequiredForModel).toBe("请先选择提供商");
    expect(files.files.zh_CN.providerRequiredError).toBe("翻译前请先在设置中选择 AI 提供商。");
  });

  it("never falls back to openai or a custom provider on a request path", () => {
    for (const file of ["src/bridge.ts", "src/main.ts", "src/settings.ts"]) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      expect(source, `${file}: openai fallback`).not.toMatch(/\|\|\s*["']openai["']/);
      expect(source, `${file}: custom provider fallback`).not.toMatch(/\|\|\s*CUSTOM_PROVIDER_ID/);
    }
    // Every settings string goes through the translator.
    expect(fs.readFileSync(path.join(ROOT, "src", "settings.ts"), "utf8")).not.toMatch(/\|\|\s*"openai"/);
    expect(providerIsUnconfigured(DEFAULT_SETTINGS.aiProvider)).toBe(true);
  });
});
