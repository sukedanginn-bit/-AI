import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRoast } from "../src/roast-normalizer.js";
import { applyUpsertAfterRemoteReady, planRoastUpsert } from "../src/sync-plan.js";

test("同じRoast IDを2回取り込んでも重複しない", () => {
  const plan = planRoastUpsert([], [{ roast_id: "r1" }, { roast_id: "r1" }]);
  assert.equal(plan.additions.length, 1);
});

test("既存IDは更新し、新しい焙煎だけ追加する", () => {
  const plan = planRoastUpsert([{ roast_id: "r1", value: 1 }], [
    { roast_id: "r1", value: 2 }, { roast_id: "r2", value: 3 },
  ]);
  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.additions.map((row) => row.roast_id), ["r2"]);
});

test("欠損データは推測せずnullまたは空配列になる", () => {
  const normalized = normalizeRoast({ uid: "missing" });
  assert.equal(normalized.preheat_c, null);
  assert.equal(normalized.development_ratio_pct, null);
  assert.deepEqual(normalized.profile, []);
  assert.equal(normalized.tasting.free_comment, null);
});

test("Google API接続相当の失敗時に既存データを変更しない", async () => {
  const existing = [{ roast_id: "r1", value: "保存済み" }];
  const snapshot = structuredClone(existing);
  await assert.rejects(() => applyUpsertAfterRemoteReady(
    existing,
    [{ roast_id: "r2" }],
    async () => { throw new Error("Google API connection failed"); },
  ));
  assert.deepEqual(existing, snapshot);
});

test("日本語テイスティングメモがUTF-8で保持される", () => {
  const memo = "白桃、蜂蜜の甘さ。後味は長く、わずかに花の香り。";
  const normalized = normalizeRoast({ uid: "ja" }, null, { free_comment: memo });
  const roundTrip = JSON.parse(JSON.stringify(normalized));
  assert.equal(roundTrip.tasting.free_comment, memo);
});

