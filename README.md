# DualTran for Obsidian

**双语对照，在 Obsidian 里读外文笔记。** 选中一段，译文插在原文下面——原文不丢，随时对照。
默认用 Google 翻译，装好即用；也可以接自己的 AI Key（OpenAI、DeepSeek、通义、Moonshot、
OpenRouter、本地 Ollama 等）。设置页的服务商与模型都是下拉列表，内置一批常用服务商，
其余来自 [models.dev](https://models.dev) 目录（200+ 服务商），也可以手填自定义模型。

## 界面语言 / Languages

界面提供 **38 种语言**（与浏览器扩展同一套 `locales/<code>/messages.json`）：
af ar ca cs da de el en es fa fi fr he hi hr hu is it ja ko lv nl no pl pt_BR pt_PT ro ru sl
sr sv th tr ug uk vi zh_CN zh_TW。默认跟随 Obsidian 自己的界面语言（读 `localStorage.language`
→ `moment.locale()`），也可以在设置里单独指定并持久化。

```bash
npm run i18n:sync    # 补齐所有语言（复用扩展译文，其余机译）
npm run i18n:check   # 缺键 / 空值 / 丢失占位符 / 中文残留 → 失败
```

`zh_CN` / `zh_TW` 手写、不参与机译；`npm run verify` 会跑 `i18n:check`，语言掉队即构建失败。

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

The e2e run drives the real Obsidian app and finishes with a language switch
(settings dropdown path → German settings labels, German command names).

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
2. `npm run verify` green — it runs `npm run lint` first, which reproduces the
   community directory's automated review (ESLint `eslint-plugin-obsidianmd`).
3. Commit and push, then push a tag **without a `v` prefix**, matching the
   manifest version exactly. The `Release` workflow builds from that tag and
   publishes `main.js`, `manifest.json` and `styles.css` together with build
   provenance attestations — never upload assets by hand: the directory rebuilds
   the tagged source and byte-compares it against the released `main.js`, so the
   build must come from CI (the banner carries no timestamp for that reason).
4. Trigger "Check for new releases" in community.obsidian.md (async scan), or
   use "Review branch" there to pre-scan a branch before tagging.

Plugin CSS ships as `styles.css` — the directory rejects plugins that inject a
`<style>` element at runtime.

## License

MIT — the bundled `@dualtran/core` portion is MPL-2.0.

## E2E

`npm run e2e` launches the pinned Obsidian build (downloaded once into `.cache/`) with a throwaway vault, loads the freshly built plugin and drives it over CDP: command registration, Google translation (answered through a local HTTPS interceptor, because `requestUrl` runs in Electron's main process), AI request body against a local mock, the loading notice + spinner, and a 401 that must leave the note untouched. Linux needs `xvfb-run -a npm run e2e`.
