import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, LOWEST_REASONING, sanitizeSettings } from "../../src/settings";

describe("sanitizeSettings", () => {
  it("returns defaults for absent or malformed input", () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial data over the defaults", () => {
    const s = sanitizeSettings({ engine: "ai", aiApiKey: "k" });
    expect(s.engine).toBe("ai");
    expect(s.aiApiKey).toBe("k");
    expect(s.targetLanguage).toBe(DEFAULT_SETTINGS.targetLanguage);
  });

  it("rejects an unknown engine value", () => {
    expect(sanitizeSettings({ engine: "yandex" }).engine).toBe(DEFAULT_SETTINGS.engine);
  });

  it("coerces non-string string fields back to defaults", () => {
    expect(sanitizeSettings({ targetLanguage: 42 }).targetLanguage).toBe(DEFAULT_SETTINGS.targetLanguage);
  });

  it("defaults the reasoning effort to the lowest setting", () => {
    expect(DEFAULT_SETTINGS.aiReasoningDepth).toBe(LOWEST_REASONING);
    expect(sanitizeSettings(undefined).aiReasoningDepth).toBe(LOWEST_REASONING);
  });

  it("keeps a valid reasoning effort and rejects non-strings", () => {
    expect(sanitizeSettings({ aiReasoningDepth: "high" }).aiReasoningDepth).toBe("high");
    expect(sanitizeSettings({ aiReasoningDepth: 3 }).aiReasoningDepth).toBe(LOWEST_REASONING);
  });

  // ── SPEC 2.1: a fresh install has no AI provider at all ────────────────────
  it("leaves the AI provider empty on a fresh install (no OpenAI / custom default)", () => {
    expect(DEFAULT_SETTINGS.aiProvider).toBe("");
    expect(sanitizeSettings(undefined).aiProvider).toBe("");
    expect(sanitizeSettings({}).aiProvider).toBe("");
    expect(sanitizeSettings({ engine: "ai" }).aiProvider).toBe("");
  });

  it("never rewrites a stored provider (empty stays empty, any id is kept verbatim)", () => {
    expect(sanitizeSettings({ aiProvider: "" }).aiProvider).toBe("");
    expect(sanitizeSettings({ aiProvider: "anthropic" }).aiProvider).toBe("anthropic");
    expect(sanitizeSettings({ aiProvider: "my-gateway" }).aiProvider).toBe("my-gateway");
  });

  it("keeps the reasoning sentinel on a fresh install", () => {
    expect(sanitizeSettings(undefined).aiReasoningDepth).toBe(LOWEST_REASONING);
  });
});
