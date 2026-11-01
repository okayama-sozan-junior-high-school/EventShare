# Event Share 機能追加 計画書兼仕様書（統合版）

- 基準: `main`（`09672df`）
- 前提: [architecture.md](architecture.md) の原則（権限・検証はサーバー側、`.server` 分離、DB は UTC ミリ秒、AI 出力は検証して事実と照合）を引き継ぐ
- 経緯: 複数モデルで作成した計画案（`model-test/`）を比較し、良い部分を統合したもの。採用元は末尾の付録に記載
- 状態: 計画。コードは未変更

---

## 1. 全体像

追加するのは次の 4 つ。

| # | 機能 | ひとことで |
| --- | --- | --- |
| A | シリーズ（開催回のつながり） | 「第 3 回」を登録するとき「第 2 回」とつながる。前回の活動報告・おすすめが新しい回から見える |
| B | おすすめ（過去のイベントを残す） | 参加した人が「初めてでも大丈夫」などの評価と一言を残せる。終了後もおすすめ順で探せる |
| C | タグ | `#初心者歓迎` `#夏休み` のような特徴で横断的に探せる。「こういう系が過去にあった」をタグのページで見せる |
| D | MCP サーバー | ChatGPT・Gemini・Claude などから、イベントの検索・詳細・おすすめ・過去の回を引ける |

### 1.1 中心の考え方: 回とシリーズ

4 つを別々に積むのではなく、**「イベントには『回』と『シリーズ』がある」** という 1 つの考え方に乗せる。

- 今の `events` の 1 行は「2025 年の第 4 回」のような **1 回分（回）**。
- その上に **シリーズ**（「高校生 AI ハッカソン」というイベントそのもの）を置く。
- **すべてのイベントは必ずどれかのシリーズに属する。** 単発は、回が 1 つしかないシリーズ。

| やりたいこと | 置き場所 |
| --- | --- |
| 次の回を過去の回とつなぐ | 新しい回を、過去の回と同じシリーズに入れる |
| 「次が出たら知りたい」 | シリーズをウォッチする |
| 「こういう系が過去にあった」 | タグの検索結果をシリーズ単位で見せる（同じイベントの 2024・2025 が並ばない） |
| 「毎年開催」「例年 8 月ごろ」 | タグで付けず、シリーズの回の履歴から**自動算出**する |
| 外部 AI に答えさせる | 回の情報に加えて、シリーズの履歴（例年の時期・回数・おすすめ）を返す |

おすすめだけは**回**に付ける。「2025 年に参加した人の感想」はその年の内容についてのものだから。表示時にシリーズ単位で集計する。

数珠つなぎ（`previous_event_id`）ではなくシリーズ表にする理由:

- 全回を 1 回のクエリで取れる（数珠つなぎは再帰が必要）
- 循環参照が構造上起こらない
- 途中の回が非公開・統合されてもつながりが切れない
- シリーズ単位のページ、活動報告・おすすめのシリーズ全体での集計が簡単

### 1.2 解決したいこと

1. 終わったイベントの知見が消える。一覧の既定は「これから開催」で、活動報告が残っていても次の学年がたどり着けない。
2. カテゴリ（管理者管理の大分類 11 種）だけでは「初心者でも大丈夫か」「チームで出られるか」「いつごろか」が伝わらない。
3. 毎年のイベントが毎年バラバラに登録される。重複判定（`scoreDuplicate`）は西暦違い・120 日以上離れた同名イベントを「別の開催回」と見抜いているのに、つなぐ手段がない。
4. サイト内 AI チャットはあるが、ChatGPT や Gemini で相談している生徒はこのサイトに来ない。

### 1.3 やらないこと

- MCP からの書き込み（お気に入り・投稿）。OAuth が必要で、Better Auth 1.7 系に MCP 用 OAuth が同梱されていないため別計画（§8 参照）。
- メール・プッシュ通知。サイト内通知のみ。
- 意味ベース検索（Vectorize）。タグとシリーズで大部分は解消できる見込み。
- 過去イベントの自動収集。登録は今まで通り生徒が行う。
- ユーザーが自由に作る公開リスト（コレクション）。モデレーション対象と個人情報の露出面が増えるため今回は見送る。

---

## 2. 用語

| 用語 | 意味 | 実体 |
| --- | --- | --- |
| シリーズ | 繰り返し開催されるイベントの「正体」。名前と履歴を持つ | `event_series` |
| 回 | 1 回分の開催。今の `events` の 1 行 | `events.series_id` |
| 回ラベル | 回を区別する表示名。`2025`、`第4回` | `events.edition_label` |
| ウォッチ | 「次の回が出たら知りたい」。シリーズに対して行う | `series_watches` |
| おすすめ | 参加した人が後輩のために残す評価と一言 | `event_endorsements` |
| タグ | カテゴリより細かい、イベントの特徴 | `tags` / `event_tags` |
| お気に入り | 「この回に応募・参加するつもり」。既存のまま | `event_bookmarks` |

---

## 3. 機能 A: シリーズ

### 3.1 シリーズから自動算出する値

保存せず表示時に計算する（学校規模のデータ量を想定）。`app/lib/series-stats.ts` の純粋関数。

| 値 | 計算方法 | 使いどころ |
| --- | --- | --- |
| 回数 | 公開中の回の数 | 「全 4 回」バッジ、MCP |
| 開催周期 | 回が 2 つ以上あり、開始日の間隔がどれも 10〜14 か月なら「毎年」、5〜7 か月なら「年 2 回」。それ以外は表示しない | 「毎年開催」バッジ |
| 例年の開催時期 | 公開中の回の `start_month` の最頻値 | 「例年 8 月ごろ」 |
| 例年の締切時期 | 公開中の回の締切月の最頻値 | 「そろそろ募集」判定 |
| 最新の回 | `start_at` が最も新しい公開中の回（未設定は最後） | 代表、通知先 |

「毎年開催」をタグにしないのは、付け忘れや 1 回しかないイベントへの誤付与を防ぐため。履歴から出せば常に実態と一致する。

### 3.2 次の回を登録する

入口は 3 つ。どれも「新しい回を既存のシリーズに入れる」操作になる。

**入口 1: 過去の回・シリーズページの「次の回を登録する」（主導線）**

`/events/new?seriesId=<シリーズID>` でフォームを開く。最新の回から次のように引き継ぐ。

| 項目 | 扱い |
| --- | --- |
| イベント名 | 西暦・`第N回` を 1 つ進めた案を入れる（`suggestNextTitle()`） |
| 説明・主催・対象者・形式・場所・参加費・カテゴリ・タグ | 引き継ぐ |
| 公式サイト URL | 引き継ぐ。年度で変わることが多いので「要確認」 |
| 応募フォーム URL | **引き継がない**。古いフォームへ誘導する事故を防ぐ |
| 開催日時・終了日時・締切 | 空。入力欄の下に「前回: 2025/8/10 開催、締切 7/1」とヒント |
| 画像 | 引き継がない |

- 引き継いだ項目には、既存の取得元バッジ（`FieldSource`）に `previous`（前回から引き継ぎ・要確認）を追加して表示する。新しい仕組みは作らない。
- フォーム上部に「『高校生AIハッカソン』の新しい回として登録します」と出し、「別のイベントとして登録する」で外せる。
- この画面でも「URL から取得」を使える。取得できた項目は取得値を優先し、取得できなかった項目だけ引き継ぎ値を残す。
- 重複判定では同じシリーズの回を候補から除く。日時未入力のまま送ると同名のため「重複の可能性が高い」と出てしまうため。

**入口 2: 通常の投稿時に自動で判定・提案する**

投稿の送信時、重複候補の検索と並行して `findSeriesCandidates()` を実行する。

1. タイトルから回の表記を取り除く `stripEditionMarkers()`。対象は西暦（`2025`、`2025年`、`2025年度`、`'25`）、`第N回`、`Vol.N`、`#N`、`N th`、全角の同等表記。
2. 除いた結果を `normalizeForMatch()` にかけたものを **`match_key`** とし、シリーズ側にも保存する。
3. `event_series.match_key` が完全一致し、かつ **主催者が一致するか公式 URL のホストが一致する** シリーズがあれば、**強い候補**として扱う。フォーム上部に「『○○』の新しい回として登録します」と出し、そのまま送ればつながる。外すこともできる。
4. `match_key` が一致しても主催者・URL がどちらも食い違う、または一致せず Dice 係数 0.8 以上のシリーズがある場合は、**弱い候補**として重複パネルとは別の「過去に同じイベントが登録されています」パネルを出す。ボタンは「このイベントの新しい回として登録」「別のイベント」。名前が同じでも別団体のイベントはあるため、自動ではつながない。
5. 母集団は、主催者が一致するシリーズ、URL ホストが一致するシリーズ、直近 3 年に回があるシリーズ（最大 500 件）。学校規模なので JS 側で採点する。上位 3 件を出す。
6. 既存の重複判定が `differentEdition: true` を返した候補は、重複パネルには出さずこちらへ回す。

閾値（Dice 0.8）は `app_settings` に置き、重複判定と同じく管理画面で調整できるようにする。

**入口 3: あとから結びつける（編集画面）**

- 「このイベントの他の回」欄でシリーズ名を検索して選ぶ（`/api/series/search?q=`）。
- 結びつけると回は選んだシリーズに移り、元のシリーズが空になれば削除する。外すときは新しいシリーズを 1 つ作ってそこへ移す（「シリーズ無し」は作らない）。
- 権限: 投稿者・管理者は結びつけ・解除の両方。それ以外のログインユーザーは、**回が 1 つしかないシリーズに属する回**に限り、既存シリーズへ結びつけることだけができる（「未設定の項目を埋める」既存ルールの延長）。
- 変更は `event_contributions` に `changes.series = { from, to }` で残す。

**結びつけ処理 `attachToSeries(db, eventId, seriesId, userId)`**（1 回の D1 バッチ）

1. 回の `series_id` を付け替える
2. 元のシリーズが空になったら、ウォッチャーを移してから削除する（`onConflictDoNothing` で統合）
3. 回ラベルが空なら、タイトルの西暦か開始年から入れる（`editionLabelFrom()`）
4. 新しい回が公開中かつ終了していなければ、`new_edition` を通知する（`waitUntil`）

### 3.3 ウォッチと通知

- `series_watches`（user, series）。終了した回では「お気に入り」ボタンを隠し、「次の回をウォッチ」を出す。
- 単発のイベントもウォッチできる。すべてのイベントがシリーズを持つので特別扱いはいらない。
- **通知のタイミング**: シリーズに新しい公開中の回が追加されたとき（投稿時・あとからの結びつけ時とも）。
- **送り先**: ウォッチャーに加え、同じシリーズの他の回に対してお気に入り・参加・おすすめのいずれかをしているユーザー。追加した本人は除く。
- 通知種別 `new_edition` を追加し、設定画面で切れるようにする。`dedupe_key = new_edition:<eventId>:<userId>`。同じ人に `new_event`（興味分野の新着）も該当する場合は `new_edition` だけ送る。

### 3.4 表示

**シリーズページ `/series/:id`**

- シリーズ名、説明、周期・例年の時期のバッジ
- 回の年表（回ラベル・開催日・状態・おすすめ数・活動報告数）。募集中の回を先頭で強調
- シリーズ全体のおすすめ（回ごとにまとめて）と活動報告
- 「ウォッチする」「次の回を登録する」
- 名前と説明は、いずれかの回の投稿者と管理者が編集できる

**イベント詳細への追加**

- 回が 2 つ以上なら右カラムに「このイベントの他の回」ボックス（年表の短縮版、最大 5 件＋「すべて見る」）
- 終了した回を開いていて新しい公開中の回があれば、最上部に「新しい回（2026）が登録されています」
- 終了した回で新しい回がまだ無く、例年の締切時期が 2 か月以内なら「例年 6 月ごろに募集が始まっています。ウォッチすると登録時に通知します」
- 「関連する活動報告」を「この回」と「他の回」に分ける（他の回は新しい順に最大 6 件、回ラベル付き）
- 「参加した人のおすすめ」も「前回までのおすすめ」を最大 5 件出す

### 3.5 「そろそろ募集が始まるかも」

- 条件: 公開中の回が 2 つ以上、例年の締切月が今から 2 か月以内、直近 10 か月以内に開始する回がまだ無い。
- 出す場所: ホームの「例年この時期に募集が始まるイベント」、タグページ、MCP の `recommend_events`。
- カードには「例年 6 月締切・8 月開催」「最後の開催 2025」「ウォッチ」「公式サイト（前回）」。「今年の募集は公式サイトで確認してください」と明記。
- 「予定」ではなく「例年の傾向」という言い方で統一する。未登録の回を存在するかのように見せない。
- Cron による通知は今回は行わない（表示のみ）。必要になれば `season_hint:<seriesId>:<year>:<userId>` の重複防止キーで年 1 回に絞って追加する。

---

## 4. 機能 B: おすすめ

### 4.1 何を残すか

「いいね」と違い、**参加した人が、あとから来る人のために残す評価**。自由記述だけだと比較しにくいので、構造化した 1 項目＋任意の一言＋任意の活動報告リンクにする。

| 項目 | 内容 | 必須 |
| --- | --- | --- |
| 向いている人 | `初めてでも大丈夫` / `経験者向け` / `誰にでも` の 3 択 | 必須 |
| 一言 | 最大 200 文字 | 任意 |
| 活動報告 | 自分がこの回に書いた活動報告へのリンク | 任意 |

3 択にする理由は「初心者でも大丈夫か」が中高生にとって最初の分かれ目だから。集計すると「参加した 5 人のうち 4 人が『初めてでも大丈夫』」と一覧でもわかる。活動報告リンクは「先輩のすすめ → 根拠の体験記」をたどれるようにするため。活動報告がなくてもおすすめはできる。

### 4.2 できる人と条件

- ログインユーザー。対象は**終了した回**（`phase = ended`）、または自分が「参加した」にしている回。
- おすすめすると「参加した」も自動で付く（参加した人の声であることを担保する）。
- 1 人 1 回 1 件。編集・取り消しができる。

### 4.3 表示

| 場所 | 内容 |
| --- | --- |
| イベント詳細 | アクション列に「おすすめ（N）」。説明の下に「参加した人のおすすめ」セクション。3 択の集計バー＋一言の一覧（新しい順、最大 20 件）。活動報告ありは「活動報告を読む」リンク。各一言に表示名と「報告」 |
| イベントカード | おすすめ 1 件以上で「おすすめ N」。3 択の最多が `初めてでも大丈夫` なら緑の小バッジ |
| 一覧 `/events` | 並び替えに「おすすめ順」。`status = ended` のときの既定の並び |
| ホーム | 「先輩のおすすめ」セクション。終了した回をシリーズ単位で重複を除いて最大 6 件 |
| マイページ | タブ「おすすめした（N）」「ウォッチ中（N）」 |
| 公開プロフィール `/users/:id` | 「おすすめしたイベント」セクション（プロフィールの公開範囲に従う） |
| シリーズページ | 回ごとにまとめた集計 |

**おすすめ順**

```
endorsement_count * 3 + bookmark_count + like_count   （同点なら start_at が新しい順）
```

`endorsement_count` は `events` に非正規化し、既存の `recount()` に加える。非表示のものは数えない。

### 4.4 モデレーション

- `REPORT_TARGETS` に `endorsement` を追加。既存の報告フローがそのまま使える。
- `/admin/comments` にタブを足し、非表示にできる。本人の取り消しは行削除、管理者の非表示は `status = hidden`。

---

## 5. 機能 C: タグ

### 5.1 カテゴリとの役割分担

- カテゴリ（11 種・管理者管理）= 分野。興味の登録や新着通知に使う。今まで通り。
- タグ = 「どんなイベントか」。参加しやすさ・形式・時期・得られるもの。ユーザーが付けられる。

### 5.2 推奨タグ（初期データ）

`tags.facet` で分類し、フォームのチップとタグ一覧の見出しに使う。

| 面 | タグ |
| --- | --- |
| 対象 | 初心者歓迎、中学生OK、高校生向け、文系歓迎 |
| 参加形態 | 個人で参加、チームで参加、学校単位で参加、メンターあり |
| 日程 | 1日完結、複数日、合宿・宿泊あり、オンライン完結、土日開催、春休み、夏休み、冬休み |
| 得られるもの | 表彰あり、賞金・副賞あり、交通費補助あり、企業・大学と交流、作品が残る、全国大会、予選あり |
| その他 | （ユーザーが作ったタグ） |

### 5.3 付け方

- 1 回に最大 8 個、1 タグ 1〜20 文字。
- 投稿・編集フォームにタグ欄。面ごとのチップ＋自由入力（入力中は `/api/tags?q=` で既存タグを候補表示、上位 10 件）。
- イベント詳細のタグ欄に「＋」を置き、その場で追加できる（`useFetcher`）。
- 権限: 投稿者・管理者は追加と削除。その他のログインユーザーは追加のみ（`event_contributions` に `add_info`、`changes.tags = { from, to }` として記録）。
- 入口 1 で次の回を登録するときは前回のタグを引き継ぐ。
- 新しいタグの作成はレート制限 `write` の対象。

### 5.4 表記ゆれと荒らし対策

- `normalizeTagName()`: NFKC → 先頭の `#`／`＃` を除去 → 前後の空白除去 → 英字を小文字化 → 連続する空白を 1 つに。この結果を一意キー（`slug`）にする。
- 既存の `normalizeForMatch()` は記号を全部消すのでタグには使わない（`C++` と `C` が同じになる）。
- ユーザーが作った新しいタグは、**利用数が 2 以上になるか管理者が面を割り当てるまで、候補表示とタグ一覧に出さない**（付けた回の詳細には表示する）。承認フローは作らず、利用数で自然に昇格させる。
- `/admin/tags` で名前変更・面の変更・統合（`event_tags` の付け替えを 1 バッチで）・非表示ができる。

### 5.5 タグページ `/tags/:slug`

「こういう系が過去にあった」を見せる中心の画面。結果は**シリーズ単位**で出す。

| 区画 | 内容 |
| --- | --- |
| 見出し | `#初心者歓迎`、面、シリーズ数（募集中 N・過去のみ M） |
| いま募集中 | 募集中の回があるシリーズ。開催日順 |
| 過去に開催されたイベント | 募集中の回が無いシリーズ。おすすめ順。各カードに「全 N 回」「例年 8 月ごろ」「最後の開催 2025」「ウォッチ」 |
| そろそろ募集 | §3.5 の条件に合うシリーズ（あれば） |
| 活動報告 | このタグの回に付いた活動報告。新しい順、最大 6 件 |
| 一緒に付くことが多いタグ | 上位 8 件 |

- 募集中が 0 件なら「今は募集中のものはありませんが、過去にはこんなイベントがありました」にして過去の区画を上に出す。
- 一覧（`/events`）にも `tag`（複数は AND）を追加。こちらは回単位のまま。
- `/tags` にタグ一覧（面ごと、利用数順）。

### 5.6 一覧の絞り込み追加

- `tag`（複数、AND）
- `month`（開催月 1〜12、複数、OR）。`status = ended | all` と合わせて「夏休みに何があったか」を探す
- `sort = recommended`

開催月は `events.start_month`（1〜12、未設定は null）を**書き込み時に `zonedParts()` で計算**して持つ。SQL で時差を計算しない（`strftime` に `+9 hours` を埋め込むと `APP_TIMEZONE` を変えたときに壊れる）。既存行はマイグレーションで一度だけ埋める。

### 5.7 AI によるタグ候補（任意機能）

URL 取り込みで AI が有効なときは、**既存の面付きタグの中から**最大 5 個を候補にし、「AI が推定・要確認」として初期選択する。新しいタグは作らせない。本文に根拠がある場合だけ採用する（既存の捏造防止方針と同じ）。

---

## 6. 機能 D: MCP サーバー

### 6.1 方針

| 項目 | 決定 | 理由 |
| --- | --- | --- |
| エンドポイント | `POST /mcp`（Streamable HTTP） | ChatGPT・Gemini CLI・Claude・Cursor が対応する標準 |
| 実装 | `@modelcontextprotocol/sdk` の `McpServer` ＋ `WebStandardStreamableHTTPServerTransport` | Web 標準の `Request`/`Response` で Workers にそのまま載る |
| セッション | ステートレス（`sessionIdGenerator: undefined`）＋ JSON 応答（`enableJsonResponse: true`） | isolate をまたいで状態を持てない。Durable Objects を増やさない |
| `GET` / `DELETE` | `405` | サーバー発の通知を使わない |
| JSON Schema 検証 | `CfWorkerJsonSchemaValidator`（`@cfworker/json-schema`）を明示指定 | SDK 既定の Ajv は実行時コード生成で Workers では動かない |
| 認証 | 既定なし（読み取り専用）。シークレット `MCP_ACCESS_TOKEN` を設定した場合のみ `Authorization: Bearer` を必須化 | 閲覧がログイン不要なので合わせる。学校外を絞りたくなったらコード変更なしで切り替えられる |
| アノテーション | 全ツールに `readOnlyHint: true`、`destructiveHint: false`、`openWorldHint: false` | クライアント側で毎回の確認ダイアログを出さずに呼べる |
| 書き込み | なし | §1.3 |

### 6.2 ツール

| ツール | 入力 | 返すもの |
| --- | --- | --- |
| `search_events` | `query`, `categories[]`, `tags[]`, `status`（upcoming/ended/all）, `months[]`, `from`, `to`, `deadline`, `format`, `fee`, `location`, `sort`, `page` | 回の要約の配列、総件数。各要約に `series`（ID・名前・回数・例年の時期） |
| `get_event` | `id` | 回の詳細、タグ、出典 URL、おすすめの集計と一言（最大 5 件）、活動報告の要約（最大 5 件）、シリーズの年表。統合済み ID は統合先を返す。非公開は「見つかりません」 |
| `get_series` | `id`（シリーズ ID または回の ID） | シリーズ名、周期・例年の時期、回の年表、シリーズ全体のおすすめ集計 |
| `recommend_events` | `categories[]`, `keywords[]`, `tags[]`, `style`, `format`, `fee`, `period`, `participation`, `includePast`, `limit`（最大 10） | `open`: 募集中の回＋事実に基づく根拠 `evidence[]`。`includePast` が true なら `past_recommended`（過去の定番）と `recurring_soon`（§3.5）も返す |
| `list_facets` | なし | カテゴリ一覧と、面ごとのタグ一覧（利用数付き）。AI が正しい値を選ぶために使う |
| `search` | `query` | `{ results: [{ id, title, url }] }` |
| `fetch` | `id` | `{ id, title, text, url, metadata }` |

- `search` と `fetch` は ChatGPT のコネクタ・Deep Research が要求する固定の形。中身は `search_events` と `get_event` を呼んで整形し直すだけ。
- `recommend_events` はサイト内チャットの `loadCandidates()` と `rankEvents()` をそのまま使う。サイトで聞いても ChatGPT で聞いても同じ推薦になり、既存の捏造防止が自動的に効く。こちらの LLM（Groq）は呼ばない。`rankEvents` が返す `matched`（「カテゴリ一致」「無料」「締切間近」）を `evidence` として返し、外部 AI が根拠を明示して答えられるようにする。
- **リソース**: `eventshare://events/{id}`、`eventshare://series/{id}`。ツールを呼ばずに URI で参照したいクライアント向け。
- **プロンプト**: `find_events`（引数: 学年、興味、時期）。「募集中のものと、例年この時期に募集があるものの両方を調べ、日程・締切・公式 URL を必ず添え、確定情報ではない旨を書くこと」。

### 6.3 出力の決まり（`mcp/format.ts` の純粋関数）

- 日時は ISO 8601（UTC）と `APP_TIMEZONE` の日本語表記（`2026年11月3日(火) 13:00`）の両方
- URL は絶対 URL。origin はリクエストから取る
- 状態は値（`open`）と日本語ラベル（`募集中`）の両方
- 未登録は `null`。推測で埋めない
- **人名を出さない。** 一言・活動報告の要約は本文だけを渡し、表示名・学年・ユーザー ID は含めない
- `content` に人が読める要約、`structuredContent` に JSON
- ツールの説明文に「日程・締切は公式サイトで確認するよう伝えること」を書く

### 6.4 配置とセキュリティ

```
workers/app.ts
  pathname === "/mcp" → handleMcpRequest()   ← CSRF 判定より前に分岐
app/.server/mcp/
  handler.ts   CORS、メソッド判定、トークン確認、レート制限、トランスポート接続
  server.ts    createMcpServer(deps) — ツール・リソース・プロンプトの登録
  tools.ts     各ツールの本体。DB 取得関数を deps で受け取る（テストで差し替えるため）
  format.ts    整形（純粋関数）
```

- **CSRF**: `/mcp` は Cookie もセッションも読まないので `isCrossSiteMutation` の対象外。`Cookie` ヘッダーが付いていても無視する。
- **CORS**: `/mcp` のみ `Access-Control-Allow-Origin: *`、`Allow-Methods: POST, OPTIONS`、`Allow-Headers: Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id`。認証情報付きリクエストは受けないので `*` で問題ない。
- **レート制限**: `RL_MCP`（IP ごと 60 回/分）を開発・本番・プレビューの 3 環境に追加。超過は JSON-RPC エラー。
- **入力上限**: 文字列 100 文字、配列 10 件、`page` 50、`limit` 10。
- **ログ**: ツール名・件数・所要時間だけを構造化ログに。検索語は出さない。
- **CSP**: HTML を返さないので既存の `applySecurityHeaders` をそのまま通してよい。

### 6.5 接続ガイド `/ai-connect`

- 接続 URL（`<origin>/mcp`）をコピーボタン付きで表示。
- クライアント別の手順。各サービスの画面は変わりやすいので操作名は断定せず、公式ドキュメントのリンクを添える。
  - ChatGPT: 開発者モードを有効にしてカスタムコネクタを追加。認証は「なし」（トークンを設定している場合はヘッダーを指定）
  - Gemini: Gemini CLI の `settings.json` の `mcpServers` に `httpUrl` を書く例。Gemini API（`@google/genai`）から MCP ツールを渡す例。一般向け Gemini アプリは対応していない場合がある旨
  - Claude / Cursor: カスタムコネクタ、`mcp.json` の例
- 聞き方の例（「夏休みに中学生が出られる、初心者歓迎のプログラミング系はある？過去の定番も」）
- `localhost` には外部の AI から接続できないので、確認はプレビュー環境か `cloudflared` トンネルで行う旨
- フッターと `/chat` からリンク

### 6.6 サイト内 AI チャットへの反映

- 募集中が 0 件のとき、同じ条件に合う「そろそろ募集」シリーズと「過去の定番」（おすすめ順、最大 3 件）を、終了したものだと明示して添える。カードに「ウォッチ」。
- `RankableEvent` に `tagNames` を加え、キーワードがタグ名に一致したら加点する。
- 推薦理由（`ruleReason`）に「参加した N 人がおすすめ」「例年 8 月開催」を加える。どちらも DB の事実。

---

## 7. データモデル

### 7.1 新規テーブル

**`event_series`**

| 列 | 型 | 備考 |
| --- | --- | --- |
| `id` | text PK | UUID |
| `title` | text not null | 初期値は最初の回のタイトルから回表記を除いたもの |
| `match_key` | text not null | `normalizeForMatch(stripEditionMarkers(title))`。インデックス |
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
| `status` | text enum(`active`, `hidden`) | 既定 `active` |
| `use_count` | integer not null default 0 | 非正規化。候補表示の条件にも使う |
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
| `audience` | text enum(`beginner_ok`, `experienced`, `anyone`) not null | 向いている人 |
| `comment` | text | 最大 200 文字 |
| `activity_report_id` | text → activity_reports（set null） | 任意 |
| `status` | text enum(`visible`, `hidden`) | 既定 `visible` |
| `created_at` / `updated_at` | timestamp_ms | |

### 7.2 既存テーブルへの追加

| テーブル | 列 | 備考 |
| --- | --- | --- |
| `events` | `series_id` text → event_series（set null） | **DB 上は nullable、アプリ上は必須。** SQLite は既存行のある表に NOT NULL 列を後から足せない。`createEvent` は必ず入れ、null は「壊れたデータ」として扱う。インデックス `(series_id, start_at)` |
| `events` | `edition_label` text | 最大 30 文字 |
| `events` | `start_month` integer | 1〜12。書き込み時に計算。インデックス `(status, start_month)` |
| `events` | `endorsement_count` integer not null default 0 | インデックス `(status, endorsement_count)` |
| `notification_settings` | `new_edition` boolean not null default true | |

列挙の追加（TypeScript 側のみ）: `NOTIFICATION_TYPES` に `new_edition`、`REPORT_TARGETS` に `endorsement`、`EVENT_FIELD_LABEL` に `tags`・`series`・`editionLabel`、`SORT_OPTIONS` に `recommended`。

### 7.3 マイグレーション

| ファイル | 内容 |
| --- | --- |
| `0002_series_tags_endorsements.sql` | drizzle-kit で生成。表・列・インデックス |
| `0003_backfill_and_seed.sql` | 手書き。既存の各イベントにシリーズを作って `series_id` を入れる（`match_key` ごとに 1 シリーズ。ただし主催者が異なるものは分ける）。`start_month` を `strftime('%m', start_at/1000, 'unixepoch', '+9 hours')` で埋める（Asia/Tokyo 固定・一回限りであることをコメントに残す）。推奨タグ（§5.2）を面付きで投入 |

### 7.4 既存機能への影響

| 機能 | 対応 |
| --- | --- |
| 統合 `mergeEvents` | 統合元の回を統合先のシリーズに移す（元のシリーズが空なら、ウォッチャーを統合先へ移して削除）。おすすめ・タグは、いいねと同じ「統合先に既にあるものを消してから付け替える」方式で同じバッチに入れる |
| 件数の再集計 `recount()` | `endorsement_count` を追加（`status = visible` のみ）。`tags.use_count` は付与・削除時に該当タグだけ再集計 |
| 重複判定 | ロジックは変えない。`differentEdition: true` の候補をシリーズ候補へ回す。同一シリーズの回は重複候補から除く |
| 非公開化 | 非公開の回は年表に投稿者・管理者以外には出さない。シリーズ自体は消さない |
| 通知の統合時付け替え | 既存の `notifications.event_id` の付け替えに加え、`series_watches` の統合 |
| ICS 出力 | 変更なし |

---

## 8. 権限

| 操作 | 未ログイン | ログイン | 投稿者 | 管理者 |
| --- | :-: | :-: | :-: | :-: |
| シリーズ・タグ・おすすめの閲覧、MCP の読み取り | ✓ | ✓ | ✓ | ✓ |
| ウォッチ、お気に入り | | ✓ | ✓ | ✓ |
| おすすめ（終了した回／参加した回） | | ✓ | ✓ | ✓ |
| タグの追加 | | ✓ | ✓ | ✓ |
| タグの削除 | | | ✓ | ✓ |
| 回をシリーズに結びつける（回が 1 つだけのシリーズから） | | ✓ | ✓ | ✓ |
| 回をシリーズから外す・別のシリーズへ移す | | | ✓ | ✓ |
| シリーズ名・説明の編集 | | | ✓（いずれかの回の投稿者） | ✓ |
| タグの面の割り当て・統合・非表示、おすすめの非表示、シリーズの統合 | | | | ✓ |

MCP は `MCP_ACCESS_TOKEN` を設定した場合のみトークン必須。

---

## 9. 変更するファイル

### 9.1 共通（純粋関数。テストの中心）

| ファイル | 内容 |
| --- | --- |
| `app/lib/edition.ts`（新規） | `stripEditionMarkers()`、`suggestNextTitle()`、`editionLabelFrom()` |
| `app/lib/tags.ts`（新規） | `normalizeTagName()`、面の定義とラベル |
| `app/lib/series-stats.ts`（新規） | 回の配列から回数・周期・例年の時期・「そろそろ募集」を算出 |
| `app/lib/labels.ts` | 面・向いている人・`new_edition` のラベル、`SORT_OPTIONS` に `recommended` |

### 9.2 サーバー

| ファイル | 内容 |
| --- | --- |
| `app/.server/db/schema.ts` | §7 |
| `app/.server/validation/event.ts` | `tags`（最大 8）、`seriesId`、`editionLabel` |
| `app/.server/validation/interaction.ts` | おすすめ（`audience`、`comment`、`activityReportId`） |
| `app/.server/services/series.ts`（新規） | `ensureSeriesFor`、`attachToSeries`、`detachFromSeries`、`getSeriesWithEditions`、`findSeriesCandidates`、`listRecurringSoon`、ウォッチ、次の回の引き継ぎ値の生成 |
| `app/.server/services/tags.ts`（新規） | 付与・削除・候補・統合・タグページ用の取得 |
| `app/.server/services/endorsements.ts`（新規） | 登録・更新・取り消し・集計・非表示 |
| `app/.server/services/events.ts` | 検索条件（`tag`・`month`・`sort=recommended`）、`EventCard` に `tags`・`endorsementCount`・`editionLabel`・`series`、作成時の `ensureSeriesFor` と `start_month` |
| `app/.server/services/interactions.ts` | `recount()` に `endorsement_count` |
| `app/.server/services/admin.ts` | `mergeEvents` の対応、タグ・シリーズの管理 |
| `app/.server/services/notifications.ts` | `notifyNewEdition()`、`SETTING_COLUMN` に `new_edition` |
| `app/.server/services/settings.ts` | シリーズ候補の閾値 |
| `app/.server/duplicates/find.ts` | 同一シリーズの除外、`differentEdition` の振り分け |
| `app/.server/chat/engine.ts` / `rank.ts` | §6.6。`loadCandidates` を export |
| `app/.server/url-import/*` | AI によるタグ候補（任意機能） |
| `app/.server/mcp/*`（新規） | §6.4 |
| `app/.server/rate-limit.ts` | `mcp` |
| `app/.server/config.ts` | `MCP_ACCESS_TOKEN`（任意シークレット） |
| `workers/app.ts` | `/mcp` の分岐 |
| `wrangler.jsonc` | `RL_MCP`（3 環境） |

### 9.3 画面

| ファイル | 内容 |
| --- | --- |
| `app/routes.ts` | `series/:id`、`tags`、`tags/:slug`、`ai-connect`、`api/tags`、`api/series/search`、`admin/tags`、`admin/series` |
| `app/routes/events.$id.tsx` | おすすめ、タグと「＋」、他の回ボックス、新しい回の案内、「そろそろ募集」案内、「次の回を登録する」、終了した回での「ウォッチ」 |
| `app/routes/events.new.tsx` | `?seriesId=`、強い候補のバナー、弱い候補のパネル |
| `app/routes/events.$id.edit.tsx` | タグ、他の回との結びつけ、回ラベル |
| `app/routes/events.tsx` | タグ・開催月の絞り込み、おすすめ順 |
| `app/routes/home.tsx` | 「先輩のおすすめ」「例年この時期に募集が始まるイベント」 |
| `app/routes/me.tsx` | 「おすすめした」「ウォッチ中」タブ |
| `app/routes/users.$id.tsx` | 「おすすめしたイベント」 |
| `app/routes/settings.tsx` | `new_edition` の通知設定 |
| `app/routes/series.$id.tsx` / `tags.tsx` / `tags.$slug.tsx` / `ai-connect.tsx`（新規） | §3.4 / §5.5 / §6.5 |
| `app/routes/admin/tags.tsx` / `admin/series.tsx`（新規） | 管理。`admin/series` には「`match_key` が同じで別シリーズになっているもの」の一覧を出す |
| `app/routes/admin/comments.tsx` | おすすめのタブ |
| `app/components/events/event-form.tsx` | タグ入力、`FieldSource` に `previous`、前回の日程ヒント |
| `app/components/events/event-card.tsx` | タグ（最大 3）、おすすめ数、回ラベル、「全 N 回」 |
| `app/components/events/series-card.tsx`（新規） | タグページ・ホーム用のシリーズ単位のカード |
| `app/components/events/series-timeline.tsx`（新規） | 回の年表 |
| `app/components/events/series-candidate-panel.tsx`（新規） | 入口 2 のパネル |
| `app/components/events/tag-input.tsx`（新規） | 面ごとのチップ＋候補付き入力 |
| `app/components/events/endorsement-form.tsx`（新規） | 3 択＋一言＋活動報告の選択 |
| `app/components/site-footer.tsx` | 「タグから探す」「AI アプリとつなぐ」 |

---

## 10. 進め方

ステップごとに PR を分け、各ステップで `npm run typecheck`・`npm test`・`npm run build` を通す。

| Step | 内容 | 確認すること |
| --- | --- | --- |
| 1 | パッケージ追加（`@modelcontextprotocol/sdk`、`@cfworker/json-schema`）、スキーマ、マイグレーション（生成＋バックフィル＋タグ初期データ）、純粋関数とテスト、`createEvent` のシリーズ自動作成 | 既存データに全件シリーズが付く。既存画面が今まで通り動く |
| 2 | シリーズ（ページ、年表、3 つの入口、ウォッチ、`new_edition` 通知、統合への対応） | 普通に投稿しただけで強い候補につながる。主催者が違えば弱い候補に落ちる。ウォッチャーに通知が 1 回だけ届く。統合してもシリーズが壊れない |
| 3 | タグ（入力、タグページ、管理画面、一覧の絞り込み・開催月） | 投稿者以外は追加のみ。利用数 1 のユーザータグが候補に出ない。タグページがシリーズ単位で出る |
| 4 | おすすめ（登録、活動報告リンク、集計、並び、報告、マイページ、プロフィール、ホーム）、「そろそろ募集」の表示 | 終了した回にだけ付けられる。非表示が件数に反映される。「そろそろ募集」が履歴から正しく出る |
| 5 | MCP と `/ai-connect` | MCP Inspector で全ツール・リソースが通る。プレビュー環境に ChatGPT と Gemini CLI から接続できる。トークン設定時に未認証が 401 になる |
| 6 | サイト内 AI チャットへの反映、URL 取り込みのタグ候補 | 0 件のときに過去の定番と「そろそろ募集」が出る |

MCP を先に使いたい場合は、Step 1 のあとに Step 5 を回してもよい。ツールの出力からシリーズ・タグ・おすすめの項目を一時的に省き、あとから足す（項目の追加は互換性を壊さない）。

**今後（別計画）**: MCP の書き込みツール。`@better-auth/oauth-provider` を導入し、OAuth のテーブル・同意画面を用意したうえで「ウォッチ」「お気に入りに追加」「自分の締切一覧」を AI から使えるようにする。

---

## 11. テスト

既存の方針（純粋関数のユニットテスト、`tests/*.test.ts`、Workers ランタイムなし）に合わせる。

| ファイル | 内容 |
| --- | --- |
| `tests/edition.test.ts` | `stripEditionMarkers`（西暦・年度・`'25`・第 N 回・Vol・全角）、`suggestNextTitle`（2025→2026、第4回→第5回、両方あるとき、何も無いとき）、`editionLabelFrom` |
| `tests/tags.test.ts` | `normalizeTagName`（`#`・全角・大小文字・`C++` が残る・空白） |
| `tests/series-stats.test.ts` | 周期判定（毎年・年 2 回・不定）、例年の月（最頻値、同数のとき）、「そろそろ募集」の境界（締切月の 2 か月前、今年の回がある場合は出ない） |
| `tests/series-candidates.test.ts` | `match_key` 一致＋主催者一致で強い候補、主催者不一致で弱い候補、Dice 0.8 の境界、同年の別イベントが候補にならない、URL ホスト一致 |
| `tests/duplicates.test.ts`（追記） | `differentEdition` の候補がシリーズ候補へ回ること、同一シリーズの回の除外 |
| `tests/mcp.test.ts` | `format.ts`（絶対 URL、二通りの日時、`null`、人名を含まない、`evidence`）。`createMcpServer` に差し替え用の取得関数を渡し、SDK の `Client` と `InMemoryTransport` で `initialize` → `tools/list` → 各ツール → `resources/read` を通す。トークン設定時に `Authorization` なしで拒否される |
| `tests/chat.test.ts`（追記） | タグ名一致の加点、0 件時の過去の定番 |

手動確認: ローカルで `npx @modelcontextprotocol/inspector` を `http://localhost:5173/mcp` につなぐ。プレビュー環境に ChatGPT（開発者モード）と Gemini CLI からつなぎ、`find_events` プロンプトで回答に公式 URL と「要確認」の文言が含まれることを見る。

---

## 12. 仮で決めた仕様（学校側で確認したいこと）

1. **おすすめは参加した人だけ**にしている（押すと「参加した」も付く）。参加していなくても「良さそう」と押せる方がよいか。
2. **一言には表示名を出す**（コメントと同じ扱い）。匿名の選択肢を付けるか。
3. **おすすめの 3 択を必須**にしている。1 タップだが、負担なら任意にする。
4. **ユーザーが作ったタグは利用数 2 まで候補に出ない**。学校規模だと 2 に届かないタグが多く残る可能性がある。管理者が面を割り当てて昇格させる運用でよいか。
5. **投稿者以外もシリーズに結びつけられる**（回が 1 つだけのものに限る）。間違いは投稿者・管理者が外せる。
6. **MCP は既定で認証なし**。閲覧がログイン不要なので合わせた。制限したい場合は `MCP_ACCESS_TOKEN` を設定して配布する運用になる。
7. **外部の AI には一言・活動報告の要約を渡す**（人名は渡さない）。本文も渡さない方がよいか。
8. **「そろそろ募集」は表示のみ**で通知はしない。通知が欲しいか。

---

## 13. リスクと対策

| リスク | 対策 |
| --- | --- |
| シリーズの誤結合 | 自動でつなぐのは `match_key` 一致＋主催者または URL ホスト一致のときだけ。それ以外は提案に留め、「別のイベント」で閉じられる。閾値は `app_settings` で調整。投稿者・管理者はあとから外せ、外しても新しいシリーズに移るだけでデータは失われない |
| `series_id` が null の回が混ざる | マイグレーションで全件埋める。`createEvent` が必ず作る。管理ダッシュボードに「シリーズ無しの回」の件数を出して検知 |
| 「そろそろ募集」が外れる（中止・時期変更） | 「予定」ではなく「例年の傾向」と書き、公式サイトでの確認を促す。回が 2 つ以上あるシリーズに限る |
| 古い応募フォームへの誘導 | 応募フォーム URL は引き継がない。公式 URL には「要確認」 |
| タグの乱立 | 面ごとのチップで既存タグへ誘導。利用数 1 のタグは候補に出ない。管理画面で統合・非表示 |
| 外部の AI が日程・締切を誤って伝える | 二通りの日時表記と絶対 URL を必ず返し、`evidence` で根拠を明示。ツール説明とプロンプトで公式確認を促す。未登録は `null` |
| 生徒の情報の外部流出 | MCP 出力に人名を含めない。公開情報のみ |
| MCP の過剰な呼び出し | `RL_MCP`、件数・文字数の上限、ステートレスなので Worker 側に状態が残らない |
| 開催月のタイムゾーン取り違え | `start_month` は書き込み時に `zonedParts()` で計算し、SQL では計算しない。バックフィルの `+9 hours` は一回限りでコメントに残す。テストで月末 23:30 JST の境界を確認 |

---

## 付録: 採用元

| 内容 | 採用元 |
| --- | --- |
| 「全イベントが必ずシリーズに属する」骨格、履歴からの自動算出（周期・例年の時期・そろそろ募集）、おすすめの 3 択、タグの面、`start_month` の書き込み時計算、MCP のリソース、`MCP_ACCESS_TOKEN`、`series_id` の nullable 扱い | Fable 5.1 |
| 章立て、「シリーズ表にする理由」、候補判定の式と閾値の `app_settings` 化、「次回を待つ」の送り先にお気に入り・参加・おすすめを含める、リスク表 | Opus 5.5 |
| 自動割り当て＋主催者／URL ホストのガード、おすすめの活動報告リンク、MCP の `evidence`、サイト内チャットと同じエンジンを使う理由 | GLM 5.3 |
| MCP アノテーション 3 点、`search`／`fetch` の位置づけ、`DuplicatePanel` の拡張という発想 | Argon |
| 公開プロフィールでのおすすめ表示 | Kimi K3 |
| 見送り: カスタムコレクション（Kimi）、`pending` タグの承認フロー（Fable）、`needs_review` 列（GLM）、「そろそろ募集」の Cron 通知（Fable）、`previous_event_id` の数珠つなぎ（Argon） | — |
