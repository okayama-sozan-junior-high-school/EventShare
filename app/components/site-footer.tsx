import { Link } from "react-router";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-foreground">Event Share</p>
          <p>学校外のイベントを見つけて、共有して、挑戦しよう。</p>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="フッター">
          <Link to="/events" className="hover:text-foreground">イベント一覧</Link>
          <Link to="/chat" className="hover:text-foreground">AIで探す</Link>
          <Link to="/calendar" className="hover:text-foreground">カレンダー</Link>
          <Link to="/activities" className="hover:text-foreground">活動報告</Link>
          <Link to="/guidelines" className="hover:text-foreground">利用ガイドライン</Link>
          <Link to="/ai-connect" className="hover:text-foreground">AIから使う</Link>
        </nav>
      </div>
    </footer>
  );
}
