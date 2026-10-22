#!/usr/bin/env bash
# Build both packages into publishable folders: out/lumen-types and out/lumen.
#   scripts/pack.sh          build into ./out
#   scripts/pack.sh <dir>    build into <dir>
#   LUMEN_VERSION=0.1.4 scripts/pack.sh   publish as that version (the publish workflow sets it)
# Each package compiles with tsc (lumen-types first: lumen's build reads its declarations), relative
# imports get their file's extension so Node and every bundler resolve them alike, and the
# published package.json points at dist with workspace dependencies pinned to this version.
# .github/workflows/publish.yml runs it and publishes what it builds.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$(mkdir -p "${1:-$ROOT/out}" && cd "${1:-$ROOT/out}" && pwd)

for pkg in lumen-types lumen; do
  dir="$ROOT/packages/$pkg"
  rm -rf "$dir/dist" "$OUT/$pkg"
  (cd "$dir" && bunx tsc -p tsconfig.build.json)
  [ -f "$dir/src/theme.css" ] && cp "$dir/src/theme.css" "$dir/dist/theme.css"
  # Values reach `bun -e` through the environment: older Bun mangles its argv.
  DIST="$dir/dist" bun -e '
    import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
    import { dirname, join } from "node:path";
    const walk = (d) => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
    for (const file of walk(process.env.DIST).filter((f) => /\.(js|d\.ts)$/.test(f))) {
      const src = readFileSync(file, "utf8");
      const out = src.replace(/((?:from|import)\s*\(?\s*["\x27])(\.\.?\/[^"\x27]+)(["\x27])/g, (all, a, spec, b) => {
        const base = join(dirname(file), spec);
        if (existsSync(`${base}.js`)) return `${a}${spec}.js${b}`;
        if (existsSync(join(base, "index.js"))) return `${a}${spec}/index.js${b}`;
        return all;
      });
      if (out !== src) writeFileSync(file, out);
    }'

  mkdir -p "$OUT/$pkg"
  cp -R "$dir/dist" "$OUT/$pkg/dist"
  cp "$ROOT/LICENSE" "$ROOT/NOTICE" "$OUT/$pkg/"
  cp "$dir/README.md" "$OUT/$pkg/README.md"
  SRC="$dir/package.json" OUT_JSON="$OUT/$pkg/package.json" DIR="packages/$pkg" VERSION="${LUMEN_VERSION:-}" bun -e '
    const { SRC: src, OUT_JSON: out, DIR: directory, VERSION: version } = process.env;
    const p = await Bun.file(src).json();
    if (version) p.version = version;
    const dist = (path) => path.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, ".js");
    const exports = {};
    for (const [key, path] of Object.entries(p.exports)) {
      exports[key] = path.endsWith(".css") ? dist(path) : { types: dist(path).replace(/\.js$/, ".d.ts"), default: dist(path) };
    }
    const pin = (deps = {}) =>
      Object.fromEntries(Object.entries(deps).map(([n, v]) => [n, String(v).startsWith("workspace:") ? p.version : v]));
    const pkg = {
      name: p.name,
      version: p.version,
      description: p.description,
      license: "MIT",
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports,
      files: ["dist", "LICENSE", "NOTICE"],
      sideEffects: ["**/*.css"],
      homepage: "https://github.com/columenlabs/lumen-ui",
      repository: { type: "git", url: "git+https://github.com/columenlabs/lumen-ui.git", directory },
      bugs: "https://github.com/columenlabs/lumen-ui/issues",
      publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
      dependencies: pin(p.dependencies),
      ...(p.peerDependencies ? { peerDependencies: p.peerDependencies } : {}),
    };
    await Bun.write(out, `${JSON.stringify(pkg, null, 2)}\n`);
  '
  echo "built $OUT/$pkg"
done
