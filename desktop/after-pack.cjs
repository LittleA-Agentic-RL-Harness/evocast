// electron-builder strips node_modules and dot-folders from extraResources, but the
// Next standalone server needs both (server.js, .next/, node_modules/). Copy it verbatim
// into Contents/Resources/server before signing.
const { cpSync, existsSync } = require("node:fs");
const { join } = require("node:path");

exports.default = async function afterPack(ctx) {
  const src = join(__dirname, "..", ".next", "standalone");
  if (!existsSync(join(src, "server.js"))) throw new Error("Missing .next/standalone — run `npm run desktop:prepare`.");
  const app = join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const dest = join(app, "Contents", "Resources", "server");
  cpSync(src, dest, { recursive: true, dereference: true });
  console.log("  • copied Next standalone server →", dest);
};
