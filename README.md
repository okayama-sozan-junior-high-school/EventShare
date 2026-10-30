# Event Share

学校内の生徒が、学校外で開催されるイベント・コンテスト・勉強会・研究発表会などの情報を共有し、新しい挑戦のきっかけを見つけるための Web アプリケーションです。Cloudflare Workers 上で動作します。

- イベントの閲覧・検索・AI チャットによる推薦は **ログイン不要**
- イベントの投稿・情報追加・コメント・いいね・お気に入り・活動報告などは **ログインが必要**
- 設計の詳細は [docs/architecture.md](docs/architecture.md) を参照してください

## 主な機能

| 分類 | 機能 |
| --- | --- |
| イベント | 一覧（新着／開催日／締切／人気順）、キーワード・カテゴリ・時期・締切・場所・形式・参加費・対象者での絞り込み、詳細、カレンダー、ICS 出力、共有 |
| 投稿 | URL からの自動取得（JSON-LD / OGP / 本文・必要に応じて AI）→ 確認・修正して投稿、手動入力、画像アップロード（R2） |
| 重複対策 | 名称・日時・主催・場所・概要の類似度スコア（配点・閾値は管理画面で調整可）、候補提示（既存を確認／情報を追加／別イベントとして投稿／修正）、管理者による統合 |
| 情報集約 | イベント本体と情報提供者を分離（`event_contributions` / `event_sources`）、変更履歴（項目ごとの差分）を保持 |
| 交流 | いいね、お気に入り、参加予定、コメント（編集・削除）、共有、不適切投稿・重複の報告 |
| 活動報告 | 参加理由・活動内容・感想、写真・動画（R2）、関連 URL、イベント詳細から参照 |
| ユーザー | プロフィール（公開範囲：全体／ログインユーザー／非公開）、興味・関心、投稿・編集履歴、通知と受信設定 |
| AI | 会話で希望条件を聞き取り → サーバー側で DB 検索・ランキング → 根拠付きでイベントカードを提示、興味・関心の保存（同意制） |
| 管理 | ダッシュボード、報告対応、イベント管理・統合、ユーザー管理（権限・利用停止・セッション無効化）、コメント、カテゴリ、履歴、重複判定設定 |

## 技術スタック

| 分野 | 採用技術 | 備考 |
| --- | --- | --- |
| フレームワーク | React Router v8（Framework Mode）+ React 19 + TypeScript | `create-cloudflare` の公式テンプレートから作成 |
| 実行環境 | Cloudflare Workers（`@cloudflare/vite-plugin`、Wrangler 4） | `nodejs_compat` を有効化 |
| DB / ORM | Cloudflare D1 + Drizzle ORM | マイグレーションは drizzle-kit で生成し Wrangler で適用 |
| ファイル | Cloudflare R2 | `/media/:id` から配信（DB に登録されたファイルのみ） |
| 認証 | Better Auth（メール＋パスワード、admin プラグイン） | Drizzle アダプター経由で D1 に保存 |
| UI | Tailwind CSS v4 + shadcn/ui（radix-nova） | |
| バリデーション | Zod v4 | |
| AI | Groq（既定: `qwen/qwen3.8-27b`、Structured Outputs） | 未設定時はルールベース。`AI_PROVIDER` で Workers AI / OpenAI 互換 API にも切り替え可能 |
| レート制限 | Workers Rate Limiting バインディング | |
| 定期実行 | Cron Triggers（毎日 09:00 JST） | 締切・開催日リマインダー、不要ファイル掃除 |
| テスト | Vitest | 純粋ロジックのユニットテスト |

## セットアップ（ローカル開発）

前提: Node.js 20 以上（22 推奨）

```bash
npm install                     # postinstall で wrangler types が実行されます
cp .dev.vars.example .dev.vars  # BETTER_AUTH_SECRET を設定（openssl rand -base64 32）
npm run db:migrate:local        # ローカル D1 にマイグレーションを適用（カテゴリの初期データを含む）
npm run db:seed:dev             # （任意）動作確認用のサンプルイベントを投入
npm run dev                     # http://localhost:5173
```

ローカルの D1 / R2 / レート制限は Miniflare によってエミュレートされ、データは `.wrangler/state` に保存されます。Cloudflare アカウントは不要です。

### 管理者の作成

サインアップ後、次のコマンドで管理者権限を付与します（メールアドレスでの自動付与は、なりすまし登録のリスクがあるため採用していません）。

```bash
npm run admin:grant -- you@example.com            # ローカル
npm run admin:grant -- you@example.com --remote   # 本番
```

以降は管理画面（`/admin/users`）から他のユーザーを管理者にできます。

### AI 機能をローカルで使う場合

既定のプロバイダは Groq です。`.dev.vars` に `GROQ_API_KEY`（[Groq Console](https://console.groq.com/keys) で発行）を設定して `npm run dev` すると、チャットと URL 取り込みで AI が動きます。キーが無いときはルールベースで動作します。モデルは `wrangler.jsonc` の `AI_MODEL`（既定 `qwen/qwen3.8-27b`）で変更できます。

Workers AI を使う場合は `wrangler.jsonc` に `ai` バインディングを戻し、`AI_PROVIDER=workers-ai` と Workers AI のモデル ID を設定したうえで、`npx wrangler login` の後、次のように起動します。

```bash
CF_REMOTE_BINDINGS=true npm run dev
```

OpenAI 互換 API を使う場合は `.dev.vars` に `AI_PROVIDER=openai`、`OPENAI_API_KEY`、必要なら `OPENAI_BASE_URL`・`AI_MODEL` を設定してください。

## 環境変数

`wrangler.jsonc` の `vars`（公開してよい設定）と、シークレット（`.dev.vars` / `wrangler secret put`）に分かれています。

| 名前 | 種別 | 説明 |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | シークレット（必須） | セッション署名・暗号化用。32文字以上のランダム値 |
| `BETTER_AUTH_URL` | var | アプリの公開 URL（Cookie・CSRF の信頼オリジン） |
| `APP_TIMEZONE` | var | 表示・入力に使うタイムゾーン（既定 `Asia/Tokyo`）。DB には UTC のミリ秒で保存 |
| `SIGNUP_MODE` | var | `open`（誰でも登録可）または `domain`（`SCHOOL_EMAIL_DOMAINS` のみ） |
| `SCHOOL_EMAIL_DOMAINS` | var | 学校メールのドメイン（カンマ区切り、サブドメインも許可） |
| `AI_PROVIDER` | var | `groq` / `workers-ai` / `openai` / `none` |
| `AI_MODEL` | var | 使用するモデル名（Groq の既定は `qwen/qwen3.8-27b`） |
| `GROQ_API_KEY` | シークレット | `AI_PROVIDER=groq` の場合 |
| `OPENAI_API_KEY` | シークレット（任意） | `AI_PROVIDER=openai` の場合のみ |
| `OPENAI_BASE_URL` | シークレット（任意） | OpenAI 互換 API のベース URL |
| `CF_REMOTE_BINDINGS` | ローカルのシェル環境変数 | `true` で開発時に Workers AI などのリモートバインディングを使う |

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルドして本番モードでローカル実行（CSP なども本番と同じ） |
| `npm run typecheck` | 型生成 + 型チェック |
| `npm test` | ユニットテスト（Vitest） |
| `npm run db:generate` | スキーマ変更からマイグレーション SQL を生成（`drizzle/migrations`） |
| `npm run db:migrate:local` / `db:migrate:remote` | マイグレーションの適用（ローカル / 本番） |
| `npm run db:seed:dev` | ローカル DB にサンプルデータを投入（本番には実行できません） |
| `npm run admin:grant -- <email> [--remote]` | 管理者権限の付与 |

### スキーマを変更するとき

1. `app/.server/db/schema.ts` を編集
2. `npm run db:generate` で SQL を生成し、内容を確認してコミット
3. `npm run db:migrate:local` で適用・動作確認
4. デプロイ前に `npm run db:migrate:remote`

## デプロイ（Cloudflare）

開発環境（トップレベル設定）と本番環境（`env.production`）で D1・R2・レート制限の名前空間を分けています。

```bash
npx wrangler login

# 1. 本番リソースを作成
npx wrangler d1 create event-share-prod          # 出力された database_id を wrangler.jsonc の env.production に設定
npx wrangler r2 bucket create event-share-media-prod

# 2. wrangler.jsonc の env.production.vars.BETTER_AUTH_URL を本番 URL に変更

# 3. シークレットを設定
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put GROQ_API_KEY --env production

# 4. マイグレーションを適用
npm run db:migrate:remote

# 5. ビルドしてデプロイ（build は本番環境を使います）
npm run build
npx wrangler deploy
```

`npm run build` は `CLOUDFLARE_ENV=production` でビルドし、`build/server/wrangler.json` に本番の D1・R2・公開 URL を出力します。`wrangler deploy` はそれを使います。ローカル開発の `npm run dev` はこれまでどおりトップレベルの開発用設定です。Cloudflare の Git 連携もビルドコマンドが `npm run build` のまま、この本番設定でデプロイされます。

## セキュリティ

- 認証・権限はすべてサーバー側（loader / action / middleware）で検証。管理画面はレイアウトのミドルウェアと各 action の両方でチェック
- パスワードは Better Auth が scrypt（workerd ではネイティブ実装）でハッシュ化。セッションは 7 日で失効、パスワード変更時は他端末のセッションを無効化、利用停止時は全セッションを削除
- CSRF: Better Auth の SameSite=Lax Cookie + 状態変更リクエストの `Origin` / `Sec-Fetch-Site` 検証
- XSS: React のエスケープ、`dangerouslySetInnerHTML` 不使用、本番は nonce ベースの CSP、外部リンクは http(s) のみ・`rel="noopener noreferrer nofollow ugc"`
- SQL インジェクション: Drizzle のパラメータ化クエリ、LIKE はワイルドカードをエスケープ
- SSRF: http(s)・標準ポートのみ、IP 直指定・内部ホスト名を拒否、DNS-over-HTTPS で解決して私設アドレスを拒否、リダイレクトは毎回再検証（最大 3 回）、タイムアウト・サイズ上限、robots.txt を尊重し 1 ページのみ取得
- アップロード: マジックバイトで種類を判定（SVG 不可）、画像 5MB・動画 50MB、配信時は `nosniff` と `sandbox` CSP
- レート制限: 認証（IP 単位）、書き込み・URL 取得・AI（ユーザー単位）
- AI: 渡すのはユーザーの発言とイベントの公開情報のみ。出力は Zod で検証し、存在しないイベント ID・日付・金額・URL を含む推薦理由は破棄してルールベースの理由に置き換え
- ログにパスワード・トークン・個人情報を出力しない

## テスト

```bash
npm test          # 重複判定、日時・タイムゾーン、SSRF 対策、HTML 抽出、robots.txt、アップロード検証、CSRF、チャットの条件抽出・ランキング
npm run typecheck
```

## ディレクトリ構成

```
app/
  .server/            サーバー専用コード（クライアントバンドルに含まれない）
    ai/               AI クライアント（Groq / Workers AI / OpenAI 互換）
    chat/             AI チャット（条件抽出・ランキング・推薦理由・履歴）
    db/               Drizzle スキーマ・接続
    duplicates/       重複判定（スコア計算・候補検索）
    media/            R2 への保存・ファイル検証
    services/         ドメインロジック（イベント、通知、管理など）
    url-import/       URL からの情報取得（SSRF 対策、robots.txt、抽出）
    validation/       Zod スキーマ
    auth.ts           Better Auth 設定
    security.ts       CSRF・セキュリティヘッダー
  components/         UI コンポーネント（ui/ は shadcn/ui）
  lib/                クライアント・サーバー共通のユーティリティ
  routes/             画面とリソースルート
drizzle/migrations/   D1 マイグレーション
scripts/              サンプルデータ投入・管理者付与
tests/                ユニットテスト
workers/app.ts        Worker エントリ（fetch / scheduled）
```
