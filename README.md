# Roast.World Analyzer

Roast.Worldの焙煎データを表示・分析するCloudflare Workerです。将来的に、取得データを正規化してGoogle Sheets／Google Docsへ同期し、NotebookLMのソースとして利用できるデータパイプラインを構築します。

## 現在の構成

- `worker.js`: 既存Worker、画面、API
- `src/roast-normalizer.js`: 欠損値を推測せずに焙煎・時系列・テイスティングを正規化
- `src/sync-plan.js`: Roast IDを一意キーにした追加・更新計画
- `test/`: 重複、追加、欠損、接続失敗、日本語のテスト

この段階ではGoogle APIへの書き込みはまだ行いません。

## ローカル検証

Node.jsをインストール後、リポジトリで次を実行します。

```powershell
npm run verify
```

`npm` が見つからず、Node.jsを `E:\` にインストールしたこのPCでは、ターミナルを開き直してから実行してください。すぐに確認する場合は `E:\node.exe --test` でもテストだけを実行できます。

Worker、ブラウザ側JavaScript、既存APIルート、データパイプラインのテストをまとめて実行します。

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

## NotebookLM

同期先のGoogle Sheets／Google DocsはNotebookLMへ一度だけソース登録します。NotebookLMのGoogle Driveソース同期を利用するため、NotebookLM自体を自動操作するコードは作成しません。
