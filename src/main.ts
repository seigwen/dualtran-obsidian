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
import { createBridge, createRequestUrlFetch, createResponseFetch } from "./bridge";
import { coreNamespace } from "./coreAdapter";
import {
  CUSTOM_MODEL_VALUE,
  PROVIDER_SEPARATOR_VALUE,
  effectiveBaseUrl,
  languageOptions,
  modelsForProvider,
  pickModelForProvider,
  projectProviders,
  summarizeCatalog,
  type CatalogCore,
  type ModelOption,
  type ModelsDevData,
  type ModelsDevStore,
  type ProviderDef,
} from "./catalog";
import { insertBelowSelection, replaceSelectionWith } from "./editorOps";
import { DEFAULT_SETTINGS, DualTranSettings, sanitizeSettings } from "./settings";
import { createObsidianStorage } from "./storage";

/** Cache key for the models.dev payload (device-local, see src/storage.ts). */
const MODELSDEV_CACHE_KEY = "dualtran:modelsdev:v1";

export default class DualTranPlugin extends Plugin {
  settings: DualTranSettings = DEFAULT_SETTINGS;
  /** models.dev payload (null until loaded / when offline). */
  catalog: ModelsDevData | null = null;
  catalogLoaded = false;
  private bridge!: ReturnType<typeof createBridge>;
  private store!: ModelsDevStore;
  private core!: CatalogCore;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.core = coreNamespace as unknown as CatalogCore;

    // requestUrl bypasses CORS on desktop and mobile alike — the core gets it
    // through the fetchImpl injection point. The same adapter fetches models.dev,
    // so the plugin never opens a second network path.
    const requestUrlImpl = (req: {
      url: string;
      method?: string;
      headers?: unknown;
      body?: unknown;
      throw?: boolean;
    }) =>
      requestUrl({
        url: req.url,
        method: req.method,
        headers: req.headers as Record<string, string> | undefined,
        body: typeof req.body === "string" ? req.body : undefined,
        throw: false,
      });

    const fetchImpl = createRequestUrlFetch(requestUrlImpl);
    // The AI SDK reads a real Response; going through requestUrl keeps providers
    // that answer no CORS headers (Anthropic et al.) reachable from app://obsidian.md.
    const aiFetch = createResponseFetch(requestUrlImpl);

    this.store = this.core.createModelsDevStore({
      storage: createObsidianStorage(this.app),
      fetch: fetchImpl,
      now: () => Date.now(),
      cacheKey: MODELSDEV_CACHE_KEY,
    });

    this.bridge = createBridge({
      core: coreNamespace,
      fetchImpl,
      getSettings: () => this.settings,
      getStore: () => this.store,
      aiFetch,
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

  // ── catalogue accessors (defensive: the pane must survive a core reshuffle) ──

  get builtInProviders(): ProviderDef[] {
    return Array.isArray(this.core?.BUILT_IN_PROVIDERS) ? this.core.BUILT_IN_PROVIDERS : [];
  }

  resolveProviderId(id: string): string {
    try {
      return this.core?.resolveModelsDevId ? this.core.resolveModelsDevId(id) : id;
    } catch {
      return id;
    }
  }

  smartDefaultModel(args: { provider: string; models: ModelOption[] }): string | null {
    try {
      return this.core?.getSmartDefaultModel ? this.core.getSmartDefaultModel(args) : null;
    } catch {
      return null;
    }
  }

  get languageTables(): Record<string, Record<string, string>> {
    return this.core?.allLanguagesNames || {};
  }

  /** Load the catalogue once; failures leave the pane on the built-in list. */
  async ensureCatalog(): Promise<void> {
    if (this.catalogLoaded) return;
    try {
      this.catalog = (await this.store.getProvidersData()) ?? null;
    } catch {
      this.catalog = null;
    }
    this.catalogLoaded = true;
  }

  /** Drop the cached payload and fetch again (the Refresh button). */
  async refreshCatalog(): Promise<void> {
    try {
      this.app.saveLocalStorage(MODELSDEV_CACHE_KEY, null);
    } catch {
      // storage unavailable: the in-memory refresh below still runs
    }
    try {
      await this.store.refreshProvidersData();
    } catch {
      // offline: keep the previous payload
    }
    try {
      this.catalog = (await this.store.getProvidersData()) ?? null;
    } catch {
      this.catalog = null;
    }
    this.catalogLoaded = true;
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
  private redrawQueued = false;

  constructor(app: App, plugin: DualTranPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const settings = this.plugin.settings;
    const builtIns = this.plugin.builtInProviders;
    const resolveId = (id: string) => this.plugin.resolveProviderId(id);
    const data = this.plugin.catalog;

    new Setting(containerEl)
      .setName("Engine")
      .setDesc("Google is free and needs no account. AI uses your own provider key (BYOK).")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ google: "Google", ai: "AI (BYOK)" })
          .setValue(settings.engine)
          .onChange(async (value) => {
            settings.engine = value as DualTranSettings["engine"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Source language")
      .setDesc('Language code the text is written in — "auto" detects it.')
      .addText((text) =>
        text.setValue(settings.sourceLanguage).onChange(async (value) => {
          settings.sourceLanguage = value.trim() || "auto";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Target language")
      .setDesc("Language the translated text is written in.")
      .addDropdown((dropdown) => {
        for (const option of languageOptions({ names: this.languageNames(), current: settings.targetLanguage })) {
          dropdown.addOption(option.value, option.text);
        }
        dropdown.setValue(settings.targetLanguage).onChange(async (value) => {
          settings.targetLanguage = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("AI provider")
      .setDesc("Built-in providers first, then everything models.dev knows about (refreshed daily).")
      .addDropdown((dropdown) => {
        let separatorAdded = false;
        for (const provider of projectProviders({
          data,
          builtIns,
          selectedId: settings.aiProvider,
          resolveId,
        })) {
          if (provider.source === "models.dev" && !separatorAdded) {
            dropdown.addOption(PROVIDER_SEPARATOR_VALUE, "──── models.dev ────");
            separatorAdded = true;
          }
          dropdown.addOption(provider.id, provider.label);
        }
        const separator = dropdown.selectEl.querySelector(
          `option[value="${PROVIDER_SEPARATOR_VALUE}"]`
        ) as HTMLOptionElement | null;
        if (separator) separator.disabled = true;

        dropdown.setValue(settings.aiProvider).onChange(async (value) => {
          if (value === PROVIDER_SEPARATOR_VALUE) {
            dropdown.setValue(settings.aiProvider);
            return;
          }
          const models = modelsForProvider({ provider: value, data, resolveId });
          const nextModel = pickModelForProvider({
            models,
            current: settings.aiModel,
            provider: value,
            smartDefault: (args) => this.plugin.smartDefaultModel(args),
          });
          settings.aiProvider = value;
          if (nextModel) settings.aiModel = nextModel;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("AI API key")
      .setDesc("Stored locally on this device only.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(settings.aiApiKey).onChange(async (value) => {
          settings.aiApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    const models = modelsForProvider({ provider: settings.aiProvider, data, resolveId });
    const modelIsListed = models.some((model) => model.value === settings.aiModel);
    const customModel = !modelIsListed;
    let customRow: Setting | null = null;

    new Setting(containerEl)
      .setName("AI model")
      .setDesc(
        models.length
          ? "Models models.dev lists for this provider."
          : "No catalogue entry for this provider — enter a model id below."
      )
      .addDropdown((dropdown) => {
        for (const model of models) dropdown.addOption(model.value, model.text);
        dropdown.addOption(CUSTOM_MODEL_VALUE, "自定义… / Custom…");
        dropdown.setValue(customModel ? CUSTOM_MODEL_VALUE : settings.aiModel).onChange(async (value) => {
          const wantsCustom = value === CUSTOM_MODEL_VALUE;
          if (customRow) customRow.settingEl.style.display = wantsCustom ? "" : "none";
          if (wantsCustom) {
            const input = customRow?.controlEl.querySelector("input") as HTMLInputElement | null;
            input?.focus();
            return;
          }
          settings.aiModel = value;
          await this.plugin.saveSettings();
        });
      });

    customRow = new Setting(containerEl)
      .setName("Custom model id")
      .setDesc("Passed to the provider as-is.")
      .addText((text) =>
        text
          .setPlaceholder("model-id")
          .setValue(settings.aiModel)
          .onChange(async (value) => {
            settings.aiModel = value.trim();
            await this.plugin.saveSettings();
          })
      );
    customRow.settingEl.style.display = customModel ? "" : "none";

    const defaultBaseUrl = effectiveBaseUrl({ provider: settings.aiProvider, data, builtIns, resolveId });
    new Setting(containerEl)
      .setName("AI base URL (optional)")
      .setDesc("Leave empty to use the provider endpoint shown in the field.")
      .addText((text) =>
        text
          .setPlaceholder(defaultBaseUrl || "https://api.example.com/v1")
          .setValue(settings.aiBaseUrl)
          .onChange(async (value) => {
            settings.aiBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    const summary = summarizeCatalog(data);
    const status = !this.plugin.catalogLoaded
      ? "Loading provider list…"
      : summary.offline
        ? "models.dev unavailable — built-in providers only."
        : `${summary.providerCount} providers · ${summary.modelCount} models from models.dev.`;
    new Setting(containerEl)
      .setName("Provider & model list")
      .setDesc(status)
      .addButton((button) =>
        button.setButtonText("Refresh").onClick(async () => {
          button.setDisabled(true).setButtonText("Refreshing…");
          await this.plugin.refreshCatalog();
          this.display();
        })
      );

    if (!this.plugin.catalogLoaded) {
      void this.plugin.ensureCatalog().then(() => this.redrawAfterLoad());
    }
  }

  /** Redraw once the catalogue arrives — but never while the user is typing in the pane. */
  private redrawAfterLoad(): void {
    if (this.redrawQueued) return;
    this.redrawQueued = true;
    const active = document.activeElement as HTMLElement | null;
    const typing =
      !!active &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA") &&
      this.containerEl.contains(active);
    if (typing) return;
    this.display();
  }

  /** Language names in Obsidian's own UI language when models.dev-aligned, else English. */
  private languageNames(): Record<string, string> {
    const tables = this.plugin.languageTables;
    const fallback = tables.en || {};
    const wanted = String((window as any).moment?.locale?.() || "en").toLowerCase();
    const exact = Object.keys(tables).find((code) => code.toLowerCase() === wanted);
    if (exact) return tables[exact];
    const prefix = wanted.split("-")[0];
    const near = Object.keys(tables).find((code) => code.toLowerCase().split("-")[0] === prefix);
    return (near && tables[near]) || fallback;
  }
}
