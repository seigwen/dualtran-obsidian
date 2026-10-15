# Submitting DualTran for Obsidian to the community directory

Status: prepared, not yet submitted. The actual submission is the maintainer's
Obsidian-account action (community.obsidian.md developer dashboard).

## Prerequisites

- [ ] Public GitHub repository (`seigwen/dualtran-obsidian`) with this source.
- [ ] First release: tag = manifest version exactly (**no `v` prefix**, e.g.
      `0.1.0`), with `main.js`, `manifest.json` and `styles.css` attached
      (`npm run verify` green before tagging).
- [ ] README explains what the plugin does and how to use it (done).
- [ ] This PRIVACY.md visible (Obsidian asks for a privacy policy when data is
      transmitted — DualTran sends text to translation services on user action).

## Submission steps (community.obsidian.md)

1. Sign in with an Obsidian account; link the GitHub account.
2. Dashboard → Plugins → "New plugin" → select the repository.
3. Review runs automatically (minutes); fix anything it flags and re-run.
4. After approval the entry appears at
   https://obsidian.md/plugins?id=dualtran-translate

## Listing copy (draft)

- **Name:** DualTran
- **Short description (manifest):** Translate selections and whole notes with
  Google or your own AI model (20+ BYOK providers).
- **Long description:**

```
DualTran brings the DualTran translation engine into Obsidian. Translate a
selection in place or right below the original, or translate an entire note
into a new file — all without leaving the editor.

Two engines, your choice:
• Google — free, no account, works out of the box.
• AI (BYOK) — your own key for 20+ providers (OpenAI, Anthropic, Google Gemini,
  DeepSeek, OpenRouter and more) for higher-quality, context-aware translations.

Your text is only ever sent to the service you chose, at the moment you
translate. No analytics, no account, no server of ours.
```

## Screenshot checklist (capture in Obsidian before submitting)

- [ ] Selection with translation inserted below (dual color not applicable —
      Obsidian mode is replace/insert; show the insert-below command result)
- [ ] "Translate note to a new file" result
- [ ] Settings tab with engine + AI fields
