/**
 * Copie les assets web statiques vers www/ (webDir Capacitor).
 * Usage : node scripts/syncCapWeb.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const www = path.join(root, "www");
const entries = ["index.html", "privacy.html", "suppression-compte.html", "captcha.html", "style.css", "reveal.png", "js", "data", "assets", "css"];

function resolveSupabaseEntry() {
  const candidates = [
    path.join(root, "node_modules", "@supabase", "supabase-js", "dist", "module", "index.js"),
    path.join(root, "node_modules", "@supabase", "supabase-js", "dist", "index.mjs"),
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function vendorSupabase() {
  const src = resolveSupabaseEntry();
  const out = path.join(root, "js", "vendor", "supabase-js.js");
  if (!src) {
    throw new Error("supabase-js manquant (npm install) : dist/module/index.js introuvable");
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Pas de minify : les lignes de 50 ko + templates coupés cassent la WebView Android
  // (Unexpected token '}'). chrome90 = syntaxe que le WebView sait parser.
  const result = spawnSync(
    `npx --yes esbuild "${src}" --bundle --format=esm --outfile="${out}" --platform=browser --target=chrome90 --legal-comments=none`,
    { cwd: root, stdio: "inherit", shell: true }
  );
  if (result.status !== 0) {
    throw new Error("esbuild vendor supabase-js a échoué");
  }
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyEntry(name) {
  const src = path.join(root, name);
  const dest = path.join(www, name);
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}

vendorSupabase();
rmDir(www);
fs.mkdirSync(www, { recursive: true });

for (const entry of entries) {
  copyEntry(entry);
}

console.log(`Capacitor www/ synced (${entries.join(", ")})`);
