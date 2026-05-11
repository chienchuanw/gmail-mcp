#!/usr/bin/env bash
# Build the distributable .mcpb bundle.
#
# Layout produced:
#   build/mcpb/manifest.json
#   build/mcpb/server/*.js            (compiled output of src/)
#   build/mcpb/server/package.json    (minimal, production deps only, no scripts)
#   build/mcpb/server/node_modules/   (production dependencies)
#   build/gmail-mcp.mcpb              (the packed, installable bundle)
#
# The bundle is launched by the host as `node server/index.js` (no args) — i.e. MCP
# stdio server mode. The `auth` CLI subcommand is for terminal use only and is not
# reachable through the bundle.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
BUNDLE_DIR="$ROOT/build/mcpb"

echo "==> Compiling TypeScript (tsconfig.build.json -> dist/)"
npm run build

echo "==> Assembling bundle at $BUNDLE_DIR"
rm -rf "$ROOT/build"
mkdir -p "$BUNDLE_DIR/server"
cp "$ROOT/manifest.json" "$BUNDLE_DIR/manifest.json"
cp "$ROOT"/dist/*.js "$BUNDLE_DIR/server/"

# Minimal package.json for the bundled server: production deps only, ESM, no
# lifecycle scripts (so installing it inside the bundle does not re-run `tsc`).
node -e '
const p = require("./package.json");
const fs = require("fs");
const out = {
  name: p.name + "-bundled",
  version: p.version,
  private: true,
  type: "module",
  main: "index.js",
  dependencies: p.dependencies,
};
fs.writeFileSync(process.argv[1], JSON.stringify(out, null, 2) + "\n");
' "$BUNDLE_DIR/server/package.json"

echo "==> Installing production dependencies into the bundle (this can take a minute)"
( cd "$BUNDLE_DIR/server" && npm install --omit=dev --no-audit --no-fund --loglevel=error )

echo "==> Validating manifest"
( cd "$BUNDLE_DIR" && npx --yes @anthropic-ai/mcpb validate manifest.json )

echo "==> Packing"
( cd "$BUNDLE_DIR" && npx --yes @anthropic-ai/mcpb pack . "$ROOT/build/gmail-mcp.mcpb" )

echo "==> Done."
ls -lh "$ROOT/build/gmail-mcp.mcpb"
