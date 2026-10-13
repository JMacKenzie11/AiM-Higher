// Runs scripts/lead-analysis-sample.mts. See that file for usage.
//
// Bundled with esbuild and run by plain Node rather than through tsx:
// @react-pdf/renderer is ESM-only, and tsx's CommonJS hook resolves
// its internal imports with the wrong export conditions
// (ERR_PACKAGE_PATH_NOT_EXPORTED on @react-pdf/hyphenate/en-us).
// Every package stays external, so Node loads them itself, the way
// the app's server does.

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Inside the repo, so Node finds node_modules from it.
const outfile = path.resolve("node_modules/.cache/lead-analysis-sample.mjs");

await build({
  entryPoints: ["scripts/lead-analysis-sample.mts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  logLevel: "warning",
  plugins: [
    {
      name: "app-paths",
      setup(b) {
        b.onResolve({ filter: /^server-only$/ }, () => ({
          path: path.resolve("scripts/lib/server-only-stub.ts"),
        }));
        // No request here, so no headers: the same throw a call outside
        // a request scope gets, which the instance lookup expects.
        b.onResolve({ filter: /^next\/headers$/ }, () => ({ path: "next-headers", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export async function headers() { throw new Error('no request scope'); }\n" +
            "export async function cookies() { throw new Error('no request scope'); }",
          loader: "js",
        }));
        b.onResolve({ filter: /^@\// }, async (args) =>
          b.resolve(`./${args.path.slice(2)}`, { resolveDir: path.resolve("src"), kind: args.kind })
        );
        // next's subpaths have no "exports" map, so ESM needs the file.
        b.onResolve({ filter: /^next\/[a-z-]+$/ }, (args) => ({ path: `${args.path}.js`, external: true }));
        // Every other bare import is a package: leave it to Node.
        b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
      },
    },
  ],
});

const r = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
