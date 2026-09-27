import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
await mkdir(dist, { recursive: true });
await cp(resolve(root, "extension"), dist, { recursive: true, force: true });
console.log(`On-device Lab build: ${dist}`);
