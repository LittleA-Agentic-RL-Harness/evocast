// Make the Next standalone server self-contained for the Mac app:
// copy static assets in, and replace Turbopack's external-package symlinks
// (.next/node_modules/<pkg>-<hash> → node_modules/<pkg>) with real directories,
// because symlinks don't survive app packaging and code signing.
import { cpSync, existsSync, lstatSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const out = ".next/standalone";
if (!existsSync(`${out}/server.js`)) throw new Error("Run with BUILD_TARGET=desktop next build first.");
cpSync("public", `${out}/public`, { recursive: true });
cpSync(".next/static", `${out}/.next/static`, { recursive: true });

const linked = `${out}/.next/node_modules`;
if (existsSync(linked)) {
  for (const name of readdirSync(linked)) {
    const p = join(linked, name);
    if (!lstatSync(p).isSymbolicLink()) continue;
    const target = resolve(dirname(p), readlinkSync(p));
    rmSync(p);
    cpSync(target, p, { recursive: true, dereference: true });
    console.log("dereferenced", p);
  }
}
console.log("standalone server ready in", out);
