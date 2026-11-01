# Event Share 機能追加 計画書兼仕様書

- 作成: Opus 5.5
- 対象ブランチ: `main`（`09672df` 時点）
- 前提ドキュメント: [architecture.md](architecture.md)
- 状態: 計画（未実装）

## 0. 概要

次の 4 つを追加する。1〜3 は「毎年ある定番イベントの知見を、学年をまたいで引き継ぐ」ための一続きの機能で、4 はそれを外部の AI からも使えるようにするもの。

| # | 機能 | ひとことで |
| --- | --- | --- |
| A | 過去イベントのおすすめ | 参加した人が「これは良かった」と一言添えて残せる。終了後もおすすめ順で探せる |
| B | タグ | `#初心者歓迎` `#夏休み` のような特徴で横断的に探せる。「こういう系が過去にあった」をタグのページで見せる |
| C | 開催回のつながり（シリーズ） | 「第3回」を登録するときに「第2回」とつなげる。前回の活動報告・おすすめが新しい回から見える |
| D | MCP サーバー | ChatGPT・Gemini・Claude などから、イベントの検索・詳細・おすすめ・過去回を引ける |

### 0.1 この計画で解決したいこと

1. **終わったイベントの知見が消える。** 一覧の既定は「これから開催」なので、終了したイベントは検索条件を変えないと出てこない。活動報告は残っていても、次の学年がたどり着けない。
2. **カテゴリだけでは「どんなイベントか」が伝わらない。** カテゴリは管理者が管理する大分類（11 種）で、「初心者でも大丈夫か」「チームで出られるか」「いつごろ開催か」は説明文を読まないとわからない。
3. **毎年のイベントが毎年バラバラに登録される。** 重複判定（`scoreDuplicate`）は、西暦違い・120 日以上離れた同名イベントを「別の開催回」とみなして警告を弱めている。この判定はあるのに、つなげる手段がない。
4. **生徒が普段使っている AI から使えない。** サイト内の AI チャットはあるが、ChatGPT や Gemini で相談している生徒はこのサイトにたどり着かない。

### 0.2 スコープ外（今回はやらない）

- MCP 経由の書き込み（お気に入り登録・投稿など）。これには OAuth が必要で、Better Auth 1.7 には MCP 用 OAuth が同梱されていないため、別計画にする（§8 参照）。
- メール通知・Web Push。今回もサイト内通知のみ。
- 意味ベース検索（Vectorize）。タグとシリーズで、検索精度の問題の大部分は解消できる見込み。

---

## 1. 用語

| 用語 | 意味 |
| --- | --- |
| おすすめ（推薦） | 参加したイベントに対して「後輩にもすすめたい」と表明すること。任意で一言（ひとこと）を付ける。`event_recommendations` |
| 次回を待つ | 終了したイベントの「お気に入り」。新しい開催回がつながったときに通知を受け取る。テーブルは既存の `event_bookmarks` を使い回す |
| タグ | カテゴリより細かい、イベントの特徴。ユーザーが付けられる。`tags` / `event_tags` |
| シリーズ | 同じイベントの開催回の集まり（例: 「高校生AIハッカソン」）。`event_series` |
| 開催回 | シリーズに属する 1 つのイベント（例: 「高校生AIハッカソン 2026」）。`events.series_id` を持つ |
| 回ラベル | 開催回を区別する短い表示名（例: `2026`、`第5回`）。`events.edition_label` |

---

## 2. 機能 A: 過去イベントのおすすめ

### 2.1 仕様

**おすすめできる人・タイミング**

- ログインユーザーが、**終了したイベント**（`phase = ended`）、または自分が「参加した」にしているイベントに対しておすすめできる。
- おすすめすると、そのイベントの「参加した」も自動で ON になる。参加した人の声であることを保証するため（仮仕様、§9-1）。
- 1 人 1 イベント 1 件。ひとことは任意で、最大 200 文字。あとから編集・取り消しができる。

**表示**

- **イベント詳細**: アクション列に「おすすめ（N）」ボタンを追加する。説明文の下に「参加した人のおすすめ」セクションを設け、ひとことを新しい順に最大 20 件表示する。ひとことには表示名へのリンクと「報告」ボタンを付ける。
- **イベントカード**: おすすめが 1 件以上あれば、いいね数の隣に「おすすめ N」を表示する。
- **一覧（`/events`）**: 並び替えに「おすすめ順」を追加する。「終了したイベント」「すべて」を選んだときは、既定の並びをおすすめ順にする。
- **ホーム**: 「先輩のおすすめ（過去のイベント）」セクションを追加する。直近 2 年に終了し、おすすめが多いイベントを最大 6 件。各カードに「次回を待つ」への導線を付ける。
- **マイページ**: タブ「おすすめした（N）」を追加する。

**「次回を待つ」**

- 新しいテーブルは作らない。終了したイベントでは「お気に入り」ボタンのラベルを「次回を待つ」に変えるだけで、中身は `event_bookmarks` のまま。
- 既存の締切・開催日リマインダーは未来の日時だけを対象にしているので、終了したイベントのお気に入りが誤って通知を出すことはない。
- 新しい開催回がシリーズにつながったとき、この人たちに通知する（§4.5）。

**モデレーション**

- `REPORT_TARGETS` に `recommendation` を追加し、ひとことを報告できるようにする。
- 管理者は `/admin/comments` と同じ画面で、ひとことの非表示・削除ができる（タブ追加）。
- 本人が削除した場合は行ごと消す。管理者が非表示にした場合は `status = hidden` にする。非表示のおすすめは件数に含めない。

### 2.2 並び順の定義

おすすめ順のスコアは次の式とし、SQL で計算する。既存の「人気順」と同じく、非正規化した件数を使う。

```
recommend_count * 3 + bookmark_count + like_count
```

同点の場合は `start_at` が新しい順にする。新しい回ほど現在の状況に近いため。

### 2.3 開催月での絞り込み

一覧の絞り込みに「開催月」（1〜12 月、複数選択可）を追加する。「夏休み（7・8 月）にどんなイベントがあったか」を過去分から探すための機能で、`status = ended | all` と組み合わせて使う想定。

- 月は `APP_TIMEZONE` での開始日時の月とする。
- D1（SQLite）では `strftime('%m', start_at / 1000, 'unixepoch', '+9 hours')` のように時差を足して計算する。時差は `APP_TIMEZONE` から求める。Asia/Tokyo には夏時間がないので固定値で問題ないが、実装では関数に切り出し、タイムゾーンを変えたときに見直すことを関数のコメントに残す。

---

## 3. 機能 B: タグ

### 3.1 仕様

**タグの付け方**

- 1 イベントあたり最大 8 個。タグ名は 1〜20 文字。
- 投稿フォームと編集フォームに「タグ」欄を追加する。推奨タグ（§3.3）をチップで並べて選べるようにし、自由入力もできるようにする。入力中は既存タグを候補として出す（`/api/tags?q=` で前方一致、上位 10 件）。
- **投稿者・管理者**: タグの追加・削除ができる。
- **それ以外のログインユーザー**: 追加のみできる。既存の「情報を追加」と同じ考え方で、荒らしによる削除を防ぐ。追加は `event_contributions` に `type = add_info`、`changes.tags = { from, to }` として記録する。
- イベント詳細のタグ欄横に「＋タグ」ボタンを置き、その場で追加できるようにする（`useFetcher`）。

**表記ゆれ対策**

- `normalizeTagName()` で正規化した値を一意キーにする。処理は、NFKC 正規化 → 先頭の `#`・`＃` を除去 → 前後の空白を除去 → 英字を小文字化 → 連続する空白を 1 つにまとめる。
- 既存の `normalizeForMatch` は記号をすべて消してしまうため、タグには使わない。`C++` と `C` が同じタグになってしまうため。
- 表示名は最初に作った人の入力を使う。管理者が後から変更できる。

**管理**

- `/admin/tags` を追加する。タグ名の変更、統合（A を B にまとめる。`event_tags` の付け替えを 1 回のバッチで行う）、非表示（候補・一覧に出さない）ができる。
- 新しいタグの作成は、ユーザーごとのレート制限 `write` の対象にする。

### 3.2 タグのページ `/tags/:name`

「こういう系のイベントが過去にあった」を見せるための中心となる画面。`:name` は正規化したタグ名を URL エンコードしたもの。

| 区画 | 内容 |
| --- | --- |
| 見出し | `#初心者歓迎` と、イベント数（募集中 N 件・過去 M 件） |
| これから開催 | 終了していないイベントを開催日順に、最大 12 件 |
| 過去に開催されたイベント | 終了したイベントをおすすめ順に。同じシリーズは最新の回だけ出し、「全 N 回」と表示する |
| このタグのイベントの活動報告 | 過去イベントに付いた活動報告を新しい順に、最大 6 件 |
| よく一緒に付くタグ | 同時に付くことが多いタグを上位 8 件（関連タグへの回遊用） |

- 募集中が 0 件のときは、「今は募集中のイベントはありません。過去にはこんなイベントがありました」という文言で、過去の区画を上に出す。
- 一覧画面（`/events`）にも `tag` パラメータ（複数指定は AND）を追加する。イベントカードのタグは `/tags/:name` へリンクする。
- `/tags` にタグの一覧ページを置く。利用数の多い順に、推奨タグはグループ別に表示する。

### 3.3 推奨タグ（初期データ）

マイグレーションで投入する。`tags.group` で分類し、フォームのチップと `/tags` の見出しに使う。

| グループ | タグ |
| --- | --- |
| 参加しやすさ | 初心者歓迎、中学生OK、高校生向け、文系歓迎、ひとりで参加OK、チームで参加 |
| 形式 | 1日完結、複数日、宿泊あり、メンターあり、作品提出あり |
| 時期 | 春休み、夏休み、冬休み、土日開催、毎年開催 |
| 規模・特典 | 全国大会、予選あり、表彰あり、賞金あり、交通費補助あり |

### 3.4 AI によるタグ候補（任意機能）

URL からの取り込みで AI が有効なときは、**既存タグの中から**候補を最大 5 個選ばせ、フォームに「AI が推定・要確認」として初期選択する。新しいタグを作らせない点と、`ImportedDraft` の他の項目と同じく本文に根拠がある場合だけ採用する点は、既存の捏造防止方針と揃える。AI が使えないときは何もしない。

---

## 4. 機能 C: 開催回のつながり（シリーズ）

### 4.1 データの持ち方

前回・次回のイベントを直接指す「数珠つなぎ」ではなく、**シリーズを独立したテーブルとして持ち、各開催回がシリーズに属する**形にする。

```
event_series (高校生AIハッカソン)
  ├─ events (2024, edition_label="2024")
  ├─ events (2025, edition_label="2025")
  └─ events (2026, edition_label="2026")  ← 募集中
```

この形を選ぶ理由:

- 全回の一覧を 1 回のクエリで取れる（`WHERE series_id = ?`）。数珠つなぎだと再帰クエリが必要になる。
- 循環参照が構造上起こらない。
- 途中の回が非公開・統合されても、つながりが切れない。
- シリーズ単位のページ（§4.4）、活動報告やおすすめのシリーズ全体での集計が簡単になる。

並び順は `start_at` で決め、開始日時が未設定の回は最後に置く。`edition_label` は表示用で、並びには使わない。

### 4.2 次の回を登録する 3 つの入口

**入口 1: 過去のイベントから「次の回を登録」（主導線）**

- 終了または受付終了のイベント詳細に、「この次の回を登録する」ボタンを置く。
- 遷移先は `/events/new?nextOf=<eventId>`。フォームを次のように初期化する。

| 項目 | 扱い | バッジ |
| --- | --- | --- |
| イベント名 | 西暦を +1、`第N回` を N+1 にした案を入れる（`suggestNextTitle()`） | 前回から引き継ぎ・要確認 |
| 説明・主催・対象者・形式・場所・参加費・カテゴリ・タグ | そのまま引き継ぐ | 前回から引き継ぎ・要確認 |
| 公式サイト URL | 引き継ぐ（年ごとにページが変わることが多いため要確認） | 前回から引き継ぎ・要確認 |
| 応募フォーム URL | 引き継がない（年ごとに変わり、古いフォームへの誘導は害が大きい） | — |
| 開催日時・終了日時・締切 | 空にする | — |
| 画像 | 引き継がない（ポスターは年ごとに違うため） | — |

- バッジは `EventForm` の既存の `FieldSource`（「ページから取得」「AIが推定・要確認」など）に `previous` を足して表示する。新しい仕組みは作らない。
- フォーム上部に「『高校生AIハッカソン 2025』の次の回として登録します」というバナーと「つなげずに登録する」リンクを出す。シリーズの指定は hidden の `seriesFromEventId` で送る。
- この画面でも「URL から取得」は使える。取得した値は引き継いだ値より優先し、取得できなかった項目だけ引き継いだ値を残す。
- 重複判定では `nextOf` のイベントを候補から外す。開始日時が未入力のまま送ると、同名なので「重複の可能性が高い」と出てしまうため。

**入口 2: 新規投稿時に過去の回を自動で提案**

- 通常の投稿で重複候補を探すのと同時に、`findPreviousEditionCandidates()` で過去の回の候補を探す。
- 候補があれば、重複パネルとは別の「過去の開催回かもしれません」パネルを出す。ボタンは「この回の次として登録する」「関係ない」の 2 つ。
- 判定方法（重複判定とは別の関数にする）:
  1. タイトルから開催回の表記を取り除く（`stripEditionMarkers()`）。対象は西暦、`第N回`、`Vol.N`、`20XX年度`、`#N`、全角数字の同等表記。
  2. 母集団は、公開中で、開始日時が入力された日時の 60 日以上前〜6 年前のイベント、または公式 URL のドメインとパスの先頭が一致するイベント。上限 500 件。学校規模のデータ量なので JS 側で採点する。
  3. 採点は「除去後のタイトルの Dice 係数 × 0.7 + 主催者の Dice 係数 × 0.3」とし、0.75 以上を候補にする。公式 URL が一致すれば +0.15。上位 3 件を出す。
  4. 候補がすでにシリーズに属していれば、そのシリーズの最新回を代表として出す。
- 入口 2 でつなぐ場合、フォームの値は書き換えない。ユーザーがすでに入力しているため。

**入口 3: あとからつなぐ**

- 編集画面に「開催回のつながり」欄を追加する。過去のイベントをタイトルで検索して選ぶ（`/api/events/lookup?q=`、上位 10 件）。
- **投稿者・管理者**: つなぐ・外すができる。
- **それ以外のログインユーザー**: シリーズ未設定のイベントに限り、つなぐことだけができる（「未設定の項目を埋める」という既存ルールに合わせる）。
- 変更は `event_contributions` に `changes.series` として記録する。

### 4.3 つなぐ処理（`linkToSeries`）

`linkToSeries(db, eventId, anchorEventId, userId)` を `services/series.ts` に置き、1 回の D1 バッチで実行する。

1. 基準のイベント（anchor）がシリーズに属していれば、そのシリーズに入れる。
2. 属していなければ、新しいシリーズを作る。シリーズ名は `stripEditionMarkers(anchor.title)` の結果（空になる場合は元のタイトル）とし、anchor と対象の両方を入れる。
3. 対象がすでに別のシリーズに属していて、権限上外せない場合は拒否する。管理者の場合は「シリーズの統合」（§4.6）を案内する。
4. `edition_label` が空なら、タイトルの西暦または開始年から自動で入れる。

### 4.4 表示

**イベント詳細（シリーズに属する場合）**

- 右カラムに「開催回」ボックスを置く。全回を新しい順に「2026 募集中 / 2025 終了 おすすめ 4 / 2024 終了」のように並べ、現在の回を強調する。
- 自分より新しい公開中の回がある場合は、ページ上部に「このイベントの新しい回（2026）があります」というお知らせを出す。終了した回を開いた人を最新の回に誘導するため。
- 「関連する活動報告」セクションは「この回の活動報告」と「過去の回の活動報告」に分ける。過去の回は新しい順に最大 6 件で、各カードに回ラベルを付ける。
- 「参加した人のおすすめ」も同様に、過去の回の分を「前回までのおすすめ」として最大 5 件出す。

**シリーズのページ `/series/:id`**

- シリーズ名、全回の一覧（回ラベル・開催日・状態・おすすめ数・活動報告数）、シリーズ全体の活動報告、おすすめのひとことを載せる。
- 「次の回を登録する」ボタンを置く（最新回を `nextOf` にする）。
- シリーズ名と説明は、シリーズ内の回の投稿者と管理者が編集できる。

### 4.5 次の回の通知

- 通知の種類に `new_edition` を追加し、設定画面で ON/OFF できるようにする（`notification_settings.new_edition`、既定 ON）。
- **タイミング**: シリーズに新しい回がつながり、かつその回が公開中で終了していないとき。投稿時でもあとからつないだときでも送る。
- **送り先**: 同じシリーズの他の回に対して、お気に入り（＝次回を待つ）・参加・おすすめのいずれかをしているユーザー。つないだ本人は除く。
- **文面**: 「『高校生AIハッカソン』の新しい回（2026）が登録されました」。リンク先は新しい回。
- **重複防止**: `dedupe_key = new_edition:<eventId>:<userId>`。
- **配信**: 既存の `notifyNewEvent` と同じく `waitUntil` で非同期に送る。同じ人に `new_event`（興味分野の新着）も届く場合は、`new_edition` を優先して `new_event` は送らない。

### 4.6 既存機能への影響

| 既存機能 | 必要な対応 |
| --- | --- |
| 統合（`mergeEvents`） | 統合元と統合先のシリーズが同じか、統合先に無い場合は統合先に引き継ぐ。異なる場合は統合先を優先し、統合元のシリーズは他の回が残っていればそのまま残す。おすすめ・タグは、いいねと同じ「重複を消してから付け替える」方式で移す。1 回のバッチで行う |
| 重複判定 | 判定ロジックは変えない。`nextOf` の除外（§4.2）だけ追加する |
| 非公開化 | 非公開の回は、シリーズの一覧には投稿者・管理者以外に出さない。シリーズは消さない |
| シリーズの統合 | 管理画面 `/admin/series` で、シリーズ A をシリーズ B にまとめられるようにする（`series_id` を付け替えて A を削除） |
| ICS 出力 | 変更なし |

---

## 5. 機能 D: MCP サーバー

### 5.1 方針

- エンドポイントは `/mcp`（Streamable HTTP）。
- 公式 SDK `@modelcontextprotocol/sdk` の `WebStandardStreamableHTTPServerTransport` を、**ステートレス**（`sessionIdGenerator: undefined`）かつ **JSON 応答**（`enableJsonResponse: true`）で使う。リクエストごとに `McpServer` を作って捨てるので、Durable Objects は不要。
- `GET` と `DELETE` には `405` を返す。サーバーから通知を送る必要がないため。
- JSON Schema の検証には `CfWorkerJsonSchemaValidator`（`@cfworker/json-schema`）を明示的に渡す。SDK 既定の Ajv は実行時にコードを生成するため、Workers では動かない。
- **認証なし・読み取り専用**とする。サイトの「閲覧・検索・AI チャットはログイン不要」と同じ扱いにする。全ツールに `readOnlyHint: true`、`openWorldHint: false` を付ける。

### 5.2 ツール

| ツール | 入力 | 出力 | 中身 |
| --- | --- | --- | --- |
| `search_events` | `query`, `categories[]`, `tags[]`, `status`（upcoming/ended/all）, `months[]`, `from`, `to`, `deadline`, `format`, `fee`, `location`, `sort`（start/deadline/popular/recommended/new）, `page` | イベント要約の配列、総件数、ページ数 | `searchEvents()`。§2・§3 で追加する絞り込み・並び替えをそのまま使う |
| `get_event` | `id` | 詳細、タグ、出典 URL、シリーズ（全回の要約）、おすすめのひとこと（最大 5 件）、活動報告の要約（最大 5 件） | 統合済みの ID なら統合先を返す。非公開は「見つかりません」 |
| `recommend_events` | `categories[]`, `keywords[]`, `tags[]`, `style`, `format`, `fee`, `period`, `participation`, `includePast`（既定 false）, `limit`（最大 10） | 推薦の配列（イベント要約 + DB の事実に基づく理由 `matched[]`）。`includePast` が true なら「過去の定番（次の回を待つ候補）」も別配列で返す | 既存の `loadCandidates()` と `rankEvents()` を使う。理由は `ruleReason()` のみ。こちらの LLM（Groq）は呼ばない（会話は呼び出し側の AI が担当するので二重になり、捏造のリスクも増えるため） |
| `get_series` | `id`（シリーズ ID またはイベント ID） | シリーズ名、全回の一覧、シリーズ全体のおすすめ・活動報告の要約 | §4.4 と同じデータ |
| `list_categories` | なし | `slug`・名前・説明 | AI が `categories` に正しい値を入れるため |
| `list_tags` | `group?`, `limit?` | タグ名・グループ・利用数 | AI が `tags` に正しい値を入れるため |
| `search` | `query` | `{ results: [{ id, title, url }] }` | ChatGPT の Deep Research・コネクタが前提にしている形 |
| `fetch` | `id` | `{ id, title, text, url, metadata }` | 同上。`text` は詳細を読みやすいプレーンテキストにしたもの |

**出力の共通ルール**（`mcp/format.ts` の純粋関数にまとめる）

- 日時は ISO 8601（UTC）と、`APP_TIMEZONE` で整形した日本語表記（例: `2026年11月3日(火) 13:00`）の両方を返す。
- `url` は絶対 URL（`<origin>/events/<id>`）。origin はリクエストの URL から取る。
- 状態（`phase`）は英語の値と日本語ラベルの両方を返す。
- 未登録の項目は `null` とし、「不明（未登録）」と明示する。AI が推測で埋めないようにするため。
- 返すのは公開情報のみ。メールアドレス・学年・プロフィールは含めない。ひとこと・活動報告の投稿者名も含めない（外部サービスに生徒の表示名を流さないため）。
- `content` には要約テキストを、`structuredContent` には JSON を入れる。

**プロンプト**: `find_events`（引数: 学年、興味、時期）を 1 つ登録する。「募集中と過去の定番の両方を調べ、締切と公式 URL を必ず添える」よう指示するテンプレート。

### 5.3 実装の構成

```
app/.server/mcp/
  format.ts    イベント・シリーズ → MCP 出力の整形（純粋関数、テスト対象）
  tools.ts     ツール定義。データ取得関数を引数で受け取る（テストで差し替え可能にするため）
  server.ts    createMcpServer(deps) → McpServer（ツール・プロンプトを登録）
  handler.ts   handleMcpRequest(request): CORS、メソッド判定、レート制限、トランスポート接続
workers/app.ts  pathname が /mcp のとき、CSRF 判定より前に handleMcpRequest へ渡す
```

### 5.4 セキュリティと運用

- **CSRF**: `/mcp` は Cookie を読まず、サイトのセッションも参照しないので、`isCrossSiteMutation` の対象から外す。`/mcp` へのリクエストで `Cookie` ヘッダーが届いても無視する。
- **CORS**: ブラウザ上で動く MCP クライアント（MCP Inspector など）のために、`/mcp` だけ次のヘッダーを付ける。認証情報を使わないので `*` で問題ない。
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Methods: POST, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id`
- **レート制限**: `RL_MCP` バインディングを開発・本番・プレビューの 3 環境に追加する（IP ごとに 60 回/分）。超えた場合は JSON-RPC のエラーで返す。
- **入力**: Zod で上限を設ける（文字列 100 文字、配列 10 件、`page` 50 まで）。
- **ログ**: ツール名・所要時間・件数のみを構造化ログに出す。検索語はログに出さない。
- **CSP**: `/mcp` は HTML を返さないので、既存の `applySecurityHeaders` をそのまま通してよい。

### 5.5 接続ガイド `/ai-connect`

- 接続 URL（`<origin>/mcp`）を表示し、コピーボタンを付ける。
- クライアント別の手順を載せる。各 AI の画面は頻繁に変わるため、ボタン名などは断定しすぎず、公式ドキュメントへのリンクを添える。
  - **ChatGPT**: 開発者モードを有効にし、カスタムコネクタ（アプリ）を作成する。URL を指定し、認証は「なし」。
  - **Gemini**: Gemini CLI の `~/.gemini/settings.json` に `mcpServers.eventshare.httpUrl` を書く例を載せる。Gemini API の SDK から使う方法も載せる。一般向けの Gemini アプリはカスタム MCP に未対応の場合があることも明記する。
  - **Claude / Cursor**: カスタムコネクタ、または `mcp.json` の設定例を載せる。
- 質問の例を載せる（「夏休みに無料で出られるプログラミング系のイベントは？過去の定番も教えて」など）。
- ローカル（`localhost`）では ChatGPT などから接続できないことを書く。確認方法として、デプロイするか `cloudflared` のトンネルを使う方法を案内する。
- フッターと `/chat` 画面からリンクする。

---

## 6. データモデルの変更

マイグレーションは 2 本に分ける。既存の `0000_init` / `0001_seed_categories` と同じ構成にするため。

- `0002_series_tags_recommendations.sql`: drizzle-kit で生成する
- `0003_seed_tags.sql`: 推奨タグの投入。手書き

### 6.1 新しいテーブル

**`event_series`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | text PK | UUID |
| `title` | text not null | 例: 高校生AIハッカソン |
| `normalized_title` | text not null | 開催回の表記を除いて `normalizeForMatch` したもの。候補検索に使う |
| `description` | text | 任意 |
| `created_by_id` | text → user（削除時 set null） | |
| `created_at` / `updated_at` | timestamp_ms | |

インデックス: `event_series_normalized_title_idx`

**`tags`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | integer PK autoincrement | |
| `name` | text not null | 表示名 |
| `normalized_name` | text not null unique | `normalizeTagName()` の結果 |
| `group` | text | `access` / `format` / `season` / `scale` / null（ユーザーが作ったタグ） |
| `status` | text enum(`active`, `hidden`) | 既定 `active` |
| `usage_count` | integer not null default 0 | 非正規化。タグ一覧・候補の並びに使う |
| `created_by_id` | text → user（削除時 set null） | |
| `created_at` | timestamp_ms | |

**`event_tags`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `event_id` | text → events（削除時 cascade） | 複合 PK |
| `tag_id` | integer → tags（削除時 cascade） | 複合 PK |
| `added_by_id` | text → user（削除時 set null） | |
| `created_at` | timestamp_ms | |

インデックス: `event_tags_tag_idx (tag_id)`

**`event_recommendations`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `user_id` | text → user（削除時 cascade） | 複合 PK |
| `event_id` | text → events（削除時 cascade） | 複合 PK |
| `comment` | text | 最大 200 文字 |
| `status` | text enum(`visible`, `hidden`) | 既定 `visible` |
| `created_at` / `updated_at` | timestamp_ms | |

インデックス: `event_recommendations_event_idx (event_id, created_at)`

### 6.2 既存テーブルへの追加

| テーブル | 列 | 備考 |
| --- | --- | --- |
| `events` | `series_id` text → event_series（削除時 set null） | インデックス `events_series_start_idx (series_id, start_at)` |
| `events` | `edition_label` text | 最大 30 文字 |
| `events` | `recommend_count` integer not null default 0 | インデックス `events_status_recommend_idx (status, recommend_count)` |
| `notification_settings` | `new_edition` integer(boolean) not null default 1 | |

以下はどれも `text` 列の値の追加で、Drizzle の型（TypeScript）を変えるだけでよく、DB の変更は不要。

- `NOTIFICATION_TYPES` に `new_edition`
- `REPORT_TARGETS` に `recommendation`
- `EVENT_FIELD_LABEL` に `tags`・`series` の表示名

### 6.3 件数の再集計

既存の `recount()`（`services/interactions.ts`）に `recommend_count` を追加する。`status = visible` のものだけを数える。`tags.usage_count` は付与・削除時に、該当タグだけを再集計する。

---

## 7. 変更するファイル

### 7.1 サーバー

| ファイル | 内容 |
| --- | --- |
| `app/.server/db/schema.ts` | §6 のテーブル・列 |
| `app/.server/validation/event.ts` | `tags`（最大 8）、`seriesFromEventId`、`editionLabel` |
| `app/.server/validation/interaction.ts` | おすすめのひとこと（200 文字） |
| `app/lib/edition.ts`（新規） | `stripEditionMarkers()`、`suggestNextTitle()`、`editionLabelFrom()`。純粋関数で、クライアントとサーバーの両方から使う |
| `app/lib/tags.ts`（新規） | `normalizeTagName()` |
| `app/.server/services/tags.ts`（新規） | 付与・削除・候補・タグのページ用の取得・統合 |
| `app/.server/services/series.ts`（新規） | `linkToSeries`、`unlinkFromSeries`、`getSeriesWithEditions`、`findPreviousEditionCandidates`、シリーズの統合 |
| `app/.server/services/recommendations.ts`（新規） | おすすめの登録・取り消し・一覧・非表示 |
| `app/.server/services/events.ts` | 検索条件（`tag`・`months`・`sort=recommended`）、`EventCard` に `tags`・`recommendCount`・`editionLabel` を追加、作成・編集時のタグとシリーズ |
| `app/.server/services/interactions.ts` | `recount()` に `recommend_count` |
| `app/.server/services/admin.ts` | `mergeEvents` の対応（§4.6）、タグ・シリーズの管理 |
| `app/.server/services/notifications.ts` | `notifyNewEdition()`、`SETTING_COLUMN` に `new_edition` |
| `app/.server/chat/engine.ts` | `loadCandidates` を export する。0 件のときに過去の定番を「次回を待つ」候補として返す（§7.3） |
| `app/.server/chat/rank.ts` | `RankableEvent` に `tagNames` を追加し、キーワードがタグ名と一致したら加点する |
| `app/.server/url-import/*` | AI によるタグ候補（§3.4、任意機能） |
| `app/.server/mcp/*`（新規） | §5.3 |
| `app/.server/rate-limit.ts` | `mcp` を追加 |
| `workers/app.ts` | `/mcp` の振り分け |
| `wrangler.jsonc` | `RL_MCP`（3 環境） |

### 7.2 画面

| ファイル | 内容 |
| --- | --- |
| `app/routes.ts` | `tags`、`tags/:name`、`series/:id`、`ai-connect`、`api/tags`、`api/events/lookup`、`admin/tags`、`admin/series` |
| `app/routes/events.$id.tsx` | おすすめ、タグ、開催回ボックス、新しい回のお知らせ、過去の回の活動報告・おすすめ、「次の回を登録する」 |
| `app/routes/events.new.tsx` | `?nextOf=`、過去の回の候補パネル |
| `app/routes/events.$id.edit.tsx` | タグ、開催回のつながり、回ラベル |
| `app/routes/events.tsx` | タグ・開催月の絞り込み、おすすめ順 |
| `app/routes/home.tsx` | 先輩のおすすめセクション |
| `app/routes/me.tsx` | 「おすすめした」タブ |
| `app/routes/settings.tsx` | `new_edition` の通知設定 |
| `app/routes/tags.tsx` / `tags.$name.tsx` / `series.$id.tsx` / `ai-connect.tsx`（新規） | §3.2 / §4.4 / §5.5 |
| `app/routes/admin/tags.tsx` / `admin/series.tsx`（新規） | タグ・シリーズの管理 |
| `app/components/events/event-form.tsx` | タグ入力、`FieldSource` に `previous` |
| `app/components/events/event-card.tsx` | タグ（最大 3）、おすすめ数、回ラベル |
| `app/components/events/edition-panel.tsx`（新規） | 過去の回の候補パネル |
| `app/components/events/series-box.tsx`（新規） | 開催回ボックス |
| `app/components/events/tag-input.tsx`（新規） | 推奨タグのチップ・候補表示付きの入力 |
| `app/components/site-footer.tsx` | 「タグから探す」「AI アプリとつなぐ」 |

### 7.3 AI チャットとの連携

- 条件に合う募集中のイベントが 0 件のとき、今は「条件を広げましょう」とだけ返している。これに、同じ条件に合う**過去の定番イベント**（終了したもの、おすすめ順、最大 3 件）を「次の回を待てるイベント」として添える。
- カードには「次回を待つ」ボタンを付け、終了したイベントであることを明示する。
- 推薦理由は既存の事実ベースのルール（`ruleReason`）に「過去に N 人がおすすめ」を加える。

---

## 8. 実装の進め方

各ステップの終わりに `npm run typecheck`・`npm test`・`npm run build` が通ることを確認する。ステップごとに PR を分ける。

| Step | 内容 | 完了の条件 |
| --- | --- | --- |
| 1 | スキーマ・マイグレーション・純粋関数（`edition.ts`・`tags.ts`）とそのテスト | ローカルの D1 にマイグレーションが適用でき、既存画面が今まで通り動く |
| 2 | タグ（付与・検索・タグのページ・管理画面） | 投稿・編集・詳細でタグを付けられ、`/tags/:name` で募集中と過去の両方が出る |
| 3 | おすすめ（登録・表示・並び順・報告・マイページ・ホーム） | 終了したイベントにおすすめを付けられ、一覧のおすすめ順に反映される。非表示にすると件数から消える |
| 4 | シリーズ（3 つの入口・表示・シリーズのページ・通知・統合への対応） | 過去のイベントから次の回を登録すると値が引き継がれ、「次回を待つ」の人に通知が 1 回だけ届く |
| 5 | MCP サーバーと `/ai-connect` | MCP Inspector で `tools/list` と全ツールの呼び出しが通る。ChatGPT（開発者モード）と Gemini CLI からプレビュー環境に接続して検索できる |
| 6 | AI チャットとの連携、AI のタグ候補（任意機能） | 0 件のときに過去の定番が出る |

MCP を最後にするのは、タグ・おすすめ・シリーズのデータを最初から返せるようにするため。MCP を先に使いたい場合は、Step 5 を Step 1 の直後に回してもよい。その場合はまず既存の検索・詳細・推薦だけで出し、あとから項目を足す。ツールの出力は項目の追加だけなら互換性が保たれる。

**今後（別計画）**: MCP の書き込みツール。`@better-auth/oauth-provider` を導入し、OAuth のテーブル・同意画面を用意したうえで、「お気に入りに追加」「自分の締切一覧」「次回を待つ」を AI から使えるようにする。

---

## 9. テスト

既存の方針（純粋関数のユニットテスト、`tests/*.test.ts`、Workers ランタイムなし）に合わせる。

| ファイル | 内容 |
| --- | --- |
| `tests/edition.test.ts` | `stripEditionMarkers`（西暦・`第N回`・全角・年度・Vol）、`suggestNextTitle`（2025→2026、第4回→第5回、何も無い場合は変更なし）、`editionLabelFrom` |
| `tests/tags.test.ts` | `normalizeTagName`（`#`・全角・大小文字・`C++` を残す）、上限 |
| `tests/series.test.ts` | 過去の回の候補の採点（同シリーズの別年は候補になる、別イベントの同年は候補にならない、URL 一致の加点） |
| `tests/mcp.test.ts` | `format.ts` の出力（絶対 URL・二通りの日時表記・未登録は `null`・投稿者名を含まない）。データ取得関数を差し替えた `createMcpServer` に SDK の `Client` と `InMemoryTransport` でつなぎ、`initialize` → `tools/list` → 各ツールの呼び出しを確認する |
| `tests/chat.test.ts`（追記） | タグ名の一致による加点 |

手動で確認すること:

- ローカルで `npx @modelcontextprotocol/inspector` を使い、`http://localhost:5173/mcp` に接続する。
- プレビュー環境で ChatGPT と Gemini CLI から接続する。

---

## 10. 要確認事項（仮で決めた仕様）

1. **おすすめできる人**: 「参加した人のみ（押すと参加済みになる）」としている。参加していなくても「良さそう」と押せるようにするか。
2. **おすすめの表示名**: ひとことには表示名を出している（コメントと同じ）。匿名（「参加した生徒」）を選べるようにするか。
3. **タグの作成**: 誰でも新しいタグを作れるようにしている。荒れる場合は「推奨タグのみ＋管理者が追加」に切り替える。
4. **シリーズのつなぎ込み**: 投稿者以外もシリーズ未設定のイベントをつなげられるようにしている。誤ってつながれた場合は投稿者・管理者が外せる。
5. **MCP を誰でも使えるようにすること**: 公開中のイベント情報はもともと未ログインで見られるため、認証なしにしている。学校外から AI 経由で使われること自体を制限したい場合は、共有トークン（`Authorization: Bearer`）の方式に切り替える。ChatGPT・Gemini CLI はどちらもヘッダー指定に対応している。
6. **外部の AI に渡す範囲**: ひとこと・活動報告の本文の要約は渡すが、投稿者名は渡さない。本文自体も渡さないほうがよいか。

---

## 11. リスクと対策

| リスク | 対策 |
| --- | --- |
| 過去の回の自動提案が的外れ | 閾値を `app_settings` に置き、重複判定と同じく管理画面で調整できるようにする。提案は強制せず、「関係ない」で閉じられる |
| タグの乱立 | 推奨タグを先頭に出し、候補表示で既存タグへ誘導する。管理画面での統合、利用数 1 のタグを候補に出さない |
| 古い応募フォームへの誘導 | 応募フォーム URL は引き継がない。引き継いだ公式 URL には「要確認」を付ける |
| MCP の過剰な呼び出し | `RL_MCP`、ページあたりの件数上限、ステートレスのため Worker 側に状態が残らない |
| 外部 AI が日付・締切を誤って伝える | ツールの出力に二通りの日時表記と絶対 URL を必ず入れ、ツールの説明文に「締切・日程は公式サイトで確認するよう伝えること」と書く |
| 開催月の計算でタイムゾーンを取り違える | 月の計算を 1 つの関数に閉じ込め、テストで境界（月末 23:30 JST）を確認する |
