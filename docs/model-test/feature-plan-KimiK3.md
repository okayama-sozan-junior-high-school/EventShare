# Event Share 機能追加 計画書兼仕様書

- 作成: Kimi K3
- 基準: `main` ブランチ（`09672df`）
- 前提: [architecture.md](architecture.md) の原則（サーバー側での権限・検証、`.server` 分離、UTC ミリ秒、AI 出力の検証）に従う
- 状態: 計画。コード未変更

---

## 1. 方針

要求は次の 3 つ。

1. 過去のイベントでおすすめなものを保存し、あとから見られるようにする
2. タグ付けして「こういう系のイベントが過去にあった」と見られるようにする
3. 次の回を登録するとき、昔のやつと紐づけられるようにする

加えて、これらを外部の AI（ChatGPT・Gemini）からも使えるようにするため MCP サーバーを立てる。

設計の中心は 2 つ。

- **「おすすめ」は「コレクション」にする。** 過去のイベントの価値は、「参加した」「行きたかった」「面白かった」など文脈によって違う。1 種類のフラグではなく、**目的別のリスト（コレクション）** として保存させる。コレクションは自分専用（保存・整理）と公開（後輩への推薦・キュレーション）に分かれる。
- **「次の回と昔のやつ」は「シリーズ」にする。** 回ごとに別々のレコードとして扱うのではなく、**同じ名前空間（シリーズ）の下に回（エディション）が並ぶ** 構造にする。これにより「過去にこういう系があった」の検索結果が「シリーズ」単位で重複なく出せ、次の回登録時のコピー先（どの項目を引き継ぐか）もシリーズの定義として決められる。

---

## 2. 機能仕様

### 2.1 コレクション（おすすめ・保存）

**定義**: ユーザーがイベントを整理するためのリスト。以下の属性を持つ。

| 属性 | 値 |
| --- | --- |
| `title` | リスト名（例: 「行ってよかった全国大会」「夏休みにチェック」） |
| `type` | `private`（自分だけが見る、整理用）/ `public`（誰でも見れる、推薦用） |
| `description` | リストの説明（任意） |
| `event_id` | 対象イベント |
| `note` | そのイベントに対する一言メモ（最大 300 文字、任意） |

**既定のコレクション**（ユーザー作成不要、システムが提供）

| 名前 | 種別 | 用途 |
| --- | --- | --- |
| おすすめ（推薦） | public | 後輩に「これは良かった」と見せるためのリスト。イベント詳細の「おすすめ」ボタンで追加。公開される |
| ブックマーク（従来のお気に入り） | private | これから参加・応募を考えているイベント。既存の `event_bookmarks` の扱いに近い |

**カスタムコレクション**

- ユーザーは自分の `public` / `private` コレクションを作成できる（例: 「プログラミング系」「無料でいけるやつ」）。
- 1 イベントを複数のコレクションに入れられる。
- `public` コレクションは `/users/:id/collections` で公開される（プロフィールの公開範囲設定に従う）。

**「過去のおすすめを見る」画面**

- `/collections/recommended` に「みんなのおすすめ」を集約表示。`public` な「おすすめ」コレクションに入っているイベントを、入れた人数・最近の追加順で並べる。
- イベント詳細には「このイベントをおすすめしている人（N 人）」を表示し、押すとその人たちの公開コレクション（該当イベントが入っているもの）へのリンクが出る。

### 2.2 タグ（分類・発見）

**定義**: イベントの属性を表す短いラベル。カテゴリ（大分類）とは別軸。

**付与**

- 投稿・編集フォームに入力欄を追加。最大 10 個、1 タグ 20 文字まで。
- 入力は自由だが、既存のタグをサジェスト（前方一致）。表記ゆれは `normalized_tag` で防ぐ（NFKC、小文字化、空白除去、記号除去）。
- 投稿者・管理者は削除できる。投稿者以外は追加のみ（情報提供の一環）。
- タグは `events` ではなく `event_tags` に保存（多対多）。

**表示**

- イベント詳細のタグはクリック可能で `/tags/:tag` に遷移。
- `/tags/:tag` では、そのタグが付いたイベントを **シリーズ単位** で表示（2.3 参照）。募集中のものと終了したものを分けて見せる。
- 一覧（`/events`）の絞り込みに `tag` パラメータ（AND 指定可能）を追加。

### 2.3 シリーズ（回の紐づけ）

**定義**: 同じイベントの繰り返し開催を束ねる概念。`event_series` テーブル。

- すべての `events` は必ず 1 つの `series_id` を持つ（単発は `editions` が 1 つのみのシリーズ）。
- シリーズは `canonical_title`（例: 「高校生 AI ハッカソン」）を持つ。

**次の回を登録する 3 つの入口**

| 入口 | 動作 |
| --- | --- |
| **過去の回から「次の回を作成」** | `/events/new?fromEventId=<過去のID>`。フォームに `title`（年号・回数を +1 したもの）、`organizer`、`location`、`format`、`feeType`、`description`、`officialUrl`（ただし年号部分を置換）、`categoryIds`、`tags` をコピーする。`applicationDeadline` と `startAt`/`endAt` は空にする |
| **投稿時に「これは既存のイベントの新しい回では？」と提案** | 投稿フォーム送信時、タイトルの類似度（`normalizeForMatch` で回の表記を除去した上で Dice 係数 0.8 以上、または `officialUrl` のドメイン一致）で既存シリーズを検索。候補があれば「『○○』の新しい回として登録しますか？」と表示し、承認されればそのシリーズに属するようにする |
| **編集画面で後から紐づける** | イベント編集画面に「このイベントのシリーズ」欄を追加。検索して既存シリーズに所属させられる。所属変更時は `event_contributions` に記録 |

**シリーズページ `/series/:id`**

- シリーズ名、説明（任意）
- 回の一覧（年表形式。`edition_label`、開催日、状態、おすすめ数、タグ）
- 「次の回を登録する」ボタン
- シリーズを「ウォッチ」する機能（`series_watches`）。新しい回が公開されると通知。

**紐づけ時の通知**

- シリーズをウォッチしているユーザーに `new_edition` 通知（「『○○』の新しい回が公開されました」）。
- 過去の回の「おすすめ」コレクションに入れているユーザーにも、別途 `new_edition` で通知（「おすすめしていた『○○』の 2026 年版が登録されました」）。重複防止は `dedupe_key`。

### 2.4 MCP サーバー

**目的**: ChatGPT、Gemini、Claude 等の外部 AI から、イベントの検索・詳細・おすすめ・シリーズ情報を取得できるようにする。

**アーキテクチャ**

- エンドポイント: `POST /mcp`
- 実装: `@modelcontextprotocol/sdk` の `McpServer` + `WebStandardStreamableHTTPServerTransport`（`sessionIdGenerator: undefined`, `enableJsonResponse: true` でステートレス・JSON 応答）。
- バリデータ: `CfWorkerJsonSchemaValidator`（`@cfworker/json-schema`）を使用（Workers 環境で `eval` が禁止されているため）。
- 認証: 既定はなし（サイトの閲覧と同様）。環境変数 `MCP_ACCESS_TOKEN` が設定されている場合のみ `Authorization: Bearer` を要求。
- レート制限: `RL_MCP`（IP あたり 60 回/分）を `wrangler.jsonc` に追加。

**提供ツール**

| ツール名 | 説明 | 主なパラメータ |
| --- | --- | --- |
| `search_events` | イベントを検索 | `query`, `tags[]`, `categories[]`, `status`（`upcoming`/`ended`/`all`）, `sort`（`recommended`/`new`/`start`）, `limit` |
| `get_event` | イベント詳細を取得 | `id` → タグ、おすすめ数、シリーズ情報（他の回）、コレクションに入れた人の数 |
| `get_series` | シリーズ情報を取得 | `id`（シリーズ ID またはイベント ID）→ 回の一覧、例年の開催時期、最新の回 |
| `list_recommendations` | おすすめイベントを取得 | `limit` → `public` な「おすすめ」コレクションに多く入っているイベント |
| `list_tags` | タグ一覧を取得 | なし |
| `search` | ChatGPT 互換検索 | `query` → `{ results: [{ id, title, url }] }` |
| `fetch` | ChatGPT 互換詳細取得 | `id` → `{ id, title, text, url }` |

**出力ルール**

- 日時は ISO 8601（UTC）と日本語表記（`2026年11月3日(火) 13:00`）の両方。
- URL は絶対 URL（`<origin>/events/<id>` 等）。
- 未設定の項目は `null`。
- ユーザー名・メールアドレスなどの個人情報は出力しない（コレクションの所有者名も出さない）。

**接続ガイド `/ai-connect`**

- エンドポイント URL（`https://<host>/mcp`）を表示。
- ChatGPT（カスタムコネクタ）、Gemini（Gemini CLI の `settings.json`、または API 経由）、Claude / Cursor の設定例を掲載。
- フッターからリンク。

---

## 3. データモデル

### 3.1 新規テーブル

**`collections`**

| 列 | 型 | 説明 |
| --- | --- | --- |
| `id` | text PK | UUID |
| `user_id` | text → user（cascade） | 所有者 |
| `title` | text | リスト名 |
| `type` | text enum(`private`, `public`) | 公開範囲 |
| `description` | text | 任意 |
| `created_at` / `updated_at` | timestamp_ms | |

**`collection_items`**

| 列 | 型 | 説明 |
| --- | --- | --- |
| `collection_id` | text → collections（cascade） | 複合 PK |
| `event_id` | text → events（cascade） | 複合 PK |
| `note` | text | 最大 300 文字 |
| `added_at` | timestamp_ms | |

**`event_series`**

| 列 | 型 | 説明 |
| --- | --- | --- |
| `id` | text PK | UUID |
| `canonical_title` | text | シリーズ名（例: 高校生 AI ハッカソン） |
| `normalized_title` | text | 回表記除去後の正規化名（検索用、ユニーク） |
| `description` | text | 任意 |
| `created_by_id` | text → user（set null） | 作成者 |
| `created_at` / `updated_at` | timestamp_ms | |

**`tags`**

| 列 | 型 | 説明 |
| --- | --- | --- |
| `id` | integer PK autoincrement | |
| `name` | text | 表示名 |
| `normalized_name` | text unique | 正規化名（`#` 除去、NFKC、小文字化） |
| `created_at` | timestamp_ms | |

**`event_tags`**

| 列 | 型 | 説明 |
| --- | --- | --- |
| `event_id` | text → events（cascade） | 複合 PK |
| `tag_id` | integer → tags（cascade） | 複合 PK |
| `added_by_id` | text → user（set null） | 追加者 |
| `created_at` | timestamp_ms | |

**`series_watches`**

| 列 | 型 | 説明 |
| --- | --- | --- |
| `user_id` | text → user（cascade） | 複合 PK |
| `series_id` | text → event_series（cascade） | 複合 PK |
| `created_at` | timestamp_ms | |

### 3.2 既存テーブルの変更

| テーブル | 変更 |
| --- | --- |
| `events` | `series_id` text → event_series（set null）を追加。`edition_label` text（最大 30 文字）を追加。`recommendation_count` integer default 0 を追加（おすすめコレクションに入れられた数の非正規化）。 |
| `NOTIFICATION_TYPES` | `new_edition` を追加。 |

### 3.3 マイグレーション

- `0002_collections_series_tags.sql`: drizzle-kit で生成。
- `0003_seed_tags.sql`: 初期タグ（例: `初心者歓迎`, `全国大会`, `無料`, `オンライン`, `チーム参加`, `夏休み`, `冬休み`, `毎年開催` 等）を `active` で投入。

---

## 4. 画面・ファイル変更

### 4.1 サーバー側

| ファイル | 内容 |
| --- | --- |
| `app/.server/db/schema.ts` | 上記テーブル定義 |
| `app/.server/services/collections.ts`（新規） | コレクションの CRUD、おすすめ数の再集計 |
| `app/.server/services/series.ts`（新規） | シリーズの取得、作成、紐づけ、ウォッチ、次の回作成時の引き継ぎ値生成 |
| `app/.server/services/tags.ts`（新規） | タグの正規化、付与、一覧 |
| `app/.server/services/events.ts` | `series_id`、`edition_label` の保存、タグの保存、おすすめ数の計算 |
| `app/.server/services/interactions.ts` | おすすめ（コレクション追加）時の `recommendation_count` 更新 |
| `app/.server/services/notifications.ts` | `notifyNewEdition`（ウォッチ＋おすすめ保持者への通知） |
| `app/.server/mcp/`（新規） | MCP サーバー実装（`handler.ts`, `server.ts`, `tools.ts`, `format.ts`） |
| `workers/app.ts` | `/mcp` へのルーティング（CSRF チェックより前） |
| `wrangler.jsonc` | `RL_MCP` バインディング追加（開発・本番・プレビュー） |

### 4.2 クライアント側

| ファイル | 内容 |
| --- | --- |
| `app/routes.ts` | `/collections`, `/collections/:id`, `/series/:id`, `/tags/:tag`, `/ai-connect` 追加 |
| `app/routes/events.$id.tsx` | タグ表示・追加、おすすめボタン（コレクションへ追加）、シリーズ情報（他の回）、「次の回を作成」ボタン |
| `app/routes/events.new.tsx` | `?fromEventId=` からの引き継ぎ、シリーズ候補の提案パネル |
| `app/routes/events.$id.edit.tsx` | タグ編集、シリーズ紐づけ変更 |
| `app/routes/events.tsx` | タグ絞り込み、おすすめ順ソート |
| `app/routes/me.tsx` | 「コレクション」タブ（自分のコレクション管理）、「ウォッチ中」タブ |
| `app/routes/users.$id.tsx` | 公開プロフィールに「公開コレクション」セクション |
| `app/routes/collections.tsx`（新規） | みんなのおすすめ一覧 |
| `app/routes/series.$id.tsx`（新規） | シリーズ詳細（回の年表） |
| `app/routes/ai-connect.tsx`（新規） | MCP 接続ガイド |
| `app/components/events/event-form.tsx` | タグ入力欄、シリーズ紐づけ表示 |
| `app/components/events/event-card.tsx` | タグバッジ、おすすめ数、回ラベル |
| `app/components/site-footer.tsx` | 「AI アプリと連携」リンク |

---

## 5. 権限

| 操作 | 未ログイン | ログイン | 投稿者 | 管理者 |
| --- | :-: | :-: | :-: | :-: |
| コレクションの閲覧（public） | ✓ | ✓ | ✓ | ✓ |
| コレクションの作成・編集 | | ✓（自分のもの） | | ✓（全て） |
| タグの閲覧・検索 | ✓ | ✓ | ✓ | ✓ |
| タグの追加 | | ✓ | ✓ | ✓ |
| タグの削除 | | | ✓ | ✓ |
| シリーズの閲覧 | ✓ | ✓ | ✓ | ✓ |
| シリーズの作成（イベント作成時に自動） | | ✓ | ✓ | ✓ |
| シリーズへの紐づけ（自分のイベント） | | | ✓ | ✓ |
| シリーズへの紐づけ（他人のイベント、単発のみ） | | ✓ | | ✓ |
| シリーズのウォッチ | | ✓ | ✓ | ✓ |
| MCP の利用（読み取り） | ✓（トークン設定時は要トークン） | | | |

---

## 6. テスト計画

| 対象 | 内容 |
| --- | --- |
| `tests/collections.test.ts` | コレクションの作成、イベント追加・削除、おすすめ数の集計 |
| `tests/series.test.ts` | シリーズの作成、次の回の引き継ぎ（タイトルの年号進行）、紐づけ時の重複防止 |
| `tests/tags.test.ts` | タグの正規化（`#`、`全角`、`半角`）、重複防止 |
| `tests/mcp.test.ts` | MCP サーバーの `initialize` → `tools/list` → 各ツール呼び出し。`search_events` でタグ・シリーズ情報が含まれること。`fetch` で詳細が取得できること。認証トークンなしで 401 になること（設定時） |
| `tests/edition.test.ts` | タイトルからの年号・回数抽出と +1 処理 |

---

## 7. 未決事項（確認したいこと）

1. **おすすめの公開範囲**: 「おすすめ」コレクションはデフォルトで公開（後輩が見られる）にするか、非公開（自分のメモ）にするか。現状は「推薦」という意味で公開を想定。
2. **コレクションの共有**: 特定のユーザーだけに見せる「限定公開」は必要か（例: 同級生だけ）。
3. **シリーズ名の自動決定**: 最初のイベントのタイトルから「2024」「第1回」等を除去したものをシリーズ名とするが、適切でない場合は後から編集可能か。
4. **MCP のアクセス制限**: 学外からのアクセスを制限するため、`MCP_ACCESS_TOKEN` を必須にするか、IP 制限をかけるか。
5. **タグの削除権限**: 投稿者以外が追加したタグを、投稿者が削除できるようにするか（現状は投稿者・管理者のみ削除可能）。
