# v0.8 検証記録（2026-10-13）

## 実際に変更した点

1. `src/App.tsx` と `src/styles.css`
   - 第1版レイアウトを保持し、利用者予想と管理者の実掲載順の並べ替えに Pointer Events を追加した。
   - タッチ操作時はハンドルの Pointer Capture とドロップ先の行の位置を使い、再描画時に一覧を並べ替える。
   - デスクトップのドラッグ操作、操作しやすい上下ボタンは維持した。
   - 管理者が別の採点対象号に切り替えるとき、保存済みの入力方式（並び替え／順番選択）を適用する。
2. `src/core/reorder.ts` の純粋関数を追加し、ドラッグ・上下移動の両方から使用する。
3. `src/App.tsx` でデモ表示を **Vite開発モードかつ `VITE_DEMO_MODE=true` が明示された場合のみ** 許可。前版は開発時に未設定でもサンプル画面へ自動的に切り替わっていた。
4. `.env.example` は `VITE_DEMO_MODE=false` を初期値に変更。
5. `server/http.js` のOrigin検証を強化。Cookie付き書き込みAPIに対しOrigin欠落・不一致・不正なスキーム・ブラウザのcross-site/same-siteを拒否する。
6. テスト `tests/reorder.test.ts`、`tests/request-security.test.mjs` を追加。

## 実行した検証

- `npm test`: **TypeScriptドメインテスト16件、Nodeサーバー統合テスト27件がすべて成功**。PythonによるSQLiteスキーマチェックも成功。計44件相当（Pythonは別テストランナー）。失敗なし。
- `tsc -p tsconfig.core.json`: 成功。
- TypeScript標準パーサで `src/App.tsx`, `src/Extras.tsx` を解析: 構文エラー0件。
- `npm run build`: **未成功**。React/Viteの依存がこの環境に入っておらず、`vite/client` が見つからない。完全な型検査とフロントエンドバンドルは未検証。

## 既知の未完了・リスク

- 実機（iPhone Safari・Android Chrome）でのタッチジェスチャー、画面スクロールと並べ替えの同時操作、アクセシビリティを未検証。
- ブラウザからの実際のログイン・CookieとOrigin送出・CSRF防御の結合テストを要する。
- 各APIの認可・レート制限・DB同時書き込み、Turso環境・Vercel環境での統合検証が未完了。
- 大会・PDF・問い合わせ・通知など、以前からの残作業は引き続き有効。
- **正式公開・実ユーザー登録はまだ行わないこと。**
