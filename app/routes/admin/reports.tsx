import { eq } from "drizzle-orm";
import { data, Form, Link, useSearchParams } from "react-router";
import { getAuth } from "~/.server/auth";
import { createDb } from "~/.server/db";
import { activityReports, comments } from "~/.server/db/schema";
import { getReport, listReports, resolveReport, setEventStatus } from "~/.server/services/admin";
import { setActivityStatus } from "~/.server/services/activities";
import { recountEventCounters } from "~/.server/services/interactions";
import { requireAdmin } from "~/.server/session";
import { AdminTitle, StatusBadge } from "~/components/admin";
import { EmptyState } from "~/components/empty-state";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatDateTime } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";
import { REPORT_REASON_LABEL, REPORT_TARGET_LABEL } from "~/lib/labels";
import type { Route } from "./+types/reports";

export async function loader({ request }: Route.LoaderArgs) {
  const status = new URL(request.url).searchParams.get("status") === "all" ? "all" : "open";
  return { reports: await listReports(createDb(), status), status };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireAdmin(context, request);
  const db = createDb();
  const form = await request.formData();
  const report = await getReport(db, String(form.get("id")));
  if (!report) throw data("報告が見つかりません", { status: 404 });
  const intent = String(form.get("intent"));
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;

  if (intent === "dismiss") {
    await resolveReport(db, report.id, admin.id, "dismissed", note);
    return { ok: true };
  }
  if (intent === "resolve") {
    await resolveReport(db, report.id, admin.id, "resolved", note);
    return { ok: true };
  }
  if (intent === "hide_target") {
    switch (report.targetType) {
      case "event":
        await setEventStatus(db, report.targetId, "hidden", admin.id);
        break;
      case "comment": {
        const c = await db.query.comments.findFirst({ where: eq(comments.id, report.targetId) });
        if (c) {
          await db.update(comments).set({ status: "hidden" }).where(eq(comments.id, c.id));
          await recountEventCounters(db, c.eventId);
        }
        break;
      }
      case "activity_report": {
        const a = await db.query.activityReports.findFirst({ where: eq(activityReports.id, report.targetId) });
        if (a) await setActivityStatus(db, a.id, "hidden");
        break;
      }
      case "user":
        if (report.targetId === admin.id) throw data("自分自身は停止できません", { status: 400 });
        await getAuth().api.banUser({
          body: { userId: report.targetId, banReason: note ?? "利用ガイドライン違反" },
          headers: request.headers,
        });
        break;
    }
    await resolveReport(db, report.id, admin.id, "resolved", note ?? "対象を非公開にしました");
    return { ok: true };
  }
  throw data("不正なリクエストです", { status: 400 });
}

export default function AdminReports({ loaderData }: Route.ComponentProps) {
  const { reports, status } = loaderData;
  const tz = useTimeZone();
  const [params] = useSearchParams();
  return (
    <>
      <AdminTitle
        title="報告"
        description="不適切な投稿・個人情報・誤り・重複などの報告を確認し、対応します。"
        actions={
          <div className="flex gap-1">
            <Button variant={status === "open" ? "default" : "outline"} size="sm" asChild>
              <Link to="?status=open">未対応</Link>
            </Button>
            <Button variant={params.get("status") === "all" ? "default" : "outline"} size="sm" asChild>
              <Link to="?status=all">すべて</Link>
            </Button>
          </div>
        }
      />
      {reports.length === 0 ? (
        <EmptyState title="報告はありません" />
      ) : (
        <ul className="grid gap-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={r.status} />
                <span className="font-medium">{REPORT_REASON_LABEL[r.reason]}</span>
                <span className="text-muted-foreground">（{REPORT_TARGET_LABEL[r.targetType]}）</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.reporterName ?? "退会ユーザー"} ・ {formatDateTime(r.createdAt, tz)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={r.target.status} />
                {r.target.href ? (
                  <Link to={r.target.href} className="font-medium text-primary hover:underline" target="_blank">
                    {r.target.label}
                  </Link>
                ) : (
                  <span>{r.target.label}</span>
                )}
              </div>
              {r.detail && <p className="mt-2 rounded-md bg-muted p-2 text-sm whitespace-pre-wrap">{r.detail}</p>}
              {r.resolutionNote && <p className="mt-2 text-xs text-muted-foreground">対応メモ: {r.resolutionNote}</p>}
              {r.status === "open" && (
                <Form method="post" className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <Input name="note" placeholder="対応メモ（任意）" className="h-8 max-w-xs" maxLength={500} />
                  {r.reason === "duplicate" && r.targetType === "event" && (
                    <Button size="sm" variant="secondary" asChild>
                      <Link
                        to={`/admin/merge?source=${r.targetId}${r.duplicateOfEventId ? `&target=${r.duplicateOfEventId}` : ""}`}
                      >
                        統合画面へ
                      </Link>
                    </Button>
                  )}
                  {r.target.status !== "missing" && r.target.status !== "hidden" && r.target.status !== "banned" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      name="intent"
                      value="hide_target"
                      onClick={(e) => {
                        if (!confirm(r.targetType === "user" ? "このユーザーを利用停止にしますか？" : "対象を非公開にしますか？")) e.preventDefault();
                      }}
                    >
                      {r.targetType === "user" ? "利用停止にする" : "対象を非公開にする"}
                    </Button>
                  )}
                  <Button size="sm" name="intent" value="resolve">
                    対応済みにする
                  </Button>
                  <Button size="sm" variant="ghost" name="intent" value="dismiss">
                    却下
                  </Button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
