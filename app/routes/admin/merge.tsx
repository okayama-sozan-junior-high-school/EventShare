import { ArrowRight, GitMerge } from "lucide-react";
import { data, Form, redirect, useNavigation } from "react-router";
import { getConfig } from "~/.server/config";
import { createDb } from "~/.server/db";
import { scoreDuplicate } from "~/.server/duplicates/score";
import { mergeEvents } from "~/.server/services/admin";
import { getEvent } from "~/.server/services/events";
import { getDuplicateConfig } from "~/.server/services/settings";
import { requireAdmin } from "~/.server/session";
import { AdminTitle, StatusBadge } from "~/components/admin";
import { FormError } from "~/components/form-field";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { formatDateTime } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";
import { FEE_LABEL, FORMAT_LABEL } from "~/lib/labels";
import type { Route } from "./+types/merge";

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const idFrom = (v: string | null) => (v ? (UUID.exec(v)?.[1]?.toLowerCase() ?? null) : null);

export async function loader({ request }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  const db = createDb();
  const sourceId = idFrom(sp.get("source"));
  const targetId = idFrom(sp.get("target"));
  const [source, target] = await Promise.all([
    sourceId ? getEvent(db, sourceId) : null,
    targetId ? getEvent(db, targetId) : null,
  ]);
  const score =
    source && target
      ? scoreDuplicate(source, target, await getDuplicateConfig(db), getConfig().timeZone)
      : null;
  return { source: source ?? null, target: target ?? null, score, sourceInput: sp.get("source") ?? "", targetInput: sp.get("target") ?? "" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireAdmin(context, request);
  const db = createDb();
  const form = await request.formData();
  const source = await getEvent(db, String(form.get("sourceId")));
  const target = await getEvent(db, String(form.get("targetId")));
  if (!source || !target) return data({ error: "イベントが見つかりません" }, { status: 400 });
  if (source.id === target.id) return data({ error: "同じイベントは統合できません" }, { status: 400 });
  if (source.status === "merged" || target.status === "merged") {
    return data({ error: "統合済みのイベントは選べません" }, { status: 400 });
  }
  await mergeEvents(db, source, target, admin.id);
  throw redirect(`/events/${target.id}`);
}

type EventView = NonNullable<Route.ComponentProps["loaderData"]["source"]>;

function EventSummary({ event, label }: { event: EventView; label: string }) {
  const tz = useTimeZone();
  const rows: [string, string | null][] = [
    ["開催日時", event.startAt ? formatDateTime(event.startAt, tz) : null],
    ["場所", event.location],
    ["形式", FORMAT_LABEL[event.format]],
    ["主催者", event.organizer],
    ["対象者", event.targetAudience],
    ["参加費", FEE_LABEL[event.feeType]],
    ["応募締切", event.applicationDeadline ? formatDateTime(event.applicationDeadline, tz) : null],
    ["公式URL", event.officialUrl],
  ];
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <StatusBadge status={event.status} />
        <a href={`/events/${event.id}`} target="_blank" rel="noopener" className="font-semibold hover:underline">
          {event.title}
        </a>
      </div>
      <dl className="mt-3 grid gap-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[80px_1fr] gap-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all">{v ?? <span className="text-muted-foreground">未設定</span>}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        いいね {event.likeCount} ・ お気に入り {event.bookmarkCount} ・ コメント {event.commentCount}
      </p>
    </div>
  );
}

export default function AdminMerge({ loaderData, actionData }: Route.ComponentProps) {
  const { source, target, score, sourceInput, targetInput } = loaderData;
  const navigation = useNavigation();
  return (
    <>
      <AdminTitle
        title="重複イベントの統合"
        description="統合元のイベントの情報・いいね・お気に入り・コメント・活動報告・履歴を、統合先のイベントへ移します。統合元のURLは統合先へ転送されます。"
      />
      <Form method="get" className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="grid gap-1.5">
          <Label htmlFor="source">統合元（重複している側）</Label>
          <Input id="source" name="source" defaultValue={sourceInput} placeholder="イベントのURLまたはID" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="target">統合先（残す側）</Label>
          <Input id="target" name="target" defaultValue={targetInput} placeholder="イベントのURLまたはID" />
        </div>
        <Button type="submit" variant="outline">
          比較する
        </Button>
      </Form>

      {source && target && (
        <div className="mt-6">
          {score && (
            <p className="mb-3 text-sm">
              類似度: <span className="font-bold">{score.score}点</span>
              <span className="ml-2 text-muted-foreground">
                （名称 {score.breakdown.title} / 日時 {score.breakdown.date} / 主催 {score.breakdown.organizer} / 場所{" "}
                {score.breakdown.location} / 概要 {score.breakdown.description}
                {score.urlMatch && " / URL一致"}
                {score.differentEdition && " / 別開催回の可能性"}）
              </span>
            </p>
          )}
          <div className="grid items-start gap-3 md:grid-cols-[1fr_auto_1fr]">
            <EventSummary event={source} label="統合元" />
            <ArrowRight className="mx-auto mt-10 hidden size-6 text-muted-foreground md:block" aria-hidden />
            <EventSummary event={target} label="統合先（残る）" />
          </div>
          <Form
            method="post"
            className="mt-4 grid gap-3"
            onSubmit={(e) => {
              if (!confirm("統合を実行しますか？この操作は元に戻せません。")) e.preventDefault();
            }}
          >
            <FormError message={actionData?.error} />
            <input type="hidden" name="sourceId" value={source.id} />
            <input type="hidden" name="targetId" value={target.id} />
            <p className="text-sm text-muted-foreground">
              統合先で未設定の項目だけが統合元の値で補われます。既存の値は上書きされません。
            </p>
            <div>
              <Button type="submit" disabled={navigation.state !== "idle"}>
                <GitMerge /> 統合を実行
              </Button>
            </div>
          </Form>
        </div>
      )}
      {(sourceInput || targetInput) && (!source || !target) && (
        <p className="mt-4 text-sm text-destructive">イベントが見つかりません。URLまたはIDを確認してください。</p>
      )}
    </>
  );
}
