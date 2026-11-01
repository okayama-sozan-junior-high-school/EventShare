# Event Share 機能追加 計画書兼仕様書

- 作成: Fable 5.1
- 基準コミット: `09672df`（`main`）
- 前提: [architecture.md](architecture.md) の設計原則（サーバー側での権限検証、`.server` の分離、UTC ミリ秒保存、AI 出力の検証と捏造防止）を引き継ぐ
- 状態: 計画。コードは未変更

---

## 1. この計画の中心にある考え方

追加したいのは次の 4 つです。

1. 過去のイベントを「おすすめ」として残し、あとから見返せるようにする
2. タグを付けて「こういう系のイベントが過去にあった」を見られるようにする
3. 次の回を登録するとき、過去の回と結びつけられるようにする
4. MCP で ChatGPT・Gemini などから使えるようにする

この 4 つを別々の機能として積むのではなく、**「イベントには『回』と『シリーズ』がある」という 1 つの考え方**に乗せます。

- 今の `events` の 1 行は「2025 年の第 4 回」のような **1 回分（回）** です。
- その上に **シリーズ**（「高校生 AI ハッカソン」というイベントそのもの）を置きます。
- **すべてのイベントは必ずどれかのシリーズに属します。** 単発のイベントは、回が 1 つしかないシリーズです。

こうすると、各機能は次のように素直に収まります。

| やりたいこと | シリーズの考え方での置き場所 |
| --- | --- |
| 次の回を過去の回とつなぐ | 新しい回を、過去の回と同じシリーズに入れる |
| 「次が出たら知りたい」 | シリーズをウォッチする（回ではなく） |
| 「こういう系が過去にあった」 | タグで探した結果を、回ではなくシリーズ単位で見せる（同じイベントの 2024・2025 が並ばない） |
| 「毎年開催」「例年 8 月ごろ」 | タグで付けるのではなく、シリーズの回の履歴から**自動で算出**する |
| 「そろそろ募集が始まりそう」 | 例年の募集時期が近いのに今年の回がまだ無いシリーズを出す |
| MCP で外部 AI に答えさせる | 回の情報に加えて、シリーズの履歴（例年の時期・過去の回数・おすすめ）を返す |

「おすすめ」だけは**回**に付けます。「2025 年に参加した人の感想」は、その年の運営や内容についてのものだからです。表示するときにシリーズ単位で集計します。

### 1.1 やらないこと

- MCP からの書き込み（お気に入り、投稿）。認証（OAuth）が必要で、Better Auth 1.7 系には MCP 向けの OAuth が同梱されていないため、別の計画にします。
- メール・プッシュ通知。サイト内通知のみです。
- 過去のイベントの一括取り込み（スクレイピング）。登録は今まで通り生徒が行います。

---

## 2. 機能仕様

### 2.1 シリーズと回

**用語**

| 用語 | 意味 | テーブル |
| --- | --- | --- |
| シリーズ | 繰り返し開催されるイベントの「正体」。名前と履歴を持つ | `event_series`（新規） |
| 回 | 1 回分の開催。今の `events` の 1 行 | `events`（`series_id` を追加） |
| 回ラベル | 回を区別する表示名。`2025`、`第4回` など | `events.edition_label` |

**シリーズから自動で算出する値**（保存せず、表示時に計算します。学校規模のデータ量を想定）

| 値 | 計算方法 | 使いどころ |
| --- | --- | --- |
| 回数 | 公開中の回の数 | 「全 4 回」バッジ、MCP の出力 |
| 開催周期 | 回が 2 つ以上あり、開始日の間隔がどれも 10〜14 か月なら「毎年」。5〜7 か月なら「年 2 回」。それ以外は表示しない | 「毎年開催」バッジ |
| 例年の開催時期 | 公開中の回の開始月（`APP_TIMEZONE`）の最頻値 | 「例年 8 月ごろ」 |
| 例年の募集開始時期 | 各回の `created_at` と `application_deadline` から、締切の最頻月と、登録された月の最頻値 | 「そろそろ募集」判定 |
| 最新の回 | `start_at` が最も新しい公開中の回（未設定は最後） | シリーズページの代表、ウォッチの通知先 |

「毎年開催」をタグにしないのは、人が付け忘れたり、1 回しかないイベントに付いてしまったりするからです。回の履歴から出せば、常に実態と一致します。

**シリーズページ `/series/:id`**

- シリーズ名、説明（任意）、周期・例年の時期のバッジ
- 回の一覧（年表形式）。回ラベル・開催日・状態（募集中／終了）・おすすめ数・活動報告数。現在募集中の回は先頭で強調
- シリーズ全体のおすすめ（回ごとにまとめて表示）
- シリーズ全体の活動報告
- 「ウォッチする」ボタン（§2.3）
- 「次の回を登録する」ボタン（§2.4 の入口 1 へ）
- シリーズ名と説明は、いずれかの回の投稿者と管理者が編集できる

**イベント詳細への追加**

- 回が 2 つ以上あるシリーズなら、右カラムに「このイベントの他の回」ボックスを出す（年表の短縮版、最大 5 件＋「すべて見る」）
- 終了した回を開いていて、より新しい公開中の回があるときは、ページ最上部に「新しい回（2026）が登録されています」の案内を出す
- 終了した回を開いていて、新しい回がまだ無く、例年の募集時期が近いときは「例年 6 月ごろに募集が始まっています。ウォッチすると登録されたときに通知します」と出す
- 「関連する活動報告」を「この回」と「他の回」に分けて表示する

### 2.2 おすすめ（過去のイベントを残す）

**何を残すか**

「いいね」と違い、**参加した人が、あとから来る人のために残す評価**です。自由記述だけだと読み手が比較しにくいので、**構造化した 1 項目＋任意の一言**にします。

| 項目 | 内容 | 必須 |
| --- | --- | --- |
| 向いている人 | `初めてでも大丈夫` / `経験者向け` / `誰にでも` の 3 択 | 必須 |
| 一言 | 最大 200 文字。「何が良かったか」「気をつけること」など | 任意 |

3 択にする理由は、「初心者でも大丈夫か」がこのサイトの利用者（中高生）にとって最初の分かれ目だからです。集計すると「参加した 5 人のうち 4 人が『初めてでも大丈夫』」のように、一覧でも一目でわかる形になります。

**できる人と条件**

- ログインユーザー。
- 対象は、**終了した回**（`phase = ended`）、または自分が「参加した」にしている回。
- おすすめすると「参加した」も自動で付く。参加した人の声であることを担保するため。
- 1 人 1 回につき 1 件。編集・取り消しができる。

**表示**

| 場所 | 内容 |
| --- | --- |
| イベント詳細 | アクション列に「おすすめ（N）」。説明の下に「参加した人のおすすめ」セクション。3 択の集計バー＋一言の一覧（新しい順、最大 20 件）。各一言に表示名と「報告」 |
| イベントカード | おすすめが 1 件以上あれば「おすすめ N」。3 択の最多が `初めてでも大丈夫` なら緑の小バッジを付ける |
| シリーズページ | 回ごとにまとめた集計と一言 |
| 一覧（`/events`） | 並び替えに「おすすめ順」。「終了したイベント」を選んだときの既定の並びにする |
| ホーム | 「先輩のおすすめ」セクション。終了した回のうちおすすめ数が多いものを、シリーズ単位で重複を除いて最大 6 件 |
| マイページ | タブ「おすすめした（N）」 |

**おすすめ順の定義**

```
endorsement_count * 3 + bookmark_count + like_count   （同点なら start_at が新しい順）
```

`endorsement_count` は `events` に非正規化し、既存の `recount()` に加えます。管理者が非表示にしたものは数えません。

**モデレーション**

- 報告対象（`REPORT_TARGETS`）に `endorsement` を追加
- 管理画面のコメント一覧（`/admin/comments`）にタブを足し、非表示にできる
- 本人の取り消しは行を削除。管理者の非表示は `status = hidden`

### 2.3 ウォッチ（次が出たら知りたい）

- **シリーズ**に対して行います。テーブルは `series_watches`。
- 「お気に入り（`event_bookmarks`）」は今まで通り「この回に応募・参加するつもり」の意味で残します。終了した回では「お気に入り」ボタンを隠し、代わりに「次の回をウォッチ」を出します。
- 単発（回が 1 つ）のイベントもウォッチできます。すべてのイベントがシリーズを持つので、特別扱いはいりません。
- 通知は次のときに送ります。
  1. ウォッチしているシリーズに、新しい公開中の回が追加された（投稿時、またはあとから結びつけたとき）
  2. 例年の募集時期の 1 か月前になっても今年の回が無い（Cron で月 1 回。「そろそろ公式サイトを確認してみましょう」。1 シリーズにつき年 1 回まで）
- 通知の種類 `new_edition` を追加し、設定画面で切れるようにします。重複防止キーは `new_edition:<eventId>:<userId>`、Cron 側は `season_hint:<seriesId>:<year>:<userId>`。
- 回を追加した本人には送りません。同じ人に `new_event`（興味分野の新着）も該当する場合は `new_edition` だけ送ります。

### 2.4 次の回を登録する

**入口は 3 つ**です。どれも最終的に「新しい回を既存のシリーズに入れる」操作になります。

**入口 1: 過去の回（またはシリーズページ）の「次の回を登録する」**

リンク先は `/events/new?seriesId=<シリーズID>`。フォームを次のように用意します。

| 項目 | 扱い |
| --- | --- |
| イベント名 | 最新の回のタイトルの西暦・「第 N 回」を 1 つ進めた案を入れる。例: `高校生AIハッカソン 2025` → `高校生AIハッカソン 2026` |
| 説明・主催・対象者・形式・場所・参加費・カテゴリ・タグ | 最新の回から引き継ぐ |
| 公式サイト URL | 引き継ぐ。年ごとに変わることが多いので「要確認」を付ける |
| 応募フォーム URL | **引き継がない**。古いフォームへ誘導する事故を防ぐ |
| 開催日時・終了日時・締切 | 空。ただし入力欄の下に「前回: 2025/8/10 開催、締切 7/1」とヒントを出す |
| 画像 | 引き継がない |

- 引き継いだ項目には、既存の取得元バッジ（`FieldSource`）に `previous`（「前回から引き継ぎ・要確認」）を追加して表示します。URL 取り込みの「ページから取得」「AI が推定」と同じ見た目の仕組みに乗せます。
- フォーム上部に「『高校生AIハッカソン』の新しい回として登録します」と出し、「別のイベントとして登録する」で外せるようにします。
- この画面でも「URL から取得」を使えます。取得できた項目は取得値を優先し、取得できなかった項目だけ引き継いだ値を残します。
- 重複判定では、同じシリーズの回を候補から除きます。日時が未入力のままだと同名のため「重複の可能性が高い」と出てしまうからです。

**入口 2: 通常の投稿時に「これは過去にあったイベントの新しい回では？」と提案する**

- 投稿の送信時、重複候補の検索と並行して `findSeriesCandidates()` を実行します。
- 候補があれば、重複パネルとは別に「過去に同じイベントが登録されています」パネルを出します。ボタンは「このイベントの新しい回として登録」「別のイベント」の 2 つ。
- **判定方法**（重複判定 `scoreDuplicate` とは別の関数にします。重複判定は「同じ回か」、こちらは「同じシリーズか」を見るので目的が逆です）
  1. タイトルから回の表記を取り除く: 西暦（`2025`、`2025年`、`2025年度`、`'25`）、`第N回`、`Vol.N`、`#N`、`N th`、全角の同等表記。関数 `stripEditionMarkers()`。
  2. 除いた結果を `normalizeForMatch()` にかけたものを **`match_key`** とし、シリーズ側にも保存しておく。
  3. まず `event_series.match_key` の完全一致を探す。あればそれを第一候補にする。
  4. 無ければ、主催者が一致するシリーズ、公式 URL のホストが一致するシリーズ、直近 3 年に回があるシリーズ（最大 500 件）を集め、`match_key` 同士の Dice 係数が 0.8 以上のものを候補にする。
  5. 上位 3 件を出す。
- 既存の重複判定が `differentEdition: true`（西暦違い・120 日以上離れている）を返した候補は、重複パネルには出さず、こちらのパネルへ回します。今は「重複の可能性が低い」と弱めるだけで、せっかくの判定が使われていません。

**入口 3: あとから結びつける（編集画面）**

- 編集画面に「このイベントの他の回」欄を追加し、シリーズ名で検索して選べるようにします（`/api/series/search?q=`）。
- 結びつけると、その回は選んだシリーズに移り、元のシリーズが空になれば削除します。
- 外すときは、新しいシリーズを 1 つ作ってそこへ移します（「シリーズ無し」の状態は作りません）。
- 権限: 投稿者と管理者は結びつけ・解除の両方。それ以外のログインユーザーは、**回が 1 つしかないシリーズに属する回**に限り、既存のシリーズへ結びつけることだけができます（「未設定の項目を埋める」という既存の情報提供ルールの延長）。
- 変更は `event_contributions` に `changes.series = { from, to }` として残します。

**結びつけ処理 `attachToSeries(db, eventId, seriesId, userId)`**

1 回の D1 バッチで行います。

1. 回の `series_id` を付け替える
2. 元のシリーズが空になったら、そのウォッチャーを移してから削除する（ウォッチャーは `onConflictDoNothing` で統合）
3. 回ラベルが空なら、タイトルの西暦か開始年から入れる
4. 新しい回が公開中かつ終了していなければ、ウォッチャーに `new_edition` を通知する（`waitUntil`）

### 2.5 タグ

**カテゴリとの違い**

- カテゴリ（11 種）は「分野」。管理者が管理する大分類で、興味の登録や通知に使う。今まで通り。
- タグは「どんなイベントか」。参加しやすさ・形式・時期・得られるもの。ユーザーが付けられる。

**タグには「面（facet）」を持たせます。** 面ごとにフォームのチップを並べ、タグ一覧の見出しにもします。

| 面 | 初期タグ |
| --- | --- |
| 対象 | 初心者歓迎、中学生OK、高校生向け、文系でも、女子限定・女子歓迎 |
| 参加形態 | 個人で参加、チームで参加、学校単位で参加、メンターあり |
| 日程 | 1日完結、複数日、合宿・宿泊あり、オンライン完結、土日 |
| 得られるもの | 表彰あり、賞金・副賞あり、企業・大学と交流、作品が残る、交通費補助 |
| その他 | （ユーザーが作ったタグはここに入る） |

**付け方**

- 1 つの回に最大 8 個。タグ名は 1〜20 文字。
- 投稿・編集フォームに「タグ」欄。面ごとのチップ＋自由入力（入力中は既存タグを候補表示、`/api/tags?q=`）。
- イベント詳細のタグ欄に「＋」を置き、その場で追加できる（`useFetcher`）。
- 権限: 投稿者・管理者は追加と削除。その他のログインユーザーは追加のみ（`event_contributions` に `add_info` として記録）。
- 入口 1 で次の回を登録するときは、前回のタグを引き継ぐ。

**表記ゆれ対策**

- `normalizeTagName()`: NFKC → 先頭の `#`／`＃` を除去 → 前後の空白除去 → 英字を小文字化 → 連続する空白を 1 つに。この結果を一意キーにする。
- 既存の `normalizeForMatch()` は記号を全部消すのでタグには使わない（`C++` と `C` が同じになるため）。
- 管理画面 `/admin/tags` で、名前の変更・面の変更・統合（A を B にまとめる）・非表示ができる。

**新しいタグの扱い（荒らし対策）**

- 誰でも作れるが、作ったばかりのタグは **「候補表示とタグ一覧に出ない」** 状態（`status = pending`）で始まる。付けた回の詳細には表示される。
- 2 人以上の別のユーザーが使うか、管理者が承認すると `active` になる。
- 新しいタグの作成はレート制限 `write` の対象。

**タグページ `/tags/:slug`（「こういう系が過去にあった」を見せる画面）**

結果は**シリーズ単位**で出します。同じイベントの 2024・2025・2026 が 3 枚並ぶのを避けるためです。

| 区画 | 内容 |
| --- | --- |
| 見出し | `#初心者歓迎`、面、シリーズ数（募集中 N・過去のみ M） |
| いま募集中 | 募集中の回があるシリーズ。開催日順 |
| 過去に開催されたイベント | 募集中の回が無いシリーズ。おすすめ順。各カードに「全 N 回」「例年 8 月ごろ」「最後の開催 2025」「ウォッチ」 |
| 活動報告 | このタグの回に付いた活動報告。新しい順、最大 6 件 |
| 一緒に付くことが多いタグ | 上位 8 件 |

- 募集中が 0 件のときは、文言を「今は募集中のものはありませんが、過去にはこんなイベントがありました」にして、過去の区画を上に出します。
- 一覧（`/events`）にも `tag` の絞り込み（複数は AND）を追加します。こちらは回単位のままです。
- `/tags` にタグ一覧（面ごと、利用数順）を置きます。

### 2.6 「そろそろ募集が始まるかも」

シリーズの履歴から出せる、このサイトならではの価値です。

- 条件: 公開中の回が 2 つ以上あり、例年の締切月が今から 2 か月以内で、今年（直近 10 か月以内に開始する）の回がまだ無いシリーズ。
- 出す場所: ホームのセクション「例年この時期に募集が始まるイベント」、タグページ、MCP の `suggest_events`。
- カードには「例年 6 月締切・8 月開催」「最後の開催 2025」「ウォッチ」「公式サイト（前回）」を出し、「今年の募集は公式サイトで確認してください」と明記します。
- 未登録の回を存在するかのように見せないよう、「予定」ではなく「例年の傾向」という言い方で統一します。

### 2.7 一覧の絞り込み追加

- `tag`（複数、AND）
- `month`（開催月、複数、OR）。`status = ended | all` と合わせて「夏休みに何があったか」を探す用途。
- `sort = recommended`（おすすめ順）

開催月は `events.start_month`（1〜12、`APP_TIMEZONE` で計算、未設定は null）を**書き込み時に非正規化**して持ちます。SQL で時差計算をしなくて済み、インデックスも効きます。既存データはマイグレーションで一度だけ埋めます。

---

## 3. MCP サーバー

### 3.1 方針

| 項目 | 決定 | 理由 |
| --- | --- | --- |
| エンドポイント | `POST /mcp`（Streamable HTTP） | 標準。ChatGPT・Gemini CLI・Claude・Cursor が対応 |
| 実装 | `@modelcontextprotocol/sdk` の `McpServer` ＋ `WebStandardStreamableHTTPServerTransport` | Web 標準の `Request`/`Response` で動き、Workers にそのまま載る |
| セッション | ステートレス（`sessionIdGenerator: undefined`）、JSON 応答（`enableJsonResponse: true`） | Worker の isolate をまたいで状態を持てない。Durable Objects を増やさない |
| `GET` / `DELETE` | `405` | サーバー発の通知を使わない |
| JSON Schema 検証 | `CfWorkerJsonSchemaValidator`（`@cfworker/json-schema`）を明示的に渡す | SDK 既定の Ajv は実行時にコード生成するため Workers で動かない |
| 認証 | 既定は無し（読み取り専用）。シークレット `MCP_ACCESS_TOKEN` を設定した場合だけ `Authorization: Bearer` を必須にする | サイトの閲覧がログイン不要なので合わせる。学校外からの利用を絞りたくなったときに、コード変更なしで切り替えられるようにしておく |
| 書き込み | 無し | §1.1 |

### 3.2 ツール

| ツール | 入力 | 返すもの |
| --- | --- | --- |
| `search_events` | `query`, `categories[]`, `tags[]`, `status`（`upcoming`/`ended`/`all`）, `months[]`, `from`, `to`, `deadline`, `format`, `fee`, `location`, `sort`, `page` | 回の要約の配列、総件数。各要約に `series`（ID・名前・回数・例年の時期）を含める |
| `get_event` | `id` | 回の詳細、タグ、出典 URL、おすすめの集計と一言（最大 5 件）、活動報告の要約（最大 5 件）、シリーズの年表 |
| `get_series` | `id`（シリーズ ID または回の ID） | シリーズ名、周期・例年の時期、回の年表、シリーズ全体のおすすめ集計 |
| `suggest_events` | `categories[]`, `keywords[]`, `tags[]`, `style`, `format`, `fee`, `period`, `participation`, `limit`（最大 10） | 2 つの配列。`open`: 募集中の回（既存の `rankEvents()` の結果と事実ベースの理由）。`recurring_soon`: §2.6 の「そろそろ募集」シリーズ |
| `list_facets` | なし | カテゴリ一覧と、面ごとの `active` なタグ一覧（利用数付き） |
| `search` | `query` | `{ results: [{ id, title, url }] }` |
| `fetch` | `id` | `{ id, title, text, url, metadata }` |

`search` と `fetch` は ChatGPT のコネクタ・Deep Research が要求する固定の形です。中身は `search_events` と `get_event` を呼んで整形し直すだけにします。

**リソース**も登録します。ツールを呼ばずに URI で参照したいクライアント向けです。

- `eventshare://events/{id}`
- `eventshare://series/{id}`

**プロンプト** `find_events`（引数: 学年、興味、時期）を 1 つ登録します。「募集中のものと、例年この時期に募集があるものの両方を調べ、日程・締切・公式 URL を必ず添え、確定情報ではない旨を書くこと」というテンプレートです。

### 3.3 出力の決まり（`mcp/format.ts` に純粋関数としてまとめる）

- 日時は ISO 8601（UTC）と `APP_TIMEZONE` の日本語表記（`2026年11月3日(火) 13:00`）の両方
- URL は絶対 URL。origin はリクエストから取る
- 状態は値（`open` など）と日本語ラベル（`募集中`）の両方
- 未登録は `null`。推測で埋めない
- **人名は出さない。** おすすめの一言・活動報告の要約は本文だけを渡し、表示名・学年・ユーザー ID は含めない。外部サービスに生徒の情報を流さないため
- `content` に人が読める要約、`structuredContent` に JSON
- 全ツールに `readOnlyHint: true`、`openWorldHint: false`。ツールの説明文に「日程・締切は公式サイトで確認するよう伝えること」を書く

### 3.4 配置とセキュリティ

```
workers/app.ts
  pathname === "/mcp" → handleMcpRequest()   ← CSRF 判定より前に分岐
app/.server/mcp/
  handler.ts   CORS、メソッド判定、トークン確認、レート制限、トランスポート接続
  server.ts    createMcpServer(deps) — ツール・リソース・プロンプトの登録
  tools.ts     各ツールの本体。DB 取得関数を deps で受け取る（テストで差し替えるため）
  format.ts    整形（純粋関数）
```

- **CSRF**: `/mcp` は Cookie もセッションも読まないので `isCrossSiteMutation` の対象外にします。`Cookie` ヘッダーが付いていても無視します。
- **CORS**: `/mcp` のみ `Access-Control-Allow-Origin: *`、`Allow-Methods: POST, OPTIONS`、`Allow-Headers: Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id`。認証情報付きリクエストは受けないので `*` で問題ありません。
- **レート制限**: `RL_MCP`（IP ごと 60 回/分）を開発・本番・プレビューの 3 環境に追加します。超過は JSON-RPC エラーで返します。
- **入力上限**: 文字列 100 文字、配列 10 件、`page` 50、`limit` 10。
- **ログ**: ツール名・件数・所要時間だけを構造化ログに。検索語は出しません。

### 3.5 接続ガイド `/ai-connect`

- 接続 URL（`<origin>/mcp`）をコピーボタン付きで表示
- クライアント別の手順。各サービスの画面は変わりやすいので、操作名は断定せず公式ドキュメントへのリンクを添える
  - ChatGPT: 開発者モードを有効にしてカスタムコネクタを追加。認証は「なし」（トークンを設定している場合はヘッダーを指定）
  - Gemini: Gemini CLI の `settings.json` の `mcpServers` に `httpUrl` を書く例。Gemini API（`@google/genai`）から MCP ツールを渡す例。一般向け Gemini アプリは対応していない場合がある旨
  - Claude / Cursor: カスタムコネクタ、`mcp.json` の例
- 聞き方の例（「夏休みに中学生が出られる、初心者歓迎のプログラミング系はある？過去の定番も」）
- `localhost` には外部の AI から接続できないので、確認はプレビュー環境か `cloudflared` トンネルで行う旨
- フッターと `/chat` からリンク

### 3.6 サイト内 AI チャットへの反映

- 募集中が 0 件のとき、同じ条件に合う「そろそろ募集」シリーズと「過去の定番」（おすすめ順、最大 3 件）を、終了したものだと明示して添えます。カードには「ウォッチ」ボタンを付けます。
- `RankableEvent` に `tagNames` を加え、キーワードがタグ名に一致したら加点します。
- 推薦理由（`ruleReason`）に「参加した N 人がおすすめ」「例年 8 月開催」を加えます。どちらも DB の事実です。

---

## 4. データモデル

### 4.1 新規テーブル

**`event_series`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | text PK | UUID |
| `title` | text not null | シリーズ名。初期値は最初の回のタイトルから回の表記を除いたもの |
| `match_key` | text not null | `normalizeForMatch(stripEditionMarkers(title))`。候補検索用。インデックス |
| `description` | text | 任意 |
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
| `slug` | text not null unique | `normalizeTagName()` の結果。URL にも使う |
| `facet` | text enum(`audience`, `participation`, `schedule`, `outcome`, `other`) | 既定 `other` |
| `status` | text enum(`pending`, `active`, `hidden`) | 既定 `pending`。初期タグは `active` |
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
| `id` | text PK | 報告の対象 ID に使うため単独の ID を持つ |
| `user_id` | text → user（cascade） | |
| `event_id` | text → events（cascade） | |
| `audience` | text enum(`beginner_ok`, `experienced`, `anyone`) not null | 向いている人 |
| `comment` | text | 最大 200 文字 |
| `status` | text enum(`visible`, `hidden`) | 既定 `visible` |
| `created_at` / `updated_at` | timestamp_ms | |

一意制約 `(user_id, event_id)`、インデックス `(event_id, created_at)`。

### 4.2 既存テーブルへの追加

| テーブル | 列 | 備考 |
| --- | --- | --- |
| `events` | `series_id` text → event_series（set null） | **DB 上は nullable、アプリ上は必須。** SQLite は既存行のある表に NOT NULL 列を後から足せないため。`createEvent` は必ず値を入れ、読み取り側は null を「壊れたデータ」として扱う。インデックス `(series_id, start_at)` |
| `events` | `edition_label` text | 最大 30 文字 |
| `events` | `start_month` integer | 1〜12。書き込み時に計算。インデックス `(status, start_month)` |
| `events` | `endorsement_count` integer not null default 0 | |
| `notification_settings` | `new_edition` boolean not null default true | |

列挙の追加（TypeScript 側のみ）: `NOTIFICATION_TYPES` に `new_edition`、`REPORT_TARGETS` に `endorsement`、`EVENT_FIELD_LABEL` に `tags`・`series`・`editionLabel`。

### 4.3 マイグレーション

| ファイル | 内容 |
| --- | --- |
| `0002_series_tags_endorsements.sql` | drizzle-kit で生成。表と列とインデックス |
| `0003_backfill_series.sql` | 手書き。既存の各イベントにシリーズを 1 つずつ作って `series_id` を入れる。`start_month` を `strftime('%m', start_at/1000, 'unixepoch', '+9 hours')` で埋める（Asia/Tokyo 前提の一回限りの処理であることをコメントに残す）。初期タグ（§2.5 の表）を `active` で投入 |

既存の `0001_seed_categories.sql` と同じく、初期データは手書きの SQL にします。

### 4.4 既存機能への影響

| 機能 | 対応 |
| --- | --- |
| 統合 `mergeEvents` | 統合元の回を統合先のシリーズに移す（元のシリーズが空になれば削除、ウォッチャーは統合）。おすすめ・タグは、いいねと同じ「統合先に既にあるものを消してから付け替える」方式。同じバッチに入れる |
| 件数の再集計 `recount()` | `endorsement_count` を追加（`status = visible` のみ） |
| 非公開化 | 非公開の回はシリーズの年表に投稿者・管理者以外には出さない。シリーズ自体は消さない |
| 重複判定 | ロジックは変えない。`differentEdition: true` の候補をシリーズ候補パネルへ回す。同じシリーズの回は重複候補から除く |
| 通知の統合時付け替え | 既存の `notifications.event_id` の付け替えに加え、`series_watches` の統合 |
| URL 取り込み | AI が有効なら、**既存の `active` なタグの中から**最大 5 個を候補にする。新しいタグは作らせない。本文に根拠がある場合だけ採用する（既存の捏造防止方針と同じ） |

---

## 5. 権限

| 操作 | 未ログイン | ログイン | 投稿者 | 管理者 |
| --- | :-: | :-: | :-: | :-: |
| シリーズページ・タグページ・おすすめの閲覧、MCP の読み取り | ✓ | ✓ | ✓ | ✓ |
| ウォッチ | | ✓ | ✓ | ✓ |
| おすすめ（終了した回／参加した回） | | ✓ | ✓ | ✓ |
| タグの追加 | | ✓ | ✓ | ✓ |
| タグの削除 | | | ✓ | ✓ |
| 回をシリーズに結びつける（回が 1 つだけのシリーズから） | | ✓ | ✓ | ✓ |
| 回をシリーズから外す・別のシリーズへ移す | | | ✓ | ✓ |
| シリーズ名・説明の編集 | | | ✓（いずれかの回の投稿者） | ✓ |
| タグの承認・統合・非表示、おすすめの非表示、シリーズの統合 | | | | ✓ |

---

## 6. 変更するファイル

### 6.1 共通（純粋関数。テストの中心）

| ファイル | 内容 |
| --- | --- |
| `app/lib/edition.ts`（新規） | `stripEditionMarkers()`、`suggestNextTitle()`、`editionLabelFrom()` |
| `app/lib/tags.ts`（新規） | `normalizeTagName()`、面の定義とラベル |
| `app/lib/series-stats.ts`（新規） | 回の配列から周期・例年の時期・「そろそろ募集」を算出する |
| `app/lib/labels.ts` | 面・向いている人・`new_edition` のラベル、`SORT_OPTIONS` に `recommended` |

### 6.2 サーバー

| ファイル | 内容 |
| --- | --- |
| `app/.server/db/schema.ts` | §4 |
| `app/.server/validation/event.ts` | `tags`（最大 8）、`seriesId`、`editionLabel` |
| `app/.server/validation/interaction.ts` | おすすめ（`audience`、`comment`） |
| `app/.server/services/series.ts`（新規） | `ensureSeriesFor`、`attachToSeries`、`detachFromSeries`、`getSeries`、`findSeriesCandidates`、`listRecurringSoon`、ウォッチ |
| `app/.server/services/tags.ts`（新規） | 付与・削除・候補・承認・統合・タグページ用の取得 |
| `app/.server/services/endorsements.ts`（新規） | 登録・更新・取り消し・集計・非表示 |
| `app/.server/services/events.ts` | 検索条件（`tag`・`month`・`sort=recommended`）、`EventCard` に `tags`・`endorsementCount`・`editionLabel`・`series`、作成時の `ensureSeriesFor` と `start_month`、入口 1 用の引き継ぎ値の生成 |
| `app/.server/services/interactions.ts` | `recount()` に `endorsement_count` |
| `app/.server/services/admin.ts` | `mergeEvents` の対応、タグ・シリーズの管理 |
| `app/.server/services/notifications.ts` | `notifyNewEdition()`、`sendSeasonHints()`（Cron）、`SETTING_COLUMN` に `new_edition` |
| `app/.server/services/scheduled.ts` | `sendSeasonHints` を月 1 回呼ぶ（日次 Cron の中で日付を見て実行） |
| `app/.server/duplicates/find.ts` | 同一シリーズの除外、`differentEdition` の振り分け |
| `app/.server/chat/engine.ts` / `rank.ts` | §3.6 |
| `app/.server/url-import/*` | AI によるタグ候補 |
| `app/.server/mcp/*`（新規） | §3.4 |
| `app/.server/rate-limit.ts` | `mcp` |
| `app/.server/config.ts` | `MCP_ACCESS_TOKEN`（任意のシークレット） |
| `workers/app.ts` | `/mcp` の分岐 |
| `wrangler.jsonc` | `RL_MCP`（3 環境） |

### 6.3 画面

| ファイル | 内容 |
| --- | --- |
| `app/routes.ts` | `series/:id`、`tags`、`tags/:slug`、`ai-connect`、`api/tags`、`api/series/search`、`admin/tags`、`admin/series` |
| `app/routes/events.$id.tsx` | おすすめ、タグと「＋」、他の回ボックス、新しい回の案内、「そろそろ募集」案内、「次の回を登録する」、終了した回での「ウォッチ」 |
| `app/routes/events.new.tsx` | `?seriesId=`、シリーズ候補パネル |
| `app/routes/events.$id.edit.tsx` | タグ、他の回との結びつけ、回ラベル |
| `app/routes/events.tsx` | タグ・開催月の絞り込み、おすすめ順 |
| `app/routes/home.tsx` | 「先輩のおすすめ」「例年この時期に募集が始まるイベント」 |
| `app/routes/me.tsx` | 「おすすめした」「ウォッチ中」タブ |
| `app/routes/settings.tsx` | `new_edition` の通知設定 |
| `app/routes/series.$id.tsx` / `tags.tsx` / `tags.$slug.tsx` / `ai-connect.tsx`（新規） | §2.1 / §2.5 / §3.5 |
| `app/routes/admin/tags.tsx` / `admin/series.tsx`（新規） | 管理 |
| `app/routes/admin/comments.tsx` | おすすめのタブ |
| `app/components/events/event-form.tsx` | タグ入力、`FieldSource` に `previous`、前回の日程ヒント |
| `app/components/events/event-card.tsx` | タグ（最大 3）、おすすめ数、回ラベル、「全 N 回」 |
| `app/components/events/series-card.tsx`（新規） | タグページ・ホーム用のシリーズ単位のカード |
| `app/components/events/series-timeline.tsx`（新規） | 回の年表 |
| `app/components/events/series-candidate-panel.tsx`（新規） | 入口 2 のパネル |
| `app/components/events/tag-input.tsx`（新規） | 面ごとのチップ＋候補付き入力 |
| `app/components/events/endorsement-form.tsx`（新規） | 3 択＋一言 |
| `app/components/site-footer.tsx` | 「タグから探す」「AI アプリとつなぐ」 |

---

## 7. 進め方

ステップごとに PR を分け、各ステップで `npm run typecheck`・`npm test`・`npm run build` を通します。

| Step | 内容 | 確認すること |
| --- | --- | --- |
| 1 | スキーマ、マイグレーション（生成＋バックフィル）、純粋関数とテスト、`createEvent` のシリーズ自動作成 | 既存データに全部シリーズが付く。既存画面が今まで通り動く |
| 2 | シリーズ（ページ、年表、3 つの入口、ウォッチ、`new_edition` 通知、統合への対応） | 過去の回から次の回を登録すると引き継がれ、ウォッチャーに通知が 1 回だけ届く。統合してもシリーズが壊れない |
| 3 | タグ（入力、タグページ、承認フロー、管理画面、一覧の絞り込み） | 投稿者以外が追加だけできる。`pending` が候補に出ない。タグページでシリーズ単位に出る |
| 4 | おすすめ（登録、集計、一覧の並び、報告、マイページ、ホーム）、「そろそろ募集」 | 終了した回にだけ付けられる。非表示が件数に反映される。「そろそろ募集」が履歴から正しく出る |
| 5 | MCP と `/ai-connect` | MCP Inspector で全ツール・リソースが通る。プレビュー環境に ChatGPT と Gemini CLI から接続できる。トークンを設定すると未認証が 401 になる |
| 6 | サイト内 AI チャットへの反映、URL 取り込みのタグ候補 | 0 件のときに過去の定番と「そろそろ募集」が出る |

MCP を先に使いたい場合は、Step 1 のあとに Step 5 を回しても構いません。その場合、ツールの出力からシリーズ・タグ・おすすめの項目を一時的に省き、あとから足します（項目の追加は互換性を壊しません）。

---

## 8. テスト

| ファイル | 内容 |
| --- | --- |
| `tests/edition.test.ts` | `stripEditionMarkers`（西暦・年度・`'25`・第 N 回・Vol・全角）、`suggestNextTitle`（2025→2026、第4回→第5回、両方あるとき、何も無いとき）、`editionLabelFrom` |
| `tests/tags.test.ts` | `normalizeTagName`（`#`・全角・大小文字・`C++` が残る・空白） |
| `tests/series-stats.test.ts` | 周期判定（毎年・年 2 回・不定）、例年の月（最頻値、同数のとき）、「そろそろ募集」の境界（締切月の 2 か月前、今年の回がある場合は出ない） |
| `tests/series-candidates.test.ts` | `match_key` 完全一致、Dice 0.8 の境界、同年の別イベントが候補にならない、URL ホスト一致 |
| `tests/duplicates.test.ts`（追記） | `differentEdition` の候補がシリーズ候補へ回ること |
| `tests/mcp.test.ts` | `format.ts`（絶対 URL、二通りの日時、`null`、人名を含まない）。`createMcpServer` に差し替え用の取得関数を渡し、SDK の `Client` と `InMemoryTransport` で `initialize` → `tools/list` → 各ツール → `resources/read` を通す。トークン有りで `Authorization` 無しが拒否される |
| `tests/chat.test.ts`（追記） | タグ名一致の加点、0 件時の過去の定番 |

手動確認: ローカルで MCP Inspector を `http://localhost:5173/mcp` につなぐ。プレビュー環境に ChatGPT（開発者モード）と Gemini CLI からつなぎ、`find_events` プロンプトで回答に公式 URL と「要確認」の文言が含まれることを見る。

---

## 9. 仮で決めた仕様（学校側で確認したいこと）

1. **おすすめは参加した人だけ**にしている。押すと「参加した」も付く。参加していなくても「良さそう」と押せる方がよいか。
2. **おすすめの一言に表示名を出す**（コメントと同じ扱い）。匿名の選択肢を付けるか。
3. **新しいタグは 2 人が使うまで候補に出ない**。学校規模だと 2 人に届かないタグが多く残る可能性がある。管理者が定期的に承認する運用でよいか。
4. **投稿者以外もシリーズに結びつけられる**（回が 1 つだけのものに限る）。間違いは投稿者・管理者が外せる。
5. **MCP は既定で認証なし**。閲覧がログイン不要なので合わせた。制限したい場合は `MCP_ACCESS_TOKEN` を設定して配布する運用になる。
6. **外部の AI にはおすすめの一言・活動報告の要約を渡す**（人名は渡さない）。本文も渡さない方がよいか。
7. **「そろそろ募集」の Cron 通知**は年 1 回・1 か月前にしている。不要なら設定で切れるが、既定を OFF にするか。

---

## 10. リスクと対策

| リスク | 対策 |
| --- | --- |
| シリーズ候補の誤提案 | 強制しない（「別のイベント」で閉じられる）。閾値（Dice 0.8）は `app_settings` に置き、重複判定と同じく管理画面で調整できるようにする |
| 間違ったシリーズに結びつけられる | 投稿者・管理者が外せる。外すと新しいシリーズに移るだけなので、データは失われない。履歴に残る |
| 「そろそろ募集」が外れる（今年は中止・時期変更） | 「予定」ではなく「例年の傾向」と書き、公式サイトでの確認を促す。回が 2 つ以上あるシリーズに限る |
| 古い応募フォームへ誘導してしまう | 応募フォーム URL は引き継がない。公式 URL には「要確認」を付ける |
| タグの乱立 | `pending` の仕組み、面ごとのチップで既存タグへ誘導、管理画面の統合 |
| `series_id` が null の回が混ざる | マイグレーションで全件埋める。`createEvent` が必ず作る。管理ダッシュボードに「シリーズ無しの回」の件数を出して検知する |
| 外部の AI が日程を誤って伝える | 二通りの日時表記と絶対 URL を必ず返す。ツールの説明文とプロンプトで公式確認を促す。未登録は `null` |
| MCP の過剰な呼び出し | `RL_MCP`、件数と文字数の上限、ステートレスなので Worker 側に状態が残らない |
| タイムゾーンの取り違え | `start_month` は書き込み時に `zonedParts()` で計算し、SQL では計算しない。バックフィルの `+9 hours` は一回限りで、コメントに残す |
