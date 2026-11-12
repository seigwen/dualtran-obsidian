import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  getLanguage,
  requestUrl,
} from "obsidian";
import type { Editor } from "obsidian";
import { createBridge, createRequestUrlFetch, createResponseFetch } from "./bridge";
import { coreNamespace } from "./coreAdapter";
import {
  CUSTOM_MODEL_VALUE,
  effectiveBaseUrl,
  endpointState,
  languageOptions,
  modelPickerState,
  modelReasoningOptions,
  modelsForProvider,
  pickModelForProvider,
  providerIsUnconfigured,
  providerPlaceholderOption,
  providerPickerOptions,
  reasoningDepthChoices,
  resolveEndpointOnProviderChange,
  resolveReasoningDepth,
  summarizeCatalog,
  type CatalogCore,
  type ModelOption,
  type ModelsDevData,
  type ModelsDevStore,
  type ProviderDef,
} from "./catalog";
import { insertBelowSelection, replaceSelectionWith } from "./editorOps";
import { DEFAULT_SETTINGS, DualTranSettings, LOWEST_REASONING, sanitizeSettings } from "./settings";
import { createObsidianStorage } from "./storage";
import { LOCALE_CODES, LOCALE_NAMES, createTranslator, obsidianLocale, type Translator } from "./i18n";

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
  /** Resolved catalogue code ("de", "zh_CN", …) and its translator. */
  locale = "en";
  t: Translator["t"] = (key) => key;

  async onload(): Promise<void> {
    this.settings = sanitizeSettings(await this.loadData());
    this.applyLanguage();
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
      resolveReasoningDepth: (settings) => this.reasoningDepthFor(settings),
      providerRequiredError: () => this.t("providerRequiredError"),
    });

    this.addSettingTab(new DualTranSettingTab(this.app, this));
    this.registerCommands();
  }

  /**
   * Resolve the interface language (settings override → Obsidian's own language)
   * and rebuild the translator. Called on load and whenever the picker changes.
   */
  applyLanguage(): void {
    const translator = createTranslator(this.settings.uiLang || obsidianLocale(getLanguage()));
    this.locale = translator.code;
    this.t = translator.t;
  }

  /** Commands are (re)registered so their names follow the interface language. */
  registerCommands(): void {
    const commands = [
      {
        id: "translate-selection-replace",
        name: this.t("cmdTranslateReplace"),
        editorCallback: (editor: Editor) => this.translateSelection(editor, "replace"),
      },
      {
        id: "translate-selection-insert",
        name: this.t("cmdTranslateInsert"),
        editorCallback: (editor: Editor) => this.translateSelection(editor, "insert"),
      },
      {
        id: "translate-note",
        name: this.t("cmdTranslateNote"),
        editorCallback: (editor: Editor, ctx: { file: TFile | null }) => this.translateNote(editor, ctx.file),
      },
    ];
    for (const command of commands) {
      // Obsidian 1.4+ can drop a command before re-adding it; older builds only add.
      const remove = (this as unknown as { removeCommand?: (id: string) => void }).removeCommand;
      if (typeof remove === "function") remove.call(this, command.id);
      this.addCommand(command);
    }
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

  /** SPEC 2.1: no provider chosen yet — AI translation must not run. */
  get providerUnconfigured(): boolean {
    return providerIsUnconfigured(this.settings.aiProvider);
  }

  /**
   * Translate through the bridge — the single entry point for both commands and
   * the note action. With no AI provider chosen it refuses with the localized
   * message and never opens a network request.
   */
  async translateBlocks(blocks: string[]): Promise<string[]> {
    if (this.settings.engine === "ai" && this.providerUnconfigured) {
      throw new Error(this.t("providerRequiredError"));
    }
    return this.bridge.translateBlocks(blocks);
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

  /** Core's dialect-clipped effort options for the current provider + model. */
  reasoningOptionsFor(provider: string, model: string): Array<{ value: string; label?: string }> {
    try {
      const core = this.core;
      if (typeof core?.buildReasoningDepthOptions !== "function") return [];
      const reasoningOptions = modelReasoningOptions({
        data: this.catalog,
        resolveId: (id) => this.resolveProviderId(id),
        provider,
        model,
      });
      const npm = this.catalog?.[this.resolveProviderId(provider)]?.npm;
      // Call through the object so the receiver stays `core` (no unbound method).
      const options = core.buildReasoningDepthOptions({ provider, npm, reasoningOptions });
      return Array.isArray(options) ? options : [];
    } catch {
      return [];
    }
  }

  /** Stored setting → the value the core will send (`lowest` is resolved per model). */
  reasoningDepthFor(settings: DualTranSettings): string {
    return resolveReasoningDepth({
      setting: settings.aiReasoningDepth,
      options: this.reasoningOptionsFor(settings.aiProvider, settings.aiModel),
    });
  }

  // ── loading feedback ──────────────────────────────────────────────

  private loadingNotice: Notice | null = null;

  private showLoading(message: string): void {
    this.hideLoading();
    const notice = new Notice(message, 0);
    // CSS comes from styles.css (the directory forbids injecting <style>), so the
    // element only needs its class names here.
    notice.messageEl.classList.add("dualtran-loading");
    notice.messageEl.prepend(createSpan({ cls: "dualtran-spinner" }));
    this.loadingNotice = notice;
  }

  private hideLoading(): void {
    if (!this.loadingNotice) return;
    this.loadingNotice.hide();
    this.loadingNotice = null;
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
      new Notice(this.t("noticeNothingSelected"));
      return;
    }
    this.showLoading(this.t("loadingSelection"));
    try {
      const [translated] = await this.translateBlocks([selection]);
      if (mode === "replace") {
        replaceSelectionWith(editor, translated ?? "");
      } else {
        insertBelowSelection(editor, translated ?? "");
      }
    } catch (error) {
      this.hideLoading();
      new Notice(this.t("noticeError", { ERROR: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.hideLoading();
    }
  }

  private async translateNote(editor: Editor, file: TFile | null): Promise<void> {
    const source = editor.getValue();
    if (!source.trim()) {
      new Notice(this.t("noticeNoteEmpty"));
      return;
    }
    // Whole-note mode: split into blank-line separated blocks, translate each
    // batch through the configured engine, re-join as the new note.
    const blocks = source.split(/\n{2,}/);
    this.showLoading(this.t("loadingNote"));
    try {
      const translatedBlocks = await this.translateBlocks(blocks);
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
      this.hideLoading();
      new Notice(this.t("noticeWrote", { PATH: outPath }));
    } catch (error) {
      this.hideLoading();
      new Notice(this.t("noticeError", { ERROR: error instanceof Error ? error.message : String(error) }));
    } finally {
      this.hideLoading();
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
      .setName(this.plugin.t("settingLanguage"))
      .setDesc(this.plugin.t("settingLanguageDesc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", this.plugin.t("languageAuto"));
        for (const code of LOCALE_CODES) dropdown.addOption(code, LOCALE_NAMES[code] || code);
        dropdown.setValue(this.plugin.settings.uiLang || "");
        dropdown.onChange(async (value) => {
          this.plugin.settings.uiLang = value;
          await this.plugin.saveSettings();
          this.plugin.applyLanguage();
          this.plugin.registerCommands();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(this.plugin.t("settingEngine"))
      .setDesc(this.plugin.t("settingEngineDesc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ google: this.plugin.t("engineGoogle"), ai: this.plugin.t("engineAi") })
          .setValue(settings.engine)
          .onChange(async (value) => {
            settings.engine = value as DualTranSettings["engine"];
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settingSource"))
      .setDesc(this.plugin.t("settingSourceDesc"))
      .addText((text) =>
        text.setValue(settings.sourceLanguage).onChange(async (value) => {
          settings.sourceLanguage = value.trim() || "auto";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName(this.plugin.t("settingTarget"))
      .setDesc(this.plugin.t("settingTargetDesc"))
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
      .setName(this.plugin.t("settingProvider"))
      .setDesc(this.plugin.t("settingProviderDesc"))
      .addDropdown((dropdown) => {
        const unconfigured = providerIsUnconfigured(settings.aiProvider);
        // SPEC 2.1: a fresh install has no provider. The picker shows one
        // disabled, selected placeholder on top of the real options; it is not
        // part of the list and never takes part in the sort.
        if (unconfigured) {
          const placeholder = providerPlaceholderOption({ t: this.plugin.t });
          dropdown.addOption(placeholder.value, placeholder.label);
          // Disable the placeholder row, not the picker: the user must be able
          // to choose a provider from the empty state.
          const placeholderOption = dropdown.selectEl?.options?.[0];
          if (placeholderOption) placeholderOption.disabled = true;
        }
        for (const provider of providerPickerOptions({
          data,
          builtIns,
          selectedId: unconfigured ? "" : settings.aiProvider,
          resolveId,
          t: this.plugin.t,
        })) {
          dropdown.addOption(provider.id, provider.label);
        }

        dropdown.setValue(unconfigured ? "" : settings.aiProvider).onChange(async (value) => {
          // "" is the disabled placeholder: there is no way back to an empty
          // provider once one has been chosen, and no "None" entry.
          if (value) {
            await this.applyProviderChoice(value);
          }
        });
      });

    new Setting(containerEl)
      .setName(this.plugin.t("settingApiKey"))
      .setDesc(this.plugin.t("settingApiKeyDesc"))
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(settings.aiApiKey).onChange(async (value) => {
          settings.aiApiKey = value.trim();
          await this.plugin.saveSettings();
        });
      });

    // modelsForProvider always appends the free-text entry last. With no
    // provider chosen the picker is empty and disabled (SPEC 2.1).
    const modelState = modelPickerState({
      provider: settings.aiProvider,
      current: settings.aiModel,
      data,
      resolveId,
      t: this.plugin.t,
    });
    const models = modelState.options;
    const catalogueModels = models.filter((model) => model.value !== CUSTOM_MODEL_VALUE);
    const modelIsListed = catalogueModels.some((model) => model.value === settings.aiModel);
    const customModel = !modelState.disabled && !modelIsListed;
    let customRow: Setting | null = null;

    new Setting(containerEl)
      .setName(this.plugin.t("settingModel"))
      .setDesc(
        catalogueModels.length
          ? this.plugin.t("settingModelDescListed")
          : this.plugin.t("settingModelDescMissing")
      )
      .addDropdown((dropdown) => {
        if (modelState.disabled) {
          // Empty list, disabled, labelled "Select a provider first".
          dropdown.addOption("", modelState.placeholder);
          if (typeof dropdown.setDisabled === "function") dropdown.setDisabled(true);
          return;
        }
        for (const model of models) dropdown.addOption(model.value, model.text);
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
          // Reasoning options are model-specific — refresh the pane so the
          // effort dropdown matches the model the user just picked.
          this.display();
        });
      });

    customRow = new Setting(containerEl)
      .setName(this.plugin.t("settingCustomModel"))
      .setDesc(this.plugin.t("settingCustomModelDesc"))
      .addText((text) =>
        text
          .setPlaceholder(this.plugin.t("placeholderModelId"))
          .setValue(settings.aiModel)
          .onChange(async (value) => {
            settings.aiModel = value.trim();
            await this.plugin.saveSettings();
          })
      );
    customRow.settingEl.style.display = customModel ? "" : "none";

    // Reasoning effort: options come from the model's models.dev declaration,
    // clipped by the core to what the provider dialect accepts. Without a
    // provider the picker is disabled and the stored sentinel is left alone.
    const reasoningDisabled = providerIsUnconfigured(settings.aiProvider);
    const reasoningOptions = reasoningDisabled
      ? []
      : this.plugin.reasoningOptionsFor(settings.aiProvider, settings.aiModel);
    const reasoningChoices = reasoningDepthChoices({ options: reasoningOptions, t: this.plugin.t });
    if (
      this.plugin.catalogLoaded &&
      settings.aiReasoningDepth &&
      !reasoningChoices.some((choice) => choice.value === settings.aiReasoningDepth)
    ) {
      // The newly selected model does not offer this level — fall back to lowest.
      settings.aiReasoningDepth = LOWEST_REASONING;
      void this.plugin.saveSettings();
    }
    const reasoningValue = reasoningChoices.some((choice) => choice.value === settings.aiReasoningDepth)
      ? settings.aiReasoningDepth
      : LOWEST_REASONING;
    const reasoningItems = reasoningChoices.some((choice) => choice.value === reasoningValue)
      ? reasoningChoices
      : [...reasoningChoices, { value: reasoningValue, text: reasoningValue }];

    new Setting(containerEl)
      .setName(this.plugin.t("settingReasoning"))
      .setDesc(reasoningOptions.length > 1 ? this.plugin.t("settingReasoningDesc") : this.plugin.t("settingReasoningDescNone"))
      .addDropdown((dropdown) => {
        if (reasoningDisabled) {
          // Stored sentinel stays untouched; the picker only waits for a provider.
          dropdown.addOption("", modelState.placeholder);
          if (typeof dropdown.setDisabled === "function") dropdown.setDisabled(true);
          return;
        }
        for (const choice of reasoningItems) dropdown.addOption(choice.value, choice.text);
        dropdown.setValue(reasoningValue).onChange(async (value) => {
          settings.aiReasoningDepth = value;
          await this.plugin.saveSettings();
        });
      });

    // The provider's api base is written into the value (not only a
    // placeholder) so the box is filled the moment a provider is chosen; it
    // stays an ordinary editable text override from there on. Without a
    // provider the box is empty and shows `https://` as its placeholder.
    const endpoint = endpointState({
      provider: settings.aiProvider,
      stored: settings.aiBaseUrl,
      data,
      builtIns,
      resolveId,
    });
    if (endpoint.autofill && !settings.aiBaseUrl.trim()) {
      settings.aiBaseUrl = endpoint.value;
      settings.aiEndpointStale = true;
      void this.plugin.saveSettings();
    }
    new Setting(containerEl)
      .setName(this.plugin.t("settingBaseUrl"))
      .setDesc(this.plugin.t("settingBaseUrlDesc"))
      .addText((text) =>
        text
          .setPlaceholder(endpoint.placeholder)
          .setValue(endpoint.value)
          .onChange(async (value) => {
            settings.aiBaseUrl = value.trim();
            // Anything typed here is the user's own value: never overwritten.
            settings.aiEndpointStale = false;
            await this.plugin.saveSettings();
          })
      );

    const summary = summarizeCatalog(data);
    const status = !this.plugin.catalogLoaded
      ? this.plugin.t("catalogLoading")
      : summary.offline
        ? this.plugin.t("catalogOffline")
        : this.plugin.t("catalogSummary", { PROVIDERS: summary.providerCount, MODELS: summary.modelCount });
    new Setting(containerEl)
      .setName(this.plugin.t("settingCatalog"))
      .setDesc(status)
      .addButton((button) =>
        button.setButtonText(this.plugin.t("btnRefresh")).onClick(async () => {
          button.setDisabled(true).setButtonText(this.plugin.t("btnRefreshing"));
          await this.plugin.refreshCatalog();
          this.display();
        })
      );

    // The pane's primary action. Without an AI provider it stays disabled and
    // explains why with the same localized message the request path throws.
    const needsProvider = settings.engine === "ai" && providerIsUnconfigured(settings.aiProvider);
    new Setting(containerEl)
      .setName(this.plugin.t("settingTranslateNow"))
      .setDesc(this.plugin.t("settingTranslateNowDesc"))
      .addButton((button) => {
        button.setButtonText(this.plugin.t("btnTranslateNow")).onClick(() => this.translateExample());
        if (needsProvider) {
          button.setDisabled(true);
          button.buttonEl.setAttribute("title", this.plugin.t("providerRequiredError"));
          button.buttonEl.setAttribute("aria-label", this.plugin.t("providerRequiredError"));
        }
      });

    if (!this.plugin.catalogLoaded) {
      void this.plugin.ensureCatalog().then(() => this.redrawAfterLoad());
    }
  }

  /**
   * Provider picker choice (SPEC 2.1). Picking a real provider fills the model
   * list, writes the provider api into the endpoint *value*, enables reasoning
   * and redraws. An endpoint the user typed is never overwritten; the pane's own
   * autofilled value follows the provider. `""` (the placeholder) is ignored.
   */
  private async applyProviderChoice(value: string): Promise<void> {
    if (!value) return;
    const settings = this.plugin.settings;
    const builtIns = this.plugin.builtInProviders;
    const resolveId = (id: string) => this.plugin.resolveProviderId(id);
    const data = this.plugin.catalog;

    const nextModel = pickModelForProvider({
      models: modelsForProvider({ provider: value, data, resolveId }),
      current: settings.aiModel,
      provider: value,
      smartDefault: (args) => this.plugin.smartDefaultModel(args),
    });
    const nextBaseUrl = effectiveBaseUrl({ provider: value, data, builtIns, resolveId });
    const previousBaseUrl = effectiveBaseUrl({ provider: settings.aiProvider, data, builtIns, resolveId });
    const untouched = settings.aiEndpointStale;
    const previousEndpoint = settings.aiBaseUrl;
    // The endpoint box always carries a value: an untouched box (or one still
    // on the previous default) follows the provider, a typed override survives.
    const nextEndpoint = resolveEndpointOnProviderChange({
      current: settings.aiBaseUrl,
      previousDefault: previousBaseUrl,
      nextDefault: nextBaseUrl,
      untouched,
    });
    // Fresh provider: the model belongs to the old provider and must not leak.
    // This must also run on a fresh install where aiBaseUrl is still empty;
    // otherwise the model picker falls into its custom-entry state.
    if (value !== settings.aiProvider || !settings.aiModel) {
      settings.aiModel = nextModel || "";
    }
    settings.aiBaseUrl = nextEndpoint;
    settings.aiEndpointStale = untouched || nextEndpoint !== previousEndpoint;
    settings.aiProvider = value;
    await this.plugin.saveSettings();
    this.display();
  }

  /** Primary pane action: translate a short sample with the configured engine. */
  private async translateExample(): Promise<void> {
    try {
      const [translated] = await this.plugin.translateBlocks([this.plugin.t("translateExampleText")]);
      new Notice(this.plugin.t("noticeExample", { TEXT: translated ?? "" }));
    } catch (error) {
      new Notice(this.plugin.t("noticeError", { ERROR: error instanceof Error ? error.message : String(error) }));
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
    const wanted = getLanguage().toLowerCase();
    const exact = Object.keys(tables).find((code) => code.toLowerCase() === wanted);
    if (exact) return tables[exact];
    const prefix = wanted.split("-")[0];
    const near = Object.keys(tables).find((code) => code.toLowerCase().split("-")[0] === prefix);
    return (near && tables[near]) || fallback;
  }
}
