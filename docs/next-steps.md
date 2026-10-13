# 作業の順序

1. Node.js 22+ がある開発環境で `npm ci`（lockfileは生成前のため、初回は `npm install`）を実行。
2. `npm run build`、`npm test` を実行し、出た問題を修正。
3. デモモードで利用者画面・管理画面をブラウザで確認。第1版との見た目差を点検。
4. **空の試験用DB** をTursoに作成し、SQL初期化 (`node scripts/apply-schema.mjs`) を実行。
5. 環境変数をVercelに秘密として設定し、プレビュー環境でテスト用ユーザーを作成。
6. 最初のアカウントを創設者として昇格（`scripts/promote-founder.mjs`）。その後、号の登録・受付・予想提出・実順位・採点・結果公開・大会告知まで通しでテスト。
7. 自動通知が必要になった段階でCloudflare Workerを配置。環境変数 `PUBLISH_ENDPOINT` と `CRON_SHARED_SECRET` を設定（共通の32文字以上のランダムな秘密文字列）。
8. 本番公開前にセキュリティチェック・法的な表示・実機試験を済ませる。

**ChatGPTとGitHubを連携する必要はありません。認証トークンやパスワードをChatGPTへ送らないでください。**
