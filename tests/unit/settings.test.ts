import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../../src/settings";

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
});
