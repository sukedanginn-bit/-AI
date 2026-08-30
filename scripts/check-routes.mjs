import fs from "node:fs";

const source = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const required = [
  "/index.html", "/api/roasts", "/api/beans", "/api/knowledge/pdfs",
  "/api/admin/pdfs", "/api/ai/analyze", "/api/ai/history",
];
const missing = required.filter((route) => !source.includes(route));
if (!source.includes("/^\\/api\\/roasts\\/([^/]+)$/")) missing.push("/api/roasts/:id");
if (!source.includes("/^\\/api\\/admin\\/pdfs\\/(.+)$/")) missing.push("/api/admin/pdfs/:key");
if (missing.length) throw new Error(`不足している既存ルート: ${missing.join(", ")}`);
console.log("Existing API routes OK");

