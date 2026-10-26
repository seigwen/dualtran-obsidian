# DualTran for Obsidian

**双语对照，在 Obsidian 里读外文笔记。** 选中一段，译文插在原文下面——原文不丢，随时对照。
默认用 Google 翻译，装好即用；也可以接自己的 AI Key（OpenAI、DeepSeek、通义、Moonshot、
OpenRouter、本地 Ollama 等 20+ 家）。

## 安装

1. Obsidian → 设置 → 第三方插件 → 关闭「安全模式」
2. 浏览 → 搜索 **DualTran Translate** → 安装 → 启用
3. 或者直接打开：https://community.obsidian.md/plugins/dualtran-translate

## 用法

| 命令 | 作用 |
|---|---|
| `Translate selection (insert below)` | 选中文本 → 译文插在下面（对照，推荐） |
| `Translate selection (replace)` | 选中文本 → 直接替换成译文 |
| `Translate note to a new file` | 整篇笔记翻译成新文件，原文保留 |

在 设置 → DualTran 里可以设目标语言；要用 AI 就在同一页填入服务商与 Key（Key 只存本机）。

## 浏览器里也想用？

同一套引擎也有浏览器扩展，支持 Chrome / Firefox / Edge：
https://github.com/seigwen/DualTran-extension

---


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
