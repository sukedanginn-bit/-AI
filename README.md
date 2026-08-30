# Roast.World Analyzer

Roast.Worldの焙煎データを表示・分析するCloudflare Workerです。将来的に、取得データを正規化してGoogle Sheets／Google Docsへ同期し、NotebookLMのソースとして利用できるデータパイプラインを構築します。

## 現在の構成

- `worker.js`: 既存Worker、画面、API
- `src/roast-normalizer.js`: 欠損値を推測せずに焙煎・時系列・テイスティングを正規化
- `src/sync-plan.js`: Roast IDを一意キーにした追加・更新計画
- `src/google-auth.js`: Web CryptoによるサービスアカウントJWTとトークン管理
- `src/google-sheets.js`: Sheetsの初期化、読込、差分書込み要求の生成・分割
- `test/`: 重複、追加、欠損、接続失敗、日本語のテスト

Google APIクライアントは追加済みですが、既存Workerのルートにはまだ接続していません。そのため本番データへの書き込みはまだ行いません。

## ローカル検証

Node.jsをインストール後、リポジトリで次を実行します。

```powershell
npm run verify
```

`npm` が見つからず、Node.jsを `E:\` にインストールしたこのPCでは、ターミナルを開き直してから実行してください。すぐに確認する場合は `E:\node.exe --test` でもテストだけを実行できます。

Worker、ブラウザ側JavaScript、既存APIルート、データパイプラインのテストをまとめて実行します。

## Cloudflareへの自動デプロイ

このリポジトリの`main`ブランチをコードの唯一の最新版として扱い、Cloudflare Workers Buildsから既存Worker `ancient-art-ec6b`へデプロイします。Cloudflareのコード編集画面へ`worker.js`を手動で貼り付けないでください。

### リポジトリ側の設定

`wrangler.jsonc`には、Cloudflare Dashboardで確認した既存Workerの設定を記載しています。

- Worker名: `ancient-art-ec6b`
- エントリーポイント: `worker.js`
- Compatibility date: 既存Workerと同じ値
- Workers.dev URL: 既存Workerと同じく有効
- `KNOWLEDGE_PDFS`: 既存のWorkers KV namespaceへ接続
- `keep_vars`: Dashboard側の通常変数を意図せず消さないため有効

KV namespace IDはSecretではありませんが、既存データを保持するために重要です。値を推測したり、IDなしのbindingへ変更したり、新しいnamespaceを作ったりしないでください。

`ROASTWORLD_API_TOKEN`、`OPENAI_API_KEY`、`PDF_ADMIN_PASSWORD`などのSecret値は`wrangler.jsonc`やGitHubへ書きません。Cloudflare Dashboardに保存済みのSecretをそのまま使用します。

### GitHub接続前の確認

リポジトリ直下で次を実行します。

```powershell
npm install
npm run verify
npm run deploy:dry-run
```

すべて成功するまでGitHub自動デプロイを有効にしないでください。

### 既存WorkerをGitHubへ接続する手順

1. Cloudflare Dashboardで「Workers & Pages」を開きます。
2. 既存Worker `ancient-art-ec6b`を選択します。
3. 「Settings」→「Builds」を開き、GitHubの「Connect」を選択します。
4. Cloudflare GitHub Appを承認し、リポジトリ `sukedanginn-bit/-AI`を選択します。
5. Production branchを`main`にします。
6. Root directoryはリポジトリ直下のままにします。サブディレクトリは指定しません。
7. Build commandを`npm run verify`にします。
8. Deploy commandを`npx wrangler deploy`にします。
9. 最初はnon-production branch buildsを無効にします。
10. 保存前にWorker名、Compatibility date、Workers.dev URL、Custom Domain／Route、3つのSecret名、`KNOWLEDGE_PDFS`の接続先をもう一度確認します。

現在はWorkers.dev URLが有効で、Custom DomainとWorker Routeはありません。この公開状態を維持するため、`wrangler.jsonc`では`workers_dev`を明示しています。将来Custom DomainやRouteを追加する場合は、自動デプロイ設定とは別の変更として扱ってください。

接続後は`main`へのpushで検証と本番デプロイが実行されます。アプリのコード変更とデプロイ設定の初回導入を同じコミットに混ぜないでください。

### 初回デプロイ後の確認

CloudflareのBuildが成功したら、最低限以下を確認します。

- トップ画面が表示される
- `/api/roasts`と`/api/beans`が従来どおり応答する
- Roast.Worldの焙煎取得と豆選択が動く
- AI分析が動く
- PDF一覧に既存データが残り、取得できる
- `KNOWLEDGE_PDFS`が以前と同じKV namespaceを指している

問題が起きた場合はCloudflareの「Deployments」から直前の正常なdeploymentへロールバックし、原因を確認します。

## Google側で今後必要になる設定

1. Google Cloud Consoleでプロジェクトを作成します。
2. Google Sheets API、Google Docs API、Google Drive APIを有効にします。
3. サービスアカウントを作成します。
4. GoogleスプレッドシートとGoogleドキュメントを作成します。
5. 両ファイルをサービスアカウントのメールアドレスに「編集者」として共有します。
6. ファイルURLからスプレッドシートIDとドキュメントIDを控えます。
7. Cloudflare WorkerのSecretsへサービスアカウント情報を設定します。

秘密鍵を `worker.js` やGitHubへ貼り付けないでください。本番ではCloudflare Secrets、ローカルでは `.dev.vars` を使用します。

予定している変数名は `.dev.vars.example` に記載しています。実値を含む `.dev.vars`、`.env`、サービスアカウントJSONは `.gitignore` で除外されます。

## 予定するスプレッドシート

- `Roasts`: 1焙煎1行。Roast IDを一意キーにする
- `ProfilePoints`: 1時点1行
- `Tasting`: 編集可能なテイスティング項目
- `SyncState`: 最終同期結果
- `Schema`: 列の意味と単位

同期実行ごとに `run_id` を生成し、`SyncState` には `last_success_at`、`last_roast_cursor`、`schema_version`、`last_run_id` を保存する予定です。`Schema` には `schema_version`、`applied_at`、`migration_id` を持たせます。

書込みは変更のある行だけを対象とし、最大500要求ずつに分割します。全バッチが成功するまで `SyncState` の成功位置を進めません。失敗した場合は同じRoast IDによるupsertで安全に再実行します。429および500/502/503/504だけを指数バックオフで再試行し、401はトークン更新後に1回だけ再試行します。

次の段階で、管理者認証付き手動同期ルートを接続します。Cron、Driveへの生JSON保存、Google Docs生成、NotebookLM操作はその後に分けて実装します。

## NotebookLM

同期先のGoogle Sheets／Google DocsはNotebookLMへ一度だけソース登録します。NotebookLMのGoogle Driveソース同期を利用するため、NotebookLM自体を自動操作するコードは作成しません。
