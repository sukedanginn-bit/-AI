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

const formatSeconds = loadBrowserFunction(
  "formatSeconds",
  "finiteNumberOrNull",
);

test("焙煎比較の時間を分:秒で読みやすく表示する", () => {
  assert.equal(formatSeconds(791), "13:11");
  assert.equal(formatSeconds(646.5), "10:46.5");
  assert.equal(formatSeconds(46), "0:46");
  assert.equal(formatSeconds(58.5), "0:58.5");
  assert.equal(formatSeconds(5), "0:05");
  assert.equal(formatSeconds(60), "1:00");
  assert.equal(formatSeconds(0), "0:00");
});

test("焙煎比較の時間を丸めてから分と秒に分解する", () => {
  assert.equal(formatSeconds(59.94), "0:59.9");
  assert.equal(formatSeconds(59.96), "1:00");
  assert.equal(formatSeconds(119.96), "2:00");
});

test("焙煎比較の不正な時間を推測しない", () => {
  assert.equal(formatSeconds(null), "—");
  assert.equal(formatSeconds(undefined), "—");
  assert.equal(formatSeconds(Number.NaN), "—");
  assert.equal(formatSeconds(Number.POSITIVE_INFINITY), "—");
  assert.equal(formatSeconds(Number.NEGATIVE_INFINITY), "—");
  assert.equal(formatSeconds(""), "—");
  assert.equal(formatSeconds("   "), "—");
  assert.equal(formatSeconds(-1), "—");
});

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
