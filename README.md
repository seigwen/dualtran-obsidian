# DualTran for Obsidian

Translate selections and whole notes inside Obsidian with **Google** or your
own AI model (BYOK, 20+ providers) — powered by `@dualtran/core`, the engine
extracted from the [DualTran browser extension](https://github.com/seigwen/DualTran-extension).

## Commands

- **Translate selection (replace)** — replaces the selection with the translation.
- **Translate selection (insert below)** — keeps the original and inserts the
  translation right below it.
- **Translate note to a new file** — translates the whole note into a new file
  next to the original.

## Development

```bash
node scripts/sync-core.mjs   # builds + vendors @dualtran/core (CORE_REPO env to override)
npm install                  # installs devDeps + the vendored tarball
npm test                     # unit + integration suites
npm run build                # produces main.js (production, minified)
npm run verify               # test + build + dist guards (manifest/versions/size/node-refs)
```

`npm run dev` builds with inline source maps and watches (`main.js`).

## Architecture

- `src/bridge.ts` — host-agnostic translation logic (Google batch via
  `core.translateGoogle`, AI via `core.streamChat`); fully dependency-injected.
- `src/coreAdapter.ts` — the only module that imports the vendored core.
- `src/editorOps.ts` — pure editor-insertion helpers (Obsidian `Editor`-shaped).
- `src/settings.ts` — settings shape, defaults and sanitization.
- `src/main.ts` — plugin wiring: commands, settings tab, `requestUrl`-based
  fetch adapter (no CORS on desktop or mobile).

## Releasing

1. Bump `manifest.json` + `package.json` + `versions.json` (minAppVersion map).
2. `npm run verify` green.
3. Commit, tag **without a `v` prefix** matching the manifest version exactly,
   push the tag, then attach `main.js`, `manifest.json` and `styles.css` (if
   any) to the GitHub release.
4. Submit via community.obsidian.md (see docs/SUBMISSION.md in the repo — added
   with the submission materials).

## License

MIT — the bundled `@dualtran/core` portion is MPL-2.0.
