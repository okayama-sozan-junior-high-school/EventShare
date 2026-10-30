import { Link } from "react-router";
import { createDb } from "~/.server/db";
import { dashboardStats, listReports } from "~/.server/services/admin";
import { AdminTitle, StatusBadge } from "~/components/admin";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { formatRelative } from "~/lib/datetime";
import { REPORT_REASON_LABEL, REPORT_TARGET_LABEL } from "~/lib/labels";
import type { Route } from "./+types/dashboard";

export async function loader() {
  const db = createDb();
  const [stats, reports] = await Promise.all([dashboardStats(db), listReports(db, "open")]);
  return { stats, reports: reports.slice(0, 5) };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { stats, reports } = loaderData;
  const cards = [
    { label: "未対応の報告", value: stats.openReports, href: "/admin/reports", highlight: stats.openReports > 0 },
    { label: "公開中のイベント", value: stats.published, href: "/admin/events?status=published" },
    { label: "非公開のイベント", value: stats.hidden, href: "/admin/events?status=hidden" },
    { label: "ユーザー数", value: stats.users, href: "/admin/users" },
    { label: "7日間の新規イベント", value: stats.newEvents, href: "/admin/events" },
    { label: "7日間のコメント", value: stats.newComments, href: "/admin/comments" },
  ];
  return (
    <>
      <AdminTitle title="ダッシュボード" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} to={c.href} className="rounded-xl border bg-card p-4 transition hover:shadow-sm">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={c.highlight ? "mt-1 text-3xl font-bold text-destructive" : "mt-1 text-3xl font-bold"}>{c.value}</p>
          </Link>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">新しい報告</CardTitle>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">未対応の報告はありません。</p>
          ) : (
            <ul className="divide-y">
              {reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <StatusBadge status={r.status} />
                  <span className="text-muted-foreground">
                    {REPORT_TARGET_LABEL[r.targetType]}・{REPORT_REASON_LABEL[r.reason]}
                  </span>
                  <span className="truncate font-medium">{r.target.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatRelative(r.createdAt, new Date())}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
