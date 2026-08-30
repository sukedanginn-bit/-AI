import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const workerSource = await readFile(
  new URL("../worker.js", import.meta.url),
  "utf8",
);

function loadBrowserFunction(name, nextName) {
  const start = workerSource.indexOf(`function ${name}(`);
  const end = workerSource.indexOf(`function ${nextName}(`, start);

  assert.notEqual(start, -1, `${name} が worker.js に存在する`);
  assert.notEqual(end, -1, `${nextName} が worker.js に存在する`);

  const context = {};
  vm.runInNewContext(
    `${workerSource.slice(start, end)}; result = ${name};`,
    context,
  );
  return context.result;
}

const finiteNumberOrNull = loadBrowserFunction(
  "finiteNumberOrNull",
  "roastMetrics",
);

test("焙煎比較の欠損数値を0として扱わない", () => {
  assert.equal(finiteNumberOrNull(null), null);
  assert.equal(finiteNumberOrNull(undefined), null);
  assert.equal(finiteNumberOrNull(""), null);
  assert.equal(finiteNumberOrNull("   "), null);
  assert.equal(finiteNumberOrNull("not-a-number"), null);
});

test("焙煎比較の有効な数値は0を含めて保持する", () => {
  assert.equal(finiteNumberOrNull(0), 0);
  assert.equal(finiteNumberOrNull("0"), 0);
  assert.equal(finiteNumberOrNull("198.5"), 198.5);
});
