import { PageContainer, PageHeader } from "~/components/page-header";

export const meta = () => [{ title: "利用ガイドライン | Event Share" }];

const RULES = [
  {
    title: "学校外のイベント情報を共有する場所です",
    body: "コンテスト、勉強会、研究発表会、ボランティアなど、生徒が参加できる学校外のイベント情報を共有してください。宣伝目的の投稿や、イベントと関係のない投稿は削除されることがあります。",
  },
  {
    title: "個人情報を書き込まない",
    body: "自分や他の人の本名・住所・電話番号・SNSアカウント・顔写真など、個人を特定できる情報は投稿しないでください。表示名は本名である必要はありません。",
  },
  {
    title: "正確な情報を、出典とともに",
    body: "イベント情報は公式サイトの内容をもとに投稿し、わからない項目は空欄のままにしてください。AIやページから自動取得した情報は、必ず自分で確認してから投稿してください。",
  },
  {
    title: "同じイベントは1つにまとめる",
    body: "すでに登録されているイベントは新しく作らず、「情報を追加」から足りない情報を補ってください。重複を見つけたら「報告」から知らせてください。",
  },
  {
    title: "思いやりのあるコミュニケーション",
    body: "他の人を傷つける表現、差別的な表現、からかい、なりすましは禁止です。困ったことがあれば「報告」ボタンから管理者に知らせてください。",
  },
  {
    title: "参加は自己責任で、保護者・先生とも相談を",
    body: "掲載されているイベントは学校が主催・推薦するものではありません。参加する前に公式サイトで最新情報を確認し、必要に応じて保護者や先生に相談してください。",
  },
];

export default function Guidelines() {
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="利用ガイドライン" description="みんなが安心して使えるように、次のルールを守ってください。" />
      <ol className="grid gap-4">
        {RULES.map((r, i) => (
          <li key={r.title} className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">
              {i + 1}. {r.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{r.body}</p>
          </li>
        ))}
      </ol>
      <section className="mt-8 rounded-xl border bg-card p-5 text-sm leading-relaxed text-muted-foreground">
        <h2 className="font-semibold text-foreground">収集する情報について</h2>
        <p className="mt-2">
          Event Share が保存するのは、ログインに必要なメールアドレスとパスワード（ハッシュ化して保存）、表示名・学年・自己紹介・興味のある分野（任意）、投稿内容です。メールアドレスは他のユーザーに公開されません。プロフィールの公開範囲は設定画面で変更できます。AIチャットの会話は、ログインしている場合のみ保存され、AIにはイベント検索に必要な最小限の情報のみを渡します。
        </p>
      </section>
    </PageContainer>
  );
}
