import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleTokenProvider, createServiceAccountJwt } from "../src/google-auth.js";
import {
  buildRoastValueBatches, createSheetsClient, rowToValues, valuesToRows,
} from "../src/google-sheets.js";
import { planRoastUpsert } from "../src/sync-plan.js";

const jsonResponse = (status, value) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

async function testPrivateKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const bytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const base64 = Buffer.from(bytes).toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
}

test("サービスアカウントJWTをRS256で生成する", async () => {
  const jwt = await createServiceAccountJwt({
    email: "service@example.test", privateKey: await testPrivateKey(), now: () => 1_700_000_000_000,
  });
  const [header, payload, signature] = jwt.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "RS256");
  assert.equal(JSON.parse(Buffer.from(payload, "base64url")).iss, "service@example.test");
  assert.ok(signature.length > 100);
});

test("アクセストークンを期限前は再利用し、期限後に更新する", async () => {
  let now = 1_700_000_000_000;
  let calls = 0;
  const provider = createGoogleTokenProvider({
    email: "service@example.test", privateKey: await testPrivateKey(), now: () => now,
    fetchImpl: async () => jsonResponse(200, { access_token: `token-${++calls}`, expires_in: 120 }),
  });
  assert.equal(await provider(), "token-1");
  assert.equal(await provider(), "token-1");
  now += 61_000;
  assert.equal(await provider(), "token-2");
});

test("同一内容は更新せず、入れ子オブジェクトの変更だけ検出する", () => {
  const existing = [{ roast_id: "r1", meta: { country: "Kenya", farm: "A" } }];
  assert.deepEqual(planRoastUpsert(existing, structuredClone(existing)), { updates: [], additions: [] });
  const changed = [{ roast_id: "r1", meta: { farm: "B", country: "Kenya" } }];
  assert.equal(planRoastUpsert(existing, changed).updates.length, 1);
});

test("行変換はnull、日本語、数値、真偽値を保持する", () => {
  const columns = ["roast_id", "memo", "missing", "number", "flag"];
  const values = rowToValues({ roast_id: "r1", memo: "白桃と蜂蜜", missing: null, number: 12.5, flag: false }, columns);
  assert.deepEqual(values, ["r1", "白桃と蜂蜜", "", 12.5, false]);
  assert.deepEqual(valuesToRows([values], columns)[0], {
    roast_id: "r1", memo: "白桃と蜂蜜", missing: null, number: 12.5, flag: false,
  });
});

test("書込み要求を指定件数で分割する", () => {
  const plan = { updates: Array.from({ length: 5 }, (_, index) => ({ index, value: { roast_id: `r${index}` } })), additions: [] };
  assert.deepEqual(buildRoastValueBatches(plan, { chunkSize: 2 }).map((batch) => batch.length), [2, 2, 1]);
  const additions = buildRoastValueBatches({
    updates: [], additions: Array.from({ length: 5 }, (_, index) => ({ roast_id: `a${index}` })),
  }, { chunkSize: 2 }).flat();
  assert.deepEqual(additions.map((range) => range.values.length), [2, 2, 1]);
});

test("401はトークン更新後1回、429は指数バックオフで再試行する", async () => {
  const statuses = [401, 429, 200];
  const tokenCalls = [];
  const sleeps = [];
  const client = createSheetsClient({
    spreadsheetId: "sheet-id",
    getAccessToken: async (options = {}) => { tokenCalls.push(options); return options.forceRefresh ? "new" : "old"; },
    fetchImpl: async () => jsonResponse(statuses.shift(), { sheets: [] }),
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  await client.getSpreadsheet();
  assert.equal(tokenCalls.filter((options) => options.forceRefresh).length, 1);
  assert.deepEqual(sleeps, [250]);
});

test("403は再試行しない", async () => {
  let calls = 0;
  const client = createSheetsClient({
    spreadsheetId: "sheet-id", getAccessToken: async () => "token",
    fetchImpl: async () => { calls++; return jsonResponse(403, { error: "forbidden" }); },
    sleep: async () => assert.fail("403でsleepしてはいけません"),
  });
  await assert.rejects(() => client.getSpreadsheet(), /403/);
  assert.equal(calls, 1);
});

test("一時的なネットワーク例外を上限付きで再試行する", async () => {
  let calls = 0;
  const sleeps = [];
  const client = createSheetsClient({
    spreadsheetId: "sheet-id", getAccessToken: async () => "token",
    fetchImpl: async () => {
      calls++;
      if (calls < 3) throw new TypeError("network down");
      return jsonResponse(200, { sheets: [] });
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  });
  await client.getSpreadsheet();
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [250, 500]);
});

test("不足しているシートだけを作成する", async () => {
  const requests = [];
  const client = createSheetsClient({
    spreadsheetId: "sheet-id", getAccessToken: async () => "token",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (!options?.method) return jsonResponse(200, { sheets: [{ properties: { title: "Roasts" } }] });
      return jsonResponse(200, {});
    },
  });
  assert.deepEqual(await client.ensureSheets(["Roasts", "Tasting"]), ["Tasting"]);
  assert.match(requests[1].options.body, /Tasting/);
  assert.doesNotMatch(requests[1].options.body, /Roasts/);
});
