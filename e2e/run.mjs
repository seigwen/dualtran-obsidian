/**
 * run.mjs — Obsidian plugin E2E in the real Obsidian desktop app.
 *
 * Launches the pinned Obsidian build (see install.mjs) with a throwaway HOME and
 * vault, loads the freshly built plugin, then drives it over CDP:
 *   • commands are registered by the plugin
 *   • Google translation replaces the selection (request intercepted over CDP)
 *   • AI translation hits a local OpenAI-compatible mock with the right body
 *   • a slow request shows the loading notice, and it disappears afterwards
 *   • a 401 leaves the note untouched and reports the error
 *
 * Linux needs a display: `xvfb-run -a npm run e2e`.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ensureObsidian } from "./install.mjs";
import { startMitmProxy } from "./mitm-proxy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ARTIFACTS = path.join(ROOT, "e2e-artifacts");
const PLUGIN_ID = "dualtran-translate";
const DEBUG_PORT = Number(process.env.DT_OBSIDIAN_PORT || 9333);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startMock() {
  const requests = [];
  let ai = { status: 200, delayMs: 0, content: "译文" };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = raw;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        /* keep raw */
      }
      requests.push({ url: req.url, body, headers: req.headers });
      if (req.url.startsWith("/v1/chat/completions")) {
        if (ai.delayMs) await sleep(ai.delayMs);
        if (ai.status !== 200) {
          res.writeHead(ai.status, { "content-type": "application/json", "access-control-allow-origin": "*" });
          res.end(JSON.stringify({ error: { message: "mock 401 unauthorized" } }));
          return;
        }
        // The plugin consumes the AI SDK stream, not a JSON body: answer as SSE.
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        // The AI SDK needs a chunk carrying finish_reason before [DONE],
        // otherwise it throws "Response stream ended without a finish reason".
        res.write(
          `data: ${JSON.stringify({ id: "e2e", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: ai.content }, finish_reason: null }] })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({ id: "e2e", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    setAi: (next) => (ai = { ...ai, ...next }),
    clear: () => (requests.length = 0),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function seedVault(base) {
  const vault = path.join(base, "vault");
  const pluginDir = path.join(vault, ".obsidian", "plugins", PLUGIN_ID);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(vault, "note.md"), "Hello world, this is a test note.\n", "utf8");
  fs.writeFileSync(path.join(pluginDir, "main.js"), fs.readFileSync(path.join(ROOT, "main.js")));
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), fs.readFileSync(path.join(ROOT, "manifest.json")));
  fs.writeFileSync(
    path.join(vault, ".obsidian", "community-plugins.json"),
    JSON.stringify([PLUGIN_ID]),
    "utf8"
  );
  fs.writeFileSync(
    path.join(vault, ".obsidian", "app.json"),
    JSON.stringify({ legacyEditor: false }),
    "utf8"
  );
  const registry = path.join(base, "home", ".config", "obsidian");
  fs.mkdirSync(registry, { recursive: true });
  const vaultId = Buffer.from(vault).toString("hex").slice(0, 16);
  fs.writeFileSync(
    path.join(registry, "obsidian.json"),
    JSON.stringify({ vaults: { [vaultId]: { path: vault, ts: Date.now(), open: true } } }),
    "utf8"
  );
  return vault;
}

async function launchObsidian(bin, base, proxyUrl) {
  const child = spawn(
    bin,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--proxy-server=${proxyUrl}`,
      // The interceptor presents a self-signed cert; only the E2E trusts it.
      "--ignore-certificate-errors",
    ],
    {
      env: {
        ...process.env,
        HOME: path.join(base, "home"),
        XDG_CONFIG_HOME: path.join(base, "home", ".config"),
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    }
  );
  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  return { child, log };
}

async function waitForEndpoint(url, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  fs.rmSync(ARTIFACTS, { recursive: true, force: true });
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const bin = await ensureObsidian();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dualtran-obsidian-e2e-"));
  seedVault(base);
  const mock = await startMock();
  const proxy = await startMitmProxy();
  const { child, log } = await launchObsidian(bin, base, proxy.url);

  let browser;
  try {
    await waitForEndpoint(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    const context = browser.contexts()[0];
    const pages = context.pages();
    assert(pages.length > 0, "Obsidian opened no window");
    const page = pages[0];

    // The first open of a vault with community plugins may ask for trust. It
    // appears asynchronously, so poll: click it when present, bail out as soon
    // as the plugin is live (some builds skip the prompt entirely).
    const deadline = Date.now() + 60000;
    for (;;) {
      const state = await page.evaluate(() => ({
        loaded: !!(window.app && window.app.plugins && window.app.plugins.plugins["dualtran-translate"]),
        trust:
          Array.from(document.querySelectorAll(".modal button")).find((button) =>
            /trust|enable/i.test(button.textContent || "")
          )?.textContent || null,
      }));
      if (state.loaded) break;
      if (state.trust) {
        await page.getByRole("button", { name: new RegExp(state.trust.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click();
        await sleep(1500);
        continue;
      }
      if (Date.now() > deadline) throw new Error("the plugin never loaded (no trust prompt, no plugin)");
      await sleep(500);
    }

    // 1) commands registered
    const commands = await page.evaluate(() => Object.keys(window.app.commands.commands));
    const pluginCommands = commands.filter((id) => id.startsWith("dualtran-translate:"));
    assert(pluginCommands.length === 3, `expected 3 plugin commands, got ${pluginCommands.join(", ")}`);
    fs.writeFileSync(path.join(ARTIFACTS, "commands.json"), JSON.stringify(pluginCommands, null, 2));

    // 2) Google translation replaces the selection
    const googleResult = await page.evaluate(async () => {
      const plugin = window.app.plugins.plugins["dualtran-translate"];
      plugin.settings.engine = "google";
      plugin.settings.targetLanguage = "zh-CN";
      await plugin.saveSettings();
      const leaf = window.app.workspace.getLeaf(true);
      await leaf.openFile(window.app.vault.getAbstractFileByPath("note.md"));
      // editorCallback commands only fire when a Markdown editor is focused.
      window.app.workspace.setActiveLeaf(leaf, { focus: true });
      const view = leaf.view;
      view.editor.focus();
      view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 11 });
      await window.app.commands.executeCommandById("dualtran-translate:translate-selection-replace");
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !view.editor.getValue().includes("译文")) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return view.editor.getValue();
    });
    assert(googleResult.includes("译文"), `Google path did not replace the selection: ${googleResult}`);
    await page.screenshot({ path: path.join(ARTIFACTS, "google-translate.png") });

    // 3) AI translation reaches the mock with the configured model
    mock.clear();
    const aiResult = await page.evaluate(
      async (origin) => {
        const plugin = window.app.plugins.plugins["dualtran-translate"];
        Object.assign(plugin.settings, {
          engine: "ai",
          targetLanguage: "zh-CN",
          aiProvider: "openai",
          aiApiKey: "test-key",
          aiModel: "gpt-5",
          aiBaseUrl: origin + "/v1",
          aiReasoningDepth: "high",
        });
        await plugin.saveSettings();
        const leaf = window.app.workspace.getLeaf(true);
        await leaf.openFile(window.app.vault.getAbstractFileByPath("note.md"));
        window.app.workspace.setActiveLeaf(leaf, { focus: true });
        const view = leaf.view;
        view.editor.focus();
        view.editor.setValue("AI request body check\n");
        view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 20 });
        await window.app.commands.executeCommandById("dualtran-translate:translate-selection-replace");
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && !view.editor.getValue().includes("译文")) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { value: view.editor.getValue(), settings: { ...plugin.settings } };
      },
      mock.origin
    );
    assert(
      String(aiResult.value).includes("译文"),
      `AI path did not replace the selection: ${aiResult.value} (settings: ${JSON.stringify(aiResult.settings)})`
    );
    // The command resolves after the stream ends, but give the server a moment.
    const requestDeadline = Date.now() + 3000;
    while (Date.now() < requestDeadline && !mock.requests.some((e) => e.url.startsWith("/v1/chat/completions"))) {
      await sleep(100);
    }
    const call = mock.requests.find((entry) => entry.url.startsWith("/v1/chat/completions"));
    assert(
      call,
      `the AI request never reached the mock endpoint (seen: ${JSON.stringify(mock.requests.map((r) => r.url))})`
    );
    assert(call.body.model === "gpt-5", `wrong model on the wire: ${call.body.model}`);
    assert(call.body.reasoning_effort === "high", `wrong reasoning on the wire: ${call.body.reasoning_effort}`);
    fs.writeFileSync(path.join(ARTIFACTS, "ai-requests.json"), JSON.stringify(mock.requests, null, 2));
    await page.screenshot({ path: path.join(ARTIFACTS, "ai-translate.png") });

    // 4) a slow request shows the loading notice and clears it afterwards
    mock.setAi({ delayMs: 1200 });
    const loading = await page.evaluate(async () => {
      // Active leaf may not be our note after the previous scenario; reopen it.
      const leaf = window.app.workspace.getLeaf(true);
      await leaf.openFile(window.app.vault.getAbstractFileByPath("note.md"));
      window.app.workspace.setActiveLeaf(leaf, { focus: true });
      const view = leaf.view;
      view.editor.focus();
      view.editor.setValue("Hello world, this is a test note.\n");
      view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 11 });
      // Command dispatch is covered above; here the point is the loading notice,
      // so call the same method the command delegates to.
      const plugin = window.app.plugins.plugins["dualtran-translate"];
      const pending = plugin.translateSelection(view.editor, "replace");
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Obsidian 1.14 mounts the Notice in the window it was created for, which
      // is not always the document Playwright attached to; assert on the notice
      // object itself and on the rendered spinner inside it.
      const notice = plugin.loadingNotice;
      const el = notice && notice.noticeEl;
      const spinner = el ? el.querySelector(".dualtran-spinner") : null;
      const during = {
        hasNotice: !!notice,
        text: el ? (el.textContent || "").trim() : "",
        hasSpinner: !!spinner,
        display: spinner ? getComputedStyle(spinner).display : null,
        width: spinner ? getComputedStyle(spinner).width : null,
      };
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { during, after: plugin.loadingNotice ? "still-set" : "cleared" };
    });
    assert(loading.during.hasNotice, "no loading notice was created");
    assert(loading.during.hasSpinner, "the loading notice has no spinner element");
    assert(loading.during.display !== "none", `the spinner is not displayed: ${loading.during.display}`);
    assert(
      loading.during.text.length > 0,
      "the loading notice had no text"
    );
    assert(loading.after === "cleared", "the loading notice was not cleared after the request");
    await page.screenshot({ path: path.join(ARTIFACTS, "loading.png") });

    // 5) a failing endpoint reports the error and leaves the note alone
    mock.setAi({ status: 401, delayMs: 0 });
    const failure = await page.evaluate(async () => {
      const leaf = window.app.workspace.getLeaf(true);
      await leaf.openFile(window.app.vault.getAbstractFileByPath("note.md"));
      window.app.workspace.setActiveLeaf(leaf, { focus: true });
      const view = leaf.view;
      view.editor.focus();
      const original = "Keep me unchanged, please.\n";
      view.editor.setValue(original);
      view.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
      const plugin = window.app.plugins.plugins["dualtran-translate"];
      await plugin.translateSelection(view.editor, "replace");
      await new Promise((resolve) => setTimeout(resolve, 300));
      // The UI swallows the error into a Notice; the transport must still reject,
      // which is the part that can actually regress silently.
      let transportError = null;
      try {
        await plugin.bridge.translateBlocks(["Hello world"]);
      } catch (error) {
        transportError = String(error && error.message ? error.message : error);
      }
      return {
        text: view.editor.getValue(),
        loadingCleared: !plugin.loadingNotice,
        transportError,
      };
    });
    assert(failure.text === "Keep me unchanged, please.\n", "a failed translation modified the note");
    assert(
      /401|unauthorized/i.test(failure.transportError || ""),
      `the transport did not surface the 401: ${failure.transportError}`
    );
    assert(failure.loadingCleared, "the loading notice stayed after a failure");
    await page.screenshot({ path: path.join(ARTIFACTS, "error-path.png") });

    // 6) the language switch really re-renders the plugin, not just a dictionary
    const de = JSON.parse(fs.readFileSync(path.join(ROOT, "locales", "de", "messages.json"), "utf8"));
    const i18n = await page.evaluate(async () => {
      const plugin = window.app.plugins.plugins["dualtran-translate"];
      // What the settings dropdown does: persist, rebuild, re-register commands.
      plugin.settings.uiLang = "de";
      await plugin.saveSettings();
      plugin.applyLanguage();
      plugin.registerCommands();
      // Render our settings tab into a detached container: the modal itself is
      // Obsidian's chrome, what matters here is the labels the plugin produces.
      const tabs = (window.app.setting && window.app.setting.pluginTabs) || [];
      const tab = tabs.find(
        (entry) =>
          entry.id === "dualtran-translate" ||
          (entry.manifest && entry.manifest.id === "dualtran-translate") ||
          (entry.plugin && entry.plugin.manifest && entry.plugin.manifest.id === "dualtran-translate")
      );
      if (!tab) {
        return {
          names: [],
          descs: [],
          commands: {},
          leaks: [],
          code: plugin.locale,
          debug: { tabs: tabs.length, ids: tabs.map((entry) => entry.id || null) },
        };
      }
      tab.containerEl = createDiv();
      tab.display();
      const names = Array.from(tab.containerEl.querySelectorAll(".setting-item-name")).map((node) =>
        node.textContent.trim()
      );
      const descs = Array.from(tab.containerEl.querySelectorAll(".setting-item-description")).map((node) =>
        node.textContent.trim()
      );
      const commands = Object.fromEntries(
        Object.entries(window.app.commands.commands)
          .filter(([id]) => id.startsWith("dualtran-translate:"))
          .map(([id, command]) => [id, command.name])
      );
      const leaks = names.filter((name) => /^[a-z][A-Za-z]*$/.test(name));
      const debug = {
        settingRows: document.querySelectorAll(".setting-item").length,
        sample: Array.from(document.querySelectorAll(".setting-item")).slice(0, 3).map((node) => ({
          text: node.textContent.trim().slice(0, 40),
          parent: node.parentElement ? node.parentElement.className : null,
          nameNodes: node.querySelectorAll(".setting-item-name").length,
        })),
        modals: document.querySelectorAll(".modal-container, .modal").length,
        tabs: Array.from(document.querySelectorAll(".vertical-tab-nav-item")).map((node) => node.textContent.trim()),
        bodyHint: (document.querySelector(".modal-container, .modal") || document.body).className,
      };
      return { names, descs, commands, leaks, code: plugin.locale, debug };
    });
    assert(i18n.code === "de", `the plugin translator must switch to German, got "${i18n.code}"`);
    if (i18n.names.length === 0) throw new Error(`settings modal empty: ${JSON.stringify(i18n.debug)}`);
    assert(i18n.names.includes(de.settingLanguage.message), `settings must be German, got ${i18n.names.join(" | ")}`);
    assert(i18n.names.includes(de.settingEngine.message), `engine setting must be German, got ${i18n.names.join(" | ")}`);
    assert(i18n.names.includes(de.settingTarget.message), `target setting must be German, got ${i18n.names.join(" | ")}`);
    assert(i18n.descs.includes(de.settingEngineDesc.message), `settings description must be German, got ${i18n.descs.join(" | ")}`);
    assert(i18n.leaks.length === 0, `untranslated setting names: ${i18n.leaks.join(", ")}`);
    const replaceName = i18n.commands["dualtran-translate:translate-selection-replace"];
    // Obsidian prefixes the plugin name; the localised part is the suffix.
    assert(
      typeof replaceName === "string" && replaceName.endsWith(de.cmdTranslateReplace.message),
      `command names must follow the locale, got "${replaceName}"`
    );
    await page.screenshot({ path: path.join(ARTIFACTS, "i18n-de.png") });

    // Back to auto so a later scenario is not stuck in German.
    await page.evaluate(async () => {
      const plugin = window.app.plugins.plugins["dualtran-translate"];
      plugin.settings.uiLang = "";
      await plugin.saveSettings();
      plugin.applyLanguage();
      plugin.registerCommands();
    });

    fs.writeFileSync(path.join(ARTIFACTS, "ok.txt"), "obsidian e2e passed\n");
    console.log("\nObsidian E2E: all checks passed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    child.kill("SIGTERM");
    await sleep(1500);
    if (!child.killed) child.kill("SIGKILL");
    fs.writeFileSync(path.join(ARTIFACTS, "obsidian.log"), log.join("").slice(-20000));
    fs.writeFileSync(path.join(ARTIFACTS, "proxy-seen.json"), JSON.stringify(proxy.seen, null, 2));
    await mock.close();
    await proxy.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Obsidian E2E failed:", error);
  try {
    fs.writeFileSync(path.join(ARTIFACTS, "error.txt"), String(error && error.stack ? error.stack : error));
  } catch {
    /* artifacts may not exist */
  }
  process.exit(1);
});
