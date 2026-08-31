import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const start = source.indexOf("function extractRoastList(");
const end = source.indexOf("async function fetchAllRoastPages(", start);
const context = {};
vm.runInNewContext(`${source.slice(start, end)}; result = extractRoastList;`, context);
const extractRoastList = context.result;

test("焙煎一覧の複数の既知レスポンス形状を正規化する", () => {
  const rows = [{ uid: "a" }];
  assert.deepEqual(Array.from(extractRoastList(rows)), rows);
  assert.deepEqual(Array.from(extractRoastList({ data: rows })), rows);
  assert.deepEqual(Array.from(extractRoastList({ items: rows })), rows);
  assert.deepEqual(Array.from(extractRoastList({ content: rows })), rows);
  assert.deepEqual(Array.from(extractRoastList({ roasts: rows })), rows);
  assert.deepEqual(Array.from(extractRoastList({ data: { items: rows } })), rows);
  assert.equal(extractRoastList({ data: { unknown: rows } }), null);
});

function loadPagination(roastWorldGet) {
  const paginationStart = source.indexOf("function extractRoastList(");
  const paginationEnd = source.indexOf("function summarizeRoast(", paginationStart);
  const sandbox = {
    roastWorldGet,
    json: (body, status = 200) => ({ body, status }),
  };
  vm.runInNewContext(
    `${source.slice(paginationStart, paginationEnd)}; result = fetchAllRoastPages;`,
    sandbox,
  );
  return sandbox.result;
}

test("重複だけの中間ページでも次ページまで取得する", async () => {
  const pages = [
    Array.from({ length: 100 }, (_, i) => ({ uid: `r${i}` })),
    Array.from({ length: 100 }, (_, i) => ({ uid: `r${i + 50}` })),
    Array.from({ length: 20 }, (_, i) => ({ uid: `r${i + 150}` })),
  ];
  let calls = 0;
  const fetchAllRoastPages = loadPagination(async () => ({
    ok: true,
    data: pages[calls++],
  }));
  const response = await fetchAllRoastPages({});
  assert.equal(calls, 3);
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 170);
  assert.equal(new Set(response.body.map((item) => item.uid)).size, 170);
});

test("未知の一覧形式を空一覧として正常終了しない", async () => {
  const fetchAllRoastPages = loadPagination(async () => ({
    ok: true,
    data: { data: { unknown: [] } },
  }));
  const response = await fetchAllRoastPages({});
  assert.equal(response.status, 502);
  assert.match(response.body.error, /一覧形式を認識できません/);
});
