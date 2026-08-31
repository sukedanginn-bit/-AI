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

const numericSeries = loadBrowserFunction(
  "numericSeries",
  "firstSeries",
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

test("複数豆の履歴は豆ごとの独立パネルとして描画する", () => {
  const start = workerSource.indexOf("function renderBeanHistory() {");
  const end = workerSource.indexOf("function renderRoastList()", start);
  const source = workerSource.slice(start, end);
  assert.match(source, /selectedOptions/);
  assert.match(source, /renderBeanHistoryPanel/);
  assert.match(source, /inferBeanKey\(roast\) === bean\.key/);
  assert.match(source, /beanHistoryPanels\.innerHTML/);
});

test("複数豆の表示は空の豆で全体を中断しない", () => {
  const start = workerSource.indexOf("function renderBeanHistoryPanel(");
  const end = workerSource.indexOf("function renderRoastList()", start);
  const source = workerSource.slice(start, end);
  assert.match(source, /rows\.length \? /);
  assert.match(source, /この豆の焙煎データはありません/);
  assert.match(source, /比較グラフには2件以上の焙煎が必要です/);
});

test("RoR時系列の欠損を0として補完しない", () => {
  assert.deepEqual(
    Array.from(numericSeries([10, null, "bad", 8, Number.POSITIVE_INFINITY])),
    [10, null, null, 8, null],
  );
});

test("RoR比較は豆選択と選択焙煎の詳細取得を分離する", () => {
  assert.match(workerSource, /id="rorBeanSelect"/);
  assert.match(workerSource, /name="rorRoast"/);
  assert.match(workerSource, /Promise\.allSettled/);
  assert.match(workerSource, /roastDetailCache/);
  assert.match(workerSource, /一度に比較できる焙煎は6件までです/);
});

test("RoR比較は時刻不明時にサンプル番号と明示する", () => {
  assert.match(workerSource, /時刻データがないため、X軸はサンプル番号です/);
  assert.match(workerSource, /欠損値は推測しません/);
  const start = workerSource.indexOf("function normalizeRorDetail(");
  const end = workerSource.indexOf("function renderRorRoastOptions(", start);
  const source = workerSource.slice(start, end);
  assert.match(source, /\["elapsedSeconds"\]/);
  assert.doesNotMatch(source, /timestamps/);
});

test("専門家共有レポートは最大3豆・最近5焙煎に制限する", () => {
  assert.match(workerSource, /id="reportBeanSelect" multiple/);
  assert.match(workerSource, /レポートには一度に3種類まで選択できます/);
  assert.match(workerSource, /function selectRecentRoastsForReport\(list, limit = 5\)/);
  assert.match(workerSource, /sortOldestFirst\(sortNewestFirst\(list\)\.slice\(0, limit\)\)/);
});

test("専門家共有レポートは事実・欠損・豆分離方針を明記する", () => {
  assert.match(workerSource, /欠損値は推測・補完していません/);
  assert.match(workerSource, /異なる豆へ直接一般化していません/);
  assert.match(workerSource, /AIによる評価・仮説は含みません/);
  assert.match(workerSource, /escapeHTML\(questions\)/);
});

test("専門家共有レポートはA4印刷と2〜3ページ構成を持つ", () => {
  assert.match(workerSource, /@page \{\s*size:A4/);
  assert.match(workerSource, /body\.print-report/);
  assert.match(workerSource, /beans\.length; index \+= 2/);
  assert.match(workerSource, /印刷 \/ PDF保存/);
  assert.match(workerSource, /maxlength="800"/);
  assert.match(workerSource, /reportExcerpt\(row\.tasting, 120\)/);
});

test("経験者相談モードは既存Analysisを残して独立表示する", () => {
  assert.match(workerSource, /id="analysisModeButton"/);
  assert.match(workerSource, /id="consultModeButton"/);
  assert.match(workerSource, /id="analysisModePanel"/);
  assert.match(workerSource, /id="consultModePanel"/);
  assert.match(workerSource, /Consult \/ 経験者相談/);
});

test("経験者相談モードは安定した豆キーと焙煎UIDで保存する", () => {
  assert.match(workerSource, /consults:\{\}/);
  assert.match(workerSource, /function consultState\(beanKey\)/);
  assert.match(workerSource, /referenceNotes:\{\}/);
  assert.match(workerSource, /state\.after\[uid\]/);
  assert.match(workerSource, /referenceUid/);
});

test("Reference以降だけを日付順で表示し保存済みAfterを削除しない", () => {
  const start = workerSource.indexOf("function renderConsult() {");
  const end = workerSource.indexOf("function setSameBeanMode(", start);
  const source = workerSource.slice(start, end);
  assert.match(source, /consultRoasts\(beanKey\)/);
  assert.match(source, /date\.getTime\(\) > referenceDate\.getTime\(\)/);
  assert.doesNotMatch(source, /delete state\.after/);
});

test("検出差分を意図的変更と断定せずユーザー入力を優先する", () => {
  assert.match(workerSource, /MAIN CHANGE（ユーザーが確定する主な変更）/);
  assert.match(workerSource, /Detected differences/);
  assert.match(workerSource, /意図的な変更とは限りません/);
  assert.match(workerSource, /Math\.abs\(delta\) < threshold/);
});

test("詳細データはReferenceと開いたAfterだけ遅延取得する", () => {
  assert.match(workerSource, /async function getConsultDetail\(uid\)/);
  assert.match(workerSource, /roastDetailCache\.has\(uid\)/);
  assert.match(workerSource, /data-detail-uid/);
  assert.match(workerSource, /details\.open/);
  assert.match(workerSource, /詳細データを取得できませんでした。既存の一覧データは保持されています/);
});

test("Consult入力はAI評価せず未評価を許容する", () => {
  assert.match(workerSource, /\["unrated","未評価"\]/);
  assert.match(workerSource, /\["improved","Improved"\]/);
  assert.match(workerSource, /\["mixed","Mixed \/ Neutral"\]/);
  assert.match(workerSource, /\["worse","Worse"\]/);
  assert.match(workerSource, /Taste ratings not recorded/);
});

test("Consult保存データはlocalStorage往復後も保持される", () => {
  const start = workerSource.indexOf("function loadStoredNotes() {");
  const end = workerSource.indexOf("function setStatus(", start);
  const storage = new Map();
  const context = {
    console,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  vm.runInNewContext(
    `const STORAGE_KEY = "roastworld-analyzer-v7";\n${workerSource.slice(start, end)}\nresult = { loadStoredNotes, saveStoredNotes };`,
    context,
  );
  context.notes = {
    roastNotes: { existing: "保持" },
    sharedNotes: {},
    beanOverrides: {},
    consults: {
      "bean-id:123": {
        referenceUid: "reference-1",
        referenceNotes: { "reference-1": { good: "甘さあり", issue: "乾き" } },
        after: { "after-1": { mainChange: "Preheatを下げた", tasteChange: "酸が穏やか", rating: "improved" } },
        ask: "FC前の熱量をどう見ますか",
      },
    },
  };
  context.result.saveStoredNotes();
  const restored = context.result.loadStoredNotes();
  assert.equal(restored.roastNotes.existing, "保持");
  assert.equal(restored.consults["bean-id:123"].referenceUid, "reference-1");
  assert.equal(restored.consults["bean-id:123"].referenceNotes["reference-1"].good, "甘さあり");
  assert.equal(restored.consults["bean-id:123"].after["after-1"].rating, "improved");
  assert.equal(restored.consults["bean-id:123"].ask, "FC前の熱量をどう見ますか");
});
