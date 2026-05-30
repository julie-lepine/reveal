/**
 * Copie les assets web statiques vers www/ (webDir Capacitor).
 * Usage : node scripts/syncCapWeb.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const www = path.join(root, "www");
const entries = ["index.html", "privacy.html", "style.css", "reveal.png", "js", "data", "assets", "css"];

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

rmDir(www);
fs.mkdirSync(www, { recursive: true });

for (const entry of entries) {
  copyEntry(entry);
}

console.log(`Capacitor www/ synced (${entries.join(", ")})`);
