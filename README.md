# DualTran for Obsidian

**双语对照，在 Obsidian 里读外文笔记。** 选中一段，译文插在原文下面——原文不丢，随时对照。
默认用 Google 翻译，装好即用；也可以接自己的 AI Key（OpenAI、DeepSeek、通义、Moonshot、
OpenRouter、本地 Ollama 等）。设置页的服务商与模型都是下拉列表，内置一批常用服务商，
其余来自 [models.dev](https://models.dev) 目录（200+ 服务商），也可以手填自定义模型。

## 安装

1. Obsidian → 设置 → 第三方插件 → 关闭「安全模式」
2. 浏览 → 搜索 **DualTran** → 安装 → 启用
3. 或者直接打开：https://community.obsidian.md/plugins/dualtran-translate

## 用法

| 命令 | 作用 |
|---|---|
| `Translate selection (insert below)` | 选中文本 → 译文插在下面（对照，推荐） |
| `Translate selection (replace)` | 选中文本 → 直接替换成译文 |
| `Translate note to a new file` | 整篇笔记翻译成新文件，原文保留 |

在 设置 → DualTran 里：

- **Target language** 下拉选目标语言（默认 `en`，中文用户请改 `zh-CN`）。
- **AI provider / AI model** 下拉：先列内置服务商，再接 models.dev 目录里的全部服务商；
  Provider 切换后会自动挑一个合适的模型，选 `自定义…` 可手填目录里没有的模型 id。
- **AI reasoning effort**：推理强度，默认 `Lowest`（模型允许的最低档，翻译更快）；
  选 `Provider default` 则不下发推理参数；只有模型声明了推理档位时才会出现更多选项。
- 翻译期间右上角会有带转圈的进行中提示，完成后自动消失。
- **AI base URL** 留空即用该服务商的默认端点（输入框里的占位符就是实际会用的地址）。
- 目录列表每天自动刷新一次；想立刻拉最新可点 **Provider & model list → Refresh**。
- **AI API key** 只存本机。

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
