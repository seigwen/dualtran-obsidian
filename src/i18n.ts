/**
 * Interface translation for DualTran for Obsidian.
 *
 * Catalogue codes match the browser extension (`locales/<code>/messages.json`),
 * so both products share the same 38 languages and translations. The bundle is
 * generated at build time by scripts/build-i18n.mjs.
 */
import { LOCALE_CODES as CODES, LOCALES } from "./i18n.generated";

/** Endonyms for the language picker — never translated. */
export const LOCALE_NAMES: Record<string, string> = {
  af: "Afrikaans", ar: "العربية", ca: "Català", cs: "Čeština", da: "Dansk", de: "Deutsch",
  el: "Ελληνικά", en: "English", es: "Español", fa: "فارسی", fi: "Suomi", fr: "Français",
  he: "עברית", hi: "हिन्दी", hr: "Hrvatski", hu: "Magyar", is: "Íslenska", it: "Italiano",
  ja: "日本語", ko: "한국어", lv: "Latviešu", nl: "Nederlands", no: "Norsk", pl: "Polski",
  pt_BR: "Português (Brasil)", pt_PT: "Português (Portugal)", ro: "Română", ru: "Русский",
  sl: "Slovenščina", sr: "Српски", sv: "Svenska", th: "ไทย", tr: "Türkçe", ug: "ئۇيغۇرچە",
  uk: "Українська", vi: "Tiếng Việt", zh_CN: "简体中文", zh_TW: "繁體中文",
};

export const LOCALE_CODES: string[] = CODES;

/** BCP-47 tag → catalogue code. */
export function normalizeTag(tag: string | undefined | null): string {
  if (!tag || typeof tag !== "string") return "";
  const raw = tag.trim().replace(/_/g, "-").toLowerCase();
  if (!raw) return "";
  if (raw.indexOf("zh-hant") === 0 || raw === "zh-tw" || raw === "zh-hk" || raw === "zh-mo") return "zh_TW";
  if (raw.indexOf("zh-hans") === 0 || raw.indexOf("zh-cn") === 0 || raw.indexOf("zh-sg") === 0 || raw === "zh") {
    return "zh_CN";
  }
  if (raw.indexOf("zh-") === 0) return "zh_CN";
  if (raw === "pt-br") return "pt_BR";
  if (raw === "pt-pt" || raw === "pt") return "pt_PT";
  if (raw === "nb" || raw === "nb-no" || raw === "nn" || raw === "no-no") return "no";
  return raw.split("-")[0];
}

/** Exact tag → base language → English. */
export function detectLocale(preferred: string | undefined | null, available: string[]): string {
  const codes = available && available.length ? available : ["en"];
  const exact = normalizeTag(preferred);
  if (!exact) return codes.indexOf("en") >= 0 ? "en" : codes[0];
  const direct = codes.filter((code) => code.toLowerCase() === exact.toLowerCase())[0];
  if (direct) return direct;
  const baseTag = String(preferred).trim().replace(/_/g, "-").toLowerCase().split("-")[0];
  const base = codes.filter((code) => code.toLowerCase().split("_")[0] === baseTag)[0];
  if (base) return base;
  return codes.indexOf("en") >= 0 ? "en" : codes[0];
}

function interpolate(text: string, subs?: Record<string, string | number>): string {
  if (!subs) return text;
  return text.replace(/\$([A-Z0-9_]+)\$/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(subs, name) ? String(subs[name]) : whole
  );
}

export interface Translator {
  code: string;
  t: (key: string, subs?: Record<string, string | number>) => string;
}

/** Build a translator; missing keys fall back to English, then to the key. */
export function createTranslator(preferred: string | undefined | null): Translator {
  const codes = Object.keys(LOCALES);
  const code = detectLocale(preferred, codes);
  const table = LOCALES[code] || {};
  const fallback = LOCALES.en || {};
  const t = (key: string, subs?: Record<string, string | number>): string => {
    const entry = table[key] || fallback[key];
    if (!entry || typeof entry.message !== "string") return key;
    return interpolate(entry.message, subs);
  };
  return { code, t };
}

/**
 * The language Obsidian itself is running in: its own localStorage key first,
 * then moment (what the settings pane already uses), then the browser.
 */
export function obsidianLocale(): string {
  try {
    const stored = window.localStorage.getItem("language");
    if (stored) return stored;
  } catch {
    /* no localStorage (tests, mobile edge) */
  }
  try {
    const momentLocale = (window as unknown as { moment?: { locale?: () => string } }).moment?.locale?.();
    if (momentLocale) return momentLocale;
  } catch {
    /* moment not loaded yet */
  }
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
}
