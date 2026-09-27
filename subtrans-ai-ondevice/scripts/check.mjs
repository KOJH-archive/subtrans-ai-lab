import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const extension = resolve(root, "extension");
const manifest = JSON.parse(await readFile(resolve(extension, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3 || manifest.host_permissions?.length) throw Error("Manifest must be MV3 without host API grants");
if (manifest.content_security_policy?.extension_pages?.includes("connect-src 'none'") !== true) throw Error("Network connections must be blocked");
const files = async dir => (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : [resolve(dir, entry.name)]))).flat();
const all = await files(extension);
for (const path of all.filter(path => path.endsWith(".js"))) execFileSync(process.execPath, ["--check", path], { stdio: "pipe" });
for (const path of all.filter(path => path.endsWith(".js") || path.endsWith(".html"))) {
  const source = await readFile(path, "utf8");
  if (/https?:\/\/api\.(openai|anthropic)\.com|generativelanguage\.googleapis\.com/.test(source)) throw Error(`Cloud API reference: ${path}`);
}
console.log(`Checked ${all.length} extension assets and ${all.filter(path => path.endsWith(".js")).length} scripts.`);
