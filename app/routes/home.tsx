import { inArray } from "drizzle-orm";
import { ArrowRight, Search, Sparkles, Ticket } from "lucide-react";
import { Form, Link } from "react-router";
import { createDb } from "~/.server/db";
import { events, eventCategories } from "~/.server/db/schema";
import { listActivities } from "~/.server/services/activities";
import { getActiveCategories, listEventCards } from "~/.server/services/events";
import { getInterests } from "~/.server/services/users";
import { getUser } from "~/.server/session";
import { ActivityCard } from "~/components/activities/activity-card";
import { EmptyState } from "~/components/empty-state";
import { EventCard, type EventCardData } from "~/components/events/event-card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { Route } from "./+types/home";

export async function loader({ context }: Route.LoaderArgs) {
  const db = createDb();
  const now = new Date();
  const user = getUser(context);

  let recommended: EventCardData[] = [];
  let recommendedReason: "interests" | "popular" = "popular";
  if (user) {
    const interestIds = (await getInterests(db, user.id))
      .map((i) => i.categoryId)
      .filter((id): id is number => id !== null);
    if (interestIds.length > 0) {
      recommended = await listEventCards(db, {
        sort: "start",
        limit: 6,
        now,
        where: inArray(
          events.id,
          db
            .select({ id: eventCategories.eventId })
            .from(eventCategories)
            .where(inArray(eventCategories.categoryId, interestIds)),
        ),
      });
      recommendedReason = "interests";
    }
  }
  if (recommended.length === 0) {
    recommended = await listEventCards(db, { sort: "popular", limit: 6, now });
    recommendedReason = "popular";
  }

  const [latest, closingSoon, activities, categories] = await Promise.all([
    listEventCards(db, { sort: "new", limit: 6, now }),
    listEventCards(db, { sort: "deadline", limit: 6, now }).then((list) =>
      list.filter((e) => e.applicationDeadline && e.applicationDeadline > now),
    ),
    listActivities(db, { limit: 4 }),
    getActiveCategories(db),
  ]);

  return { recommended, recommendedReason, latest, closingSoon, activities, categories };
}

function Section({
  title,
  description,
  href,
  children,
}: {
  title: string;
  description?: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {href && (
          <Link to={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline">
            すべて見る <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function CardRow({ events }: { events: EventCardData[] }) {
  return (
    <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
      {events.map((e) => (
        <EventCard key={e.id} event={e} className="w-[78%] shrink-0 snap-start sm:w-auto" />
      ))}
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { recommended, recommendedReason, latest, closingSoon, activities, categories } = loaderData;
  const isEmpty = latest.length === 0;

  return (
    <>
      <section className="border-b bg-gradient-to-b from-brand-soft/70 to-background">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-[1.4fr_1fr] md:py-16">
          <div>
            <p className="mb-3 text-sm font-semibold text-primary">学校の外に、挑戦のきっかけを。</p>
            <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
              コンテスト、勉強会、研究発表。
              <br className="hidden sm:block" />
              気になるイベントを見つけて、みんなで共有しよう。
            </h1>
            <Form method="get" action="/events" className="mt-6 flex max-w-xl gap-2" role="search">
              <label htmlFor="home-q" className="sr-only">
                キーワードでイベントを検索
              </label>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input id="home-q" name="q" placeholder="例: ハッカソン、プログラミング、岡山" className="h-11 bg-card pl-9" />
              </div>
              <Button type="submit" size="lg" className="h-11">
                検索
              </Button>
            </Form>
            <div className="mt-4 flex flex-wrap gap-2">
              {categories.slice(0, 8).map((c) => (
                <Link
                  key={c.id}
                  to={`/events?category=${c.slug}`}
                  className="rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>
          <Link
            to="/chat"
            className="group flex flex-col justify-between gap-6 rounded-2xl bg-primary p-6 text-primary-foreground shadow-lg transition hover:shadow-xl"
          >
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
                <Sparkles className="size-3.5" aria-hidden /> AIイベント検索
              </span>
              <p className="mt-4 text-xl font-bold">何に参加すればいいか迷ったら、AIに相談しよう</p>
              <p className="mt-2 text-sm text-primary-foreground/80">
                「何か作ってみたい」「AIに興味がある」など、気軽に話しかけるだけ。登録済みのイベントから、あなたに合いそうなものを探します。
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-semibold">
              AIに相談する <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden />
            </span>
          </Link>
        </div>
      </section>

      {isEmpty ? (
        <div className="mx-auto max-w-6xl px-4 py-12">
          <EmptyState
            icon={Ticket}
            title="まだイベントが登録されていません"
            description="知っている学校外のイベントがあれば、最初の情報提供者になりましょう。"
          >
            <Button asChild>
              <Link to="/events/new">イベントを投稿する</Link>
            </Button>
          </EmptyState>
        </div>
      ) : (
        <>
          <Section
            title="おすすめのイベント"
            description={
              recommendedReason === "interests"
                ? "プロフィールの「興味・関心」に合うイベントです"
                : "いいね・お気に入りが多いイベントです"
            }
            href="/events?sort=popular"
          >
            <CardRow events={recommended} />
          </Section>
          <Section title="新着イベント" href="/events?sort=new">
            <CardRow events={latest} />
          </Section>
          {closingSoon.length > 0 && (
            <Section title="締切が近いイベント" description="応募はお早めに" href="/events?sort=deadline&deadline=open">
              <CardRow events={closingSoon} />
            </Section>
          )}
        </>
      )}

      <Section title="活動報告" description="イベントに参加した生徒のレポート" href="/activities">
        {activities.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {activities.map((a) => (
              <ActivityCard key={a.id} activity={a} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="まだ活動報告はありません"
            description="イベントに参加したら、学んだことや感想を共有してみましょう。"
          />
        )}
      </Section>
    </>
  );
}
