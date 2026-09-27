import { readdir, readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = fileURLToPath(new URL("../extension/", import.meta.url));
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(dir, entry.name)) : join(dir, entry.name)))).flat();
}
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
for (const name of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, "offscreen.html", "audio-worklet.js", "content.js"]) await access(resolve(root, name));
const sources = await files(root);
for (const file of sources) {
  if (file.endsWith(".js")) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  if (file.endsWith(".html")) {
    const html = await readFile(file, "utf8");
    if (/<script\b[^>]*>\s*[^<\s]/i.test(html) || /\son(?:click|load|input)=/i.test(html)) throw new Error(`Inline script forbidden: ${file}`);
    for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) if (!/^https?:/.test(match[1])) await access(resolve(root, match[1]));
  }
}
if (manifest.host_permissions.some(host => host.includes("<all_urls>"))) throw new Error("Unexpected broad host permission");
console.log(`Checked ${sources.length} extension files: syntax, manifest references, local assets and CSP.`);
