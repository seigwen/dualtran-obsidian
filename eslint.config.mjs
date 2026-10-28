// Mirrors the community directory's automated source review (plan 101).
//
// The scanner runs eslint-plugin-obsidianmd with its recommended config against
// `src/`; reproducing it locally is what keeps a release from failing after it
// was published. Errors here are release blockers (`no-forbidden-elements`,
// `no-unsupported-api`, …); warnings are advisory and do not fail `npm run lint`.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    // The directory scans the plugin source; build scripts, tests and the vendored
    // core are out of scope (the core is reviewed in its own repository).
    ignores: ["main.js", "node_modules/**", "vendor/**", "locales/**", "scripts/**", "tests/**", "e2e/**"],
  },
  {
    languageOptions: {
      parserOptions: {
        // The recommended config includes type-checked rules, which need the
        // TypeScript project; the config file itself is outside tsconfig.json.
        projectService: { allowDefaultProject: ["eslint.config.mjs"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
