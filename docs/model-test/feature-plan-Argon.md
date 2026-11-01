# Event Share 機能拡張 計画書兼仕様書（Phase 6）

本ドキュメントは、Event Share に対して追加実装する以下4つの機能群の**計画書兼詳細仕様書**です。既存の設計書（`docs/architecture.md`）の原則（Cloudflare Workers + D1 + Drizzle ORM、プログレッシブエンハンスメント、権限・検証のサーバー側徹底、AIによる捏造防止）に準拠して設計しています。

1. **過去イベントの「おすすめ保存（推薦）」とアーカイブ機能**
2. **タグ付け機能（特徴タグによる横断検索・「過去にこういう系があった」の可視化）**
3. **次回（別年度・次期）開催登録時の過去イベント紐づけ（シリーズ機能）**
4. **MCP（Model Context Protocol）サーバー対応（ChatGPT / Gemini / Claude 連携）**

---

## 1. 背景と目的

中高生向けのコンテスト・ハッカソン・勉強会・研究発表会は、**毎年ほぼ同じ時期に開催される「定番イベント」** が多く存在します。しかし現状の仕組みでは以下の課題があります。

- **終了した良質なイベントが埋もれる**: 開催終了後は一覧の既定フィルタ（これから開催）から外れるため、後輩が「過去にどんな良いイベントがあったか」を知りにくい。
- **大分類カテゴリだけでは特徴がわからない**: 「プログラミング」「科学・技術」だけでは、`#初心者歓迎` `#毎年開催` `#夏休み` `#宿泊あり` といった具体的な特徴で探せない。
- **翌年の開催と過去の実績が分断される**: 2026年版が投稿されても、2025年版に書かれた先輩の活動報告やおすすめコメントと繋がらない。
- **普段使っている外部AI（ChatGPT / Gemini 等）から探せない**: 生徒が普段使っているAIアプリから直接 Event Share のデータベースを検索・相談できない。

これら4つを一貫したデータモデルで繋ぎ、**「過去の先輩のおすすめ・タグから知る」→「今年の回を過去回と紐づけて簡単に登録する」→「WebやChatGPT/Geminiから過去の実績込みで探せる」** というサイクルを作ります。

---

## 2. 機能仕様

### 2.1 過去イベントの「おすすめ保存（推薦）」機能

既存の「お気に入り（`event_bookmarks`）」が「これから応募・参加したい個人メモ」であるのに対し、参加後や終了後のイベントを **「後輩にもおすすめしたい定番イベント」として保存・推薦する機能** です。

#### 権限と対象
| 操作 | 未ログイン | ログイン | 投稿者 | 管理者 |
| --- | :-: | :-: | :-: | :-: |
| おすすめ数・一言メモの閲覧、おすすめ順での検索 | ✓ | ✓ | ✓ | ✓ |
| おすすめ登録・解除・自分の一言メモの編集 | | ✓ | ✓ | ✓ |
| 不適切な一言メモの非表示化 | | | | ✓ |

#### 画面・動作仕様
1. **イベント詳細ページ（`/events/:id`）**
   - アクションボタン群に **「後輩におすすめ（推薦）」ボタン**（件数カウント付き）を追加。
   - ボタンを押すと推薦状態になり、任意で **「おすすめメモ（最大200文字）」**（例：「初心者でもメンターが丁寧に教えてくれた」「毎年5月ごろ募集が出る定番大会」）を入力・保存できるミニフォーム（Popover または折りたたみ）を表示。
   - 詳細ページ本文に「おすすめコメント一覧（推薦者名・学年・一言メモ）」セクションを表示（個人情報記載禁止の注意書き付き）。
2. **マイページ（`/me`）**
   - タブに **「おすすめ保存（N）」** を追加。自分がおすすめしたイベント（過去イベント含む）を一覧で見返せる。
3. **イベント検索ページ（`/events`）**
   - 並び替え（`sort`）に **`recommended`（おすすめ順）** を追加（`recommend_count * 3 + like_count + bookmark_count` で算出）。
   - 「表示するイベント（`status`）」に既存の `upcoming` / `ended` / `all` に加え、終了したイベントを探す際に便利な **「開催月フィルタ（`month`: 1〜12月）」** を追加（「夏休み（7・8月）に開催された過去のおすすめイベント」などを検索可能にする）。
4. **ホーム画面（`/`）**
   - 「先輩おすすめの定番・過去イベント」セクションを追加（過去イベントのうちおすすめ数・活動報告数が多いものを表示）。

---

### 2.2 タグ付け機能（特徴タグによる横断検索）

管理者が固定管理する `categories`（11種の大分類）とは別に、イベントの具体的な性質を表す **ハッシュタグ（`#初心者歓迎` `#毎年開催` など）** を付与できる仕組みです。

#### プリセット推奨タグ（サジェスト候補）
自由入力（最大20文字）も可能としつつ、表記ゆれを防ぐため以下の推奨タグをチップ形式でワンクリック選択できるようにします。
- **対象・難易度**: `初心者歓迎`, `中学生OK`, `高校生限定`, `文系歓迎`
- **参加形態**: `個人参加OK`, `チーム参加`, `メンター付き`, `宿泊あり`, `1日完結`
- **開催性質**: `毎年開催`, `全国大会`, `地方予選あり`, `賞金・表彰あり`, `交通費補助あり`
- **時期**: `春休み`, `夏休み`, `冬休み`, `週末開催`

#### 権限と荒らし対策
- **投稿・編集時**: イベント作成画面（`/events/new`）および編集・情報追加画面（`/events/:id/edit`）で最大 **10個** までタグを設定可能。
- **既存・過去イベントへのタグ追加**: ログインユーザーであれば、投稿者以外でもイベント詳細ページまたは情報追加画面から **既存イベント（終了済み含む）にタグを追加** できる（上限10個まで）。
- **タグの削除**: 投稿者本人または管理者のみが既存タグを外せる（情報提供モードでは追加のみ可能とし、荒らしによるタグ消去を防ぐ）。
- **正規化**: NFKC正規化＋小文字化＋先頭の `#` 除去＋空白除去を行った `normalized_name` で一意管理し、表記ゆれによる重複タグ生成を防ぐ。

#### 「こういう系のイベントが過去あったよ」の可視化
- イベントカード・イベント詳細ページに `#タグ名` バッジを表示。
- タグをクリックすると `/events?tag=<タグ名>&status=all` へ遷移、または `/events` でタグ絞り込みを行う際：
  - **現在募集中のイベント** を上部に表示。
  - 募集中が0件（または少ない）場合でも、同じ画面の下部に **「過去に開催された『#タグ名』のイベント（N件）」** セクションを自動表示し、「今は募集期間外だが、過去にこういうイベントがあった」ことが一目でわかるようにする。

---

### 2.3 次回登録時の過去イベント紐づけ（シリーズ・歴代開催機能）

年次・回次で開催されるイベントを「前回のイベント（`previous_event_id`）」として鎖状に紐づける機能です。

```
[2024年 第1回] ◀── previous_event_id ── [2025年 第2回] ◀── previous_event_id ── [2026年 第3回（募集中）]
```

#### 登録・紐づけの3つの導線

1. **導線A: 過去イベント詳細ページの「次回の開催を投稿する」ボタン（推奨導線）**
   - イベント詳細ページ（特に `ended` / `closed` のイベント）に **「このイベントの次回開催を投稿」** ボタンを設置。
   - リンク先: `/events/new?fromEventId=<過去イベントID>`
   - **自動引き継ぎ項目**:
     - `previousEventId`: `<過去イベントID>`（フォーム上部に「『〇〇（2025年）』の次回開催として投稿します」とバナー表示、解除も可）
     - `categoryIds`: 過去イベントのカテゴリをそのまま初期選択
     - `tags`: 過去イベントのタグをそのまま初期選択（`毎年開催` タグも自動サジェスト）
     - `organizer`, `targetAudience`, `format`, `location`, `feeType`, `feeDetail`, `officialUrl`: 初期値として入力済みにする
     - `title`, `description`: 初期値として入れつつ、西暦（例: `2025` → `2026`）や回数を書き換えやすいようフォーカス
     - `startAt`, `endAt`, `applicationDeadline`: 新しい回の日時を入れるため **空欄** にする
   - URLインポートを併用した場合も、`fromEventId` の引き継ぎ情報（カテゴリ・タグ・未取得項目の補完・`previousEventId`）を維持する。

2. **導線B: 新規投稿時の「過去の開催回」自動検出（重複判定の拡張）**
   - 現在の `scoreDuplicate()`（`app/.server/duplicates/score.ts`）は、タイトルや主催・URLが似ていても「開催日が120日以上離れている」または「タイトル内の西暦が異なる」場合に `differentEdition: true` と判定し、スコアを抑えています。
   - これまでは単なる重複警告（`DuplicatePanel`）しか出していませんでしたが、`differentEdition: true` かつタイトル類似度が高い（または公式URLが一致する）既存イベントが見つかった場合、**「過去の開催回が見つかりました。前回のイベントとして紐づけますか？」** という候補パネルを表示します。
   - ユーザーはワンクリックで **「『〇〇』の次回開催として紐づけて投稿する」** を選択でき、カテゴリやタグが不足していれば過去回から引き継いで投稿できます。

3. **導線C: 編集・情報追加画面での後から紐づけ**
   - `/events/:id/edit` にて、過去のイベントをキーワード検索またはID指定で `previousEventId` に設定できる欄を追加。
   - 投稿者以外（情報追加モード）でも、`previousEventId` が未設定（`null`）であれば設定可能とする。
   - **循環参照防止**: 自分自身、またはすでに自分の後続回になっているイベントを `previousEventId` に指定できないようサーバー側で検証する（最大10世代まで遡ってサイクル検出）。

#### 紐づけたときの表示と通知
1. **新しい回（2026年）の詳細ページ**
   - **「歴代の開催回・シリーズ」ボックス** を表示（過去回・次回回へのリンク一覧と開催年）。
   - 今年の活動報告がまだ0件でも、**「前回の開催回に寄せられた活動報告・先輩のおすすめコメント」** を折りたたみ／カードで表示し、応募の参考にできるようにする。
2. **過去の回（2025年）の詳細ページ**
   - ページ上部の目立つ位置に **「このイベントの新しい開催回（2026年）が登録されています！」** という案内バナーを表示し、最新回へ1クリックで移動できるようにする。
3. **次回開催の自動通知（`notifyNewEdition`）**
   - `previousEventId` 付きでイベントが公開された際、過去回（さらに遡れる場合は直近3回分）を **「お気に入り（`event_bookmarks`）」「参加（`event_participations`）」「おすすめ（`event_recommendations`）」** していたユーザーに対し、`new_event` 通知（「過去に参加・保存した『〇〇』の新しい開催回が投稿されました」）を送信する。
4. **イベント統合（`mergeEvents`）との整合性**
   - 管理者がイベントAをイベントBに統合した際、Aを `previousEventId` として参照していた後続イベントがあれば `previousEventId = B`（ただしB自身になる場合は `B.previousEventId`）へ自動で付け替える。

---

### 2.4 MCP（Model Context Protocol）サーバー対応（ChatGPT / Gemini / Claude 連携）

Event Share 自体を **リモート MCP サーバー（Streamable HTTP 方式）** として動作させ、ChatGPT、Gemini、Claude 等から直接イベント検索・詳細確認・おすすめ相談ができるようにします。

#### アーキテクチャ方針
- **エンドポイント**: `https://<ホスト名>/mcp`
- **トランスポート**: MCP 公式 SDK（`@modelcontextprotocol/sdk`）の `WebStandardStreamableHTTPServerTransport` を **ステートレス JSON モード**（`sessionIdGenerator: undefined`, `enableJsonResponse: true`）で使用。
  - Cloudflare Workers の標準 `Request` / `Response` でそのまま動作し、Durable Objects が不要でコールドスタートも高速。
- **JSON Schema バリデータ**: Workers 環境では `eval` / `new Function` が禁止されているため、SDK 既定の Ajv ではなく Cloudflare 公式対応の `CfWorkerJsonSchemaValidator`（`@cfworker/json-schema`）を指定。
- **認証方針（Phase 6）**: サイトの「閲覧・検索・AI相談はログイン不要」というポリシーに合わせ、**読み取り専用・認証不要（Authless）** で公開。
  - すべてのツールに MCP アノテーション `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` を付与し、ChatGPT / Gemini 側で毎回確認ダイアログが出ずにスムーズに呼び出せるようにする。
  - 返すデータは `status = 'published'` のイベントの公開情報のみとし、ユーザーのメールアドレスや非公開プロフィール等は一切含めない。

#### 提供する MCP ツール一覧

| ツール名 | 用途・対象クライアント | 入力パラメータ（Zod） | 返却内容 |
| --- | --- | --- | --- |
| `search_events` | 条件指定でのイベント検索（全クライアント共通） | `query` (キーワード), `categories` (slug配列), `tags` (タグ配列), `status` (`upcoming` / `ended` / `all`, 既定 `upcoming`), `month` (1〜12), `format` (`online` / `offline`), `fee` (`free` / `paid`), `deadline` (`open` / `7d` / `30d`), `location`, `sort` (`start` / `deadline` / `popular` / `recommended` / `new`), `limit` (最大20) | 条件に合うイベント一覧（ID、タイトル、開催日時、締切、場所、形式、参加費、カテゴリ、タグ、おすすめ数、絶対URL） |
| `get_event` | イベントの詳細・過去回・先輩の声の取得 | `id` (イベントID) | イベント全項目、公式/応募URL、タグ、**歴代開催回（前回・次回）**、**先輩のおすすめメモ（上位5件）**、**関連する活動報告の要約（上位5件）** |
| `recommend_events` | 生徒の興味・希望からのイベント推薦 | `categories` (slug配列), `keywords` (配列), `tags` (配列), `style` (`create` / `learn` / `compete` / `present` / `volunteer` / `any`), `format`, `fee`, `participation` (`solo` / `team` / `any`), `includePastRecommended` (boolean: 募集終了でも定番のおすすめ過去イベントを含めるか) | スコア順の推薦イベント一覧＋DBの事実に基づく推薦理由（`matched`）＋過去定番イベントの候補 |
| `list_categories_and_tags` | 分類・人気タグ一覧の取得 | なし | 有効なカテゴリ一覧（`slug`, `name`, `description`）と、利用数の多いタグ一覧（`name`, `count`）。AIが検索前に正しいスラッグ・タグ名を知るために使用 |
| `search` | ChatGPT コネクタ / Deep Research 互換検索 | `query` (検索文字列) | OpenAI MCP 仕様に準拠した `{ results: [{ id, title, url }] }` 形式の検索結果 |
| `fetch` | ChatGPT コネクタ / Deep Research 互換詳細取得 | `id` (イベントID) | OpenAI MCP 仕様に準拠した `{ id, title, text, url, metadata }` 形式のドキュメントデータ |

#### プロンプト（MCP Prompts）の提供
MCP クライアント側で呼び出せる定型プロンプトも登録します。
- `find_events_for_student`: 学年・興味のある分野・長期休み（夏休み等）を入力すると、募集中イベントと過去の定番イベントの両方を調査して提案するプロンプト。

#### セキュリティ・CORS・レート制限
- **CSRF 除外**: `workers/app.ts` にて `/mcp` へのリクエストは Cookie を使用しない API のため `isCrossSiteMutation` チェックの前に MCP ハンドラへルーティングする。
- **CORS 対応**: ブラウザベースの MCP クライアントや Inspector からの接続に対応するため、`/mcp` では `Access-Control-Allow-Origin: *`、`Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`、`Access-Control-Allow-Headers: Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id` を付与。
- **レート制限**: `wrangler.jsonc`（開発・本番・プレビュー全環境）に `RL_MCP` バインディング（IPあたり 60回 / 分）を追加し、過剰な呼び出しを防止。

#### AI接続ガイド画面（`/ai-connect`）
生徒や先生が自分の ChatGPT / Gemini / Claude にすぐ繋げられるよう、Web 画面にガイドページを追加します（フッターおよび `/chat` 画面からリンク）。
- 現在の環境の MCP エンドポイント URL（`https://.../mcp`）を大きく表示し、ワンクリックでコピーできるボタンを設置。
- **ChatGPT での接続手順**: 設定 → アプリとコネクタ → 開発者モードを有効化 → カスタムコネクタ作成で URL に `https://.../mcp`、認証「なし」を指定する手順。
- **Gemini での接続手順**:
  - Gemini CLI（`~/.gemini/settings.json`）や Google AI Studio / Gemini API SDK での `mcpServers` 設定スニペット（コピーボタン付き）。
- **Claude / Cursor での接続手順**: カスタムコネクタおよび `mcp.json` の設定スニペット。
- **質問例**: 「夏休みに高校生が無料で参加できるプログラミング系のイベントを探して。過去に先輩がおすすめしていた定番イベントも教えて」などのプロンプト例を掲載。

---

## 3. データベース設計（D1 / Drizzle スキーマ変更）

`app/.server/db/schema.ts` に以下の変更を行い、`npm run db:generate` でマイグレーション（`0002_series_tags_recommendations.sql`）を生成します。

### 3.1 `events` テーブルへの列追加

| カラム名 | 型 | 制約 / 既定値 | 説明 |
| --- | --- | --- | --- |
| `previous_event_id` | `text` | nullable | 前回（過去年度・前回開催）の `events.id`。インデックス `events_previous_event_idx` を作成 |
| `recommend_count` | `integer` | `not null default 0` | おすすめ（推薦）された件数の非正規化カウンタ。インデックス `events_status_recommend_idx` `(status, recommend_count)` を作成 |

### 3.2 新規テーブル: `tags`（タグマスタ）

| カラム名 | 型 | 制約 / 既定値 | 説明 |
| --- | --- | --- | --- |
| `id` | `integer` | PK, autoIncrement | タグID |
| `name` | `text` | `not null` | 表示用のタグ名（例: `初心者歓迎`、`毎年開催`） |
| `normalized_name` | `text` | `not null unique` | NFKC正規化・小文字化・空白除去後の文字列（表記ゆれ防止） |
| `created_at` | `integer (timestamp_ms)` | `not null` | 作成日時 |

### 3.3 新規テーブル: `event_tags`（イベントとタグの紐づけ）

| カラム名 | 型 | 制約 / 既定値 | 説明 |
| --- | --- | --- | --- |
| `event_id` | `text` | PK(複合), FK(`events.id`, cascade) | イベントID |
| `tag_id` | `integer` | PK(複合), FK(`tags.id`, cascade) | タグID（`event_tags_tag_idx` インデックス作成） |
| `added_by_id` | `text` | FK(`user.id`, set null) | タグを追加したユーザーID |
| `created_at` | `integer (timestamp_ms)` | `not null` | 追加日時 |

### 3.4 新規テーブル: `event_recommendations`（過去イベント等のおすすめ保存・一言メモ）

| カラム名 | 型 | 制約 / 既定値 | 説明 |
| --- | --- | --- | --- |
| `user_id` | `text` | PK(複合), FK(`user.id`, cascade) | 推薦したユーザーID |
| `event_id` | `text` | PK(複合), FK(`events.id`, cascade) | イベントID（`event_recommendations_event_idx` インデックス作成） |
| `comment` | `text` | nullable | おすすめの一言メモ（最大200文字） |
| `created_at` | `integer (timestamp_ms)` | `not null` | 作成日時 |
| `updated_at` | `integer (timestamp_ms)` | `not null` | 更新日時 |

---

## 4. 変更・新規作成ファイル一覧

### 4.1 サーバー側（`app/.server/`・`workers/`）
| ファイルパス | 区分 | 内容 |
| --- | --- | --- |
| `app/.server/db/schema.ts` | 変更 | `events` に `previousEventId`, `recommendCount` 追加。`tags`, `eventTags`, `eventRecommendations` テーブル追加 |
| `drizzle/migrations/0002_*.sql` | 新規 | 上記スキーマ変更のD1マイグレーション（推奨タグの初期シード含む） |
| `app/.server/validation/event.ts` | 変更 | `tags`（最大10個・各20文字）、`previousEventId`（UUID）、おすすめメモのバリデーション追加 |
| `app/.server/services/tags.ts` | 新規 | タグの正規化・取得・イベントへの紐づけ・人気タグ一覧取得ロジック |
| `app/.server/services/series.ts` | 新規 | `previousEventId` を辿る歴代イベント取得（前後双方向）、循環参照チェック、過去回候補検索（`findPastEditionCandidates`） |
| `app/.server/services/events.ts` | 変更 | 検索条件に `tag`, `month`, `sort=recommended` を追加。同タグの過去イベント取得、作成・編集・情報追加時のタグ＆`previousEventId` 保存 |
| `app/.server/services/interactions.ts` | 変更 | `setRecommendation`（おすすめ登録・解除・一言メモ更新）、`listRecommendations`、`recount` への `recommendCount` 追加 |
| `app/.server/services/admin.ts` | 変更 | `mergeEvents` で `eventTags`, `eventRecommendations`, `previousEventId` も統合先へ引き継ぐよう更新 |
| `app/.server/services/notifications.ts` | 変更 | `notifyNewEdition`（過去回をお気に入り・参加・おすすめしていたユーザーへの次回開催通知）を追加 |
| `app/.server/mcp/format.ts` | 新規 | イベント・シリーズ・活動報告・おすすめメモを MCP ツールレスポンス用に整形する純粋関数群 |
| `app/.server/mcp/server.ts` | 新規 | `McpServer` の生成と6つのツール（`search_events`, `get_event`, `recommend_events`, `list_categories_and_tags`, `search`, `fetch`）＋プロンプトの登録 |
| `app/.server/mcp/handler.ts` | 新規 | `/mcp` リクエストの CORS 処理、レート制限、`WebStandardStreamableHTTPServerTransport` 呼び出し |
| `app/.server/rate-limit.ts` | 変更 | `RateLimitKind` に `"mcp"`（`RL_MCP`）を追加 |
| `workers/app.ts` | 変更 | `/mcp` パスへのリクエストを `handleMcpRequest` にルーティング |
| `wrangler.jsonc` | 変更 | 開発・本番・プレビュー環境に `RL_MCP` バインディングを追加 |

### 4.2 クライアント・画面側（`app/routes/`・`app/components/`）
| ファイルパス | 区分 | 内容 |
| --- | --- | --- |
| `app/routes.ts` | 変更 | `/ai-connect` ルートを追加 |
| `app/routes/ai-connect.tsx` | 新規 | ChatGPT / Gemini / Claude への MCP 接続ガイド＆設定コピー画面 |
| `app/routes/events.tsx` | 変更 | タグ絞り込み、開催月フィルタ、「おすすめ順」ソート、募集中が少ないときの「過去の同系イベント」表示 |
| `app/routes/events.$id.tsx` | 変更 | タグ表示・追加UI、おすすめ保存＋一言メモUI、歴代開催回（シリーズ）表示、過去回の活動報告表示、「次回の開催を投稿する」ボタン |
| `app/routes/events.new.tsx` | 変更 | `?fromEventId=` からの引き継ぎ処理、過去回候補の自動検出パネル（「過去回と紐づけて投稿」） |
| `app/routes/events.$id.edit.tsx` | 変更 | タグ編集・追加、過去イベント紐づけ（`previousEventId`）の設定に対応 |
| `app/routes/me.tsx` | 変更 | 「おすすめ保存」タブを追加 |
| `app/routes/home.tsx` | 変更 | 「先輩おすすめの定番・過去イベント」セクションを追加 |
| `app/components/events/event-form.tsx` | 変更 | タグ入力（推奨タグチップ＋自由入力）と過去イベント紐づけ表示を追加 |
| `app/components/events/event-card.tsx` | 変更 | カード上にタグとおすすめ数を表示 |
| `app/components/events/duplicate-panel.tsx` | 変更 | 同一イベントの重複候補と「過去の開催回（別年度）候補」を区別し、「前回の開催として紐づけて投稿」ボタンを追加 |
| `app/components/site-footer.tsx` | 変更 | フッターに「外部AI連携（MCP）」リンクを追加 |

---

## 5. 実装ステップとテスト計画

実装は以下の4ステップで順番に進めます。各ステップ完了時に `npm run typecheck` と `npm test` が通る状態を維持します。

### Step 1: パッケージ整備と DB スキーマ・マイグレーション
1. `@modelcontextprotocol/sdk` と `@cfworker/json-schema` を `package.json` に正式追加。
2. `app/.server/db/schema.ts` を更新し、`npm run db:generate` でマイグレーション SQL を生成、推奨タグの初期データを追加して `npm run db:migrate:local` でローカル D1 に適用。

### Step 2: タグ機能・おすすめ保存・過去イベント検索の実装
1. `tags.ts` と `interactions.ts`（おすすめ登録・一言メモ）を実装。
2. `events.ts` の検索・ソート拡張（タグ・開催月・おすすめ順・同タグの過去イベント取得）。
3. イベント詳細・一覧・マイページ・ホーム画面の UI 更新。

### Step 3: 次回登録時の過去イベント紐づけ（シリーズ機能）の実装
1. `series.ts`（前後シリーズの取得、循環チェック、過去回候補の抽出）を実装。
2. `/events/new?fromEventId=...` の引き継ぎ機能と、投稿時の過去回自動候補パネル（`DuplicatePanel` 拡張）を実装。
3. イベント詳細画面での「歴代開催回」「過去回の活動報告・おすすめコメント」表示と、次回開催通知（`notifyNewEdition`）を実装。

### Step 4: MCP サーバー（`/mcp`）と AI 接続ガイド画面（`/ai-connect`）の実装
1. `app/.server/mcp/`（`format.ts`, `server.ts`, `handler.ts`）と `workers/app.ts` のルーティング、`wrangler.jsonc` のレート制限を実装。
2. `/ai-connect` ページとフッター導線を実装。
3. **ユニットテスト・結合テスト（`tests/`）の追加**:
   - タグ正規化・シリーズ循環防止・過去回判定のテスト
   - MCP の整形ロジック、および MCP Client SDK を使って `initialize` → `tools/list` → `tools/call`（`search_events`, `get_event`, `recommend_events` 等）が正常応答することのテスト
4. `npm test`、`npm run typecheck`、`npm run build` で本番ビルドまで検証。
