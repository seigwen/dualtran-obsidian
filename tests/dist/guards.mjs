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

console.log(
  `[guards] PASS — main.js ${sizeMb.toFixed(2)} MB, ${manifest.id}@${manifest.version}, 3 command ids present`
);
