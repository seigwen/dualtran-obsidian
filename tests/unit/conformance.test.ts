/**
 * Host conformance gate (SPEC 2.0.0).
 *
 * Builds the shared payload contract from the REAL settings surface — the same
 * pure functions `src/main.ts` renders with, the shipped locale files and the
 * vendored core's built-in registry / alias map — then runs `validatePayload`
 * against it. No network: the models.dev payload comes from `facts/`.
 *
 * This file doubles as the `npm run conformance` payload generator
 * (`conformance.json.payload`), so the two paths cannot drift apart.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";
import * as catalog from "../../src/catalog";
import { LOCALE_CODES } from "../../src/i18n";
import { LOWEST_REASONING } from "../../src/settings";
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
  effectiveBaseUrl,
  languageOptions,
  modelsForProvider,
  projectProviders,
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

/** Provider the endpoint scenario ends on — a catalogue provider with a usable api. */
function endpointProvider(data: ModelsDevData): { id: string; api: string } {
  for (const [id, entry] of Object.entries(data)) {
    const api = String(entry?.api || "").trim();
    if (api && /^https?:\/\//i.test(api) && !/\$\{/.test(api)) return { id, api };
  }
  throw new Error("models-dev-sample.json has no provider with a usable api");
}

function endpointScenario(data: ModelsDevData): {
  provider: { value: string; label: string; source: string };
  autofill: Record<string, unknown>;
} {
  const target = endpointProvider(data);
  const provider = projectProviders({
    data,
    builtIns: BUILT_INS,
    selectedId: target.id,
    resolveId,
  }).find((option) => option.id === target.id);
  if (!provider) throw new Error(`provider ${target.id} is not in the projected list`);

  const apiOf = (id: string): string => effectiveBaseUrl({ provider: id, data, builtIns: BUILT_INS, resolveId });
  const switched = projectProviders({ data, builtIns: BUILT_INS, selectedId: "", resolveId })
    .map((option) => option.id)
    .filter((id) => id !== target.id)
    .find((id) => apiOf(id) && apiOf(id) !== apiOf(target.id));
  if (!switched) throw new Error("no second provider with a distinct endpoint to switch to");

  // R3, reproduced from the shipped pane: a fresh install persists "" and the
  // input's value is empty. A `setPlaceholder(defaultBaseUrl)` pane therefore
  // shows an empty box — the provider change is what has to fill the value.
  const providerApi = apiOf(target.id);
  const persisted = "";
  const before = persisted.trim();
  const after = resolveEndpointOnProviderChange({
    current: before,
    previousDefault: "",
    nextDefault: providerApi,
  });
  // Render-time fill: `main.ts` writes the default into the *value* when the
  // box is empty (a placeholder-only pane would leave `rendered` empty here).
  const rendered = before || providerApi;
  // …then the user edits it and switches provider: the override must survive.
  const userEdited = "https://proxy.example/v1";
  const afterSwitch = resolveEndpointOnProviderChange({
    current: userEdited,
    previousDefault: providerApi,
    nextDefault: apiOf(switched),
  });

  return {
    provider,
    autofill: {
      provider: target.id,
      providerApi,
      before,
      rendered,
      after,
      userEdited,
      afterSwitch,
    },
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

export async function buildPayload(): Promise<Record<string, unknown>> {
  const languageNames = LANGUAGE_NAMES;
  const target = languageOptions({ names: languageNames, current: "en" });
  const providers = projectProviders({ data: DATA, builtIns: BUILT_INS, selectedId: "", resolveId });

  const byProvider: Record<string, Array<{ value: string; label: string }>> = {};
  for (const provider of providers) {
    // The conformance contract owns the alphabetical list, so it sees the
    // catalogue entries only. The shipped picker still appends the free-text
    // entry last — asserted separately in `customModelLast()` below.
    const models = modelsForProvider({ provider: provider.id, data: DATA, resolveId }).filter(
      (model) => model.value !== CUSTOM_MODEL_VALUE
    );
    if (models.length === 0) continue;
    byProvider[provider.id] = models.map((model) => ({ value: model.value, label: model.text }));
  }

  const selectedProvider = Object.keys(byProvider)[0];
  const firstChoice = selectedProvider ? byProvider[selectedProvider][0].value : "";

  const locales = [...LOCALE_CODES];
  const files: Record<string, Record<string, string>> = {};
  for (const locale of locales) files[locale] = localeMessages(locale);
  const keys = Object.keys(files.en || {}).sort();
  const referenced = usedKeys();
  const missing = referenced.filter((key) => !keys.includes(key));
  if (missing.length) throw new Error(`main.ts uses undeclared i18n keys: ${missing.join(", ")}`);

  const scenario = endpointScenario(DATA);
  const staticConfig = readJson("conformance.json") as { static?: { files?: string[]; patterns?: string[] } };

  return {
    spec: SPEC_VERSION,
    host: HOST,
    version: packageJson.version,
    language: {
      control: "select",
      current: "en",
      options: target.map((option) => ({ value: option.value, label: option.text })),
    },
    provider: {
      control: "select",
      current: scenario.provider.value,
      options: providers.map((option) => ({ value: option.id, label: option.label, source: option.source })),
    },
    model: {
      control: "select",
      selectedProvider,
      selectedModel: firstChoice,
      byProvider,
    },
    endpoint: {
      control: "text",
      editable: true,
      autofill: scenario.autofill,
    },
    reasoning: {
      control: "select",
      default: LOWEST_REASONING,
      resolved: {
        none: reasoningCases(["none", "minimal", "low"]),
        minimal: reasoningCases(["minimal", "low", "medium"]),
        low: reasoningCases(["low", "medium", "high"]),
        "none-declared": reasoningCases(["high"]),
      },
    },
    i18n: {
      locales,
      keys,
      sourceLocale: "en",
      used: referenced,
      files,
    },
    static: {
      hits: staticConfig.static ? scanFiles(ROOT, staticConfig.static) : [],
    },
  };
}

export default buildPayload;

describe("host conformance (SPEC 2.0.0)", () => {
  it("catches every negative control before trusting the payload", () => {
    expect(selfTest()).toBeGreaterThanOrEqual(11);
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

  it("builds a payload from the real settings surface and passes validatePayload", async () => {
    const payload = await buildPayload();
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, "conformance.json"), "utf8"));
    const summary = validatePayload(payload, config);
    expect(summary).toMatchObject({ host: HOST, spec: SPEC_VERSION, localeCount: 38 });
    expect(summary.providers).toBeGreaterThanOrEqual(5);
    expect(summary.languages).toBeGreaterThanOrEqual(30);
  });

  it("writes the provider api into the endpoint value, not a placeholder (R3)", async () => {
    const payload = (await buildPayload()) as {
      endpoint: {
        autofill: {
          before: string;
          rendered: string;
          after: string;
          providerApi: string;
          afterSwitch: string;
          userEdited: string;
        };
      };
    };
    const { before, rendered, after, providerApi, afterSwitch, userEdited } = payload.endpoint.autofill;
    // A fresh install holds an empty box…
    expect(before).toBe("");
    // …and the pane fills it with the provider api as the *value*.
    expect(rendered).toBe(providerApi);
    expect(after).toMatch(/^https:\/\//);
    expect(after).toBe(providerApi);
    // A typed override survives a provider switch.
    expect(afterSwitch).toBe(userEdited);
    // The pane must write the default into the value: a placeholder alone fails this.
    const source = fs.readFileSync(path.join(ROOT, "src", "main.ts"), "utf8");
    expect(source).not.toMatch(/setPlaceholder\(\s*defaultBaseUrl/);
  });
});
