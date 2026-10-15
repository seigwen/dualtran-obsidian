/**
 * Settings shape for DualTran for Obsidian. Pure module — no obsidian import,
 * so it stays unit-testable.
 */
export type Engine = "google" | "ai";

export interface DualTranSettings {
  engine: Engine;
  sourceLanguage: string;
  targetLanguage: string;
  aiProvider: string;
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string;
}

export const DEFAULT_SETTINGS: DualTranSettings = {
  engine: "google",
  sourceLanguage: "auto",
  targetLanguage: "en",
  aiProvider: "openai",
  aiApiKey: "",
  aiModel: "",
  aiBaseUrl: "",
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
    "aiBaseUrl",
  ] as const;
  for (const key of stringKeys) {
    if (typeof source[key] === "string") {
      settings[key] = source[key] as string;
    }
  }
  return settings;
}
