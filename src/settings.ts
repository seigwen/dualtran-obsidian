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

export interface DualTranSettings {
  engine: Engine;
  sourceLanguage: string;
  targetLanguage: string;
  aiProvider: string;
  aiApiKey: string;
  aiModel: string;
  aiReasoningDepth: string;
  aiBaseUrl: string;
  /** Interface language override ("" = follow Obsidian). */
  uiLang: string;
}

export const DEFAULT_SETTINGS: DualTranSettings = {
  engine: "google",
  sourceLanguage: "auto",
  targetLanguage: "en",
  aiProvider: "openai",
  aiApiKey: "",
  aiModel: "",
  aiReasoningDepth: LOWEST_REASONING,
  aiBaseUrl: "",
  uiLang: "",
};

/**
 * Coerce persisted data (loadData() may return anything) into a valid settings
 * object: unknown fields are dropped, non-string strings fall back to the
 * defaults, an unknown engine value falls back to the default engine.
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
      settings[key] = source[key] as string;
    }
  }
  return settings;
}
