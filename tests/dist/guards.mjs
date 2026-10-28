#!/usr/bin/env node
/**
 * Dist guards (plan 63 A4). Run AFTER `npm run build` from the repo root:
 *   node tests/dist/guards.mjs
 * Fails on: illegal manifest ids, versions.json drift, a missing or oversized
 * main.js, surviving node: built-in references (Obsidian mobile), or a bundle
 * that lost the public command ids.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const versions = JSON.parse(fs.readFileSync(path.join(ROOT, "versions.json"), "utf8"));

// Manifest legality (community.obsidian.md requirements).
assert.match(manifest.id, /^[a-z0-9-]+$/, "manifest.id must be lowercase alphanumeric with hyphens");
assert.ok(!manifest.id.includes("obsidian"), 'manifest.id must not contain "obsidian"');
assert.ok(!manifest.id.endsWith("plugin"), 'manifest.id must not end with "plugin"');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/, "manifest.version must be plain semver");
assert.ok(manifest.minAppVersion, "manifest.minAppVersion is required");
assert.strictEqual(typeof manifest.isDesktopOnly, "boolean", "manifest.isDesktopOnly must be a boolean");

// versions.json must map the shipped version to its minAppVersion.
assert.strictEqual(versions[manifest.version], manifest.minAppVersion, "versions.json is out of sync with manifest.json");

// Built artifact.
const mainPath = path.join(ROOT, "main.js");
assert.ok(fs.existsSync(mainPath), "main.js missing — run `npm run build` first");
const main = fs.readFileSync(mainPath, "utf8");
const sizeMb = fs.statSync(mainPath).size / (1024 * 1024);
assert.ok(sizeMb <= 4, `main.js is ${sizeMb.toFixed(2)} MB — over the 4 MB cap (plan 63 D4)`);

// Obsidian mobile has no Node built-ins; node:fs/node:path are stubbed at build time.
assert.ok(!/node:fs|node:path/.test(main), "main.js must not reference node: built-ins (mobile)");

// Wiring smoke: public command ids survive bundling.
for (const id of ["translate-selection-replace", "translate-selection-insert", "translate-note"]) {
  assert.ok(main.includes(id), `main.js is missing command id ${id}`);
}

// ── community review rules (plan 101) ──────────────────────────────
// The directory's scanner rejects runtime <style> injection: plugin CSS must
// ship as styles.css, which Obsidian loads for us.
assert.ok(!/createElement\(\s*["']style["']\s*\)/.test(main), "main.js must not create <style> elements (use styles.css)");
assert.ok(!/\.head\.appendChild\(/.test(main), "main.js must not append to document.head (use styles.css)");

const stylesPath = path.join(ROOT, "styles.css");
assert.ok(fs.existsSync(stylesPath), "styles.css missing — the loading spinner CSS must ship as a file");
const styles = fs.readFileSync(stylesPath, "utf8");
assert.ok(styles.includes(".dualtran-spinner"), "styles.css must style .dualtran-spinner");
assert.ok(styles.includes("@keyframes dualtran-spin"), "styles.css must define the dualtran-spin animation");

// minAppVersion must cover the newest Obsidian API we call: App.saveLocalStorage
// is @since 1.8.7 (obsidian.d.ts), and the scanner fails the release when the
// manifest declares an older floor.
const [minMajor, minMinor, minPatch] = manifest.minAppVersion.split(".").map(Number);
const floor = [1, 8, 7];
const coversFloor =
  minMajor > floor[0] ||
  (minMajor === floor[0] && (minMinor > floor[1] || (minMinor === floor[1] && minPatch >= floor[2])));
assert.ok(coversFloor, `manifest.minAppVersion ${manifest.minAppVersion} is below the 1.8.7 API floor`);

console.log(
  `[guards] PASS — main.js ${sizeMb.toFixed(2)} MB, ${manifest.id}@${manifest.version}, 3 command ids present, styles.css + minAppVersion ${manifest.minAppVersion} ok`
);
