/**
 * install.mjs — fetch the pinned Obsidian build for the E2E and unpack it.
 *
 * The AppImage is used instead of a system package so CI needs no root install:
 * `--appimage-extract` unpacks it with the embedded runtime (no FUSE).
 * Cached under .cache/ so repeat runs and the CI cache step are cheap.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, "..", ".cache");
const VERSION = process.env.OBSIDIAN_VERSION || "1.14.5";
const APPIMAGE = path.join(CACHE, `Obsidian-${VERSION}.AppImage`);
const EXTRACTED = path.join(CACHE, "squashfs-root");
const BIN = path.join(EXTRACTED, "obsidian");
const URL = `https://github.com/obsidianmd/obsidian-releases/releases/download/v${VERSION}/Obsidian-${VERSION}.AppImage`;

async function download() {
  if (fs.existsSync(APPIMAGE) && fs.statSync(APPIMAGE).size > 100 * 1024 * 1024) return;
  fs.mkdirSync(CACHE, { recursive: true });
  console.log(`[install] downloading ${URL}`);
  const response = await fetch(URL, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(APPIMAGE, buffer);
  fs.chmodSync(APPIMAGE, 0o755);
  console.log(`[install] saved ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
}

function extract() {
  if (fs.existsSync(BIN)) return;
  console.log("[install] unpacking the AppImage");
  execFileSync(APPIMAGE, ["--appimage-extract"], { cwd: CACHE, stdio: "inherit" });
  if (!fs.existsSync(BIN)) throw new Error("extracted binary missing");
}

export async function ensureObsidian() {
  await download();
  extract();
  return BIN;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureObsidian()
    .then((bin) => console.log(`[install] ready: ${bin}`))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
