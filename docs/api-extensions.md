# v0.4追加API

## 大会
`GET /api/tournaments`：一般には公開済み大会だけ、管理者は全大会。
`GET /api/tournaments?id=<id>`：大会・各段階・対象号・参加者（公開前の本戦情報は秘匿）。
`GET /api/tournaments?stage=<stage-id>[&asOf=YYYYNNMM]`：公開済み号だけの段階別累計/失格順位（管理者は未公開確定分を閲覧可）。
`POST /api/tournaments`: `join` / `create` / `enroll` / `remove` / `saveFinal` / `publishFinal` / `archive` / `restore`。

## お知らせ・問い合わせ
`GET /api/announcements`：公開済みのお知らせ。ログインしなくても閲覧可。管理者は下書きも閲覧。
`POST /api/announcements`：管理者向け保存/公開/固定/完全削除。
`GET /api/notifications`：本人宛て通知。`POST` は `read` / `readAll`。
`GET /api/inquiries[?id=]`：本人、または管理者がスレッド閲覧。`POST` は `create` / `reply` / `status`。

## 設定・帳票
`GET/POST /api/account`：ユーザー名/パスワード/秘密の質問変更。現在のパスワード必須。
`GET /api/my-history`：公開済みの個人成績一覧、20件単位。
`GET/POST /api/admin/site-settings`：所有者のみ。
`GET/POST /api/admin/roles`：所有者のみ、パスワード再認証必須。
`GET /api/admin/users?q=`：管理者ユーザー検索。
`GET /api/admin/pdf-data?type=works|issue|tournament`：管理者帳票データ。号は `issue=YYYYNNMM`、大会は `stage=...` を指定。

## 定期処理
`GET /api/cron/publish`：Bearer認証のWorker呼び出し。締切終了・採点結果公開・大会告知・締切12時間前通知・通知の期限切れ削除を冪等に実行。

## v0.5 追加操作
- `PATCH /api/issues`：`{code,release_at?,cutoff_at?}`。管理者向け号日時編集。受付開始後の締切は元の締切週末（日曜23:59:59 JST）まで延長のみ。
- `POST /api/tournaments {action:"update",id,title,stages,confirmStageRemoval?}`：対象号や大会名を変更、同じ区分の参加者を維持。区分削除時には `confirmStageRemoval:true` 必須。
- `POST /api/tournaments {action:"restore",id}` は復元後に他の開催大会との対象号が重複する場合409。
