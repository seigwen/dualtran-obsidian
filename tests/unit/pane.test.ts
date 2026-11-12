/**
 * The shipped settings pane must render the empty-provider state from the same
 * pure functions the conformance payload reads (SPEC 2.1, unconfigured host).
 *
 * These assertions read `src/main.ts` as text: the pane builds real Obsidian
 * `Setting` objects, which only exist inside the app. The contract is therefore
 * pinned on the calls the pane makes — placeholder entry, disabled pickers,
 * error guard — plus on the pure state helpers it delegates to.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../../src/settings";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAIN = fs.readFileSync(path.join(ROOT, "src", "main.ts"), "utf8");

/**
 * Code that drives one control: from `startMarker` (or, when the state is
 * computed ahead of the control, from `fromMarker`) to the control's own
 * `new Setting(` / next `.setName(`.
 */
function paneSection(startMarker: string, fromMarker?: string): string {
  const start = fromMarker ? MAIN.indexOf(fromMarker) : MAIN.indexOf(startMarker);
  expect(start, `main.ts is missing ${fromMarker || startMarker}`).toBeGreaterThan(-1);
  const control = MAIN.indexOf(startMarker, start);
  expect(control, `main.ts is missing ${startMarker}`).toBeGreaterThan(-1);
  const next = MAIN.indexOf("new Setting(", control + startMarker.length);
  return MAIN.slice(start, next === -1 ? undefined : next);
}

/** One control's `.addDropdown(` body (state lines above it are excluded). */
function controlBody(startMarker: string): string {
  const start = MAIN.indexOf(startMarker);
  expect(start, `main.ts is missing ${startMarker}`).toBeGreaterThan(-1);
  const next = MAIN.indexOf("new Setting(", start + startMarker.length);
  return MAIN.slice(start, next === -1 ? undefined : next);
}

describe("settings pane — empty provider state (SPEC 2.1)", () => {
  it("a fresh install renders no provider at all", () => {
    const settings = sanitizeSettings(undefined);
    expect(settings.aiProvider).toBe("");
    expect(settings.aiProvider).toBe(DEFAULT_SETTINGS.aiProvider);
    expect(settings.aiEndpointStale).toBe(false);
  });

  it("prepends the disabled placeholder to the provider picker when nothing is selected", () => {
    const providerSection = paneSection('.setName(this.plugin.t("settingProvider"))');
    expect(providerSection).toMatch(/providerIsUnconfigured\(\s*settings\.aiProvider\s*\)/);
    expect(providerSection).toMatch(/providerPlaceholderOption\(\{\s*t:\s*this\.plugin\.t\s*\}\)/);
    // Disable the placeholder row, not the picker — a disabled picker would
    // trap the user in the empty state.
    expect(providerSection).toMatch(/placeholderOption\.disabled\s*=\s*true/);
    expect(providerSection).not.toMatch(/setDisabled\(\s*true\s*\)/);
  });

  it("offers no way back to an empty provider and no \"None\" row", () => {
    const providerSection = paneSection('.setName(this.plugin.t("settingProvider"))');
    // Ignoring an empty value in onChange means the placeholder can never be
    // chosen again; nothing adds a "None"/"不设置" entry.
    expect(providerSection).toMatch(/if\s*\(\s*value\s*\)\s*\{/);
    expect(providerSection).not.toMatch(/addOption\(\s*""/);
    expect(MAIN).not.toMatch(/t\(\s*"(none|noProvider)"\s*\)/);
  });

  it("disables the model and reasoning pickers and labels the model picker", () => {
    const modelState = paneSection(
      '.setName(this.plugin.t("settingModel"))',
      "modelsForProvider always appends the free-text entry last"
    );
    expect(modelState).toMatch(/modelPickerState\(/);
    expect(modelState).toMatch(/modelState\.disabled/);
    expect(controlBody('.setName(this.plugin.t("settingModel"))')).toMatch(
      /if\s*\(\s*modelState\.disabled\s*\)[\s\S]*?addOption\(\s*""\s*,\s*modelState\.placeholder\s*\)[\s\S]*?setDisabled\(\s*true\s*\)/
    );

    const reasoningState = paneSection(
      '.setName(this.plugin.t("settingReasoning"))',
      "Reasoning effort: options come from"
    );
    expect(reasoningState).toMatch(/const reasoningDisabled = providerIsUnconfigured\(/);
    expect(controlBody('.setName(this.plugin.t("settingReasoning"))')).toMatch(
      /if\s*\(\s*reasoningDisabled\s*\)[\s\S]*?addOption\(\s*""\s*,\s*modelState\.placeholder\s*\)[\s\S]*?setDisabled\(\s*true\s*\)/
    );
  });

  it("keeps the endpoint empty with the `https://` placeholder while unconfigured", () => {
    const endpointSection = paneSection(
      '.setName(this.plugin.t("settingBaseUrl"))',
      "The provider's api base is written into the value"
    );
    expect(endpointSection).toMatch(/endpointState\(/);
    expect(endpointSection).toMatch(/endpoint\.placeholder/);
    expect(endpointSection).not.toMatch(/setPlaceholder\(\s*defaultBaseUrl/);
  });

  it("never persists an endpoint or model for an unconfigured provider", () => {
    // The endpoint default is only written once a provider supplies one…
    expect(MAIN).toMatch(/if\s*\(\s*endpoint\.autofill\s*&&\s*!settings\.aiBaseUrl\.trim\(\)/);
    // …and a provider choice with an empty id is ignored outright.
    const providerSection = paneSection('.setName(this.plugin.t("settingProvider"))');
    expect(providerSection).toMatch(/if\s*\(\s*value\s*\)/);
  });

  it("refuses to translate with an empty provider and sends no request", () => {
    // Both command paths go through translateBlocks; the pane disables the
    // primary button with the same localized message.
    expect(MAIN).toMatch(/providerRequiredError/);
    expect(MAIN).not.toMatch(/\|\|\s*"openai"/);
    expect(MAIN).not.toMatch(/\|\|\s*CUSTOM_PROVIDER_ID/);
  });
});
