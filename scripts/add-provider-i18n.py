#!/usr/bin/env python3
"""
SPEC 2.1 locale additions for dualtran-obsidian:

  providerPlaceholder     "Select a provider"
  providerRequiredForModel "Select a provider first"
  providerRequiredError   "Choose an AI provider in settings before translating."
  customProviderOption    "Custom provider"   (label of the host's custom provider entry)

Each file keeps its existing keys/order; only the missing keys are appended and
existing human translations are never overwritten. zh_CN / zh_TW are handwritten
(the repo never machine-translates them); every other locale was translated with
the repo's existing translation mechanism (scripts/locale-kit.mjs → local
OpenAI-compatible model, OLLAMA_*), reusing each file's own provider/model
terminology so the strings match the shipped UI.

Usage:
  python3 scripts/add-provider-i18n.py            # write missing keys
  python3 scripts/add-provider-i18n.py --check    # validate only
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOCALES = os.path.join(ROOT, "locales")

KEYS = ("providerPlaceholder", "providerRequiredForModel", "providerRequiredError", "customProviderOption")

EN = {
    "providerPlaceholder": "Select a provider",
    "providerRequiredForModel": "Select a provider first",
    "providerRequiredError": "Choose an AI provider in settings before translating.",
    "customProviderOption": "Custom provider",
}

TRANSLATIONS = {
    "af": {
        "providerPlaceholder": "Kies 'n verskaffer",
        "providerRequiredForModel": "Kies eers 'n verskaffer",
        "providerRequiredError": "Kies 'n KI-verskaffer in die instellings voordat jy vertaal.",
        "customProviderOption": "Pasgemaakte verskaffer",
    },
    "ar": {
        "providerPlaceholder": "اختر مزودًا",
        "providerRequiredForModel": "اختر مزودًا أولاً",
        "providerRequiredError": "اختر مزود الذكاء الاصطناعي في الإعدادات قبل الترجمة.",
        "customProviderOption": "مزود مخصص",
    },
    "ca": {
        "providerPlaceholder": "Selecciona un proveïdor",
        "providerRequiredForModel": "Selecciona primer un proveïdor",
        "providerRequiredError": "Tria un proveïdor d'IA a la configuració abans de traduir.",
        "customProviderOption": "Proveïdor personalitzat",
    },
    "cs": {
        "providerPlaceholder": "Vyberte poskytovatele",
        "providerRequiredForModel": "Nejprve vyberte poskytovatele",
        "providerRequiredError": "Před překladem vyberte v nastavení poskytovatele AI.",
        "customProviderOption": "Vlastní poskytovatel",
    },
    "da": {
        "providerPlaceholder": "Vælg en udbyder",
        "providerRequiredForModel": "Vælg en udbyder først",
        "providerRequiredError": "Vælg en AI-udbyder i indstillingerne, før du oversætter.",
        "customProviderOption": "Tilpasset udbyder",
    },
    "de": {
        "providerPlaceholder": "Anbieter auswählen",
        "providerRequiredForModel": "Zuerst einen Anbieter auswählen",
        "providerRequiredError": "Wähle vor dem Übersetzen einen KI-Anbieter in den Einstellungen.",
        "customProviderOption": "Eigener Anbieter",
    },
    "el": {
        "providerPlaceholder": "Επιλέξτε πάροχο",
        "providerRequiredForModel": "Επιλέξτε πρώτα πάροχο",
        "providerRequiredError": "Επιλέξτε πάροχο AI στις ρυθμίσεις πριν από τη μετάφραση.",
        "customProviderOption": "Προσαρμοσμένος πάροχος",
    },
    "es": {
        "providerPlaceholder": "Selecciona un proveedor",
        "providerRequiredForModel": "Selecciona primero un proveedor",
        "providerRequiredError": "Elige un proveedor de IA en los ajustes antes de traducir.",
        "customProviderOption": "Proveedor personalizado",
    },
    "fa": {
        "providerPlaceholder": "یک ارائه‌دهنده انتخاب کنید",
        "providerRequiredForModel": "ابتدا یک ارائه‌دهنده انتخاب کنید",
        "providerRequiredError": "پیش از ترجمه، یک ارائه‌دهنده هوش مصنوعی در تنظیمات انتخاب کنید.",
        "customProviderOption": "ارائه‌دهنده سفارشی",
    },
    "fi": {
        "providerPlaceholder": "Valitse palveluntarjoaja",
        "providerRequiredForModel": "Valitse ensin palveluntarjoaja",
        "providerRequiredError": "Valitse AI-palveluntarjoaja asetuksista ennen kääntämistä.",
        "customProviderOption": "Mukautettu palveluntarjoaja",
    },
    "fr": {
        "providerPlaceholder": "Sélectionner un fournisseur",
        "providerRequiredForModel": "Sélectionnez d'abord un fournisseur",
        "providerRequiredError": "Choisissez un fournisseur d'IA dans les paramètres avant de traduire.",
        "customProviderOption": "Fournisseur personnalisé",
    },
    "he": {
        "providerPlaceholder": "בחרו ספק",
        "providerRequiredForModel": "בחרו ספק תחילה",
        "providerRequiredError": "בחרו ספק AI בהגדרות לפני התרגום.",
        "customProviderOption": "ספק מותאם אישית",
    },
    "hi": {
        "providerPlaceholder": "प्रदाता चुनें",
        "providerRequiredForModel": "पहले प्रदाता चुनें",
        "providerRequiredError": "अनुवाद करने से पहले सेटिंग्स में AI प्रदाता चुनें।",
        "customProviderOption": "कस्टम प्रदाता",
    },
    "hr": {
        "providerPlaceholder": "Odaberite pružatelja",
        "providerRequiredForModel": "Najprije odaberite pružatelja",
        "providerRequiredError": "Prije prevođenja odaberite AI pružatelja u postavkama.",
        "customProviderOption": "Prilagođeni pružatelj",
    },
    "hu": {
        "providerPlaceholder": "Válasszon szolgáltatót",
        "providerRequiredForModel": "Először válasszon szolgáltatót",
        "providerRequiredError": "Fordítás előtt válasszon AI-szolgáltatót a beállításokban.",
        "customProviderOption": "Egyéni szolgáltató",
    },
    "is": {
        "providerPlaceholder": "Veldu þjónustuveitu",
        "providerRequiredForModel": "Veldu þjónustuveitu fyrst",
        "providerRequiredError": "Veldu AI-þjónustuveitu í stillingum áður en þú þýðir.",
        "customProviderOption": "Sérsniðin þjónustuveita",
    },
    "it": {
        "providerPlaceholder": "Seleziona un provider",
        "providerRequiredForModel": "Seleziona prima un provider",
        "providerRequiredError": "Scegli un provider AI nelle impostazioni prima di tradurre.",
        "customProviderOption": "Provider personalizzato",
    },
    "ja": {
        "providerPlaceholder": "プロバイダーを選択",
        "providerRequiredForModel": "先にプロバイダーを選択してください",
        "providerRequiredError": "翻訳する前に設定で AI プロバイダーを選択してください。",
        "customProviderOption": "カスタムプロバイダー",
    },
    "ko": {
        "providerPlaceholder": "공급자 선택",
        "providerRequiredForModel": "먼저 공급자를 선택하세요",
        "providerRequiredError": "번역하기 전에 설정에서 AI 공급자를 선택하세요.",
        "customProviderOption": "사용자 지정 공급자",
    },
    "lv": {
        "providerPlaceholder": "Atlasiet pakalpojumu sniedzēju",
        "providerRequiredForModel": "Vispirms atlasiet pakalpojumu sniedzēju",
        "providerRequiredError": "Pirms tulkošanas iestatījumos atlasiet AI pakalpojumu sniedzēju.",
        "customProviderOption": "Pielāgots pakalpojumu sniedzējs",
    },
    "nl": {
        "providerPlaceholder": "Selecteer een provider",
        "providerRequiredForModel": "Selecteer eerst een provider",
        "providerRequiredError": "Kies een AI-provider in de instellingen voordat je vertaalt.",
        "customProviderOption": "Aangepaste provider",
    },
    "no": {
        "providerPlaceholder": "Velg en leverandør",
        "providerRequiredForModel": "Velg en leverandør først",
        "providerRequiredError": "Velg en AI-leverandør i innstillingene før du oversetter.",
        "customProviderOption": "Tilpasset leverandør",
    },
    "pl": {
        "providerPlaceholder": "Wybierz dostawcę",
        "providerRequiredForModel": "Najpierw wybierz dostawcę",
        "providerRequiredError": "Przed tłumaczeniem wybierz dostawcę AI w ustawieniach.",
        "customProviderOption": "Dostawca niestandardowy",
    },
    "pt_BR": {
        "providerPlaceholder": "Selecione um provedor",
        "providerRequiredForModel": "Selecione um provedor primeiro",
        "providerRequiredError": "Escolha um provedor de IA nas configurações antes de traduzir.",
        "customProviderOption": "Provedor personalizado",
    },
    "pt_PT": {
        "providerPlaceholder": "Selecione um fornecedor",
        "providerRequiredForModel": "Selecione primeiro um fornecedor",
        "providerRequiredError": "Escolha um fornecedor de IA nas definições antes de traduzir.",
        "customProviderOption": "Fornecedor personalizado",
    },
    "ro": {
        "providerPlaceholder": "Selectați un furnizor",
        "providerRequiredForModel": "Selectați mai întâi un furnizor",
        "providerRequiredError": "Alegeți un furnizor AI din setări înainte de a traduce.",
        "customProviderOption": "Furnizor personalizat",
    },
    "ru": {
        "providerPlaceholder": "Выберите провайдера",
        "providerRequiredForModel": "Сначала выберите провайдера",
        "providerRequiredError": "Перед переводом выберите провайдера ИИ в настройках.",
        "customProviderOption": "Свой провайдер",
    },
    "sl": {
        "providerPlaceholder": "Izberite ponudnika",
        "providerRequiredForModel": "Najprej izberite ponudnika",
        "providerRequiredError": "Pred prevajanjem v nastavitvah izberite ponudnika AI.",
        "customProviderOption": "Ponudnik po meri",
    },
    "sr": {
        "providerPlaceholder": "Изаберите провајдера",
        "providerRequiredForModel": "Прво изаберите провајдера",
        "providerRequiredError": "Пре превођења изаберите AI провајдера у подешавањима.",
        "customProviderOption": "Прилагођени провајдер",
    },
    "sv": {
        "providerPlaceholder": "Välj en leverantör",
        "providerRequiredForModel": "Välj en leverantör först",
        "providerRequiredError": "Välj en AI-leverantör i inställningarna innan du översätter.",
        "customProviderOption": "Anpassad leverantör",
    },
    "th": {
        "providerPlaceholder": "เลือกผู้ให้บริการ",
        "providerRequiredForModel": "เลือกผู้ให้บริการก่อน",
        "providerRequiredError": "เลือกผู้ให้บริการ AI ในการตั้งค่าก่อนแปล",
        "customProviderOption": "ผู้ให้บริการที่กำหนดเอง",
    },
    "tr": {
        "providerPlaceholder": "Bir sağlayıcı seçin",
        "providerRequiredForModel": "Önce bir sağlayıcı seçin",
        "providerRequiredError": "Çeviri yapmadan önce ayarlardan bir AI sağlayıcısı seçin.",
        "customProviderOption": "Özel sağlayıcı",
    },
    "ug": {
        "providerPlaceholder": "تەمىنلىگۈچى تاللاڭ",
        "providerRequiredForModel": "ئالدى بىلەن تەمىنلىگۈچى تاللاڭ",
        "providerRequiredError": "تەرجىمە قىلىشتىن بۇرۇن تەڭشەكتە AI تەمىنلىگۈچىسىنى تاللاڭ.",
        "customProviderOption": "ئۆزىڭىز بەلگىلىگەن تەمىنلىگۈچى",
    },
    "uk": {
        "providerPlaceholder": "Виберіть постачальника",
        "providerRequiredForModel": "Спочатку виберіть постачальника",
        "providerRequiredError": "Перед перекладом виберіть постачальника ШІ у налаштуваннях.",
        "customProviderOption": "Власний постачальник",
    },
    "vi": {
        "providerPlaceholder": "Chọn nhà cung cấp",
        "providerRequiredForModel": "Chọn nhà cung cấp trước",
        "providerRequiredError": "Chọn nhà cung cấp AI trong cài đặt trước khi dịch.",
        "customProviderOption": "Nhà cung cấp tùy chỉnh",
    },
    # Handwritten (never machine-translated in this repo).
    "zh_CN": {
        "providerPlaceholder": "请选择 AI 提供商",
        "providerRequiredForModel": "请先选择提供商",
        "providerRequiredError": "翻译前请先在设置中选择 AI 提供商。",
        "customProviderOption": "自定义提供商",
    },
    "zh_TW": {
        "providerPlaceholder": "請選擇 AI 提供商",
        "providerRequiredForModel": "請先選擇提供商",
        "providerRequiredError": "翻譯前請先在設定中選擇 AI 提供商。",
        "customProviderOption": "自訂提供商",
    },
}

# Every English placeholder token must survive; non-CJK locales may not carry CJK text.
CJK_OK = {"zh_CN", "zh_TW", "ja", "ko"}


def read(code):
    with open(os.path.join(LOCALES, code, "messages.json"), encoding="utf-8") as fh:
        return json.load(fh)


def has_cjk(text):
    return any("\u3400" <= ch <= "\u9fff" for ch in text)


def validate(code):
    problems = []
    try:
        catalogue = read(code)
    except Exception as error:  # noqa: BLE001
        return [f"{code}: unreadable messages.json — {error}"]
    en = read("en")
    en_keys = list(en)
    if list(catalogue) != en_keys:
        missing = [k for k in en_keys if k not in catalogue]
        extra = [k for k in catalogue if k not in en]
        problems.append(f"{code}: key set differs (missing {missing}, extra {extra})")
    for key in KEYS:
        value = (catalogue.get(key) or {}).get("message")
        if not isinstance(value, str) or not value.strip():
            problems.append(f"{code}: {key} missing/empty")
            continue
        if code != "en" and code not in ("ja", "zh_CN", "zh_TW") and has_cjk(value):
            problems.append(f"{code}: {key} contains CJK text")
    if code == "en":
        for key, expected in EN.items():
            got = (catalogue.get(key) or {}).get("message")
            if got != expected:
                problems.append(f"en: {key} is {got!r}, expected {expected!r}")
    return problems


def write(code):
    path = os.path.join(LOCALES, code, "messages.json")
    catalogue = read(code)
    if all(key in catalogue for key in KEYS):
        return False
    values = TRANSLATIONS[code]
    out = {}
    for key, entry in catalogue.items():
        out[key] = entry
        if key == "settingProviderDesc":
            for new_key in KEYS:
                if new_key not in catalogue:
                    out[new_key] = {"message": values[new_key]}
    for new_key in KEYS:
        if new_key not in out:
            out[new_key] = {"message": values[new_key]}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return True


def main():
    check_only = "--check" in sys.argv
    codes = sorted(
        entry for entry in os.listdir(LOCALES) if os.path.isdir(os.path.join(LOCALES, entry))
    )
    if not check_only:
        for code in codes:
            if code == "en":
                continue
            if code not in TRANSLATIONS:
                print(f"! {code}: no translation — add it to TRANSLATIONS", file=sys.stderr)
                return 1
            if write(code):
                print(f"✓ {code}: added {KEYS}")
    problems = []
    for code in codes:
        problems.extend(validate(code))
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print(f"[provider-i18n] {len(codes)} locales complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
