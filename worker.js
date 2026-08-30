export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.ROASTWORLD_API_TOKEN) {
      return json(
        { error: "ROASTWORLD_API_TOKEN が設定されていません" },
        500
      );
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(pageHTML(), {
        headers: {
          "Content-Type": "text/html; charset=UTF-8",
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.pathname === "/api/roasts") {
      return proxyRoastWorld(
        "https://api.roast.world/api/v3/public/roasts?page=1&size=100",
        env
      );
    }

    if (url.pathname === "/api/beans") {
      return proxyRoastWorld(
        "https://api.roast.world/api/v3/public/beans?page=1&size=100",
        env
      );
    }

    const roastMatch = url.pathname.match(/^\/api\/roasts\/([^/]+)$/);

    if (roastMatch) {
      return proxyRoastWorld(
        "https://api.roast.world/api/v3/public/roasts/" +
          encodeURIComponent(decodeURIComponent(roastMatch[1])),
        env
      );
    }

    if (url.pathname === "/api/knowledge/pdfs") {
      if (request.method !== "GET") {
        return json(
          { error: "Method Not Allowed" },
          405
        );
      }

      if (!env.KNOWLEDGE_PDFS) {
        return json(
          { error: "KNOWLEDGE_PDFS KVバインディングが設定されていません" },
          500
        );
      }

      const listed =
        await env.KNOWLEDGE_PDFS.list({
          prefix: "experience/",
          limit: 100,
        });

      return json({
        files:
          listed.keys.map(
            pdfMetadata
          ),
      });
    }

    if (url.pathname === "/api/admin/pdfs") {
      const authError =
        validatePdfAdmin(
          request,
          env
        );

      if (authError) {
        return authError;
      }

      if (request.method !== "POST") {
        return json(
          { error: "Method Not Allowed" },
          405
        );
      }

      if (!env.KNOWLEDGE_PDFS) {
        return json(
          { error: "KNOWLEDGE_PDFS KVバインディングが設定されていません" },
          500
        );
      }

      const form =
        await request.formData();

      const file =
        form.get("file");

      if (!(file instanceof File)) {
        return json(
          { error: "PDFファイルがありません" },
          400
        );
      }

      if (
        file.type !== "application/pdf" ||
        !file.name.toLowerCase().endsWith(".pdf")
      ) {
        return json(
          { error: "PDF形式のみ登録できます" },
          400
        );
      }

      if (file.size > 10 * 1024 * 1024) {
        return json(
          { error: "PDFは10MB以下にしてください" },
          413
        );
      }

      const safeName =
        sanitizePdfName(
          file.name
        );

      const key =
        "experience/" +
        crypto.randomUUID() +
        "-" +
        safeName;

      const metadata = {
        originalName:
          file.name.slice(0, 180),
        title:
          String(
            form.get("title") ||
            file.name
          ).slice(0, 180),
        author:
          String(
            form.get("author") ||
            ""
          ).slice(0, 180),
        sourceType:
          "owned_experience_pdf",
        size: file.size,
        uploaded:
          new Date().toISOString(),
      };

      await env.KNOWLEDGE_PDFS.put(
        key,
        await file.arrayBuffer(),
        { metadata }
      );

      const saved = {
        name: key,
        metadata,
      };

      return json(
        {
          file:
            pdfMetadata(saved),
        },
        201
      );
    }

    const pdfDeleteMatch =
      url.pathname.match(
        /^\/api\/admin\/pdfs\/(.+)$/
      );

    if (pdfDeleteMatch) {
      const authError =
        validatePdfAdmin(
          request,
          env
        );

      if (authError) {
        return authError;
      }

      if (request.method !== "DELETE") {
        return json(
          { error: "Method Not Allowed" },
          405
        );
      }

      if (!env.KNOWLEDGE_PDFS) {
        return json(
          { error: "KNOWLEDGE_PDFS KVバインディングが設定されていません" },
          500
        );
      }

      const key =
        decodeURIComponent(
          pdfDeleteMatch[1]
        );

      if (!key.startsWith("experience/")) {
        return json(
          { error: "無効なPDFキーです" },
          400
        );
      }

      await env.KNOWLEDGE_PDFS.delete(
        key
      );

      return json({ success: true });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/ai/analyze"
    ) {
      if (!env.OPENAI_API_KEY) {
        return json(
          { error: "OPENAI_API_KEY が設定されていません" },
          500
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          { error: "JSONを読み取れませんでした" },
          400
        );
      }

      const uid = String(body.uid || "").trim();

      if (!uid) {
        return json(
          { error: "uid がありません" },
          400
        );
      }

      const result = await roastWorldGet(
        "https://api.roast.world/api/v3/public/roasts/" +
          encodeURIComponent(uid),
        env
      );

      if (!result.ok) {
        return json(
          {
            error: "焙煎詳細を取得できませんでした",
            details: result.text,
          },
          502
        );
      }

      const summary = summarizeRoast(
        result.data,
        true
      );

      summary.roast_label =
        String(body.roastLabel || "");

      summary.bean =
        body.bean || null;

      const packet = {
        target: summary,

        tasting_note:
          String(body.tasting || "").trim() ||
          "未入力",

        shared_experiment_note:
          String(body.commonNote || "").trim() ||
          "未入力",
      };

      const knowledgeLayers =
        normalizeKnowledgeLayers(
          body.knowledgeLayers
        );

      const pdfInputs =
        knowledgeLayers.includes(
          "experts"
        )
          ? await loadKnowledgePdfInputs(
              body.pdfKeys,
              env
            )
          : [];

      return runOpenAI(
        knowledgePrompt(
          individualPrompt(packet),
          knowledgeLayers
        ),
        env,
        2600,
        {
          useWebSearch:
            needsWebSearch(
              knowledgeLayers
            ),
          pdfInputs,
        }
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/ai/history"
    ) {
      if (!env.OPENAI_API_KEY) {
        return json(
          { error: "OPENAI_API_KEY が設定されていません" },
          500
        );
      }

      let body;

      try {
        body = await request.json();
      } catch {
        return json(
          { error: "JSONを読み取れませんでした" },
          400
        );
      }

      const mode =
        body.mode === "cross"
          ? "cross"
          : body.mode === "multi"
            ? "multi"
            : "bean";

      const selectedBeanKey =
        String(body.selectedBeanKey || "");

      const selectedBeanKeys =
        Array.isArray(body.selectedBeanKeys)
          ? body.selectedBeanKeys.map(String)
          : [];

      let entries =
        Array.isArray(body.entries)
          ? body.entries.filter(
              (entry) =>
                entry &&
                entry.uid
            )
          : [];

      if (mode === "bean") {
        entries =
          entries.filter(
            (entry) =>
              String(
                entry.beanKey || ""
              ) ===
              selectedBeanKey
          );
      }

      if (mode === "multi") {
        entries =
          entries.filter(
            (entry) =>
              selectedBeanKeys.includes(
                String(
                  entry.beanKey || ""
                )
              )
          );
      }

      if (!entries.length) {
        return json(
          {
            error:
              mode === "bean"
                ? "この豆の焙煎履歴がありません"
                : "分析対象がありません",
          },
          400
        );
      }

      entries.sort(
        (a, b) => {
          const aTaste =
            String(a.tasting || "").trim()
              ? 1
              : 0;

          const bTaste =
            String(b.tasting || "").trim()
              ? 1
              : 0;

          return bTaste - aTaste;
        }
      );

      entries =
        entries.slice(
          0,
          mode === "bean"
            ? 40
            : 50
        );

      const detailResults =
        await Promise.all(
          entries.map(
            (entry) =>
              roastWorldGet(
                "https://api.roast.world/api/v3/public/roasts/" +
                  encodeURIComponent(entry.uid),
                env
              )
          )
        );

      const experiments = [];

      for (
        let i = 0;
        i < detailResults.length;
        i++
      ) {
        if (!detailResults[i].ok) {
          continue;
        }

        const summary =
          summarizeRoast(
            detailResults[i].data,
            false
          );

        summary.roast_label =
          entries[i].roastLabel || "";

        summary.bean_key =
          entries[i].beanKey || "";

        summary.bean =
          entries[i].bean || null;

        summary.tasting_note =
          entries[i].tasting || "未入力";

        summary.shared_experiment_note =
          entries[i].commonNote || "未入力";

        experiments.push(summary);
      }

      if (!experiments.length) {
        return json(
          { error: "焙煎詳細を取得できませんでした" },
          502
        );
      }

      const prompt =
        mode === "cross"
          ? crossBeanPrompt(experiments)
          : mode === "multi"
            ? multiBeanPlanningPrompt(experiments)
            : sameBeanPrompt(experiments);

      const knowledgeLayers =
        normalizeKnowledgeLayers(
          body.knowledgeLayers
        );

      const pdfInputs =
        knowledgeLayers.includes(
          "experts"
        )
          ? await loadKnowledgePdfInputs(
              body.pdfKeys,
              env
            )
          : [];

      return runOpenAI(
        knowledgePrompt(
          prompt,
          knowledgeLayers
        ),
        env,
        4200,
        {
          useWebSearch:
            needsWebSearch(
              knowledgeLayers
            ),
          pdfInputs,
        }
      );
    }

    return json(
      { error: "Not Found" },
      404
    );
  },
};


function validatePdfAdmin(
  request,
  env
) {
  if (!env.PDF_ADMIN_PASSWORD) {
    return json(
      { error: "PDF_ADMIN_PASSWORD が設定されていません" },
      500
    );
  }

  const supplied =
    request.headers.get(
      "x-admin-password"
    ) || "";

  if (supplied !== env.PDF_ADMIN_PASSWORD) {
    return json(
      { error: "管理者認証に失敗しました" },
      401
    );
  }

  return null;
}


function sanitizePdfName(
  name
) {
  const cleaned =
    String(name)
      .normalize("NFKC")
      .replace(
        /[^a-zA-Z0-9._-]+/g,
        "-"
      )
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);

  return cleaned || "document.pdf";
}


function pdfMetadata(
  object
) {
  const metadata =
    object?.metadata || {};

  const key =
    object?.key ||
    object?.name ||
    "";

  return {
    key,
    name:
      metadata.originalName ||
      key.split("/").pop() ||
      "",
    title:
      metadata.title ||
      metadata.originalName ||
      "",
    author:
      metadata.author || "",
    sourceType:
      metadata.sourceType ||
      "owned_experience_pdf",
    size:
      Number(
        metadata.size ||
        object?.size ||
        0
      ),
    uploaded:
      metadata.uploaded ||
      (object?.uploaded
        ? object.uploaded.toISOString()
        : ""),
  };
}


async function loadKnowledgePdfInputs(
  value,
  env
) {
  if (!Array.isArray(value)) {
    return [];
  }

  const keys =
    Array.from(
      new Set(
        value.map(String)
      )
    )
      .filter(
        (key) =>
          key.startsWith(
            "experience/"
          )
      )
      .slice(0, 3);

  if (!keys.length) {
    return [];
  }

  if (!env.KNOWLEDGE_PDFS) {
    throw new Error(
      "KNOWLEDGE_PDFS KVバインディングが設定されていません"
    );
  }

  const inputs = [];
  let totalBytes = 0;

  for (const key of keys) {
    const object =
      await env.KNOWLEDGE_PDFS.getWithMetadata(
        key,
        { type: "arrayBuffer" }
      );

    if (!object?.value) {
      continue;
    }

    totalBytes +=
      Number(
        object.metadata?.size ||
        object.value.byteLength ||
        0
      );

    if (
      totalBytes >
      15 * 1024 * 1024
    ) {
      throw new Error(
        "選択PDFの合計は15MB以下にしてください"
      );
    }

    const buffer =
      object.value;

    const metadata =
      object.metadata || {};

    inputs.push({
      type: "input_file",
      filename:
        metadata.originalName ||
        key.split("/").pop() ||
        "document.pdf",
      file_data:
        "data:application/pdf;base64," +
        arrayBufferToBase64(
          buffer
        ),
    });
  }

  return inputs;
}


function arrayBufferToBase64(
  buffer
) {
  const bytes =
    new Uint8Array(buffer);

  const chunkSize =
    0x8000;

  let binary = "";

  for (
    let offset = 0;
    offset < bytes.length;
    offset += chunkSize
  ) {
    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          offset,
          Math.min(
            offset + chunkSize,
            bytes.length
          )
        )
      );
  }

  return btoa(binary);
}


async function runOpenAI(
  prompt,
  env,
  maxTokens,
  options = {}
) {
  const requestBody = {
    model:
      "gpt-5.6-luna",

    input:
      prompt,

    max_output_tokens:
      maxTokens,

    store:
      false,
  };

  if (
    Array.isArray(options.pdfInputs) &&
    options.pdfInputs.length
  ) {
    requestBody.input = [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
          ...options.pdfInputs,
        ],
      },
    ];
  }

  if (options.useWebSearch) {
    requestBody.tools = [
      { type: "web_search" },
    ];

    requestBody.include = [
      "web_search_call.action.sources",
    ];

    requestBody.max_tool_calls = 4;
  }

  const response =
    await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",

        headers: {
          Authorization:
            "Bearer " +
            env.OPENAI_API_KEY,

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            requestBody
          ),
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    return json(
      {
        error:
          "OpenAI API エラー",

        details:
          text,
      },
      502
    );
  }

  let data;

  try {
    data =
      JSON.parse(text);
  } catch {
    return json(
      {
        error:
          "OpenAIレスポンス解析エラー",

        details:
          text,
      },
      502
    );
  }

  return json({
    analysis:
      extractResponseText(data),
  });
}


function extractResponseText(
  data
) {
  if (
    typeof data.output_text === "string" &&
    data.output_text
  ) {
    return data.output_text;
  }

  const parts = [];

  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return (
    parts.join("\n") ||
    "AI出力を取得できませんでした。"
  );
}


async function roastWorldGet(
  apiUrl,
  env
) {
  try {
    const response =
      await fetch(
        apiUrl,
        {
          headers: {
            "x-api-key":
              env.ROASTWORLD_API_TOKEN,

            Accept:
              "application/json",
          },
        }
      );

    const text =
      await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        text,
      };
    }

    return {
      ok: true,
      data: JSON.parse(text),
      text,
    };

  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: String(error),
    };
  }
}


async function proxyRoastWorld(
  apiUrl,
  env
) {
  const result =
    await roastWorldGet(
      apiUrl,
      env
    );

  if (!result.ok) {
    return json(
      {
        error:
          "Roast.World API エラー",

        details:
          result.text,
      },
      502
    );
  }

  return json(result.data);
}


function summarizeRoast(
  roast,
  includeSeries
) {
  const total =
    numberOrNull(
      roast.totalRoastTime
    );

  const fc =
    numberOrNull(
      roast.firstCrackTime
    );

  const bt =
    getNumericArray(
      roast,
      [
        "beanTemperature",
        "beanTemperatures",
        "beanTemp",
        "bt",
      ]
    );

  const ibts =
    getNumericArray(
      roast,
      [
        "ibtsTemperature",
        "ibtsTemperatures",
        "ibts",
      ]
    );

  const ror =
    getNumericArray(
      roast,
      [
        "beanDerivative",
        "beanRoR",
        "rateOfRise",
        "ror",
      ]
    );

  const green =
    numberOrNull(
      roast.weightGreen ??
      roast.greenWeight ??
      roast.chargeWeight
    );

  const roasted =
    numberOrNull(
      roast.weightRoasted ??
      roast.roastedWeight ??
      roast.dropWeight
    );

  const actions =
    Array.isArray(roast.actions)
      ? roast.actions
      : [];

  const summary = {
    uid:
      roast.uid ||
      roast.id ||
      null,

    date_time:
      formatDateJST(
        roast.dateTime
      ),

    preheat_c:
      numberOrNull(
        roast.preheatTemperature
      ),

    bean_charge_c:
      numberOrNull(
        roast.beanChargeTemperature
      ),

    drum_charge_c:
      numberOrNull(
        roast.drumChargeTemperature
      ),

    total_time_s:
      total,

    first_crack_time_s:
      fc,

    first_crack_temp_c:
      numberOrNull(
        roast.firstCrackTemp
      ),

    development_s:
      total != null &&
      fc != null
        ? round(
            total -
            fc,
            1
          )
        : null,

    dtr_pct:
      total > 0 &&
      fc != null
        ? round(
            (
              (
                total -
                fc
              ) /
              total
            ) *
            100,
            1
          )
        : null,

    green_weight_g:
      green,

    roasted_weight_g:
      roasted,

    weight_loss_pct:
      green > 0 &&
      roasted > 0
        ? round(
            (
              1 -
              roasted /
              green
            ) *
            100,
            1
          )
        : null,

    environment: {
      ambient_c:
        numberOrNull(
          roast.ambient
        ),

      humidity_pct:
        numberOrNull(
          roast.humidity
        ),
    },

    series_stats: {
      bt:
        seriesStats(bt),

      ibts:
        seriesStats(ibts),

      ror:
        seriesStats(ror),
    },

    actions:
      actions.slice(
        0,
        60
      ),
  };

  if (includeSeries) {
    summary.series = {
      bt:
        downsample(
          bt,
          120
        ),

      ibts:
        downsample(
          ibts,
          120
        ),

      ror:
        downsample(
          ror,
          120
        ),
    };
  }

  return summary;
}


const KNOWLEDGE_LAYER_LABELS = {
  user_experiments:
    "1. ユーザー自身の焙煎実験",
  peer_reviewed:
    "2. 査読論文・食品科学",
  official:
    "3. SCA/WCRC/Aillio等の公式資料",
  experts:
    "4. 大会優勝者・上位競技者・専門家の経験則",
  ai_hypothesis:
    "5. AIによる仮説",
};


function normalizeKnowledgeLayers(
  value
) {
  const allowed =
    Object.keys(
      KNOWLEDGE_LAYER_LABELS
    );

  const selected =
    Array.isArray(value)
      ? value.filter(
          (item) =>
            allowed.includes(
              String(item)
            )
        )
      : [];

  return Array.isArray(value)
    ? Array.from(
        new Set(selected)
      )
    : allowed;
}


function needsWebSearch(
  layers
) {
  return layers.some(
    (layer) =>
      [
        "peer_reviewed",
        "official",
        "experts",
      ].includes(layer)
  );
}


function knowledgePrompt(
  prompt,
  layers
) {
  const labels =
    layers.map(
      (layer) =>
        KNOWLEDGE_LAYER_LABELS[layer]
    );

  return `
選択された根拠層:
${labels.join("\n")}

必須ルール:
- 選択されていない根拠層は使用しない。
- 各主張を選択された根拠層ごとに明確に分離する。
- 層1は提供されたユーザー自身の焙煎・カッピング記録だけを根拠にする。
- 層2〜4を使用する場合はWeb検索を行い、本文中に資料名とURLを記載する。
- 層2は査読論文または食品科学の一次資料を優先する。
- 層3はSCA、WCRC、Aillio等の公式資料だけを根拠にする。
- 層4は人物名、実績、発言元を明記し、経験則として扱う。
- input_fileのPDFは「所有PDF由来」と明記し、ファイル名を示す。
- 所有PDFの内容とWeb検索由来の経験則を混ぜずに分離する。
- PDFの記述を査読論文や公式資料として勝手に格上げしない。
- 層5は必ず「AIによる仮説」と表示し、事実として断定しない。
- 根拠が見つからない層は「根拠を確認できず」と明記する。
- 豆が異なる場合、具体的な焙煎条件を直接一般化しない。
- 次回実験は原則1変数だけ変更する。

${prompt}
`;
}


function individualPrompt(
  packet
) {
  return `
あなたは競技レベルのスペシャルティコーヒー焙煎コーチです。

対象データ:
${JSON.stringify(packet)}

重要:
- bean情報を必ず考慮する。
- shared_experiment_note は複数焙煎に共通する実験条件・比較・本人の考察として扱う。
- tasting_note は対象焙煎固有のカッピング結果として扱う。
- 違う豆の結果をこの豆へ直接一般化しない。
- データから確認できる事実と仮説を分ける。
- 因果を断定しない。
- 次回変更する変数は原則1つだけ。
- 変更量を具体化する。

特に評価:
first-sip acidity/rawness
floral
sugar/honey sweetness
texture
dryness
paper
grain
grass
watery finish
aftertaste duration

出力:
【対象焙煎】
【豆】
【個別カッピング結果】
【共通実験・考察】
【プロファイルの特徴】
【カッピングとの対応】
【改善仮説】
【次回の単一変数実験】
【固定する条件】
【結果による次の判断】
`;
}


function sameBeanPrompt(
  experiments
) {
  return `
あなたは競技レベルのスペシャルティコーヒー焙煎コーチ兼実験設計者です。

以下は同一豆 / 同一ロットとして分類された焙煎履歴です。

${JSON.stringify(experiments)}

各記録の tasting_note は個別カッピング結果、
shared_experiment_note は共通実験条件・比較・本人の考察です。

目的:
この豆について、
焙煎プロファイル × 個別カッピング × 共通実験メモから、
次の1バッチで最も情報価値の高い実験を1つ決めてください。

ルール:
1. この豆の履歴を主証拠にする。
2. カッピング未入力の焙煎を味覚判断の根拠にしない。
3. 共通実験メモから「何を変えたか」「何を比較したか」を読み取る。
4. 条件が近いA/Bを最優先する。
5. 複数変数が変わった比較は信頼度を下げる。
6. 再現した傾向を優先する。
7. 矛盾する結果を明記する。
8. 次回変更する変数は1つだけ。
9. 変更量を具体化する。
10. その他の条件を固定する。

重視する味覚:
first-sip acidity/rawness
floral
sugar/honey sweetness
texture
dryness
paper
grain
grass
watery finish
aftertaste duration

出力:
【この豆で現在までに分かったこと】
【かなり確からしい傾向】
【まだ仮説段階のこと】
【矛盾している結果】
【現時点のベスト焙煎】
【現在最大の品質課題】
【次に検証すべき仮説】
【次回の単一変数A/B実験】

Baseline:
過去のどの焙煎か。

Test:
変更する変数を1つ。

Exact change:
具体的な変更量。

【絶対に固定する条件】

green coffee
batch size
charge / preheat
soak
power / fan sequence
milestone targets
drop criteria
rest time
brew / cupping recipe

※変更対象の1変数は除く。

【記録する項目】

【結果 → 次のアクション】

最後に
「次のバッチではこれ以外を変更しない」
と明記してください。
`;
}


function multiBeanPlanningPrompt(
  experiments
) {
  return `
あなたは競技レベルのスペシャルティコーヒー焙煎コーチ兼実験設計者です。

以下にはユーザーが選択した複数種類の豆の焙煎履歴が含まれます。

${JSON.stringify(experiments)}

目的:
豆ごとに履歴を完全に分離して評価し、各豆について次回の1変数実験を1つずつ提案してください。

必須ルール:
- 異なる豆の具体的なPreheat、FC時間、温度、火力・風量操作を別の豆へ直接一般化しない。
- 各豆では、その豆自身の焙煎実験とカッピング結果を主証拠にする。
- 豆をまたぐ情報は仮説の着想に限り、具体的条件の根拠にはしない。
- 各豆の次回実験で変更する変数は1つだけにする。
- 変更対象以外の条件を明記して固定する。
- カッピング未入力の焙煎を味覚判断の根拠にしない。

出力:
豆ごとに以下を繰り返す。
【豆】
【この豆自身の履歴から分かったこと】
【現時点のベスト焙煎】
【最大の品質課題】
【次回の単一変数実験】
【具体的な変更量】
【固定する条件】
【結果による次の判断】

最後に、豆間で直接一般化しなかったことを明記してください。
`;
}


function crossBeanPrompt(
  experiments
) {
  return `
あなたは競技レベルのスペシャルティコーヒー焙煎コーチです。

以下には複数種類の豆が含まれます。

${JSON.stringify(experiments)}

各記録の tasting_note は個別カッピング、
shared_experiment_note は共通実験条件・比較・本人の考察です。

目的:
特定豆の最適レシピを決めるのではなく、
「この焙煎者 + Aillio Bullet」で豆が変わっても再現している
操作上の傾向を見つける。

最重要:
- 豆ごとの密度・含水率・品種・精製・サイズ・熱応答の差を考慮する。
- ある豆の具体的なPreheatやFC時間を別の豆へ直接移植しない。
- 同一豆内の因果仮説と、豆横断傾向を混ぜない。
- 複数豆で再現した傾向のみ強く扱う。
- 反例を必ず明記する。
- 豆固有の次回レシピはここでは提案しない。

出力:
【豆ごとの違い】
【複数豆で再現した焙煎者 / 機材側の傾向】
【何ロットで再現したか】
【反例・矛盾】
【まだ一般化できないこと】
【今後どの豆でも記録すべき項目】
【同一豆分析へ持ち帰るべき仮説】
`;
}


function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=UTF-8",

        "Cache-Control":
          "no-store",

        "Access-Control-Allow-Origin":
          "*",
      },
    }
  );
}


function numberOrNull(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function round(
  value,
  digits = 1
) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const p =
    Math.pow(
      10,
      digits
    );

  return (
    Math.round(
      value *
      p
    ) /
    p
  );
}


function getNumericArray(
  object,
  names
) {
  for (const name of names) {
    const value =
      object?.[name];

    if (Array.isArray(value)) {
      return value
        .map(
          (x) => {
            if (
              typeof x === "number"
            ) {
              return x;
            }

            if (
              x &&
              typeof x === "object"
            ) {
              if (
                Number.isFinite(
                  Number(x.value)
                )
              ) {
                return Number(
                  x.value
                );
              }

              if (
                Number.isFinite(
                  Number(x.y)
                )
              ) {
                return Number(
                  x.y
                );
              }

              if (
                Number.isFinite(
                  Number(
                    x.temperature
                  )
                )
              ) {
                return Number(
                  x.temperature
                );
              }
            }

            const n =
              Number(x);

            return Number.isFinite(n)
              ? n
              : null;
          }
        )
        .filter(
          (x) =>
            x !== null
        );
    }
  }

  return [];
}


function seriesStats(
  values
) {
  if (
    !Array.isArray(values) ||
    !values.length
  ) {
    return null;
  }

  const valid =
    values.filter(
      Number.isFinite
    );

  if (!valid.length) {
    return null;
  }

  let min =
    valid[0];

  let max =
    valid[0];

  let sum =
    0;

  for (const value of valid) {
    if (value < min) min = value;
    if (value > max) max = value;

    sum += value;
  }

  return {
    count:
      valid.length,

    min:
      round(min, 2),

    max:
      round(max, 2),

    mean:
      round(
        sum /
        valid.length,
        2
      ),

    first:
      round(
        valid[0],
        2
      ),

    last:
      round(
        valid[
          valid.length -
          1
        ],
        2
      ),
  };
}


function downsample(
  values,
  targetCount = 120
) {
  if (
    !Array.isArray(values) ||
    !values.length
  ) {
    return [];
  }

  if (
    values.length <=
    targetCount
  ) {
    return values.map(
      (v) =>
        round(v, 2)
    );
  }

  const result = [];

  const step =
    (
      values.length -
      1
    ) /
    (
      targetCount -
      1
    );

  for (
    let i = 0;
    i < targetCount;
    i++
  ) {
    const index =
      Math.round(
        i *
        step
      );

    result.push(
      round(
        values[index],
        2
      )
    );
  }

  return result;
}


function formatDateJST(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  let date;

  if (
    typeof value === "number"
  ) {
    date =
      new Date(
        value <
        100000000000
          ? value *
            1000
          : value
      );
  } else {
    const numeric =
      Number(value);

    if (
      String(value).trim() !== "" &&
      Number.isFinite(numeric)
    ) {
      date =
        new Date(
          numeric <
          100000000000
            ? numeric *
              1000
            : numeric
        );
    } else {
      date =
        new Date(value);
    }
  }

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return String(value);
  }

  try {
    return new Intl.DateTimeFormat(
      "ja-JP",
      {
        timeZone:
          "Asia/Tokyo",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        second:
          "2-digit",

        hour12:
          false,
      }
    ).format(date);

  } catch {
    return date.toISOString();
  }
}


function pageHTML() {
  return String.raw`<!DOCTYPE html>

<html lang="ja">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width, initial-scale=1"
>

<title>
Roast.World Analyzer
</title>

<style>

:root {
  --bg:#f5f5f3;
  --card:#ffffff;
  --text:#171717;
  --sub:#686868;
  --border:#ddddda;
  --green:#126b3a;
  --green2:#e8f4ec;
  --blue:#145a8d;
  --blue2:#eaf3fa;
  --red:#a63333;
  --red2:#faeaea;
  --amber:#855b00;
  --amber2:#fff4d6;
  --shadow:
    0 5px 18px
    rgba(0,0,0,0.06);
}

* {
  box-sizing:border-box;
}

body {
  margin:0;
  background:var(--bg);
  color:var(--text);

  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    "Noto Sans JP",
    sans-serif;

  line-height:1.65;
}

button,
input,
select,
textarea {
  font:inherit;
}

button {
  cursor:pointer;
}

.header {
  background:#171717;
  color:white;
  padding:22px 18px;
}

.header-inner {
  max-width:1120px;
  margin:auto;
}

.header h1 {
  margin:0;
  font-size:26px;
}

.header p {
  margin:4px 0 0;
  opacity:.75;
  font-size:13px;
}

.container {
  max-width:1120px;
  margin:auto;
  padding:18px;
}

.card {
  background:var(--card);
  border:1px solid var(--border);
  border-radius:18px;
  padding:20px;
  margin-bottom:18px;
  box-shadow:var(--shadow);
}

h2 {
  margin-top:0;
  line-height:1.3;
  font-size:22px;
}

h3 {
  margin-top:0;
  line-height:1.4;
}

.muted {
  color:var(--sub);
}

.small {
  font-size:13px;
}

.status {
  padding:13px 15px;
  border-radius:12px;
  margin-top:10px;
  white-space:pre-wrap;
}

.status.loading {
  background:#efefef;
}

.status.ok {
  background:var(--green2);
  color:var(--green);
}

.status.error {
  background:var(--red2);
  color:var(--red);
}

.status.warn {
  background:var(--amber2);
  color:var(--amber);
}

.toolbar {
  display:flex;
  gap:10px;
  flex-wrap:wrap;
  align-items:center;
}

.btn {
  border:0;
  border-radius:11px;
  padding:11px 15px;
  background:#171717;
  color:white;
  font-weight:700;
}

.btn.green {
  background:var(--green);
}

.btn.blue {
  background:var(--blue);
}

.btn.light {
  background:#eeeeec;
  color:#171717;
}

.btn.danger {
  background:var(--red);
}

.btn:disabled {
  opacity:.45;
  cursor:not-allowed;
}

textarea,
input,
select {
  width:100%;
  border:1px solid #cfcfca;
  border-radius:11px;
  background:white;
  padding:11px 12px;
  color:#171717;
}

textarea {
  min-height:130px;
  resize:vertical;
}

.bulk-input {
  min-height:390px;
  font-size:16px;
}

label {
  display:block;
  font-weight:700;
  margin-bottom:6px;
}

.grid2 {
  display:grid;
  grid-template-columns:
    repeat(
      2,
      minmax(0,1fr)
    );
  gap:14px;
}

.roast-list {
  display:grid;
  gap:13px;
}

.roast {
  border:1px solid var(--border);
  border-radius:15px;
  padding:15px;
  background:#fff;
}

.roast-head {
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:10px;
  flex-wrap:wrap;
}

.roast-title {
  font-size:20px;
  font-weight:800;
}

.bean-name {
  color:var(--green);
  font-weight:700;
}

.pill {
  display:inline-block;
  border-radius:999px;
  padding:3px 9px;
  margin:2px 4px 2px 0;
  font-size:12px;
  background:#efefed;
}

.roast-note {
  margin-top:10px;
  padding:10px 12px;
  background:#f7f7f5;
  border-radius:10px;
  white-space:pre-wrap;
}

.common-note {
  background:#fff8e8;
}

.ai-box {
  margin-top:12px;
  padding:14px;
  border-radius:12px;
  background:var(--blue2);
  white-space:pre-wrap;
}

.hidden {
  display:none !important;
}

.preview-group {
  border:1px solid var(--border);
  border-radius:14px;
  padding:14px;
  margin:12px 0;
}

.preview-item {
  padding:10px 0;
  border-bottom:1px dashed #ddd;
}

.preview-item:last-child {
  border-bottom:0;
}

.common-editor {
  background:#fff9e9;
  padding:12px;
  border-radius:10px;
  margin-top:10px;
}

.analysis-card {
  border:2px solid #cbded1;
}

.analysis-output {
  white-space:pre-wrap;
  padding:14px;
  background:#f5faf7;
  border-radius:12px;
  margin-top:12px;
}

.cross-output {
  background:#f2f7fb;
}

.pagination {
  display:flex;
  align-items:center;
  justify-content:center;
  gap:12px;
  margin:18px 0;
}

.pagination button {
  border:0;
  border-radius:10px;
  padding:10px 14px;
}

.danger-text {
  color:var(--red);
}

.section-note {
  border-left:4px solid #999;
  padding-left:12px;
  margin-bottom:14px;
}

@media(max-width:760px) {
  .container {
    padding:12px;
  }

  .card {
    padding:16px;
  }

  .grid2 {
    grid-template-columns:1fr;
  }

  .header h1 {
    font-size:23px;
  }

  .bulk-input {
    min-height:450px;
  }
}

</style>

</head>

<body>

<header class="header">

<div class="header-inner">

<h1>
☕ Roast.World Analyzer
</h1>

<p>
Roast.Worldの焙煎履歴・カッピング結果・AI分析を一か所で管理
</p>

</div>

</header>


<main class="container">


<section class="card">

<h2>
接続状態
</h2>

<div
id="connectionStatus"
class="status loading"
>
Roast.Worldから取得中…
</div>

<div
class="toolbar"
style="margin-top:12px"
>

<button
id="reloadButton"
class="btn"
type="button"
>
再読み込み
</button>

<button
id="jsonButton"
class="btn light"
type="button"
>
取得JSONを見る
</button>

</div>

<pre
id="jsonPreview"
class="hidden"
style="
overflow:auto;
max-height:420px;
background:#111;
color:#eee;
padding:12px;
border-radius:10px;
"
></pre>

</section>


<section class="card">

<h2>
📝 まとめてカッピング結果を入力
</h2>

<p class="muted">
①②③は各焙煎の個別結果として認識します。
番号の後に続く文章は、同じ比較実験に対する共通メモとして分離します。
保存前に振り分け内容を編集できます。
</p>

<textarea
id="bulkInput"
class="bulk-input"
placeholder="例：

8/14
①紙、舌が乾く
②苦みがでてくる。
③より苦みが出てくる。
Unirのケニアと比較して、いずれも一口目の浅い舌の乾く風味がある。"
></textarea>

<div
class="toolbar"
style="margin-top:12px"
>

<button
id="parseButton"
class="btn"
type="button"
>
振り分けを確認
</button>

</div>

<div
id="bulkMessage"
class="status hidden"
></div>

<div
id="bulkPreview"
class="hidden"
></div>

</section>


<section class="card">

<h2>
📚 分析に使う知識層
</h2>

<p class="section-note muted">
使用する根拠を選択してください。層2〜4を選ぶとWeb検索を使用します。
</p>

<div id="knowledgeLayerOptions" class="grid2">
<label><input type="checkbox" name="knowledgeLayer" value="user_experiments" checked> 1. ユーザー自身の焙煎実験</label>
<label><input type="checkbox" name="knowledgeLayer" value="peer_reviewed" checked> 2. 査読論文・食品科学</label>
<label><input type="checkbox" name="knowledgeLayer" value="official" checked> 3. SCA/WCRC/Aillio等の公式資料</label>
<label><input type="checkbox" name="knowledgeLayer" value="experts" checked> 4. 大会優勝者・上位競技者・専門家の経験則</label>
<label><input type="checkbox" name="knowledgeLayer" value="ai_hypothesis" checked> 5. AIによる仮説</label>
</div>

<div id="knowledgeLayerMessage" class="status ok" style="margin-top:12px">
5つの知識層を使用します。
</div>

</section>


<section class="card">

<h2>
📄 経験則PDFライブラリ
</h2>

<p class="section-note muted">
所有しているPDFを固定資料としてKVへ登録・更新できます。管理パスワードは保存されません。
</p>

<details>
<summary style="cursor:pointer; font-weight:700">
PDFを管理する
</summary>

<div class="grid2" style="margin-top:14px">
<div>
<label for="pdfAdminPassword">管理パスワード</label>
<input id="pdfAdminPassword" type="password" autocomplete="current-password">
</div>
<div>
<label for="pdfFile">PDFファイル（10MB以下）</label>
<input id="pdfFile" type="file" accept="application/pdf,.pdf">
</div>
<div>
<label for="pdfTitle">資料タイトル</label>
<input id="pdfTitle" type="text" maxlength="180">
</div>
<div>
<label for="pdfAuthor">著者・講師</label>
<input id="pdfAuthor" type="text" maxlength="180">
</div>
</div>

<button id="pdfUploadButton" class="btn blue" type="button" style="margin-top:14px">
PDFを登録
</button>

<div id="pdfAdminMessage" class="status hidden" style="margin-top:12px"></div>

</details>

<div id="pdfLibraryList" class="status loading" style="margin-top:14px">
PDFライブラリを読み込み中…
</div>

</section>


<section
id="sameBeanSection"
class="card analysis-card"
>

<h2>
🫘 同一豆の蓄積分析
</h2>

<p class="section-note muted">
次の焙煎条件を決める分析では、
原則として同じ豆・同じロットとして分類した履歴だけを使います。
</p>

<div class="grid2">

<div>

<label for="beanSelect">
分析する豆（複数選択可）
</label>

<select
id="beanSelect"
multiple
size="6"
>

<option value="">
豆データを読み込み中…
</option>

</select>

</div>


<div>

<label>
記録数
</label>

<div
id="beanStats"
class="status loading"
>
読み込み中…
</div>

</div>

</div>

<div
class="toolbar"
style="margin-top:14px"
>

<button
id="beanAnalyzeButton"
class="btn green"
type="button"
>
選択した豆の履歴から次回焙煎を分析
</button>

</div>

<div
id="beanAnalysis"
class="analysis-output hidden"
></div>

</section>


<section class="card">

<h2>
🌐 全豆横断分析
</h2>

<p class="section-note muted">
豆固有のレシピを決める分析ではありません。
選択した複数の豆で再現する「自分 + Bullet」の操作傾向だけを探します。
</p>

<label for="crossBeanSelect">
比較する豆（2種類以上）
</label>

<select
id="crossBeanSelect"
multiple
size="6"
style="width:100%; margin-bottom:14px"
>
<option value="">
豆データを読み込み中…
</option>
</select>

<button
id="crossAnalyzeButton"
class="btn blue"
type="button"
>
選択した豆を横断して自分の焙煎傾向を分析
</button>

<div
id="crossAnalysis"
class="analysis-output cross-output hidden"
></div>

</section>


<section class="card">

<div class="roast-head">

<div>

<h2 style="margin-bottom:4px">
焙煎履歴
</h2>

<div
id="roastCount"
class="muted small"
></div>

</div>

<div style="min-width:240px">

<label for="filterBean">
豆で絞り込み
</label>

<select id="filterBean">

<option value="">
すべて
</option>

</select>

</div>

</div>

<div
id="roastList"
class="roast-list"
></div>

<div class="pagination">

<button
id="prevButton"
type="button"
>
← 前
</button>

<strong id="pageLabel">
1
</strong>

<button
id="nextButton"
type="button"
>
次 →
</button>

</div>

</section>

</main>


<script>

"use strict";

const STORAGE_KEY =
  "roastworld-analyzer-v7";

const PAGE_SIZE =
  12;

let roastWorldRaw =
  null;

let roasts =
  [];

let beans =
  [];

let notes =
  loadStoredNotes();

let currentPage =
  1;

let parsedBulk =
  null;


const el = {
  connectionStatus:
    document.getElementById(
      "connectionStatus"
    ),

  reloadButton:
    document.getElementById(
      "reloadButton"
    ),

  jsonButton:
    document.getElementById(
      "jsonButton"
    ),

  jsonPreview:
    document.getElementById(
      "jsonPreview"
    ),

  bulkInput:
    document.getElementById(
      "bulkInput"
    ),

  parseButton:
    document.getElementById(
      "parseButton"
    ),

  bulkMessage:
    document.getElementById(
      "bulkMessage"
    ),

  bulkPreview:
    document.getElementById(
      "bulkPreview"
    ),

  beanSelect:
    document.getElementById(
      "beanSelect"
    ),

  beanStats:
    document.getElementById(
      "beanStats"
    ),

  beanAnalyzeButton:
    document.getElementById(
      "beanAnalyzeButton"
    ),

  beanAnalysis:
    document.getElementById(
      "beanAnalysis"
    ),

  crossBeanSelect:
    document.getElementById(
      "crossBeanSelect"
    ),

  crossAnalyzeButton:
    document.getElementById(
      "crossAnalyzeButton"
    ),

  crossAnalysis:
    document.getElementById(
      "crossAnalysis"
    ),

  filterBean:
    document.getElementById(
      "filterBean"
    ),

  roastList:
    document.getElementById(
      "roastList"
    ),

  roastCount:
    document.getElementById(
      "roastCount"
    ),

  prevButton:
    document.getElementById(
      "prevButton"
    ),

  nextButton:
    document.getElementById(
      "nextButton"
    ),

  pageLabel:
    document.getElementById(
      "pageLabel"
    ),
};


function loadStoredNotes() {
  try {
    const raw =
      localStorage.getItem(
        STORAGE_KEY
      );

    if (!raw) {
      return {
        roastNotes:{},
        sharedNotes:{},
        beanOverrides:{},
      };
    }

    const parsed =
      JSON.parse(raw);

    return {
      roastNotes:
        parsed.roastNotes ||
        {},

      sharedNotes:
        parsed.sharedNotes ||
        {},

      beanOverrides:
        parsed.beanOverrides ||
        {},
    };

  } catch(error) {
    console.error(
      "保存データ読み込み失敗",
      error
    );

    return {
      roastNotes:{},
      sharedNotes:{},
      beanOverrides:{},
    };
  }
}


function saveStoredNotes() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(notes)
  );
}


function setStatus(
  node,
  message,
  type = "loading"
) {
  node.textContent =
    message;

  node.className =
    "status " +
    type;
}


function escapeHTML(
  value
) {
  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}


function normalizeSpace(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function round(
  value,
  digits = 1
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return null;
  }

  const p =
    Math.pow(
      10,
      digits
    );

  return (
    Math.round(
      n * p
    ) / p
  );
}


function getUid(
  roast
) {
  return String(
    roast?.uid ??
    roast?.id ??
    ""
  );
}


function toDate(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  let date;

  if (
    typeof value === "number"
  ) {
    date =
      new Date(
        value <
        100000000000
          ? value *
            1000
          : value
      );
  } else {
    const raw =
      String(value)
        .trim();

    const n =
      Number(raw);

    if (
      raw !== "" &&
      Number.isFinite(n)
    ) {
      date =
        new Date(
          n <
          100000000000
            ? n *
              1000
            : n
        );
    } else {
      date =
        new Date(value);
    }
  }

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}


function getRoastDate(
  roast
) {
  return (
    toDate(
      roast.dateTime
    ) ||
    toDate(
      roast.createdAt
    ) ||
    toDate(
      roast.updatedAt
    )
  );
}


function datePartsJST(
  date
) {
  if (!date) {
    return null;
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "Asia/Tokyo",

        year:
          "numeric",

        month:
          "numeric",

        day:
          "numeric",

        hour:
          "numeric",

        minute:
          "numeric",

        second:
          "numeric",

        hour12:
          false,
      }
    ).formatToParts(date);

  const map = {};

  for (
    const part
    of parts
  ) {
    if (
      part.type !==
      "literal"
    ) {
      map[part.type] =
        Number(
          part.value
        );
    }
  }

  return {
    year:
      map.year,

    month:
      map.month,

    day:
      map.day,

    hour:
      map.hour,

    minute:
      map.minute,

    second:
      map.second,
  };
}


function dateKey(
  roast
) {
  const date =
    getRoastDate(
      roast
    );

  const p =
    datePartsJST(
      date
    );

  if (!p) {
    return "";
  }

  return (
    String(
      p.year
    ) +
    "-" +
    String(
      p.month
    ).padStart(
      2,
      "0"
    ) +
    "-" +
    String(
      p.day
    ).padStart(
      2,
      "0"
    )
  );
}


function shortDate(
  roast
) {
  const date =
    getRoastDate(
      roast
    );

  const p =
    datePartsJST(
      date
    );

  if (!p) {
    return "?/?";
  }

  return (
    p.month +
    "/" +
    p.day
  );
}


function fullDateTime(
  roast
) {
  const date =
    getRoastDate(
      roast
    );

  if (!date) {
    return "日時不明";
  }

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      timeZone:
        "Asia/Tokyo",

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false,
    }
  ).format(date);
}


function sortOldestFirst(
  list
) {
  return [...list].sort(
    (a,b) => {
      const ad =
        getRoastDate(a)
          ?.getTime() ||
        0;

      const bd =
        getRoastDate(b)
          ?.getTime() ||
        0;

      if (
        ad !== bd
      ) {
        return ad - bd;
      }

      return getUid(a)
        .localeCompare(
          getUid(b)
        );
    }
  );
}


function sortNewestFirst(
  list
) {
  return sortOldestFirst(
    list
  ).reverse();
}


function getDaySequenceMap() {
  const map =
    new Map();

  const grouped =
    new Map();

  for (
    const roast
    of roasts
  ) {
    const key =
      dateKey(
        roast
      );

    if (!key) {
      continue;
    }

    if (
      !grouped.has(key)
    ) {
      grouped.set(
        key,
        []
      );
    }

    grouped.get(
      key
    ).push(
      roast
    );
  }

  for (
    const list
    of grouped.values()
  ) {
    const ordered =
      sortOldestFirst(
        list
      );

    ordered.forEach(
      (roast,index) => {
        map.set(
          getUid(roast),
          index +
          1
        );
      }
    );
  }

  return map;
}


function circledNumber(
  number
) {
  const values = [
    "",
    "①","②","③","④","⑤",
    "⑥","⑦","⑧","⑨","⑩",
    "⑪","⑫","⑬","⑭","⑮",
    "⑯","⑰","⑱","⑲","⑳"
  ];

  return (
    values[number] ||
    "(" +
    number +
    ")"
  );
}


function roastLabel(
  roast
) {
  const seq =
    getDaySequenceMap()
      .get(
        getUid(roast)
      ) ||
    "?";

  return (
    shortDate(
      roast
    ) +
    circledNumber(
      seq
    )
  );
}


function inferBeanKey(
  roast
) {
  const uid =
    getUid(roast);

  if (
    notes.beanOverrides &&
    notes.beanOverrides[
      uid
    ]
  ) {
    return String(
      notes.beanOverrides[
        uid
      ]
    );
  }

  const directCandidates = [
    roast.beanId,
    roast.greenBeanId,
    roast.bean?.uid,
    roast.bean?.id,
    roast.greenBean?.uid,
    roast.greenBean?.id,
  ];

  for (
    const value
    of directCandidates
  ) {
    if (
      value !== undefined &&
      value !== null &&
      String(value)
        .trim() !== ""
    ) {
      return (
        "id:" +
        String(value)
      );
    }
  }

  const roastName =
    normalizeSpace(
      roast.roastName ||
      roast.name ||
      ""
    );

  if (roastName) {
    return (
      "name:" +
      roastName
    );
  }

  return "unknown";
}


function buildBeanLookup() {
  const map =
    new Map();

  for (
    const bean
    of beans
  ) {
    const ids = [
      bean?.uid,
      bean?.id,
      bean?.beanId,
      bean?.greenBeanId,
    ];

    for (
      const id
      of ids
    ) {
      if (
        id !== undefined &&
        id !== null &&
        String(id)
          .trim() !== ""
      ) {
        map.set(
          "id:" +
          String(id),
          bean
        );
      }
    }

    const name =
      normalizeSpace(
        bean?.name ||
        ""
      );

    if (name) {
      map.set(
        "name:" +
        name,
        bean
      );
    }
  }

  return map;
}


function beanDisplayName(
  roast,
  beanLookup
) {
  const key =
    inferBeanKey(
      roast
    );

  const bean =
    beanLookup.get(
      key
    );

  if (bean) {
    return (
      bean.name ||
      bean.country ||
      bean.farm ||
      "豆情報あり"
    );
  }

  if (
    key.startsWith(
      "name:"
    )
  ) {
    return key.slice(
      "name:".length
    );
  }

  if (
    key === "unknown"
  ) {
    return "豆情報なし";
  }

  return key;
}


function beanMetaForRoast(
  roast,
  beanLookup
) {
  const key =
    inferBeanKey(
      roast
    );

  const bean =
    beanLookup.get(
      key
    );

  return {
    beanKey:
      key,

    name:
      bean?.name ||
      (
        key.startsWith(
          "name:"
        )
          ? key.slice(
              "name:".length
            )
          : null
      ),

    country:
      bean?.country ||
      null,

    farm:
      bean?.farm ||
      null,

    process:
      bean?.process ||
      null,

    varieties:
      Array.isArray(
        bean?.varieties
      )
        ? bean.varieties
        : (
            bean?.variety
              ? [
                  bean.variety
                ]
              : []
          ),
  };
}


function beanOptions() {
  const lookup =
    buildBeanLookup();

  const groups =
    new Map();

  for (
    const roast
    of roasts
  ) {
    const key =
      inferBeanKey(
        roast
      );

    if (
      !groups.has(
        key
      )
    ) {
      groups.set(
        key,
        {
          key,

          label:
            beanDisplayName(
              roast,
              lookup
            ),

          count:
            0,
        }
      );
    }

    groups.get(
      key
    ).count++;
  }

  return [
    ...groups.values()
  ].sort(
    (a,b) => {
      if (
        b.count !==
        a.count
      ) {
        return (
          b.count -
          a.count
        );
      }

      return a.label
        .localeCompare(
          b.label,
          "ja"
        );
    }
  );
}


function getTasting(
  uid
) {
  return String(
    notes.roastNotes?.[
      uid
    ] ||
    ""
  );
}


function setTasting(
  uid,
  text
) {
  notes.roastNotes[
    uid
  ] =
    String(
      text ??
      ""
    );

  saveStoredNotes();
}


function getSharedNoteByUid(
  uid
) {
  return String(
    notes.sharedNotes?.[
      uid
    ] ||
    ""
  );
}


function setSharedNoteForUids(
  uids,
  text
) {
  const value =
    String(
      text ??
      ""
    );

  for (
    const uid
    of uids
  ) {
    if (!uid) {
      continue;
    }

    if (
      value.trim()
    ) {
      notes.sharedNotes[
        uid
      ] =
        value;
    } else {
      delete notes.sharedNotes[
        uid
      ];
    }
  }

  saveStoredNotes();
}


function getRoastsForLabelDate(
  month,
  day
) {
  return sortOldestFirst(
    roasts.filter(
      (roast) => {
        const date =
          getRoastDate(
            roast
          );

        const p =
          datePartsJST(
            date
          );

        return (
          p &&
          p.month === month &&
          p.day === day
        );
      }
    )
  );
}


function parseCircledNumber(
  text
) {
  const map =
    new Map([
      ["①",1],
      ["②",2],
      ["③",3],
      ["④",4],
      ["⑤",5],
      ["⑥",6],
      ["⑦",7],
      ["⑧",8],
      ["⑨",9],
      ["⑩",10],
      ["⑪",11],
      ["⑫",12],
      ["⑬",13],
      ["⑭",14],
      ["⑮",15],
      ["⑯",16],
      ["⑰",17],
      ["⑱",18],
      ["⑲",19],
      ["⑳",20],
    ]);

  return (
    map.get(text) ||
    null
  );
}


function parseBulkText(
  source
) {
  const text =
    String(
      source ?? ""
    )
      .replace(
        /\r\n/g,
        "\n"
      )
      .replace(
        /\r/g,
        "\n"
      )
      .trim();

  if (!text) {
    return [];
  }

  const lines =
    text.split("\n");

  const sections = [];

  let current = null;


  function finishSection() {
    if (!current) {
      return;
    }

    if (
      current.month &&
      current.day
    ) {
      sections.push(
        current
      );
    }

    current = null;
  }


  // ==========================================
  // ①②③の比較文章かどうかを判定
  //
  // 例:
  // ③→②→①の順で酸がキツい
  // ①と②では②が甘い
  // ①より②の方が良い
  // ①②③の順で酸が弱くなる
  //
  // → 個別ではなく共通メモ
  // ==========================================

  function isComparisonLine(
  line
) {
  const text =
    String(line || "")
      .trim();

  // ==========================================
  // 行頭の丸数字を取得
  // ==========================================

  const first =
    text.match(
      /^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/
    );

  if (!first) {
    return false;
  }

  const rest =
    text.slice(
      first[1].length
    ).trim();


  // ==========================================
  // 「③→②→①」
  // 「③ → ② → ①」
  // 「③>②>①」
  // 「③＞②＞①」
  // のように、番号の直後から
  // 比較順序を書いている場合だけ共通メモ
  // ==========================================

  if (
    /^[→＞>⇒➡︎➡\-]+\s*[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/
      .test(rest)
  ) {
    return true;
  }


  // ==========================================
  // 例:
  // ①と②では②が甘い
  // ①・②・③の順
  //
  // 「最初の番号の直後から別番号との
  // 全体比較を始めている」場合
  // ==========================================

  if (
    /^(?:と|・|\/|、)\s*[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/
      .test(rest)
  ) {
    return true;
  }


  // ==========================================
  // それ以外は個別メモ
  //
  // ②こちらも〜しかし①より乾く
  // ③②より少し乾きがある
  //
  // は②・③の個別結果
  // ==========================================

  return false;
}



  // ==========================================
  // 日付ごとにセクション分割
  // ==========================================

  for (
    const rawLine
    of lines
  ) {
    const line =
      rawLine.trim();

    const dateMatch =
      line.match(
        /^(\d{1,2})\s*\/\s*(\d{1,2})$/
      );

    if (dateMatch) {
      finishSection();

      current = {
        month:
          Number(
            dateMatch[1]
          ),

        day:
          Number(
            dateMatch[2]
          ),

        lines:
          [],
      };

      continue;
    }

    if (!current) {
      continue;
    }

    current.lines.push(
      rawLine
    );
  }

  finishSection();


  const parsed = [];


  // ==========================================
  // 各日付を
  //
  // individual = ①②③の個別メモ
  // commonNote = 全体比較・考察
  //
  // に分離
  // ==========================================

  for (
    const section
    of sections
  ) {
    const numbered = [];

    let commonLines = [];

    let currentItem = null;


    // ==========================================
    // 「本当の個別メモ」の位置だけを調べる
    //
    // ③→②→① のような比較文は除外
    // ==========================================

    const numberStarts = [];

    section.lines.forEach(
      (raw, index) => {
        const line =
          raw.trim();

        const match =
          line.match(
            /^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])/
          );

        if (
          match &&
          !isComparisonLine(
            line
          )
        ) {
          numberStarts.push(
            index
          );
        }
      }
    );


    const sawMultiple =
      numberStarts.length >= 2;

    const lastNumberIndex =
      numberStarts.length
        ? numberStarts[
            numberStarts.length - 1
          ]
        : -1;


    function finishItem() {
      if (!currentItem) {
        return;
      }

      currentItem.note =
        currentItem.noteLines
          .join("\n")
          .trim();

      delete currentItem.noteLines;

      numbered.push(
        currentItem
      );

      currentItem = null;
    }


    for (
      let index = 0;
      index <
      section.lines.length;
      index++
    ) {
      const rawLine =
        section.lines[
          index
        ];

      const line =
        rawLine.trim();


      // 空行
      if (!line) {
        if (
          currentItem &&
          index <=
          lastNumberIndex
        ) {
          currentItem.noteLines.push(
            ""
          );

        } else if (
          commonLines.length
        ) {
          commonLines.push(
            ""
          );
        }

        continue;
      }


      // ==========================================
      // 明示的な「共通:」「考察:」など
      // ==========================================

      const explicitCommon =
        line.match(
          /^(?:共通|共通メモ|全体|全体メモ|考察|共通考察)\s*[:：]\s*(.*)$/
        );

      if (explicitCommon) {
        finishItem();

        if (
          explicitCommon[1]
        ) {
          commonLines.push(
            explicitCommon[1]
          );
        }

        for (
          let j = index + 1;
          j <
          section.lines.length;
          j++
        ) {
          commonLines.push(
            section.lines[j]
          );
        }

        break;
      }


      // ==========================================
      // ①②③を複数含む比較文
      //
      // 例:
      // ③→②→①の順で酸がキツい
      //
      // → 必ず共通メモ
      // ==========================================

      if (
        isComparisonLine(
          line
        )
      ) {
        finishItem();

        commonLines.push(
          rawLine
        );

        continue;
      }


      // ==========================================
      // ①②③の個別メモ
      //
      // 例:
      // ①140℃からp9
      // ②135℃からp9
      // ③130℃からp9
      // ==========================================

      const numberedMatch =
        line.match(
          /^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])\s*(.*)$/
        );

      if (numberedMatch) {
        finishItem();

        currentItem = {
          number:
            parseCircledNumber(
              numberedMatch[1]
            ),

          noteLines:
            [],
        };

        if (
          numberedMatch[2]
        ) {
          currentItem.noteLines.push(
            numberedMatch[2]
          );
        }

        continue;
      }


      // ==========================================
      // ①②③を書き終えた後の文章は共通メモ
      // ==========================================

      if (
        sawMultiple &&
        index >
        lastNumberIndex
      ) {
        finishItem();

        commonLines.push(
          rawLine
        );

        continue;
      }


      // ==========================================
      // その他
      // ==========================================

      if (currentItem) {
        currentItem.noteLines.push(
          rawLine
        );

      } else {
        commonLines.push(
          rawLine
        );
      }
    }


    finishItem();


    parsed.push({
      month:
        section.month,

      day:
        section.day,

      individual:
        numbered,

      commonNote:
        commonLines
          .join("\n")
          .trim(),
    });
  }


  return parsed;
}


function resolveParsedBulk(
  parsed
) {
  return parsed.map(
    (section) => {

      const dayRoasts =
        getRoastsForLabelDate(
          section.month,
          section.day
        );

      // ==========================================
      // 同じ①②③が複数回出た場合は1つに統合
      // ==========================================

      const mergedByNumber =
        new Map();

      for (
        const item
        of section.individual
      ) {

        const number =
          Number(
            item.number
          );

        if (
          !Number.isFinite(
            number
          )
        ) {
          continue;
        }

        const note =
          String(
            item.note || ""
          ).trim();

        if (
          !mergedByNumber.has(
            number
          )
        ) {
          mergedByNumber.set(
            number,
            {
              number: number,
              notes: [],
            }
          );
        }

        if (note) {

          const group =
            mergedByNumber.get(
              number
            );

          // 同じ文章が重複していたら1回だけ保存
          if (
            !group.notes.includes(
              note
            )
          ) {
            group.notes.push(
              note
            );
          }
        }
      }


      // ==========================================
      // ① → ② → ③ の順番に並べる
      // ==========================================

      const mergedItems =
        [
          ...mergedByNumber.values()
        ].sort(
          (a, b) =>
            a.number - b.number
        );


      // ==========================================
      // Roast.Worldの同日の焙煎と対応させる
      // ==========================================

      const items =
        mergedItems.map(
          (item) => {

            const roast =
              dayRoasts[
                item.number - 1
              ] || null;

            return {

              number:
                item.number,

              label:
                section.month +
                "/" +
                section.day +
                circledNumber(
                  item.number
                ),

              // 同じ番号に複数の記録があれば
              // 1つの欄に改行して統合
              note:
                item.notes
                  .join("\n")
                  .trim(),

              roastUid:
                roast
                  ? getUid(roast)
                  : "",

              roast:
                roast,

              beanKey:
                roast
                  ? inferBeanKey(
                      roast
                    )
                  : "",

              matched:
                Boolean(
                  roast
                ),
            };
          }
        );


      // ==========================================
      // 最終結果
      // ==========================================

      return {

        month:
          section.month,

        day:
          section.day,

        dateLabel:
          section.month +
          "/" +
          section.day,

        individual:
          items,

        commonNote:
          String(
            section.commonNote || ""
          ).trim(),

        // 同じUIDは1回だけ
        sharedUids:
          [
            ...new Set(
              items
                .filter(
                  (item) =>
                    item.matched
                )
                .map(
                  (item) =>
                    item.roastUid
                )
            )
          ],
      };
    }
  );
}
function renderBulkPreview(
  resolved
) {
  if (!resolved.length) {
    el.bulkPreview.innerHTML =
      "";

    el.bulkPreview.classList.add(
      "hidden"
    );

    setStatus(
      el.bulkMessage,
      "日付と①②③を認識できませんでした。",
      "error"
    );

    el.bulkMessage.classList.remove(
      "hidden"
    );

    return;
  }

  const lookup =
    buildBeanLookup();

  let html = "";

  resolved.forEach(
    (section,sectionIndex) => {
      html +=
        '<div class="preview-group">';

      html +=
        "<h3>" +
        escapeHTML(
          section.dateLabel
        ) +
        "</h3>";

      if (
        !section.individual.length
      ) {
        html +=
          '<div class="status warn">' +
          "①②③形式の個別メモはありません。" +
          "</div>";
      }

      section.individual.forEach(
        (item,itemIndex) => {
          const beanLabel =
            item.roast
              ? beanDisplayName(
                  item.roast,
                  lookup
                )
              : "一致する焙煎なし";

          const dateTime =
            item.roast
              ? fullDateTime(
                  item.roast
                )
              : "";

          html +=
            '<div class="preview-item">';

          html +=
            "<strong>" +
            escapeHTML(
              item.label
            ) +
            "</strong>";

          html +=
            '<div class="small muted">' +
            escapeHTML(
              beanLabel
            ) +
            (
              dateTime
                ? " / " +
                  escapeHTML(
                    dateTime
                  )
                : ""
            ) +
            "</div>";

          html +=
            '<textarea ' +
            'data-section="' +
            sectionIndex +
            '" ' +
            'data-item="' +
            itemIndex +
            '" ' +
            'class="bulk-item-editor">' +
            escapeHTML(
              item.note
            ) +
            "</textarea>";

          html +=
            '<div class="small ' +
            (
              item.matched
                ? ""
                : "danger-text"
            ) +
            '">' +
            (
              item.matched
                ? "✅ Roast.Worldの焙煎に一致"
                : "⚠️ この日の該当番号の焙煎がありません"
            ) +
            "</div>";

          html +=
            "</div>";
        }
      );

      html +=
        '<div class="common-editor">';

      html +=
        "<strong>" +
        escapeHTML(
          section.dateLabel
        ) +
        " 共通実験メモ" +
        "</strong>";

      html +=
        '<textarea ' +
        'data-common-section="' +
        sectionIndex +
        '" ' +
        'class="bulk-common-editor">' +
        escapeHTML(
          section.commonNote
        ) +
        "</textarea>";

      html +=
        '<div class="small muted">' +
        "この共通メモは、この入力で一致した①②③だけに紐付けます。" +
        "</div>";

      html +=
        "</div>";

      html +=
        "</div>";
    }
  );

  html +=
    '<div class="toolbar">' +
    '<button id="bulkSaveButton" class="btn green" type="button">' +
    "この内容で保存" +
    "</button>" +
    "</div>";

  el.bulkPreview.innerHTML =
    html;

  el.bulkPreview.classList.remove(
    "hidden"
  );

  setStatus(
    el.bulkMessage,
    "振り分け結果を確認してください。保存前に各欄を編集できます。",
    "ok"
  );

  el.bulkMessage.classList.remove(
    "hidden"
  );

  document
    .getElementById(
      "bulkSaveButton"
    )
    .addEventListener(
      "click",
      saveBulkPreview
    );
}


function saveBulkPreview() {
  if (!parsedBulk) {
    return;
  }

  const result =
    structuredClone(
      parsedBulk
    );

  document
    .querySelectorAll(
      ".bulk-item-editor"
    )
    .forEach(
      (textarea) => {
        const sectionIndex =
          Number(
            textarea.dataset.section
          );

        const itemIndex =
          Number(
            textarea.dataset.item
          );

        if (
          result[
            sectionIndex
          ]?.individual?.[
            itemIndex
          ]
        ) {
          result[
            sectionIndex
          ].individual[
            itemIndex
          ].note =
            textarea.value;
        }
      }
    );

  document
    .querySelectorAll(
      ".bulk-common-editor"
    )
    .forEach(
      (textarea) => {
        const sectionIndex =
          Number(
            textarea.dataset
              .commonSection
          );

        if (
          result[
            sectionIndex
          ]
        ) {
          result[
            sectionIndex
          ].commonNote =
            textarea.value;
        }
      }
    );

  let individualSaved =
    0;

  let sharedSaved =
    0;

  let missing =
    0;

  for (
    const section
    of result
  ) {
    for (
      const item
      of section.individual
    ) {
      if (
        !item.matched ||
        !item.roastUid
      ) {
        missing++;

        continue;
      }

      setTasting(
        item.roastUid,
        item.note
      );

      individualSaved++;
    }

    const sharedUids =
      section.sharedUids ||
      [];

    if (
      sharedUids.length &&
      String(
        section.commonNote ||
        ""
      ).trim()
    ) {
      setSharedNoteForUids(
        sharedUids,
        section.commonNote
      );

      sharedSaved++;
    }
  }

  saveStoredNotes();

  renderAll();

  setStatus(
    el.bulkMessage,
    [
      "保存しました。",

      "個別カッピング: " +
      individualSaved +
      "件",

      "共通実験メモ: " +
      sharedSaved +
      "グループ",

      missing
        ? "未一致: " +
          missing +
          "件"
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    missing
      ? "warn"
      : "ok"
  );
}


function formatSeconds(
  value
) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n)
  ) {
    return "-";
  }

  const minutes =
    Math.floor(
      n /
      60
    );

  const seconds =
    Math.round(
      (
        n -
        minutes *
        60
      ) *
      10
    ) /
    10;

  return (
    minutes +
    ":" +
    String(seconds)
      .padStart(
        4,
        "0"
      )
  );
}


function roastMetrics(
  roast
) {
  const total =
    Number(
      roast.totalRoastTime
    );

  const fc =
    Number(
      roast.firstCrackTime
    );

  const development =
    Number.isFinite(total) &&
    Number.isFinite(fc)
      ? total -
        fc
      : null;

  const dtr =
    Number.isFinite(total) &&
    total > 0 &&
    Number.isFinite(fc)
      ? (
          development /
          total
        ) *
        100
      : null;

  return {
    preheat:
      roast.preheatTemperature,

    total:
      formatSeconds(
        total
      ),

    fc:
      formatSeconds(
        fc
      ),

    development:
      development === null
        ? "-"
        : formatSeconds(
            development
          ),

    dtr:
      dtr === null
        ? "-"
        : round(
            dtr,
            1
          ) +
          "%",

    fcTemp:
      roast.firstCrackTemp,
  };
}


function renderRoastList() {
  const lookup =
    buildBeanLookup();

  const selectedBean =
    el.filterBean.value;

  const filtered =
    sortNewestFirst(
      roasts.filter(
        (roast) =>
          !selectedBean ||
          inferBeanKey(
            roast
          ) ===
          selectedBean
      )
    );

  const totalPages =
    Math.max(
      1,
      Math.ceil(
        filtered.length /
        PAGE_SIZE
      )
    );

  if (
    currentPage >
    totalPages
  ) {
    currentPage =
      totalPages;
  }

  const start =
    (
      currentPage -
      1
    ) *
    PAGE_SIZE;

  const visible =
    filtered.slice(
      start,
      start +
      PAGE_SIZE
    );

  el.roastCount.textContent =
    filtered.length +
    "件表示 / 全" +
    roasts.length +
    "焙煎";

  el.pageLabel.textContent =
    currentPage +
    " / " +
    totalPages;

  el.prevButton.disabled =
    currentPage <=
    1;

  el.nextButton.disabled =
    currentPage >=
    totalPages;

  if (!visible.length) {
    el.roastList.innerHTML =
      '<div class="status warn">' +
      "該当する焙煎がありません。" +
      "</div>";

    return;
  }

  el.roastList.innerHTML =
    visible
      .map(
        (roast) => {
          const uid =
            getUid(
              roast
            );

          const label =
            roastLabel(
              roast
            );

          const bean =
            beanDisplayName(
              roast,
              lookup
            );

          const metrics =
            roastMetrics(
              roast
            );

          const tasting =
            getTasting(
              uid
            );

          const shared =
            getSharedNoteByUid(
              uid
            );

          return (
            '<article class="roast" data-uid="' +
            escapeHTML(uid) +
            '">' +

            '<div class="roast-head">' +

            "<div>" +

            '<div class="roast-title">' +
            escapeHTML(
              label
            ) +
            "</div>" +

            '<div class="muted small">' +
            escapeHTML(
              fullDateTime(
                roast
              )
            ) +
            "</div>" +

            '<div class="bean-name">' +
            "🫘 " +
            escapeHTML(
              bean
            ) +
            "</div>" +

            "</div>" +

            '<button ' +
            'class="btn light roast-ai-button" ' +
            'type="button" ' +
            'data-uid="' +
            escapeHTML(
              uid
            ) +
            '">' +
            "この焙煎をAI分析" +
            "</button>" +

            "</div>" +

            '<div style="margin-top:10px">' +

            '<span class="pill">' +
            "Preheat: " +
            escapeHTML(
              metrics.preheat ??
              "-"
            ) +
            " ℃" +
            "</span>" +

            '<span class="pill">' +
            "Total: " +
            escapeHTML(
              metrics.total
            ) +
            "</span>" +

            '<span class="pill">' +
            "FC: " +
            escapeHTML(
              metrics.fc
            ) +
            "</span>" +

            '<span class="pill">' +
            "Dev: " +
            escapeHTML(
              metrics.development
            ) +
            "</span>" +

            '<span class="pill">' +
            "DTR: " +
            escapeHTML(
              metrics.dtr
            ) +
            "</span>" +

            '<span class="pill">' +
            "FC Temp: " +
            escapeHTML(
              metrics.fcTemp ??
              "-"
            ) +
            " ℃" +
            "</span>" +

            "</div>" +

            '<div style="margin-top:12px">' +

            "<label>" +
            "個別カッピングメモ" +
            "</label>" +

            '<textarea ' +
            'class="roast-note-editor" ' +
            'data-uid="' +
            escapeHTML(
              uid
            ) +
            '">' +
            escapeHTML(
              tasting
            ) +
            "</textarea>" +

            "</div>" +

            (
              shared
                ? (
                    '<div class="roast-note common-note">' +
                    "<strong>共通実験メモ</strong>\n" +
                    escapeHTML(
                      shared
                    ) +
                    "</div>"
                  )
                : ""
            ) +

            '<div ' +
            'id="ai-' +
            escapeHTML(
              uid
            ) +
            '" ' +
            'class="ai-box hidden">' +
            "</div>" +

            "</article>"
          );
        }
      )
      .join(
        ""
      );

  document
    .querySelectorAll(
      ".roast-note-editor"
    )
    .forEach(
      (textarea) => {
        textarea.addEventListener(
          "change",
          () => {
            const uid =
              textarea.dataset.uid;

            setTasting(
              uid,
              textarea.value
            );

            renderBeanStats();
          }
        );
      }
    );

  document
    .querySelectorAll(
      ".roast-ai-button"
    )
    .forEach(
      (button) => {
        button.addEventListener(
          "click",
          () =>
            analyzeSingleRoast(
              button.dataset.uid
            )
        );
      }
    );
}


function populateBeanSelects() {
  const options =
    beanOptions();

  const optionHTML =
    options
      .map(
        (item) =>
          '<option value="' +
          escapeHTML(
            item.key
          ) +
          '">' +
          escapeHTML(
            item.label +
            " — " +
            item.count +
            "焙煎"
          ) +
          "</option>"
      )
      .join(
        ""
      );

  const previousAnalyze =
    Array.from(
      el.beanSelect.selectedOptions
    ).map(
      (option) => option.value
    );

  const previousFilter =
    el.filterBean.value;

  const previousCross =
    Array.from(
      el.crossBeanSelect.selectedOptions
    ).map(
      (option) => option.value
    );

  el.beanSelect.innerHTML =
    optionHTML ||
    '<option value="">豆情報なし</option>';

  el.crossBeanSelect.innerHTML =
    optionHTML ||
    '<option value="">豆情報なし</option>';

  el.filterBean.innerHTML =
    '<option value="">すべて</option>' +
    optionHTML;

  const analyzeSelection =
    previousAnalyze.length
      ? previousAnalyze
      : options.slice(0, 1).map(
          (item) => item.key
        );

  Array.from(
    el.beanSelect.options
  ).forEach(
    (option) => {
      option.selected =
        analyzeSelection.includes(
          option.value
        );
    }
  );

  if (
    previousFilter &&
    options.some(
      (x) =>
        x.key ===
        previousFilter
    )
  ) {
    el.filterBean.value =
      previousFilter;
  }

  const crossSelection =
    previousCross.length
      ? previousCross
      : options.slice(0, 2).map(
          (item) => item.key
        );

  Array.from(
    el.crossBeanSelect.options
  ).forEach(
    (option) => {
      option.selected =
        crossSelection.includes(
          option.value
        );
    }
  );
}


function renderBeanStats() {
  const beanKeys =
    Array.from(
      el.beanSelect.selectedOptions
    ).map(
      (option) => option.value
    ).filter(Boolean);

  if (!beanKeys.length) {
    setStatus(
      el.beanStats,
      "豆を選択してください。",
      "warn"
    );

    return;
  }

  const selected =
    roasts.filter(
      (roast) =>
        beanKeys.includes(
          inferBeanKey(
            roast
          )
        )
    );

  const withTaste =
    selected.filter(
      (roast) =>
        getTasting(
          getUid(
            roast
          )
        ).trim()
    );

  const withShared =
    selected.filter(
      (roast) =>
        getSharedNoteByUid(
          getUid(
            roast
          )
        ).trim()
    );

  setStatus(
    el.beanStats,
    [
      beanKeys.length +
      "種類 / " +
      selected.length +
      "焙煎",

      withTaste.length +
      "カッピング記録",

      withShared.length +
      "件に共通実験メモ",
    ].join(
      " / "
    ),
    "ok"
  );
}


let knowledgePdfs = [];
let selectedKnowledgePdfKeys = new Set();


function formatFileSize(
  bytes
) {
  const size =
    Number(bytes) || 0;

  if (size < 1024) {
    return size + " B";
  }

  if (size < 1024 * 1024) {
    return round(
      size / 1024,
      1
    ) + " KB";
  }

  return round(
    size /
      (1024 * 1024),
    1
  ) + " MB";
}


function renderPdfLibrary() {
  const list =
    document.getElementById(
      "pdfLibraryList"
    );

  if (!list) return;

  if (!knowledgePdfs.length) {
    setStatus(
      list,
      "登録済みPDFはありません。",
      "warn"
    );

    return;
  }

  list.className = "";
  list.innerHTML =
    knowledgePdfs.map(
      (file) =>
        '<div class="roast" style="margin-bottom:10px">' +
        '<div class="roast-head">' +
        "<div>" +
        '<label style="display:block; margin-bottom:6px">' +
        '<input class="pdf-select-checkbox" type="checkbox" data-key="' +
        escapeHTML(file.key) +
        '"' +
        (selectedKnowledgePdfKeys.has(file.key)
          ? " checked"
          : "") +
        '> 分析に使用</label>' +
        "<strong>" +
        escapeHTML(
          file.title || file.name
        ) +
        "</strong>" +
        '<div class="muted small">' +
        escapeHTML(
          [
            file.author,
            file.name,
            formatFileSize(file.size),
          ].filter(Boolean).join(" / ")
        ) +
        "</div>" +
        "</div>" +
        '<button class="btn light pdf-delete-button" type="button" data-key="' +
        escapeHTML(file.key) +
        '">削除</button>' +
        "</div>" +
        "</div>"
    ).join("");

  list.querySelectorAll(
    ".pdf-select-checkbox"
  ).forEach(
    (checkbox) =>
      checkbox.addEventListener(
        "change",
        () => {
          const key =
            checkbox.dataset.key;

          if (checkbox.checked) {
            if (
              selectedKnowledgePdfKeys.size >= 3
            ) {
              checkbox.checked = false;
              alert(
                "分析に使用できるPDFは最大3冊です。"
              );
              return;
            }

            selectedKnowledgePdfKeys.add(
              key
            );
          } else {
            selectedKnowledgePdfKeys.delete(
              key
            );
          }
        }
      )
  );

  list.querySelectorAll(
    ".pdf-delete-button"
  ).forEach(
    (button) =>
      button.addEventListener(
        "click",
        () => deleteKnowledgePdf(
          button.dataset.key
        )
      )
  );
}


async function loadPdfLibrary() {
  const list =
    document.getElementById(
      "pdfLibraryList"
    );

  try {
    const response =
      await fetch(
        "/api/knowledge/pdfs"
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        "PDF一覧を取得できませんでした。"
      );
    }

    knowledgePdfs =
      Array.isArray(data.files)
        ? data.files
        : [];

    const availableKeys =
      new Set(
        knowledgePdfs.map(
          (file) => file.key
        )
      );

    selectedKnowledgePdfKeys =
      new Set(
        Array.from(
          selectedKnowledgePdfKeys
        ).filter(
          (key) =>
            availableKeys.has(key)
        )
      );

    renderPdfLibrary();

  } catch (error) {
    if (list) {
      setStatus(
        list,
        "PDFライブラリ: " +
          (
            error?.message ||
            String(error)
          ),
        "warn"
      );
    }
  }
}


async function uploadKnowledgePdf() {
  const password =
    document.getElementById(
      "pdfAdminPassword"
    ).value;

  const fileInput =
    document.getElementById(
      "pdfFile"
    );

  const message =
    document.getElementById(
      "pdfAdminMessage"
    );

  const file =
    fileInput.files?.[0];

  if (!password || !file) {
    setStatus(
      message,
      "管理パスワードとPDFを指定してください。",
      "warn"
    );

    return;
  }

  const form =
    new FormData();

  form.append("file", file);
  form.append(
    "title",
    document.getElementById(
      "pdfTitle"
    ).value
  );
  form.append(
    "author",
    document.getElementById(
      "pdfAuthor"
    ).value
  );

  setStatus(
    message,
    "PDFを登録中…",
    "loading"
  );

  try {
    const response =
      await fetch(
        "/api/admin/pdfs",
        {
          method: "POST",
          headers: {
            "x-admin-password":
              password,
          },
          body: form,
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        "PDFを登録できませんでした。"
      );
    }

    fileInput.value = "";
    document.getElementById(
      "pdfTitle"
    ).value = "";
    document.getElementById(
      "pdfAuthor"
    ).value = "";

    setStatus(
      message,
      "PDFを登録しました。",
      "ok"
    );

    await loadPdfLibrary();

  } catch (error) {
    setStatus(
      message,
      error?.message ||
        String(error),
      "error"
    );
  }
}


async function deleteKnowledgePdf(
  key
) {
  const password =
    document.getElementById(
      "pdfAdminPassword"
    ).value;

  const message =
    document.getElementById(
      "pdfAdminMessage"
    );

  if (!password) {
    setStatus(
      message,
      "管理パスワードを入力してください。",
      "warn"
    );

    return;
  }

  if (!confirm(
    "このPDFを削除しますか？"
  )) {
    return;
  }

  try {
    const response =
      await fetch(
        "/api/admin/pdfs/" +
          encodeURIComponent(key),
        {
          method: "DELETE",
          headers: {
            "x-admin-password":
              password,
          },
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        data.error ||
        "PDFを削除できませんでした。"
      );
    }

    setStatus(
      message,
      "PDFを削除しました。",
      "ok"
    );

    await loadPdfLibrary();

  } catch (error) {
    setStatus(
      message,
      error?.message ||
        String(error),
      "error"
    );
  }
}


function getSelectedKnowledgePdfKeys() {
  return Array.from(
    selectedKnowledgePdfKeys
  );
}


function getSelectedKnowledgeLayers() {
  return Array.from(
    document.querySelectorAll(
      'input[name="knowledgeLayer"]:checked'
    )
  ).map(
    (input) => input.value
  );
}


function updateKnowledgeLayerMessage() {
  const selected =
    getSelectedKnowledgeLayers();

  const message =
    document.getElementById(
      "knowledgeLayerMessage"
    );

  if (!message) return;

  if (!selected.length) {
    setStatus(
      message,
      "知識層を1つ以上選択してください。",
      "warn"
    );

    return;
  }

  const usesWeb =
    selected.some(
      (layer) =>
        [
          "peer_reviewed",
          "official",
          "experts",
        ].includes(layer)
    );

  setStatus(
    message,
    selected.length +
      "つの知識層を使用" +
      (usesWeb
        ? " / Web検索あり"
        : " / Web検索なし"),
    "ok"
  );
}


function historyEntries() {
  const lookup =
    buildBeanLookup();

  return roasts.map(
    (roast) => {
      const uid =
        getUid(
          roast
        );

      const meta =
        beanMetaForRoast(
          roast,
          lookup
        );

      return {
        uid:
          uid,

        roastLabel:
          roastLabel(
            roast
          ),

        beanKey:
          meta.beanKey,

        bean:
          meta,

        tasting:
          getTasting(
            uid
          ),

        commonNote:
          getSharedNoteByUid(
            uid
          ),
      };
    }
  );
}


async function fetchAllData() {
  setStatus(
    el.connectionStatus,
    "Roast.Worldから取得中…",
    "loading"
  );

  el.reloadButton.disabled = true;

  try {
    const controller = new AbortController();

    const timeoutId = setTimeout(
      () => controller.abort(),
      15000
    );

    let roastResponse;

    try {
      roastResponse = await fetch(
        "/api/roasts",
        {
          signal: controller.signal
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const roastText =
      await roastResponse.text();

    let roastData;

    try {
      roastData =
        JSON.parse(roastText);
    } catch {
      throw new Error(
        "焙煎データをJSONとして読み取れませんでした。\n" +
        roastText.slice(0, 500)
      );
    }

    if (!roastResponse.ok) {
      throw new Error(
        roastData.error ||
        roastData.details ||
        "Roast.Worldの焙煎データを取得できませんでした。"
      );
    }

    roasts =
      Array.isArray(roastData)
        ? roastData
        : (
            roastData.data ||
            roastData.items ||
            roastData.roasts ||
            []
          );

    if (!Array.isArray(roasts)) {
      roasts = [];
    }

    beans = [];

    roastWorldRaw = {
      roasts: roastData,
      beans: null,
    };

    currentPage = 1;

    setStatus(
      el.connectionStatus,
      "✅ Roast.World 接続成功：" +
      roasts.length +
      "焙煎",
      "ok"
    );

    renderAll();

    // 豆一覧は後から取得。
    // 失敗しても焙煎一覧はそのまま使える。
    try {
      const beanController =
        new AbortController();

      const beanTimeoutId =
        setTimeout(
          () => beanController.abort(),
          7000
        );

      let beanResponse;

      try {
        beanResponse = await fetch(
          "/api/beans",
          {
            signal:
              beanController.signal
          }
        );
      } finally {
        clearTimeout(
          beanTimeoutId
        );
      }

      if (beanResponse.ok) {
        const beanData =
          await beanResponse.json();

        beans =
          Array.isArray(beanData)
            ? beanData
            : (
                beanData.data ||
                beanData.items ||
                beanData.beans ||
                []
              );

        if (!Array.isArray(beans)) {
          beans = [];
        }

        roastWorldRaw.beans =
          beanData;

        renderAll();

        setStatus(
          el.connectionStatus,
          "✅ Roast.World 接続成功：" +
          roasts.length +
          "焙煎 / " +
          beans.length +
          "豆",
          "ok"
        );
      }

    } catch (beanError) {
      console.warn(
        "Bean APIの取得には失敗しましたが、焙煎データだけで継続します。",
        beanError
      );
    }

  } catch (error) {
    console.error(error);

    const message =
      error?.name === "AbortError"
        ? "Roast.Worldの焙煎データ取得が15秒以内に完了しませんでした。"
        : (
            error?.message ||
            String(error)
          );

    setStatus(
      el.connectionStatus,
      "❌ " + message,
      "error"
    );

  } finally {
    el.reloadButton.disabled = false;
  }
}


function renderAll() {
  populateBeanSelects();
  renderBeanStats();
  renderRoastList();
}


function getRoastByUid(
  uid
) {
  return roasts.find(
    (roast) =>
      getUid(
        roast
      ) ===
      String(
        uid
      )
  );
}


async function analyzeSingleRoast(
  uid
) {
  const roast =
    getRoastByUid(
      uid
    );

  if (!roast) {
    alert(
      "対象焙煎が見つかりません。"
    );

    return;
  }

  const output =
    document.getElementById(
      "ai-" +
      uid
    );

  if (!output) {
    return;
  }

  output.classList.remove(
    "hidden"
  );

  output.textContent =
    "AIがRoast.World詳細データとカッピング結果を分析しています…";

  const lookup =
    buildBeanLookup();

  const bean =
    beanMetaForRoast(
      roast,
      lookup
    );

  try {
    const response =
      await fetch(
        "/api/ai/analyze",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              uid:
                uid,

              roastLabel:
                roastLabel(
                  roast
                ),

              tasting:
                getTasting(
                  uid
                ),

              commonNote:
                getSharedNoteByUid(
                  uid
                ),

              bean:
                bean,

              knowledgeLayers:
                getSelectedKnowledgeLayers(),

              pdfKeys:
                getSelectedKnowledgePdfKeys(),
            }),
        }
      );

    const data =
      await response.json();

    if (
      !response.ok
    ) {
      throw new Error(
        [
          data.error,
          data.details,
        ]
          .filter(
            Boolean
          )
          .join(
            "\n"
          )
      );
    }

    output.textContent =
      data.analysis ||
      "AI分析結果が空でした。";

  } catch(error) {
    output.textContent =
      "❌ AI分析エラー\n" +
      (
        error?.message ||
        String(
          error
        )
      );
  }
}


async function analyzeSelectedBean() {
  const beanKeys =
    Array.from(
      el.beanSelect.selectedOptions
    ).map(
      (option) => option.value
    ).filter(Boolean);

  if (!beanKeys.length) {
    setAnalysisOutput(
      el.beanAnalysis,
      "分析する豆を選択してください。",
      true
    );

    return;
  }

  const entries =
    historyEntries();

  const targetEntries =
    entries.filter(
      (entry) =>
        beanKeys.includes(
          entry.beanKey
        )
    );

  if (!targetEntries.length) {
    setAnalysisOutput(
      el.beanAnalysis,
      "選択した豆の焙煎履歴がありません。",
      true
    );

    return;
  }

  el.beanAnalyzeButton.disabled =
    true;

  setAnalysisOutput(
    el.beanAnalysis,
    beanKeys.length === 1
      ? "この豆の焙煎履歴をAIが分析しています…"
      : "選択した豆を分離したまま、豆ごとの次回焙煎をAIが分析しています…"
  );

  try {
    const response =
      await fetch(
        "/api/ai/history",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              mode:
                beanKeys.length === 1
                  ? "bean"
                  : "multi",

              selectedBeanKey:
                beanKeys[0],

              selectedBeanKeys:
                beanKeys,

              entries:
                targetEntries,

              knowledgeLayers:
                getSelectedKnowledgeLayers(),

              pdfKeys:
                getSelectedKnowledgePdfKeys(),
            }),
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        [
          data.error,
          data.details,
        ]
          .filter(
            Boolean
          )
          .join(
            "\n"
          )
      );
    }

    setAnalysisOutput(
      el.beanAnalysis,
      data.analysis ||
      "AI分析結果が空でした。"
    );

  } catch(error) {
    setAnalysisOutput(
      el.beanAnalysis,
      "❌ AI分析エラー\n" +
      (
        error?.message ||
        String(
          error
        )
      ),
      true
    );

  } finally {
    el.beanAnalyzeButton.disabled =
      false;
  }
}


async function analyzeAcrossBeans() {
  const selectedBeanKeys =
    Array.from(
      el.crossBeanSelect.selectedOptions
    ).map(
      (option) => option.value
    ).filter(Boolean);

  if (selectedBeanKeys.length < 2) {
    setAnalysisOutput(
      el.crossAnalysis,
      "比較する豆を2種類以上選択してください。",
      true
    );

    return;
  }

  const entries =
    historyEntries().filter(
      (entry) =>
        selectedBeanKeys.includes(
          entry.beanKey
        )
    );

  if (!entries.length) {
    setAnalysisOutput(
      el.crossAnalysis,
      "選択した豆に分析対象の焙煎がありません。",
      true
    );

    return;
  }

  el.crossAnalyzeButton.disabled =
    true;

  setAnalysisOutput(
    el.crossAnalysis,
    "複数の豆に再現する焙煎者・Bullet側の傾向をAIが分析しています…"
  );

  try {
    const response =
      await fetch(
        "/api/ai/history",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              mode:
                "cross",

              entries:
                entries,

              knowledgeLayers:
                getSelectedKnowledgeLayers(),

              pdfKeys:
                getSelectedKnowledgePdfKeys(),
            }),
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      throw new Error(
        [
          data.error,
          data.details,
        ]
          .filter(
            Boolean
          )
          .join(
            "\n"
          )
      );
    }

    setAnalysisOutput(
      el.crossAnalysis,
      data.analysis ||
      "AI分析結果が空でした。"
    );

  } catch(error) {
    setAnalysisOutput(
      el.crossAnalysis,
      "❌ AI分析エラー\n" +
      (
        error?.message ||
        String(
          error
        )
      ),
      true
    );

  } finally {
    el.crossAnalyzeButton.disabled =
      false;
  }
}


function setAnalysisOutput(
  node,
  text,
  isError = false
) {
  node.textContent =
    String(
      text ??
      ""
    );

  node.classList.remove(
    "hidden"
  );

  if (isError) {
    node.style.background =
      "#faeaea";

    node.style.color =
      "#8b2424";
  } else {
    node.style.background =
      "";

    node.style.color =
      "";
  }
}


function handleBulkParse() {
  const parsed =
    parseBulkText(
      el.bulkInput.value
    );

  parsedBulk =
    resolveParsedBulk(
      parsed
    );

  renderBulkPreview(
    parsedBulk
  );
}


function toggleJSONPreview() {
  if (
    el.jsonPreview.classList.contains(
      "hidden"
    )
  ) {
    el.jsonPreview.textContent =
      JSON.stringify(
        roastWorldRaw,
        null,
        2
      );

    el.jsonPreview.classList.remove(
      "hidden"
    );

    el.jsonButton.textContent =
      "JSONを閉じる";

  } else {
    el.jsonPreview.classList.add(
      "hidden"
    );

    el.jsonButton.textContent =
      "取得JSONを見る";
  }
}


function changeBeanFilter() {
  currentPage =
    1;

  renderRoastList();
}


function goPreviousPage() {
  if (
    currentPage <=
    1
  ) {
    return;
  }

  currentPage--;

  renderRoastList();

  window.scrollTo({
    top:
      el.roastList
        .getBoundingClientRect()
        .top +
      window.scrollY -
      20,

    behavior:
      "smooth",
  });
}


function goNextPage() {
  currentPage++;

  renderRoastList();

  window.scrollTo({
    top:
      el.roastList
        .getBoundingClientRect()
        .top +
      window.scrollY -
      20,

    behavior:
      "smooth",
  });
}


document
  .getElementById(
    "pdfUploadButton"
  )
  .addEventListener(
    "click",
    uploadKnowledgePdf
  );


document
  .querySelectorAll(
    'input[name="knowledgeLayer"]'
  )
  .forEach(
    (input) =>
      input.addEventListener(
        "change",
        updateKnowledgeLayerMessage
      )
  );


el.reloadButton.addEventListener(
  "click",
  fetchAllData
);

el.jsonButton.addEventListener(
  "click",
  toggleJSONPreview
);

el.parseButton.addEventListener(
  "click",
  handleBulkParse
);

el.beanSelect.addEventListener(
  "change",
  renderBeanStats
);

el.beanAnalyzeButton.addEventListener(
  "click",
  analyzeSelectedBean
);

el.crossAnalyzeButton.addEventListener(
  "click",
  analyzeAcrossBeans
);

el.filterBean.addEventListener(
  "change",
  changeBeanFilter
);

el.prevButton.addEventListener(
  "click",
  goPreviousPage
);

el.nextButton.addEventListener(
  "click",
  goNextPage
);


window.addEventListener(
  "error",
  (event) => {
    console.error(
      "Browser error:",
      event.error ||
      event.message
    );

    if (
      el.connectionStatus.textContent.includes(
        "取得中"
      )
    ) {
      setStatus(
        el.connectionStatus,
        "❌ 画面側JavaScriptエラー\n" +
        (
          event.message ||
          "不明なエラー"
        ),
        "error"
      );
    }
  }
);


window.addEventListener(
  "unhandledrejection",
  (event) => {
    console.error(
      "Unhandled promise rejection:",
      event.reason
    );

    if (
      el.connectionStatus.textContent.includes(
        "取得中"
      )
    ) {
      setStatus(
        el.connectionStatus,
        "❌ JavaScript実行エラー\n" +
        String(
          event.reason ||
          ""
        ),
        "error"
      );
    }
  }
);


fetchAllData();
loadPdfLibrary();

</script>

</body>

</html>`;
}
