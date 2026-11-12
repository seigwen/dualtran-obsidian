/**
 * Provider / model / language catalogue shaping for the settings pane.
 *
 * Pure functions: the models.dev payload and the core helpers (alias map, smart
 * defaults) are injected, so the unit suite runs without the vendored tarball
 * and without network. The data comes from `core.createModelsDevStore`, which
 * owns the fetch + 24 h cache; this module only decides what the dropdowns show.
 */

import { LOWEST_REASONING, ENDPOINT_PLACEHOLDER } from "./settings";
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
  source: "built-in" | "models.dev" | "custom";
}

export interface ModelOption {
  value: string;
  text: string;
}

/** Sentinel option that reveals the free-text model input. */
export const CUSTOM_MODEL_VALUE = "__custom__";

/** Id of the host's custom provider entry — always last, never sorted. */
export const CUSTOM_PROVIDER_ID = "__custom_provider__";

const TEMPLATE_VAR = /\$\{[^}]+\}/;
/**
 * Sort order shared with the conformance contract (scripts/conformance/validate.mjs):
 * case-insensitive code-unit order, numeric runs compared as numbers. Not
 * `localeCompare` — ICU collation is not stable across engine builds (one host
 * ordered "t" after "c", which would push "text-embedding…" above "Custom…").
 */
const LABEL_ORDER = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Sort by the label the user sees; a fixed locale keeps the list stable everywhere. */
function compareLabels(left: string, right: string): number {
  return LABEL_ORDER.compare(String(left || "").trim(), String(right || "").trim());
}

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
 * One provider list: built-ins and models.dev entries merged and sorted by the
 * visible label (no grouping, no divider). A models.dev entry that is the
 * catalogue twin of a built-in (google ↔ google-gemini, xai ↔ grok…) is dropped
 * so each provider appears once; built-ins win. A saved value the catalogue no
 * longer knows stays selectable and is sorted into place like any other entry.
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
  const builtInDevIds = new Set(builtIns.map((def) => resolveId(def.id)));
  const taken = new Set(builtIns.map((def) => def.id));
  const options: ProviderOption[] = builtIns.map((def) => ({
    id: def.id,
    label: def.name,
    source: "built-in",
  }));

  for (const [id, info] of Object.entries(data || {})) {
    if (!usableApi(info?.api) || builtInDevIds.has(resolveId(id)) || taken.has(id)) continue;
    const label = (info?.name || info?.id || id).trim() || id;
    options.push({ id, label, source: "models.dev" });
    taken.add(id);
  }

  if (selectedId && !taken.has(selectedId)) {
    options.push({ id: selectedId, label: selectedId, source: "models.dev" });
  }

  return options.sort((left, right) => compareLabels(left.label, right.label));
}

/** The empty provider id means "nothing chosen yet" (fresh install). */
export function providerIsUnconfigured(provider: string | null | undefined): boolean {
  return String(provider ?? "").trim() === "";
}

/**
 * Disabled, selected placeholder the provider picker shows while
 * `provider.current === ""`. It is NOT one of the real options: the pane adds
 * it as a single disabled entry selected on top of the alphabetical list.
 */
export function providerPlaceholderOption({ t }: { t: (key: string) => string }): {
  value: "";
  label: string;
  disabled: true;
} {
  return { value: "", label: t("providerPlaceholder"), disabled: true };
}

/**
 * Provider picker options, exactly as the pane lists them: one alphabetical
 * list of real providers, with the host's custom provider entry last.
 */
export function providerPickerOptions({
  data,
  builtIns,
  selectedId,
  resolveId,
  t,
}: {
  data: ModelsDevData | null;
  builtIns: ProviderDef[];
  selectedId: string;
  resolveId: (id: string) => string;
  /** Optional translator; the English label is used without it (unit tests). */
  t?: (key: string) => string;
}): ProviderOption[] {
  const real = projectProviders({ data, builtIns, selectedId, resolveId });
  const custom: ProviderOption = {
    id: CUSTOM_PROVIDER_ID,
    label: t ? t("customProviderOption") : "Custom provider",
    source: "custom",
  };
  return [...real, custom];
}

/**
 * Model candidates for a provider; the internal id is resolved to its models.dev
 * id first. Sorted by label, with the free-text entry always last.
 */
export function modelsForProvider({
  provider,
  data,
  resolveId,
  t,
}: {
  provider: string;
  data: ModelsDevData | null;
  resolveId: (id: string) => string;
  /** Optional translator; without it the English label is used (unit tests). */
  t?: (key: string) => string;
}): ModelOption[] {
  const models = Object.entries(data?.[resolveId(provider)]?.models || {})
    .map(([id, model]) => ({ value: id, text: model?.name || model?.id || id }))
    .sort((left, right) => compareLabels(left.text, right.text));
  return [...models, { value: CUSTOM_MODEL_VALUE, text: t ? t("customModelOption") : "Custom model" }];
}

/**
 * Model picker state. With no provider chosen the list is empty, the picker is
 * disabled and its placeholder asks for a provider first; a chosen provider
 * lists that provider's models (free-text entry last).
 */
export function modelPickerState({
  provider,
  current,
  data,
  resolveId,
  t,
}: {
  provider: string;
  current: string;
  data: ModelsDevData | null;
  resolveId: (id: string) => string;
  t?: (key: string) => string;
}): { disabled: boolean; options: ModelOption[]; placeholder: string } {
  const label = (key: string, fallback: string) => (t ? t(key) : fallback);
  if (providerIsUnconfigured(provider)) {
    return {
      disabled: true,
      options: [],
      placeholder: label("providerRequiredForModel", "Select a provider first"),
    };
  }
  return {
    disabled: false,
    options: modelsForProvider({ provider, data, resolveId, t }),
    placeholder: label("providerRequiredForModel", "Select a provider first"),
  };
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
    .sort((left, right) => compareLabels(left.text, right.text));
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
  const record = data?.[resolveId(provider)]?.models?.[model];
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
  t,
}: {
  options: Array<{ value: string; label?: string }>;
  /** Optional translator; without it the English labels are used (unit tests). */
  t?: (key: string) => string;
}): Array<{ value: string; text: string }> {
  const label = (key: string, fallback: string) => (t ? t(key) : fallback);
  const choices = [
    { value: LOWEST_REASONING, text: label("reasoningLowest", "Lowest (default)") },
    { value: "", text: label("reasoningProviderDefault", "Provider default") },
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

/**
 * Endpoint input state for the pane.
 *
 * - No provider chosen: value `""`, placeholder exactly `https://`.
 * - Provider chosen: the stored value is used verbatim when there is one,
 *   otherwise the provider's api base fills the box as its **value** (never a
 *   placeholder).
 *
 * `autofill` reports whether the value came from the provider (so the pane can
 * persist the default and mark it untouched) or from the user's own text.
 */
export function endpointState({
  provider,
  stored,
  data,
  builtIns,
  resolveId,
}: {
  provider: string;
  stored: string;
  data?: ModelsDevData | null;
  builtIns?: ProviderDef[];
  resolveId?: (id: string) => string;
}): { value: string; placeholder: string; empty: boolean; autofill: boolean } {
  if (providerIsUnconfigured(provider)) {
    return { value: "", placeholder: ENDPOINT_PLACEHOLDER, empty: true, autofill: false };
  }
  const current = (stored || "").trim();
  if (current) {
    return { value: current, placeholder: ENDPOINT_PLACEHOLDER, empty: false, autofill: false };
  }
  const apiBase = effectiveBaseUrl({
    provider,
    data: data ?? null,
    builtIns: builtIns ?? [],
    resolveId: resolveId ?? ((id: string) => id),
  });
  return { value: apiBase, placeholder: ENDPOINT_PLACEHOLDER, empty: !apiBase, autofill: !!apiBase };
}

/**
 * Endpoint input after the provider picker changes. The box shows the
 * provider's api base as its *value* (not a placeholder); an untouched box (or
 * one still holding the previous provider's default) moves to the new default,
 * while anything the user typed themselves is left alone.
 */
export function resolveEndpointOnProviderChange({
  current,
  previousDefault,
  nextDefault,
  untouched,
}: {
  /** What the input holds right now. */
  current: string;
  /** The default that was written for the provider being left ("" if none). */
  previousDefault: string;
  /** The new provider's api base ("" when it has none). */
  nextDefault: string;
  /**
   * The endpoint box was filled by the pane and never edited (optional). When
   * omitted, the value is compared with the previous default — the historical
   * behaviour. When `true`, the box is definitely still the pane's own value.
   */
  untouched?: boolean;
}): string {
  const value = (current || "").trim();
  const previous = normalizeApiBase(previousDefault);
  const next = (nextDefault || "").trim();
  if (!value) return next;
  if (untouched === true) return next;
  if (previous && normalizeApiBase(value) === previous) return next;
  return current;
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
