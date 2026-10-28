import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCALE_NAMES, createTranslator, detectLocale, normalizeTag, obsidianLocale } from "../../src/i18n";
import { LOCALE_CODES, LOCALES } from "../../src/i18n.generated";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, "locales", "en", "messages.json"), "utf8"));
const EN_KEYS = Object.keys(EN);

/** The same 38 languages the browser extension ships (see DualTran-manage/98). */
const EXPECTED = [
  "af", "ar", "ca", "cs", "da", "de", "el", "en", "es", "fa", "fi", "fr", "he", "hi", "hr",
  "hu", "is", "it", "ja", "ko", "lv", "nl", "no", "pl", "pt_BR", "pt_PT", "ro", "ru", "sl",
  "sr", "sv", "th", "tr", "ug", "uk", "vi", "zh_CN", "zh_TW",
];

describe("normalizeTag / detectLocale", () => {
  it("maps regional tags onto catalogue codes", () => {
    expect(normalizeTag("zh-CN")).toBe("zh_CN");
    expect(normalizeTag("zh-Hant-HK")).toBe("zh_TW");
    expect(normalizeTag("pt-BR")).toBe("pt_BR");
    expect(normalizeTag("de-AT")).toBe("de");
    expect(normalizeTag(undefined)).toBe("");
  });

  it("falls back base language, then English", () => {
    expect(detectLocale("zh-TW", EXPECTED)).toBe("zh_TW");
    expect(detectLocale("fr-CA", EXPECTED)).toBe("fr");
    expect(detectLocale("xx-YY", EXPECTED)).toBe("en");
  });
});

describe("createTranslator", () => {
  it("translates, falls back per key and interpolates", () => {
    const { code, t } = createTranslator("de-DE");
    expect(code).toBe("de");
    expect(t("btnRefresh")).not.toBe("btnRefresh");
    expect(t("noticeWrote", { PATH: "a.md" })).toContain("a.md");
    expect(t("no-such-key")).toBe("no-such-key");
  });

  it("uses English when nothing else matches", () => {
    const { code, t } = createTranslator("xx");
    expect(code).toBe("en");
    expect(t("btnRefresh")).toBe("Refresh");
  });
});

describe("obsidianLocale", () => {
  it("resolves to a catalogue the plugin ships (jsdom has no Obsidian locale)", () => {
    expect(typeof obsidianLocale()).toBe("string");
    expect(createTranslator(obsidianLocale()).code).toBe("en");
  });
});

describe("locale catalogues", () => {
  it("ships the agreed 38 languages", () => {
    expect([...LOCALE_CODES].sort()).toEqual([...EXPECTED].sort());
    for (const code of LOCALE_CODES) expect(LOCALE_NAMES[code], `${code}: endonym`).toBeTruthy();
  });

  it("has every English key, non-empty, in every locale", () => {
    for (const code of LOCALE_CODES) {
      const catalogue = LOCALES[code];
      expect(Object.keys(catalogue), `${code}: key set`).toEqual(EN_KEYS);
      for (const key of EN_KEYS) {
        const value = catalogue[key] && catalogue[key].message;
        expect(typeof value === "string" && value.trim().length > 0, `${code}: ${key}`).toBe(true);
      }
    }
  });

  it("keeps every placeholder of the English source", () => {
    for (const code of LOCALE_CODES) {
      for (const key of EN_KEYS) {
        const tokens = EN[key].message.match(/\$[A-Z0-9_]+\$/g) || [];
        for (const token of tokens) {
          expect(LOCALES[code][key].message, `${code}: ${key} lost ${token}`).toContain(token);
        }
      }
    }
  });

  it("does not leave Chinese in non-Chinese locales", () => {
    for (const code of LOCALE_CODES) {
      if (code.startsWith("zh") || code.startsWith("ja")) continue;
      expect(/[\u4e00-\u9fff]/.test(JSON.stringify(LOCALES[code])), `${code}: Chinese left over`).toBe(false);
    }
  });
});
