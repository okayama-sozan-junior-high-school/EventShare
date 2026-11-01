# Event Share 機能追加 計画書兼仕様書

- 作成: GLM 5.3
- 基準: `main`（`09672df`）
- 前提: [architecture.md](architecture.md) の原則（権限・検証はすべてサーバー側、`.server` 分離、DB は UTC ミリ秒、AI 出力は検証して事実と照合）を引き継ぐ
- 状態: 計画。コードは未変更

---

## 1. 全体像

要求は 4 つ。

1. 過去のイベントでおすすめのものを **保存** できるようにする
2. **タグ** を付けて「こういう系のイベントが過去にあった」を見られるようにする
3. 次の回を登録するとき、**昔のやつと紐づけ** られるようにする
4. **MCP** で ChatGPT・Gemini などと接続できるようにする

この計画の軸は **「系譜」と「実績」** の 2 本です。

- **系譜（シリーズ）**: イベントの「回」は、シリーズという名前空間の下に並ぶ。次の回の登録は「シリーズに新しい回を足す」操作になり、タグ検索の結果もシリーズ単位で重複なく出せる。
- **実績（おすすめ）**: 過去のイベントの価値は、**参加した人が残した記録**（活動報告・おすすめ）にある。おすすめは単なる数ではなく、「活動報告つきのおすすめ」として実績と結びつけて残す。

もう 1 つ、設計上の意思決定として **「保存」に新しい仕組みを作らない** ことがあります。個人用の保存は既存の「お気に入り（`event_bookmarks`）」がその役割を持っているので、終了したイベントでもそのまま使えるように整えるだけにします。新しいのは「みんなに見せる推薦」の方です。テーブルと UI の重複を避け、荒らし対応も既存の報告・管理の仕組みに乗せられるためです。

### 1.1 スコープ外

- MCP からの書き込み（お気に入り・投稿など）。OAuth が必要で、Better Auth 1.7 系に MCP 用 OAuth が同梱されていないため、別計画とする。
- メール・プッシュ通知。既存のサイト内通知のみ。
- 過去イベントの自動収集（スクレイピング）。登録は引き続き生徒が行う。

---

## 2. 機能仕様

### 2.1 シリーズと回（紐づけ）

**用語**

| 用語 | 意味 | 実体 |
| --- | --- | --- |
| シリーズ | 繰り返し開催されるイベントの「正体」 | `event_series`（新規） |
| 回 | 1 回分の開催。今の `events` の 1 行 | `events.series_id` を追加 |
| 回ラベル | 回を区別する表示（`2025`、`第4回`） | `events.edition_label` |

**シリーズは基本「自動」で、人間は「修正」する**

次の回の登録をいちいち手動で紐づけさせるのではなく、**投稿時に自動でシリーズへ割り当てる** のを既定にします。判定には、重複判定（`app/.server/duplicates/score.ts`）がすでに持っている「西暦違いは別の回」という発見（`titlesHaveDifferentYears`、`differentEditionDays`）を逆方向に使います。

1. タイトルから回の表記を除去する `stripEditionMarkers()`（西暦・`第N回`・`Vol.N`・年度・`#N`・全角相当）を作り、`normalizeForMatch()` と合わせて **正規化キー** を作る。
2. 投稿時、同じ正規化キーのシリーズがあれば候補とする。このとき **主催者（`organizer`）または公式 URL のホスト** が一致するかを確認し、どちらも食い違う場合は自動では割り当てず、新しいシリーズとして作成し「要確認」として管理画面に挙げる（名前が同じでも別団体のイベントはあるため）。
3. 合っていればそのシリーズに割り当て、フォームに「『○○』の新しい回として登録します」と表示して、外すこともできる。

これで「次の回を登録するときに昔のやつを紐づける」操作の大部分が、**普通に投稿するだけで済む** ようになります。残りは次の 2 つの導線で補います。

**導線 A: 過去の回・シリーズページの「次の回を登録する」**

- `/events/new?seriesId=<シリーズID>` でフォームを開く。
- 最新の回から引き継ぐ項目と、引き継がない項目を明確に分ける。

| 項目 | 扱い |
| --- | --- |
| イベント名 | 回表記を 1 つ進めた案（`2025`→`2026`、`第4回`→`第5回`） |
| 説明・主催・対象者・形式・場所・参加費・カテゴリ・タグ | 引き継ぐ |
| 公式サイト URL | 引き継ぐ（年度で URL が変わることが多いので「要確認」） |
| 応募フォーム URL | **引き継がない**（旧年度のフォームへ誘導する事故を防ぐ） |
| 開催日時・終了日時・締切 | 空欄。入力欄の下に「前回: 8/10 開催・7/1 締切」のヒント |
| 画像 | 引き継がない |

- 引き継いだ項目には、既存の取得元バッジ（`FieldSource`：ページから取得／AI が推定 など）に `previous`（前回から引き継ぎ・要確認）を追加して示す。URL 取り込みと同じ見た目の仕組みに乗せる。
- この画面でも「URL から取得」を使える。取得できた項目は取得値を優先し、取得できなかった項目だけ引き継ぎ値を残す。
- 重複判定では同じシリーズの回を候補から除く（日時未入力のまま送ると同名のため「重複の可能性が高い」に出てしまうため）。

**導線 B: 編集画面であとから紐づける・外す**

- 投稿者・管理者は、シリーズ検索（`/api/series/search?q=`）で選んで付け替えられる。
- それ以外のログインユーザーは、**自分の回が 1 つしかないシリーズに限り**、別のシリーズへの結びつけだけができる（「未設定の項目を埋める」既存の情報提供ルールの延長）。
- 変更は `event_contributions` に `changes.series = { from, to }` で残す。

**シリーズページ `/series/:id`**

- シリーズ名・説明、回の年表（回ラベル・開催日・状態・おすすめ数・活動報告数）
- シリーズ全体の活動報告とおすすめ
- 「次の回を登録する」「ウォッチする」ボタン
- 名前と説明は、いずれかの回の投稿者と管理者が編集できる

**イベント詳細への追加**

- 回が 2 つ以上あれば、右カラムに「このイベントの他の回」ボックス（年表の短縮版）
- 終了した回を開いていて新しい公開中の回があれば、最上部に「新しい回（2026）が登録されています」の案内
- 「関連する活動報告」を「この回」と「他の回」に分けて表示

**ウォッチと通知**

- `series_watches`（user, series）。終了した回の「お気に入り」ボタンは「次の回をウォッチ」に表示を変える（中身は別テーブル）。
- シリーズに新しい公開中の回が増えたとき（投稿時・あとからの紐づけ時とも）に `new_edition` 通知を送る。`dedupe_key = new_edition:<eventId>:<userId>`。回を登録した本人には送らない。
- 通知の種類 `new_edition` を `NOTIFICATION_TYPES` と `notification_settings` に追加し、設定画面で切れるようにする。

### 2.2 おすすめ（実績）と保存

**おすすめ（推薦）= みんなに見える評価**

| 項目 | 内容 |
| --- | --- |
| できる人 | ログインユーザー |
| 対象 | 終了した回、または自分が「参加した」にしている回 |
| 内容 | ひとこと（最大 200 文字・任意）＋ **活動報告へのリンク（任意）** |
| 副作用 | おすすめすると「参加した」も自動で付く（参加した人の声であることを担保する） |
| 件数 | 1 人 1 回 1 件。編集・取り消し可 |

活動報告へのリンクがこの計画の特徴です。Event Share にはすでに活動報告（`activity_reports`）があり、イベント詳細にも表示されています。おすすめのひとことと活動報告が結びつくと、**「先輩のすすめたイベント → その根拠となる体験記」** をたどれます。活動報告を書いていない人もおすすめはできます（ハードルを上げすぎない）が、詳細ページでは「活動報告あり」のバッジで区別します。

**表示**

| 場所 | 内容 |
| --- | --- |
| イベント詳細 | アクション列に「おすすめ（N）」。説明の下に「参加した人のおすすめ」セクション（ひとこと＋活動報告へのリンク、新しい順に最大 20 件）。各ひとことには表示名と「報告」 |
| イベントカード | おすすめ 1 件以上で「おすすめ N」。活動報告つきが過半ならバッジ |
| 一覧（`/events`） | 並び替えに「おすすめ順」。`status = ended` のときの既定の並びにする |
| ホーム | 「先輩のおすすめ」セクション。終了した回をシリーズ単位で重複を除いて最大 6 件 |
| マイページ | タブ「おすすめした（N）」 |
| シリーズページ | 回ごとにまとめた集計 |

**並び順の定義**

```
endorsement_count * 3 + bookmark_count + like_count   （同点なら start_at が新しい順）
```

`endorsement_count` は `events` に非正規化し、既存の `recount()`（`services/interactions.ts`）に加える。管理者が非表示にしたものは数えない。

**モデレーション**

- `REPORT_TARGETS` に `endorsement` を追加（既存の報告フローがそのまま使える）。
- 管理画面 `/admin/comments` にタブを足して非表示にできる。本人の取り消しは行削除、管理者の非表示は `status = hidden`。

**保存 = 既存のお気に入りの延伸（新テーブルを作らない）**

- 「終了したイベントもお気に入りに保存して見返したい」は、既存の `event_bookmarks` でそのまま実現できる。終了した回ではボタンのラベルを「保存」に変える。
- 既存の締切・開催日リマインダー（`sendReminders`）は未来の日時だけを見るので、終了した回を保存しても誤通知は起きない。
- マイページの「お気に入り」タブに「終了分のみ」の絞り込みを足す。
- 終了した回を保存した人は、新しい回がシリーズに増えたときにウォッチ通知（§2.1）を受け取れるようにする（保存は「次も見たい」という意思とみなす）。

### 2.3 タグ

**カテゴリとの役割分担**

- カテゴリ（11 種・管理者管理）= 分野。興味の登録や新着通知に使う。今まで通り。
- タグ = 「どんなイベントか」。参加しやすさ・形式・時期・特典。ユーザーが付けられる。

**推奨タグ（初期データをマイグレーションで投入）**

| グループ | タグ |
| --- | --- |
| 対象 | 初心者歓迎、中学生OK、高校生向け、文系歓迎 |
| 参加形態 | 個人で参加、チームで参加、メンターあり、宿泊あり |
| 日程 | 1日完結、複数日、土日開催、夏休み、冬休み、春休み |
| 特典・規模 | 表彰あり、賞金あり、交通費補助あり、全国大会、予選あり |

**付け方**

- 1 回に最大 8 個、1 タグ 20 文字まで。
- 投稿・編集フォームにタグ欄（推奨タグのチップ＋自由入力、入力中は `/api/tags?q=` で既存タグを候補表示）。
- イベント詳細にも「＋タグ」を置き、その場で追加できる（`useFetcher`）。
- 権限: 投稿者・管理者は追加と削除、その他のログインユーザーは追加のみ（`event_contributions` に `add_info` として記録）。
- 導線 A で次の回を作るときは前回のタグを引き継ぐ。

**表記ゆれ対策**

- `normalizeTagName()`: NFKC → 先頭の `#`/`＃` 除去 → 前後の空白除去 → 英字小文字化 → 連続空白を 1 つに。この結果を一意キーにする。
- 既存の `normalizeForMatch()` は記号をすべて消すためタグには使わない（`C++` と `C` が同じになる）。
- 管理画面 `/admin/tags` で名前変更・統合（`event_tags` の付け替えを 1 バッチで）・非表示。

**「こういう系が過去にあった」を見せるタグページ `/tags/:slug`**

結果は **シリーズ単位** で出す（同じイベントの 2024・2025・2026 が 3 枚並ぶのを避ける）。

| 区画 | 内容 |
| --- | --- |
| 見出し | `#初心者歓迎`、シリーズ数（募集中 N・過去のみ M） |
| いま募集中 | 募集中の回があるシリーズ。開催日順 |
| 過去に開催された | 募集中の回がないシリーズ。おすすめ順。各カードに「全 N 回」「最後の開催 2025」「ウォッチ」 |
| 活動報告 | このタグの回に付いた活動報告、新しい順に最大 6 件 |
| よく一緒に付くタグ | 上位 8 件 |

- 募集中が 0 件なら「今は募集中のものはありませんが、過去にはこんなイベントがありました」に文言を変え、過去の区画を上に出す。
- 一覧（`/events`）にも `tag` 絞り込み（複数は AND）を追加。こちらは回単位のまま。
- `/tags` にタグ一覧（グループごと、利用数順）を置く。

**開催月の絞り込み**

- 一覧に `month`（1〜12、複数選択）を追加。「夏休みにどんなイベントがあったか」を過去から探す用途で、`status = ended | all` と組み合わせる。
- 月は書き込み時に `zonedParts()`（`lib/datetime.ts`）で計算して `events.start_month`（1〜12、未設定は null）に保存する。**SQL で時差を計算しない**（`strftime` に `+9 hours` を埋め込むと `APP_TIMEZONE` を変えたときに壊れるため）。既存行はマイグレーションで 1 回だけ埋める（Asia/Tokyo 固定の一回限りの処理であることを SQL にコメントで残す）。

### 2.4 MCP サーバー（ChatGPT / Gemini 接続）

**アーキテクチャ**

| 項目 | 決定 | 理由 |
| --- | --- | --- |
| エンドポイント | `POST /mcp`（Streamable HTTP） | ChatGPT・Gemini CLI・Claude・Cursor が対応する標準 |
| 実装 | `@modelcontextprotocol/sdk` の `McpServer` + `WebStandardStreamableHTTPServerTransport` | Web 標準の `Request`/`Response` で Workers にそのまま載る |
| セッション | ステートレス（`sessionIdGenerator: undefined`）＋ JSON 応答（`enableJsonResponse: true`） | isolate をまたいで状態を持てない。Durable Objects を増やさない |
| `GET` / `DELETE` | `405` | サーバー発の通知を使わない |
| JSON Schema 検証 | `CfWorkerJsonSchemaValidator`（`@cfworker/json-schema`）を明示指定 | SDK 既定の Ajv は実行時コード生成で Workers では動かない |
| 認証 | 既定なし。シークレット `MCP_ACCESS_TOKEN` を設定した場合のみ `Authorization: Bearer` を必須化 | 閲覧がログイン不要なので合わせる。学校外を絞りたくなったらコード変更なしで切り替えられる |
| 書き込み | なし | §1.1 |

**ツール**

| ツール | 入力 | 出力 |
| --- | --- | --- |
| `search_events` | `query`, `categories[]`, `tags[]`, `status`（upcoming/ended/all）, `months[]`, `deadline`, `format`, `fee`, `location`, `sort`（start/deadline/popular/recommended/new）, `page` | 回の要約（+ シリーズの ID・名前・回数）、総件数 |
| `get_event` | `id` | 詳細、タグ、出典 URL、シリーズの年表、おすすめのひとこと（最大 5 件）、活動報告の要約（最大 5 件）。統合済み ID は統合先を返す |
| `get_series` | `id`（シリーズ ID または回の ID） | シリーズ名、回の年表、シリーズ全体のおすすめ集計 |
| `recommend_events` | `categories[]`, `keywords[]`, `tags[]`, `style`, `format`, `fee`, `period`, `participation`, `includePast`, `limit`（最大 10） | `open`: 募集中の回＋**事実に基づく根拠（`evidence`）**。`includePast` が true なら `past_recommended`: 過去の定番（次の回を待つ候補） |
| `list_categories_tags` | なし | カテゴリ一覧とタグ一覧（グループ・利用数付き）。AI が正しい値を選ぶために使う |
| `search` | `query` | `{ results: [{ id, title, url }] }`（ChatGPT コネクタ / Deep Research 互換） |
| `fetch` | `id` | `{ id, title, text, url, metadata }`（同上） |

**サイト内 AI チャットとの一貫性**

`recommend_events` は、サイト内チャットが使っている `loadCandidates()` と `rankEvents()`（`app/.server/chat/`）をそのまま使います。理由は 2 つ。

1. サイトで聞いても ChatGPT で聞いても、同じ条件なら同じ推薦になる。
2. 既存の捏造防止（推薦理由は DB の事実のみ、存在しない ID・日付は破棄）が自動的に効く。

外部 AI に渡す推薦理由は `ruleReason()` 系の事実ベースに限定し、こちらの LLM（Groq）は呼ばない。会話は呼び出し側の AI が担当するため二重になり、不確かな情報が増えるだけだからです。代わりに、`rankEvents` が返す `matched`（「カテゴリ一致」「無料」「締切間近」などの事実）を **`evidence` 配列** として構造化出力に含め、外部 AI が根拠を明示して答えられるようにします。

**出力の決まり（`mcp/format.ts` に純粋関数でまとめる）**

- 日時は ISO 8601（UTC）と `APP_TIMEZONE` の日本語表記（`2026年11月3日(火) 13:00`）の両方
- URL は絶対 URL（origin はリクエストから取得）
- 状態は値（`open`）と日本語ラベル（`募集中`）の両方
- 未設定は `null`（推測で埋めない）
- **人名を渡さない**: ひとこと・活動報告の要約は本文のみ。表示名・学年・ユーザー ID は含めない
- `content` に人が読める要約、`structuredContent` に JSON
- 全ツールに `readOnlyHint: true`, `openWorldHint: false`。ツール説明に「日程・締切は公式サイトで確認するよう伝えること」を書く

**プロンプト**: `find_events`（引数: 学年、興味、時期）を 1 つ登録。「募集中のものと過去の定番の両方を調べ、締切と公式 URL を必ず添える」テンプレート。

**セキュリティ**

- **CSRF**: `/mcp` は Cookie もサイトのセッションも読まないため、`isCrossSiteMutation` の対象外にする（`workers/app.ts` で CSRF 判定より前に分岐）。`Cookie` ヘッダーが付いていても無視する。
- **CORS**: `/mcp` のみ `Access-Control-Allow-Origin: *`、`Allow-Methods: POST, OPTIONS`、`Allow-Headers: Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id`。認証情報を使わないため `*` で問題ない。
- **レート制限**: `RL_MCP`（IP あたり 60 回/分）を開発・本番・プレビューの 3 環境に追加。超過は JSON-RPC エラー。
- **入力上限**: 文字列 100 文字、配列 10 件、`page` 50、`limit` 10。
- **ログ**: ツール名・件数・所要時間のみ。検索語はログに出さない。

**接続ガイド `/ai-connect`**

- 接続 URL（`<origin>/mcp`）をコピーボタン付きで表示。
- ChatGPT（開発者モード→カスタムコネクタ、認証「なし」）、Gemini（Gemini CLI の `settings.json` の `mcpServers.httpUrl`、Gemini API SDK 経由。一般向け Gemini アプリはカスタム MCP 非対応の場合がある旨）、Claude / Cursor（カスタムコネクタ・`mcp.json`）の手順。UI は変わりやすいので操作名は断定せず公式ドキュメントのリンクを添える。
- 聞き方の例（「夏休みに無料で出られる初心者歓迎のプログラミング系は？過去の定番も教えて」）。
- `localhost` には外部 AI から接続できないため、確認はプレビュー環境か `cloudflared` トンネルを使う旨。
- フッターと `/chat` からリンク。

**サイト内 AI チャットへの反映**

- 募集中が 0 件のとき、今は「条件を広げましょう」とだけ返すが、同じ条件に合う**過去の定番**（終了した回、おすすめ順、最大 3 件）を「次の回を待てるイベント」として添える。カードには「ウォッチ」ボタンと終了済みである旨の明示。
- `RankableEvent` に `tagNames` を追加し、キーワードがタグ名に一致したら加点。
- 推薦理由（`ruleReason`）に「参加した N 人がおすすめ」を加える（DB の事実のみ）。

---

## 3. データモデル

### 3.1 新規テーブル

**`event_series`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | text PK | UUID |
| `title` | text not null | シリーズ名。初期値は最初の回のタイトルから回表記を除いたもの |
| `normalized_key` | text not null unique | `normalizeForMatch(stripEditionMarkers(title))`。自動割り当てに使う |
| `description` | text | 任意 |
| `needs_review` | integer(boolean) not null default false | 自動判定で主催者・URL が食い違った場合に立てる。管理画面で確認 |
| `watch_count` | integer not null default 0 | 非正規化 |
| `created_by_id` | text → user（set null） | |
| `created_at` / `updated_at` | timestamp_ms | |

**`series_watches`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `user_id` | text → user（cascade） | 複合 PK |
| `series_id` | text → event_series（cascade） | 複合 PK、インデックス |
| `created_at` | timestamp_ms | |

**`tags`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | integer PK autoincrement | |
| `name` | text not null | 表示名 |
| `normalized_name` | text not null unique | `normalizeTagName()` の結果 |
| `group` | text enum(`audience`, `participation`, `schedule`, `perk`) | ユーザー作成タグは null |
| `status` | text enum(`active`, `hidden`) | 既定 `active` |
| `use_count` | integer not null default 0 | 非正規化 |
| `created_by_id` | text → user（set null） | |
| `created_at` | timestamp_ms | |

**`event_tags`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `event_id` | text → events（cascade） | 複合 PK |
| `tag_id` | integer → tags（cascade） | 複合 PK、インデックス |
| `added_by_id` | text → user（set null） | |
| `created_at` | timestamp_ms | |

**`event_endorsements`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | text PK | 報告の対象 ID に使う |
| `user_id` | text → user（cascade） | 一意 `(user_id, event_id)` |
| `event_id` | text → events（cascade） | インデックス `(event_id, created_at)` |
| `comment` | text | 最大 200 文字 |
| `activity_report_id` | text → activity_reports（set null） | 紐づく活動報告（任意） |
| `status` | text enum(`visible`, `hidden`) | 既定 `visible` |
| `created_at` / `updated_at` | timestamp_ms | |

### 3.2 既存テーブルへの追加

| テーブル | 列 | 備考 |
| --- | --- | --- |
| `events` | `series_id` text → event_series（set null） | DB 上は nullable、アプリ上は必須（SQLite は既存行のある表に NOT NULL 列を後から足せないため。`createEvent` は必ず入れ、null は「壊れたデータ」として扱う）。インデックス `(series_id, start_at)` |
| `events` | `edition_label` text | 最大 30 文字 |
| `events` | `start_month` integer | 1〜12、書き込み時に計算。インデックス `(status, start_month)` |
| `events` | `endorsement_count` integer not null default 0 | インデックス `(status, endorsement_count)` |
| `notification_settings` | `new_edition` boolean not null default true | |

列挙の追加（TypeScript 側のみ）: `NOTIFICATION_TYPES` に `new_edition`、`REPORT_TARGETS` に `endorsement`、`EVENT_FIELD_LABEL` に `tags`・`series`・`editionLabel`。

### 3.3 マイグレーション

| ファイル | 内容 |
| --- | --- |
| `0002_series_tags_endorsements.sql` | drizzle-kit で生成 |
| `0003_backfill_and_seed.sql` | 手書き。既存の各イベントにシリーズを作って `series_id` を入れる（タイトルから回表記を除いた正規化キーごとに 1 シリーズ）。`start_month` を `strftime('%m', start_at/1000, 'unixepoch', '+9 hours')` で埋める（Asia/Tokyo 固定・一回限りであることをコメントに残す）。推奨タグ（§2.3）を `active` で投入 |

既存の `0001_seed_categories.sql` と同じく、初期データは手書き SQL にする。

### 3.4 既存機能への影響

| 機能 | 対応 |
| --- | --- |
| 統合 `mergeEvents` | 統合元の回を統合先のシリーズへ（元のシリーズが空ならウォッチャーを統合先へ移して削除）。おすすめ・タグはいいねと同じ「統合先に既にある分を消してから付け替え」を同じバッチに入れる |
| 件数再集計 `recount()` | `endorsement_count` を追加（`status = visible` のみ） |
| 重複判定 | ロジックは変えない。`differentEdition: true` の候補は重複パネルではなくシリーズ自動割り当ての方で活用。同一シリーズの回は重複候補から除外 |
| 非公開化 | 非公開の回は年表に投稿者・管理者以外は出さない。シリーズ自体は消さない |
| URL 取り込み | AI 有効時、**既存の `active` なタグの中からのみ**最大 5 個を候補にする（新規タグは作らせない。本文に根拠がある場合のみ採用） |

---

## 4. 権限

| 操作 | 未ログイン | ログイン | 投稿者 | 管理者 |
| --- | :-: | :-: | :-: | :-: |
| シリーズ・タグ・おすすめの閲覧、MCP の読み取り | ✓ | ✓ | ✓ | ✓ |
| お気に入り（保存）・ウォッチ | | ✓ | ✓ | ✓ |
| おすすめ（終了した回／参加した回） | | ✓ | ✓ | ✓ |
| タグの追加 | | ✓ | ✓ | ✓ |
| タグの削除 | | | ✓ | ✓ |
| 回のシリーズ付け替え（自分の回） | | | ✓ | ✓ |
| 回のシリーズ結びつけ（1 回しかないシリーズから） | | ✓ | ✓ | ✓ |
| シリーズ名・説明の編集 | | | ✓（いずれかの回の投稿者） | ✓ |
| タグの統合・非表示、おすすめの非表示、`needs_review` の解消 | | | | ✓ |

---

## 5. 変更するファイル

### 5.1 共通（純粋関数・テストの中心）

| ファイル | 内容 |
| --- | --- |
| `app/lib/edition.ts`（新規） | `stripEditionMarkers()`、`suggestNextTitle()`、`editionLabelFrom()` |
| `app/lib/tags.ts`（新規） | `normalizeTagName()`、タググループの定義とラベル |
| `app/lib/labels.ts` | `SORT_OPTIONS` に `recommended`、`new_edition` などのラベル |

### 5.2 サーバー

| ファイル | 内容 |
| --- | --- |
| `app/.server/db/schema.ts` | §3 |
| `app/.server/validation/event.ts` | `tags`（最大 8）、`seriesId`、`editionLabel` |
| `app/.server/validation/interaction.ts` | おすすめのひとこと |
| `app/.server/services/series.ts`（新規） | 自動割り当て（`assignSeries`）、`attachToSeries`、`getSeriesWithEditions`、`findSeriesCandidates`、ウォッチ、次の回の引き継ぎ値生成 |
| `app/.server/services/tags.ts`（新規） | 付与・削除・候補・統合・タグページ用の取得 |
| `app/.server/services/endorsements.ts`（新規） | 登録・更新・取り消し・集計・非表示 |
| `app/.server/services/events.ts` | 検索条件（`tag`・`month`・`sort=recommended`）、`EventCard` への `tags`・`endorsementCount`・`editionLabel`・`series` 追加、作成時のシリーズ自動割り当てと `start_month` 計算 |
| `app/.server/services/interactions.ts` | `recount()` に `endorsement_count` |
| `app/.server/services/admin.ts` | `mergeEvents` の対応、タグ・シリーズ管理、`needs_review` キュー |
| `app/.server/services/notifications.ts` | `notifyNewEdition()`、`SETTING_COLUMN` に `new_edition` |
| `app/.server/duplicates/find.ts` | 同一シリーズの除外 |
| `app/.server/chat/engine.ts` / `rank.ts` | §2.4 の反映 |
| `app/.server/url-import/*` | AI によるタグ候補 |
| `app/.server/mcp/handler.ts` / `server.ts` / `tools.ts` / `format.ts`（新規） | §2.4 |
| `app/.server/rate-limit.ts` | `mcp` |
| `app/.server/config.ts` | `MCP_ACCESS_TOKEN`（任意シークレット） |
| `workers/app.ts` | `/mcp` の分岐 |
| `wrangler.jsonc` | `RL_MCP`（3 環境） |

### 5.3 画面

| ファイル | 内容 |
| --- | --- |
| `app/routes.ts` | `series/:id`、`tags`、`tags/:slug`、`ai-connect`、`api/tags`、`api/series/search`、`admin/tags`、`admin/series` |
| `app/routes/events.$id.tsx` | おすすめ、タグと「＋」、他の回ボックス、新しい回の案内、「次の回を登録する」、終了した回の「保存」表示 |
| `app/routes/events.new.tsx` | `?seriesId=`、シリーズ自動割り当ての確認表示 |
| `app/routes/events.$id.edit.tsx` | タグ、シリーズの付け替え、回ラベル |
| `app/routes/events.tsx` | タグ・開催月の絞り込み、おすすめ順 |
| `app/routes/home.tsx` | 「先輩のおすすめ」セクション |
| `app/routes/me.tsx` | 「おすすめした」「ウォッチ中」タブ、お気に入りの「終了分のみ」絞り込み |
| `app/routes/settings.tsx` | `new_edition` の通知設定 |
| `app/routes/series.$id.tsx` / `tags.tsx` / `tags.$slug.tsx` / `ai-connect.tsx`（新規） | §2.1 / §2.3 / §2.4 |
| `app/routes/admin/tags.tsx` / `admin/series.tsx`（新規） | 管理（`needs_review` の確認を含む） |
| `app/routes/admin/comments.tsx` | おすすめのタブ |
| `app/components/events/event-form.tsx` | タグ入力、`FieldSource` に `previous`、前回の日程ヒント |
| `app/components/events/event-card.tsx` | タグ（最大 3）、おすすめ数、回ラベル、「全 N 回」 |
| `app/components/events/series-card.tsx`（新規） | タグページ・ホーム用のシリーズ単位カード |
| `app/components/events/series-timeline.tsx`（新規） | 回の年表 |
| `app/components/events/tag-input.tsx`（新規） | チップ＋候補付き入力 |
| `app/components/events/endorsement-form.tsx`（新規） | ひとこと＋活動報告リンク |
| `app/components/site-footer.tsx` | 「タグから探す」「AI アプリとつなぐ」 |

---

## 6. 進め方

ステップごとに PR を分け、各ステップで `npm run typecheck`・`npm test`・`npm run build` を通す。

| Step | 内容 | 確認すること |
| --- | --- | --- |
| 1 | スキーマ・マイグレーション（生成＋バックフィル＋タグ初期データ）・純粋関数とテスト | 既存データに全件シリーズが付き、既存画面が今まで通り動く |
| 2 | シリーズ（自動割り当て、年表、導線 A/B、ウォッチ、`new_edition` 通知、統合対応） | 普通に投稿しただけで正しいシリーズに割り当たる。主催者が違う場合は `needs_review` に乗る。ウォッチャーに通知が 1 回だけ届く |
| 3 | タグ（入力、タグページ、管理画面、一覧の絞り込み・開催月） | 投稿者以外は追加のみ。タグページがシリーズ単位で出る。開催月の絞り込みが正しい |
| 4 | おすすめ（登録、活動報告リンク、集計、並び、報告、マイページ、ホーム） | 終了した回にだけ付けられる。非表示が件数に反映される |
| 5 | MCP と `/ai-connect` | MCP Inspector で全ツールが通る。プレビュー環境に ChatGPT・Gemini CLI から接続できる。トークン設定時に未認証が 401 になる |
| 6 | サイト内 AI チャットへの反映、URL 取り込みのタグ候補 | 0 件のときに過去の定番が出る |

MCP を先に使いたい場合は Step 1 の直後に Step 5 を回してもよい。ツール出力からシリーズ・タグ・おすすめの項目を一時的に省き、あとから追加する（項目の追加は互換性を壊さない）。

---

## 7. テスト

| ファイル | 内容 |
| --- | --- |
| `tests/edition.test.ts` | `stripEditionMarkers`（西暦・年度・`'25`・第N回・Vol・全角）、`suggestNextTitle`（2025→2026、第4回→第5回、表記なしは変えない）、`editionLabelFrom` |
| `tests/tags.test.ts` | `normalizeTagName`（`#`・全角・大小文字・`C++` が残る） |
| `tests/series.test.ts` | 自動割り当て（キー一致＋主催者一致/不一致、URL ホスト一致）、`needs_review` の立ち上がり、付け替え時の空シリーズ削除 |
| `tests/mcp.test.ts` | `format.ts`（絶対 URL、二通りの日時、`null`、人名を含まない、`evidence` 配列）。`createMcpServer` に差し替え用の取得関数を渡し、SDK の `Client` + `InMemoryTransport` で `initialize` → `tools/list` → 各ツールを通す。トークン設定時に `Authorization` なしで 401 |
| `tests/duplicates.test.ts`（追記） | 同一シリーズの回が重複候補から除外されること |
| `tests/chat.test.ts`（追記） | タグ名一致の加点、0 件時の過去の定番 |

手動確認: ローカルで MCP Inspector を `http://localhost:5173/mcp` に。プレビュー環境に ChatGPT・Gemini CLI から接続し、回答に公式 URL と「要確認」の文言が含まれること。

---

## 8. リスクと対策

| リスク | 対策 |
| --- | --- |
| シリーズ自動割り当ての誤結合 | 主催者・URL ホストの確認を通さなければ自動で割り当てず `needs_review` に回す。ユーザーはフォームで外せる。投稿者・管理者はあとから付け替えられる |
| `series_id` が null の回が混ざる | マイグレーションで全件埋め、`createEvent` が必ず作る。管理ダッシュボードに「シリーズ未割り当て」件数を出して検知 |
| 古い応募フォームへの誘導 | 応募フォーム URL は引き継がない。公式 URL には「要確認」バッジ |
| タグの乱立 | 推奨タグのチップで既存タグへ誘導、候補表示、管理画面での統合・非表示 |
| 外部 AI が日程・締切を誤って伝える | 二通りの日時表記と絶対 URL を必ず返し、`evidence` で根拠を明示。ツール説明とプロンプトで公式確認を促す。未設定は `null` |
| 生徒の情報の外部流出 | MCP 出力に人名を含めない。公開情報のみ |
| MCP の過剰呼び出し | `RL_MCP`、件数・文字数上限、ステートレスなので Worker 側に状態が残らない |
| 開催月のタイムゾーン取り違え | 書き込み時に `zonedParts()` で計算し SQL で時差を扱わない。バックフィルの `+9 hours` は一回限りとコメントで明示 |

---

## 9. 未決事項（学校側で確認したいこと）

1. **おすすめは参加した人だけ**にしている（押すと「参加した」も付く）。参加していなくても「良さそう」と押せる方がよいか。
2. **ひとことの表示名**はコメントと同じく表示している。匿名の選択肢が要るか。
3. **保存（お気に入り）を「次の回をウォッチ」の意思とみなす** 仕様にしている（新しい回が登録されたら通知）。通知が多くなる場合は既定 OFF も検討。
4. **タグは誰でも新規作成可**。荒れる場合は「推奨タグ＋管理者が承認したタグのみ」に切り替える。
5. **MCP は既定で認証なし**。閲覧がログイン不要なので合わせた。制限する場合は `MCP_ACCESS_TOKEN` を配布する運用になる。
6. **`needs_review`（自動判定で保留にしたシリーズ）** は管理画面での手動確認を前提にしている。確認頻度が担保できるか。
