import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  requestUrl,
} from "obsidian";
import type { Editor } from "obsidian";
import { createBridge, createRequestUrlFetch } from "./bridge";
import { coreNamespace } from "./coreAdapter";
import { insertBelowSelection, replaceSelectionWith } from "./editorOps";
import { DEFAULT_SETTINGS, DualTranSettings, sanitizeSettings } from "./settings";

export default class DualTranPlugin extends Plugin {
  settings: DualTranSettings = DEFAULT_SETTINGS;
  private bridge!: ReturnType<typeof createBridge>;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());

    // requestUrl bypasses CORS on desktop and mobile alike — the core gets it
    // through the fetchImpl injection point.
    this.bridge = createBridge({
      core: coreNamespace,
      fetchImpl: createRequestUrlFetch((req) =>
        requestUrl({
          url: req.url,
          method: req.method,
          headers: req.headers as Record<string, string> | undefined,
          body: typeof req.body === "string" ? req.body : undefined,
          throw: false,
        })
      ),
      getSettings: () => this.settings,
    });

    this.addSettingTab(new DualTranSettingTab(this.app, this));

    this.addCommand({
      id: "translate-selection-replace",
      name: "Translate selection (replace)",
      editorCallback: (editor) => this.translateSelection(editor, "replace"),
    });
    this.addCommand({
      id: "translate-selection-insert",
      name: "Translate selection (insert below)",
      editorCallback: (editor) => this.translateSelection(editor, "insert"),
    });
    this.addCommand({
      id: "translate-note",
      name: "Translate note to a new file",
      editorCallback: (editor, ctx) => this.translateNote(editor, ctx.file),
    });
  }

  private async translateSelection(editor: Editor, mode: "replace" | "insert"): Promise<void> {
    const selection = editor.getSelection().trim();
    if (!selection) {
      new Notice("DualTran: nothing selected.");
      return;
    }
    try {
      const [translated] = await this.bridge.translateBlocks([selection]);
      if (mode === "replace") {
        replaceSelectionWith(editor, translated ?? "");
      } else {
        insertBelowSelection(editor, translated ?? "");
      }
    } catch (error) {
      new Notice(`DualTran: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async translateNote(editor: Editor, file: TFile | null): Promise<void> {
    const source = editor.getValue();
    if (!source.trim()) {
      new Notice("DualTran: the note is empty.");
      return;
    }
    // Whole-note mode: split into blank-line separated blocks, translate each
    // batch through the configured engine, re-join as the new note.
    const blocks = source.split(/\n{2,}/);
    try {
      const translatedBlocks = await this.bridge.translateBlocks(blocks);
      const base = file?.path ?? "Untitled.md";
      const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
      const name = base.slice(base.lastIndexOf("/") + 1).replace(/\.md$/, "");
      const outPath = `${dir}${name} (${this.settings.targetLanguage}).md`;
      const content = translatedBlocks.join("\n\n");
      const existing = this.app.vault.getAbstractFileByPath(outPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(outPath, content);
      }
      new Notice(`DualTran: wrote ${outPath}`);
    } catch (error) {
      new Notice(`DualTran: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class DualTranSettingTab extends PluginSettingTab {
  plugin: DualTranPlugin;

  constructor(app: App, plugin: DualTranPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Engine")
      .setDesc("Google is free and needs no account. AI uses your own provider key (BYOK).")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ google: "Google", ai: "AI (BYOK)" })
          .setValue(this.plugin.settings.engine)
          .onChange(async (value) => {
            this.plugin.settings.engine = value as DualTranSettings["engine"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Source language")
      .setDesc('Language code the text is written in — "auto" detects it.')
      .addText((text) =>
        text.setValue(this.plugin.settings.sourceLanguage).onChange(async (value) => {
          this.plugin.settings.sourceLanguage = value.trim() || "auto";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Target language")
      .setDesc("Language code to translate into (e.g. en, zh-CN, ja).")
      .addText((text) =>
        text.setValue(this.plugin.settings.targetLanguage).onChange(async (value) => {
          this.plugin.settings.targetLanguage = value.trim() || "en";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("AI provider")
      .setDesc("Provider id from @dualtran/core registry (e.g. openai, anthropic, google, deepseek).")
      .addText((text) =>
        text.setValue(this.plugin.settings.aiProvider).onChange(async (value) => {
          this.plugin.settings.aiProvider = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("AI API key")
      .setDesc("Stored locally on this device only.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.plugin.settings.aiApiKey).onChange(async (value) => {
          this.plugin.settings.aiApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("AI model")
      .setDesc("Model id passed to the provider (e.g. gpt-4o-mini).")
      .addText((text) =>
        text.setValue(this.plugin.settings.aiModel).onChange(async (value) => {
          this.plugin.settings.aiModel = value.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("AI base URL (optional)")
      .setDesc("Override the provider endpoint (proxies, OpenAI-compatible servers).")
      .addText((text) =>
        text.setValue(this.plugin.settings.aiBaseUrl).onChange(async (value) => {
          this.plugin.settings.aiBaseUrl = value.trim();
          await this.plugin.saveSettings();
        })
      );
  }
}
