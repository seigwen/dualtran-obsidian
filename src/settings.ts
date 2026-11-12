/**
 * Settings shape for DualTran for Obsidian. Pure module — no obsidian import,
 * so it stays unit-testable.
 */
export type Engine = "google" | "ai";

/**
 * Persisted value meaning "use the lowest reasoning level the current model
 * accepts". Resolved at request time (model-dependent), never sent to the core.
 */
export const LOWEST_REASONING = "__lowest__";

/** Placeholder shown in the AI endpoint box while no provider is selected. */
export const ENDPOINT_PLACEHOLDER = "https://";

export interface DualTranSettings {
  engine: Engine;
  sourceLanguage: string;
  targetLanguage: string;
  /** models.dev / built-in provider id; "" = unconfigured (fresh install). */
  aiProvider: string;
  aiApiKey: string;
  aiModel: string;
  aiReasoningDepth: string;
  aiBaseUrl: string;
  /**
   * True when the endpoint box was filled with a provider default and the user
   * has not typed anything yet (false otherwise, and always false while no
   * provider is selected). Lets a provider switch tell "untouched" apart from
   * "the user typed exactly the previous default".
   */
  aiEndpointStale: boolean;
  /** Interface language override ("" = follow Obsidian). */
  uiLang: string;
}

/**
 * A fresh install has NO AI provider. The picker shows a disabled placeholder
 * until the user chooses one, and every AI path refuses to run without it —
 * there is no silent OpenAI (or custom) fallback.
 */
export const DEFAULT_SETTINGS: DualTranSettings = {
  engine: "google",
  sourceLanguage: "auto",
  targetLanguage: "en",
  aiProvider: "",
  aiApiKey: "",
  aiModel: "",
  aiReasoningDepth: LOWEST_REASONING,
  aiBaseUrl: "",
  aiEndpointStale: false,
  uiLang: "",
};

/**
 * Coerce persisted data (loadData() may return anything) into a valid settings
 * object: unknown fields are dropped, non-string strings fall back to the
 * defaults, an unknown engine value falls back to the default engine, and a
 * stored endpoint that differs from the provider default counts as user-edited.
 *
 * Stored values are never rewritten: an empty provider stays empty and any
 * provider id is kept verbatim.
 */
export function sanitizeSettings(raw: unknown): DualTranSettings {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const settings: DualTranSettings = { ...DEFAULT_SETTINGS };
  if (source.engine === "google" || source.engine === "ai") {
    settings.engine = source.engine;
  }
  const stringKeys = [
    "sourceLanguage",
    "targetLanguage",
    "aiProvider",
    "aiApiKey",
    "aiModel",
    "aiReasoningDepth",
    "aiBaseUrl",
    "uiLang",
  ] as const;
  for (const key of stringKeys) {
    if (typeof source[key] === "string") {
      settings[key] = source[key];
    }
  }
  if (typeof source.aiEndpointStale === "boolean") {
    settings.aiEndpointStale = source.aiEndpointStale;
  } else {
    // No flag persisted yet (older install or a hand-written config): a
    // non-empty box counts as user text and is never overwritten.
    settings.aiEndpointStale = false;
  }
  return settings;
}
