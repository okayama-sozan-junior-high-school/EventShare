import { CalendarDays, Pencil } from "lucide-react";
import { data, Link } from "react-router";
import { createDb } from "~/.server/db";
import { getActivity } from "~/.server/services/activities";
import { getUser, isAdmin } from "~/.server/session";
import { ExternalLink, Linkified } from "~/components/external-link";
import { PageContainer } from "~/components/page-header";
import { ReportDialog } from "~/components/report-dialog";
import { Button } from "~/components/ui/button";
import { formatDateTime } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";
import type { Route } from "./+types/activities.$id";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.activity.title ?? "活動報告"} | Event Share` }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const viewer = getUser(context);
  const activity = await getActivity(createDb(), params.id);
  const owner = !!viewer && activity?.userId === viewer.id;
  if (
    !activity ||
    activity.status === "deleted" ||
    ((activity.status !== "visible" || activity.eventStatus !== "published") && !owner && !isAdmin(viewer))
  ) {
    throw data("活動報告が見つかりません", { status: 404 });
  }
  return { activity, canEdit: owner };
}

function Section({ title, text }: { title: string; text: string | null }) {
  if (!text) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">{title}</h2>
      <Linkified text={text} className="mt-2 leading-relaxed" />
    </section>
  );
}

export default function ActivityDetail({ loaderData }: Route.ComponentProps) {
  const { activity, canEdit } = loaderData;
  const tz = useTimeZone();
  return (
    <PageContainer className="max-w-3xl">
      <nav className="mb-4 text-sm text-muted-foreground" aria-label="パンくず">
        <Link to="/activities" className="hover:underline">
          活動報告
        </Link>
      </nav>
      <Link
        to={`/events/${activity.eventId}`}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-primary hover:underline"
      >
        <CalendarDays className="size-4" aria-hidden />
        {activity.eventTitle}
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{activity.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <Link to={`/users/${activity.userId}`} className="font-medium text-foreground hover:underline">
          {activity.userName}
        </Link>
        <span className="mx-1.5">・</span>
        {formatDateTime(activity.createdAt, tz)}
      </p>
      <div className="mt-4 flex gap-2">
        {canEdit && (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/activities/${activity.id}/edit`}>
              <Pencil /> 編集
            </Link>
          </Button>
        )}
        {!canEdit && <ReportDialog targetType="activity_report" targetId={activity.id} />}
      </div>

      {activity.media.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {activity.media.map((m) =>
            m.kind === "image" ? (
              <img key={m.id} src={m.url} alt="" loading="lazy" className="w-full rounded-lg border object-cover" />
            ) : (
              <video key={m.id} src={m.url} controls preload="metadata" className="w-full rounded-lg border bg-black" />
            ),
          )}
        </div>
      )}

      <Section title="参加した理由" text={activity.motivation} />
      <Section title="活動内容" text={activity.activity} />
      <Section title="感想・成果" text={activity.reflection} />
      {activity.relatedUrl && (
        <section className="mt-8">
          <h2 className="text-lg font-bold">関連リンク</h2>
          <ExternalLink href={activity.relatedUrl} className="mt-2 break-all text-primary underline underline-offset-2">
            {activity.relatedUrl}
          </ExternalLink>
        </section>
      )}
    </PageContainer>
  );
}
