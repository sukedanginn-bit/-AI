import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error("worker.js内にブラウザJavaScriptが見つかりません");
for (const [, script] of scripts) new vm.Script(script, { filename: "worker-browser.js" });
console.log(`Browser JavaScript syntax OK (${scripts.length} script)`);

