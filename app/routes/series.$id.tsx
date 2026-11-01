import { data, Link, useFetcher } from "react-router";
import { getConfig } from "~/.server/config";
import { createDb } from "~/.server/db";
import { getSeriesDetail, unwatchSeries, watchSeries } from "~/.server/services/series";
import { enforceRateLimit } from "~/.server/rate-limit";
import { getUser, isAdmin, requireUser } from "~/.server/session";
import { PageContainer, PageHeader } from "~/components/page-header";
import { SeriesTimeline } from "~/components/events/series-timeline";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { getEventPhase } from "~/lib/event-phase";
import { useCurrentUser } from "~/lib/hooks";
import { SERIES_CADENCE_LABEL } from "~/lib/labels";
import type { Route } from "./+types/series.$id";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "シリーズが見つかりません | Event Share" }];
  return [
    { title: `${loaderData.series.title} | Event Share` },
    { name: "description", content: `${loaderData.series.title}の開催回` },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const db = createDb();
  const { timeZone } = getConfig();
  const viewer = getUser(context);
  const detail = await getSeriesDetail(db, params.id, viewer?.id ?? null, timeZone);
  if (!detail) throw data("シリーズが見つかりません", { status: 404 });

  const admin = isAdmin(viewer);
  const now = new Date();
  const editions = detail.editions
    .filter((edition) => {
      if (edition.status === "merged") return false;
      if (edition.status === "published") return true;
      return !!viewer && (admin || edition.createdById === viewer.id);
    })
    .map((edition) => ({
      id: edition.id,
      title: edition.title,
      editionLabel: edition.editionLabel,
      startAt: edition.startAt,
      phase: getEventPhase(edition, now),
      hidden: edition.status !== "published",
    }))
    .sort((a, b) => (b.startAt?.getTime() ?? -1) - (a.startAt?.getTime() ?? -1));

  return {
    series: {
      id: detail.id,
      title: detail.displayTitle,
      description: detail.description,
      watching: detail.watching,
    },
    stats: detail.stats,
    editions,
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const user = requireUser(context, request);
  await enforceRateLimit("write", user.id);
  const intent = String((await request.formData()).get("intent"));
  if (intent !== "watch" && intent !== "unwatch") throw data("不正なリクエストです", { status: 400 });
  const db = createDb();
  const ok =
    intent === "watch"
      ? await watchSeries(db, user.id, params.id)
      : await unwatchSeries(db, user.id, params.id);
  if (!ok) throw data("シリーズが見つかりません", { status: 404 });
  return { watching: intent === "watch" };
}

function WatchButton({ watching }: { watching: boolean }) {
  const fetcher = useFetcher();
  const user = useCurrentUser();
  const pending = fetcher.formData?.get("intent");
  const on = pending === "watch" ? true : pending === "unwatch" ? false : watching;
  if (!user) {
    return (
      <Button variant="outline" asChild>
        <Link to="/login">ログインしてウォッチ</Link>
      </Button>
    );
  }
  return (
    <fetcher.Form method="post">
      <Button type="submit" name="intent" value={on ? "unwatch" : "watch"} variant={on ? "default" : "outline"}>
        {on ? "ウォッチ中" : "ウォッチする"}
      </Button>
    </fetcher.Form>
  );
}

function Stat({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border bg-card px-3 py-1 text-sm">{children}</span>;
}

export default function SeriesPage({ loaderData }: Route.ComponentProps) {
  const { series, stats, editions } = loaderData;
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title={series.title}
        description={series.description || "同じイベントの開催回です。"}
        actions={
          <>
            <WatchButton watching={series.watching} />
            <Button asChild>
              <Link to={`/events/new?seriesId=${series.id}`}>次の回を登録</Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Stat>全{stats.count}回</Stat>
        {stats.cadence && <Stat>周期: {SERIES_CADENCE_LABEL[stats.cadence]}</Stat>}
        {stats.typicalStartMonth && <Stat>例年の開催時期: {stats.typicalStartMonth}月ごろ</Stat>}
        {stats.typicalDeadlineMonth && <Stat>例年の締切時期: {stats.typicalDeadlineMonth}月ごろ</Stat>}
        {stats.recurringSoon && <Badge>そろそろ募集</Badge>}
      </div>
      {stats.recurringSoon && (
        <p className="mt-3 text-sm text-muted-foreground">
          例年の傾向です。今年の募集が始まっているかは、公式サイトで確認してください。
        </p>
      )}

      <section className="mt-8" aria-labelledby="editions">
        <h2 id="editions" className="text-lg font-bold">
          開催回
        </h2>
        <div className="mt-3">
          <SeriesTimeline editions={editions} />
        </div>
      </section>
    </PageContainer>
  );
}
