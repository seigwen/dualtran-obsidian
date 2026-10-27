/**
 * Provider / model / language catalogue shaping for the settings pane.
 *
 * Pure functions: the models.dev payload and the core helpers (alias map, smart
 * defaults) are injected, so the unit suite runs without the vendored tarball
 * and without network. The data comes from `core.createModelsDevStore`, which
 * owns the fetch + 24 h cache; this module only decides what the dropdowns show.
 */

import { LOWEST_REASONING } from "./settings";
export { LOWEST_REASONING };

export interface ModelsDevModel {
  id?: string;
  name?: string;
  reasoning_options?: ReasoningOption[];
}

/** models.dev `reasoning_options` entry (`effort` values, `toggle`, `budget_tokens`). */
export interface ReasoningOption {
  type?: string;
  values?: string[];
}

export interface ModelsDevProvider {
  id?: string;
  name?: string;
  api?: string;
  npm?: string;
  models?: Record<string, ModelsDevModel>;
}

export type ModelsDevData = Record<string, ModelsDevProvider>;

export interface ProviderDef {
  id: string;
  name: string;
  apiBase?: string;
}

export interface ProviderOption {
  id: string;
  label: string;
  source: "built-in" | "models.dev";
}

export interface ModelOption {
  value: string;
  text: string;
}

/** Sentinel option that renders a disabled divider inside the provider dropdown. */
export const PROVIDER_SEPARATOR_VALUE = "__separator__";
/** Sentinel option that reveals the free-text model input. */
export const CUSTOM_MODEL_VALUE = "__custom__";

const TEMPLATE_VAR = /\$\{[^}]+\}/;

/** Strip the request path so the value can be used as an SDK base URL. */
export function normalizeApiBase(value: string | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/+$/, "");
}

/** models.dev entries with a templated (`${HOST}`) or missing api cannot be called directly. */
function usableApi(api: string | undefined): string {
  const value = (api || "").trim();
  if (!value || TEMPLATE_VAR.test(value)) return "";
  return value;
}

/**
 * Built-in providers first (registry order), then every models.dev provider that
 * is not the catalogue twin of a built-in (google ↔ google-gemini, xai ↔ grok…),
 * sorted by label. A saved value the catalogue no longer knows stays selectable.
 */
export function projectProviders({
  data,
  builtIns,
  selectedId,
  resolveId,
}: {
  data: ModelsDevData | null;
  builtIns: ProviderDef[];
  selectedId: string;
  resolveId: (id: string) => string;
}): ProviderOption[] {
  const options: ProviderOption[] = builtIns.map((def) => ({
    id: def.id,
    label: def.name,
    source: "built-in",
  }));
  const taken = new Set(options.map((option) => option.id));
  const builtInDevIds = new Set(builtIns.map((def) => resolveId(def.id)));
  const discovered: ProviderOption[] = [];

  for (const [id, info] of Object.entries(data || {})) {
    if (!usableApi(info?.api) || builtInDevIds.has(id) || taken.has(id)) continue;
    const label = (info?.name || info?.id || id).trim() || id;
    discovered.push({ id, label, source: "models.dev" });
    taken.add(id);
  }
  discovered.sort((left, right) => left.label.localeCompare(right.label));
  options.push(...discovered);

  if (selectedId && !taken.has(selectedId)) {
    options.push({ id: selectedId, label: selectedId, source: "models.dev" });
  }
  return options;
}

/** Model candidates for a provider; the internal id is resolved to its models.dev id first. */
export function modelsForProvider({
  provider,
  data,
  resolveId,
}: {
  provider: string;
  data: ModelsDevData | null;
  resolveId: (id: string) => string;
}): ModelOption[] {
  const entry = data?.[resolveId(provider)];
  if (!entry?.models) return [];
  return Object.entries(entry.models)
    .map(([id, model]) => ({ value: id, text: model?.name || model?.id || id }))
    .sort((left, right) => left.text.localeCompare(right.text));
}

/**
 * Target-language options: `Name (code)`, alphabetical, `auto` excluded (it is a
 * source-language concept). A code the table does not know is still selectable.
 */
export function languageOptions({
  names,
  current,
}: {
  names: Record<string, string>;
  current: string;
}): ModelOption[] {
  const options = Object.entries(names || {})
    .filter(([code]) => code !== "auto" && code !== "und")
    .map(([code, name]) => ({ value: code, text: `${name} (${code})` }))
    .sort((left, right) => left.text.localeCompare(right.text));
  if (current && !options.some((option) => option.value === current)) {
    options.push({ value: current, text: current });
  }
  return options;
}

/**
 * Keep the model when the new provider still lists it, otherwise take the smart
 * default, otherwise the first catalogue entry. An empty catalogue yields "" so
 * the caller can show the free-text input instead of inventing an id.
 */
export function pickModelForProvider({
  models,
  current,
  provider,
  smartDefault,
}: {
  models: ModelOption[];
  current: string;
  provider: string;
  smartDefault: (args: { provider: string; models: ModelOption[] }) => string | null;
}): string {
  if (models.length === 0) return "";
  if (current && models.some((model) => model.value === current)) return current;
  const preferred = smartDefault({ provider, models });
  if (preferred && models.some((model) => model.value === preferred)) return preferred;
  return models[0].value;
}

/**
 * Raw `reasoning_options` for one model, straight from the catalogue (the core's
 * `buildReasoningDepthOptions` decides which of them the provider dialect accepts).
 */
export function modelReasoningOptions({
  data,
  resolveId,
  provider,
  model,
}: {
  data: ModelsDevData | null;
  resolveId: (id: string) => string;
  provider: string;
  model: string;
}): ReasoningOption[] {
  const record = data?.[resolveId(provider)]?.models?.[model] as ModelsDevModel | undefined;
  const options = record?.reasoning_options;
  return Array.isArray(options) ? options.filter(Boolean) : [];
}

/**
 * Turn the persisted setting into the value sent to the core. The `lowest`
 * sentinel becomes the smallest explicit level the model offers (none → minimal
 * → low); a toggle-only model has no explicit "off", so it sends nothing. An
 * explicit level passes through and the core drops it if the dialect rejects it.
 */
export function resolveReasoningDepth({
  setting,
  options,
}: {
  setting: string;
  options: Array<{ value: string }>;
}): string {
  if (setting !== LOWEST_REASONING) return setting || "";
  const values = options.map((option) => option.value);
  for (const candidate of ["none", "minimal", "low"]) {
    if (values.includes(candidate)) return candidate;
  }
  return "";
}

/** Settings-pane options: the sentinel, provider default, then the explicit levels. */
export function reasoningDepthChoices({
  options,
}: {
  options: Array<{ value: string; label?: string }>;
}): Array<{ value: string; text: string }> {
  const choices = [
    { value: LOWEST_REASONING, text: "Lowest (default)" },
    { value: "", text: "Provider default" },
  ];
  const seen = new Set(choices.map((choice) => choice.value));
  for (const option of options) {
    if (!option || typeof option.value !== "string" || seen.has(option.value)) continue;
    choices.push({ value: option.value, text: option.label || option.value });
    seen.add(option.value);
  }
  return choices;
}

/** Status line under the catalogue controls. */
export function summarizeCatalog(data: ModelsDevData | null): {
  providerCount: number;
  modelCount: number;
  offline: boolean;
} {
  if (!data) return { providerCount: 0, modelCount: 0, offline: true };
  const providers = Object.values(data);
  return {
    providerCount: providers.length,
    modelCount: providers.reduce((total, provider) => total + Object.keys(provider?.models || {}).length, 0),
    offline: false,
  };
}

/** Endpoint the AI client will actually use when the user leaves the override empty. */
export function effectiveBaseUrl({
  provider,
  data,
  builtIns,
  resolveId,
}: {
  provider: string;
  data: ModelsDevData | null;
  builtIns: ProviderDef[];
  resolveId: (id: string) => string;
}): string {
  const catalogueApi = usableApi(data?.[resolveId(provider)]?.api);
  if (catalogueApi) return normalizeApiBase(catalogueApi);
  const def =
    builtIns.find((candidate) => candidate.id === provider) ||
    builtIns.find((candidate) => resolveId(candidate.id) === resolveId(provider));
  return normalizeApiBase(def?.apiBase);
}

// ── Core surface the settings pane consumes (kept structural: core ships no types) ──

export interface ModelsDevStore {
  getProvidersData(): Promise<ModelsDevData | null>;
  refreshProvidersData(): Promise<void>;
}

export interface CatalogCore {
  BUILT_IN_PROVIDERS: ProviderDef[];
  resolveModelsDevId(id: string): string;
  allLanguagesNames: Record<string, Record<string, string>>;
  getSmartDefaultModel(args: { provider: string; models: ModelOption[] }): string | null;
  buildReasoningDepthOptions?(args: {
    provider?: string;
    npm?: string;
    reasoningOptions?: ReasoningOption[];
  }): Array<{ value: string; label?: string }>;
  createModelsDevStore(opts: {
    storage?: unknown;
    fetch?: unknown;
    now?: () => number;
    ttlMs?: number;
    url?: string;
    cacheKey?: string;
  }): ModelsDevStore;
}
