import esbuild from "esbuild";
import process from "node:process";
import { readFileSync } from "node:fs";

const prod = process.argv.includes("production");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));

// No build timestamp: the community directory rebuilds the tagged source and
// byte-compares it with the released main.js, so the banner must be identical
// across builds (plan 101).
const banner = `/*
DualTran for Obsidian — v${version}
Bundles @dualtran/core (MPL-2.0, https://github.com/seigwen/DualTran-extension).
*/`;

/**
 * Obsidian mobile has no Node built-ins. The core ships a Node-only file cache
 * (node:fs / node:path) that this host never uses; stub those two modules so
 * the bundle stays loadable everywhere. tests/dist/guards.mjs asserts no
 * node: references survive into main.js.
 */
const nodeBuiltinStubPlugin = {
  name: "node-builtin-stub",
  setup(build) {
    build.onResolve({ filter: /^node:(fs|path)$/ }, (args) => ({
      path: args.path,
      namespace: "node-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "node-stub" }, (args) => ({
      loader: "js",
      contents: `
        // The message deliberately avoids the module specifier so the guard in
        // tests/dist/guards.mjs can assert that no node: reference survives.
        const unavailable = () => {
          throw new Error("DualTran: a Node built-in module is not available on this host.");
        };
        export const readFileSync = unavailable;
        export const writeFileSync = unavailable;
        export const mkdirSync = unavailable;
        export const dirname = (p) => String(p).split("/").slice(0, -1).join("/") || ".";
        export default {};
      `,
    }));
  },
};

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  plugins: [nodeBuiltinStubPlugin],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  outfile: "main.js",
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
  process.exit(0);
} else {
  await ctx.watch();
}
