import { and, eq, gte, inArray, lt, or, type SQL } from "drizzle-orm";
import { ChevronLeft, ChevronRight, Timer } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { getConfig } from "~/.server/config";
import { createDb } from "~/.server/db";
import { eventBookmarks, events } from "~/.server/db/schema";
import { getUser } from "~/.server/session";
import { EmptyState } from "~/components/empty-state";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";
import { toDateKey, zonedLocalToDate, zonedParts } from "~/lib/datetime";
import { getEventPhase, type EventPhase } from "~/lib/event-phase";
import { useTimeZone } from "~/lib/hooks";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/calendar";

export const meta = () => [{ title: "カレンダー | Event Share" }];

type Item = { kind: "event" | "deadline"; id: string; title: string; at: Date; phase: EventPhase };

const pad = (n: number) => String(n).padStart(2, "0");

export async function loader({ request, context }: Route.LoaderArgs) {
  const { timeZone } = getConfig();
  const url = new URL(request.url);
  const now = new Date();
  const today = zonedParts(now, timeZone);
  const m = /^(\d{4})-(\d{2})$/.exec(url.searchParams.get("month") ?? "");
  let year = m ? Number(m[1]) : today.year;
  let month = m ? Number(m[2]) : today.month;
  if (month < 1 || month > 12 || year < 2000 || year > 2100) {
    year = today.year;
    month = today.month;
  }
  const start = zonedLocalToDate(`${year}-${pad(month)}-01`, timeZone)!;
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const end = zonedLocalToDate(`${next.y}-${pad(next.m)}-01`, timeZone)!;

  const user = getUser(context);
  const mineOnly = url.searchParams.get("mine") === "1" && !!user;
  const db = createDb();
  const where: SQL[] = [
    eq(events.status, "published"),
    or(
      and(gte(events.startAt, start), lt(events.startAt, end)),
      and(gte(events.applicationDeadline, start), lt(events.applicationDeadline, end)),
    )!,
  ];
  if (mineOnly) {
    where.push(
      inArray(
        events.id,
        db.select({ id: eventBookmarks.eventId }).from(eventBookmarks).where(eq(eventBookmarks.userId, user!.id)),
      ),
    );
  }
  const rows = await db.select().from(events).where(and(...where)).limit(500);

  const items: Item[] = [];
  for (const e of rows) {
    const phase = getEventPhase(e, now);
    if (e.startAt && e.startAt >= start && e.startAt < end) {
      items.push({ kind: "event", id: e.id, title: e.title, at: e.startAt, phase });
    }
    if (e.applicationDeadline && e.applicationDeadline >= start && e.applicationDeadline < end) {
      items.push({ kind: "deadline", id: e.id, title: e.title, at: e.applicationDeadline, phase });
    }
  }
  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    year,
    month,
    items,
    mineOnly,
    loggedIn: !!user,
    todayKey: toDateKey(now, timeZone),
    prev: month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`,
    next: `${next.y}-${pad(next.m)}`,
  };
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

function ItemPill({ item, compact }: { item: Item; compact?: boolean }) {
  const ended = item.phase === "ended";
  return (
    <Link
      to={`/events/${item.id}`}
      className={cn(
        "block truncate rounded px-1.5 py-0.5 text-[11px] leading-4",
        item.kind === "event"
          ? "bg-primary/10 text-primary hover:bg-primary/20"
          : "bg-amber-100 text-amber-900 hover:bg-amber-200",
        ended && "opacity-60",
        compact && "text-[10px]",
      )}
      title={`${item.kind === "deadline" ? "締切: " : ""}${item.title}`}
    >
      {item.kind === "deadline" && "締切 "}
      {item.title}
    </Link>
  );
}

export default function CalendarPage({ loaderData }: Route.ComponentProps) {
  const { year, month, items, mineOnly, loggedIn, todayKey, prev, next } = loaderData;
  const tz = useTimeZone();
  const [params] = useSearchParams();
  const mineParam = params.get("mine") === "1" ? "&mine=1" : "";

  const byDay = new Map<string, Item[]>();
  for (const item of items) {
    const key = toDateKey(item.at, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const keyOf = (d: number) => `${year}-${pad(month)}-${pad(d)}`;
  const agendaDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <PageContainer>
      <PageHeader title="カレンダー" description="イベントの開催日と応募締切を月ごとに確認できます。" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" asChild>
            <Link to={`?month=${prev}${mineParam}`} aria-label="前の月">
              <ChevronLeft />
            </Link>
          </Button>
          <h2 className="min-w-32 text-center text-lg font-bold" aria-live="polite">
            {year}年{month}月
          </h2>
          <Button variant="outline" size="icon" asChild>
            <Link to={`?month=${next}${mineParam}`} aria-label="次の月">
              <ChevronRight />
            </Link>
          </Button>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to={mineParam ? "?mine=1" : "?"}>今月</Link>
        </Button>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="size-3 rounded bg-primary/20" /> 開催日
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-3 rounded bg-amber-200" /> 応募締切
          </span>
          {loggedIn && (
            <Button variant={mineOnly ? "default" : "outline"} size="sm" asChild>
              <Link to={`?month=${year}-${pad(month)}${mineOnly ? "" : "&mine=1"}`}>お気に入りのみ</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
        <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium">
          {WEEK.map((w, i) => (
            <div key={w} className={cn("py-2", i === 0 && "text-red-600", i === 6 && "text-blue-600")}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const dayItems = d ? (byDay.get(keyOf(d)) ?? []) : [];
            const isToday = d !== null && keyOf(d) === todayKey;
            return (
              <div key={i} className={cn("min-h-28 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0", !d && "bg-muted/30")}>
                {d && (
                  <>
                    <span
                      className={cn(
                        "mb-1 inline-grid size-6 place-items-center rounded-full text-xs",
                        isToday && "bg-primary font-bold text-primary-foreground",
                      )}
                    >
                      {d}
                    </span>
                    <div className="grid gap-0.5">
                      {dayItems.slice(0, 3).map((item) => (
                        <ItemPill key={`${item.kind}-${item.id}`} item={item} />
                      ))}
                      {dayItems.length > 3 && (
                        <span className="px-1 text-[11px] text-muted-foreground">他{dayItems.length - 3}件</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <section className="mt-6 md:mt-8" aria-label="予定一覧">
        <h2 className="mb-3 text-base font-semibold md:text-lg">この月の予定</h2>
        {agendaDays.length === 0 ? (
          <EmptyState
            title="この月の予定はありません"
            description={mineOnly ? "お気に入りに登録したイベントの予定が表示されます。" : undefined}
          />
        ) : (
          <ol className="grid gap-3">
            {agendaDays.map(([key, dayItems]) => {
              const [, mm, dd] = key.split("-").map(Number);
              const wd = WEEK[new Date(Date.UTC(year, mm - 1, dd)).getUTCDay()];
              return (
                <li key={key} className="flex gap-4 rounded-xl border bg-card p-3">
                  <div className={cn("w-14 shrink-0 text-center", key === todayKey && "text-primary")}>
                    <p className="text-xl font-bold">{dd}</p>
                    <p className="text-xs text-muted-foreground">
                      {mm}月({wd})
                    </p>
                  </div>
                  <ul className="grid flex-1 gap-1.5">
                    {dayItems.map((item) => (
                      <li key={`${item.kind}-${item.id}`} className="flex items-center gap-2 text-sm">
                        {item.kind === "deadline" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                            <Timer className="size-3" aria-hidden /> 締切
                          </span>
                        ) : (
                          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">開催</span>
                        )}
                        <Link to={`/events/${item.id}`} className={cn("truncate hover:underline", item.phase === "ended" && "text-muted-foreground")}>
                          {item.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </PageContainer>
  );
}
