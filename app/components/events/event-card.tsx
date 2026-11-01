import { CalendarClock, Heart, MapPin, MessageCircle, Monitor, Timer } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { daysUntil, formatShortDateTime } from "~/lib/datetime";
import { FEE_LABEL } from "~/lib/labels";
import { useTimeZone } from "~/lib/hooks";
import { cn } from "~/lib/utils";
import type { EventPhase } from "~/lib/event-phase";
import { PhaseBadge } from "./phase-badge";

export type EventCardData = {
  id: string;
  title: string;
  excerpt: string;
  startAt: Date | null;
  endAt: Date | null;
  applicationDeadline: Date | null;
  location: string | null;
  format: "offline" | "online" | "hybrid" | "unknown";
  feeType: "free" | "paid" | "unknown";
  organizer: string | null;
  imageUrl: string | null;
  categories: { id: number; slug: string; name: string }[];
  phase: EventPhase;
  likeCount: number;
  commentCount: number;
  endorsementCount?: number;
  editionLabel?: string | null;
  seriesId?: string | null;
};

export function placeLabel(format: EventCardData["format"], location: string | null) {
  if (format === "online") return location ? `オンライン（${location}）` : "オンライン";
  if (format === "hybrid") return location ? `${location} ＋ オンライン` : "会場＋オンライン";
  return location ?? "場所未設定";
}

export function DeadlineText({ deadline, phase }: { deadline: Date | null; phase: EventPhase }) {
  const tz = useTimeZone();
  if (!deadline) return <span className="text-muted-foreground">締切 未設定</span>;
  const days = daysUntil(deadline, new Date(), tz);
  const urgent = phase === "closing";
  return (
    <span className={cn(urgent && "font-semibold text-amber-700")}>
      締切 {formatShortDateTime(deadline, tz)}
      {phase !== "closed" && phase !== "ended" && days >= 0 && (
        <span className="ml-1">{days === 0 ? "（今日まで）" : `（あと${days}日）`}</span>
      )}
    </span>
  );
}

export function EventCard({ event, className }: { event: EventCardData; className?: string }) {
  const tz = useTimeZone();
  const ended = event.phase === "ended";
  return (
    <Link
      to={`/events/${event.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        ended && "opacity-75",
        className,
      )}
    >
      <div className="relative aspect-[16/7] overflow-hidden bg-gradient-to-br from-brand-soft to-secondary">
        {event.imageUrl ? (
          <img
            src={event.imageUrl}
            alt=""
            loading="lazy"
            className={cn("size-full object-cover transition group-hover:scale-[1.02]", ended && "grayscale")}
          />
        ) : (
          <div className="grid size-full place-items-center text-3xl font-bold text-primary/25">
            {event.categories[0]?.name ?? "EVENT"}
          </div>
        )}
        <PhaseBadge phase={event.phase} className="absolute top-3 left-3 bg-white/95 shadow-xs" />
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex flex-wrap gap-1">
          {event.categories.slice(0, 3).map((c) => (
            <Badge key={c.id} variant="secondary" className="font-normal">
              {c.name}
            </Badge>
          ))}
          {event.feeType === "free" && (
            <Badge variant="outline" className="border-emerald-200 font-normal text-emerald-700">
              {FEE_LABEL.free}
            </Badge>
          )}
          {event.editionLabel && (
            <Badge variant="outline" className="font-normal">
              {event.editionLabel}
            </Badge>
          )}
        </div>
        <h3 className="line-clamp-2 text-base leading-snug font-semibold group-hover:text-primary">
          {event.title}
        </h3>
        <dl className="mt-auto space-y-1 text-sm text-muted-foreground">
          <div className="flex items-start gap-1.5">
            <dt className="sr-only">開催日時</dt>
            <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <dd>{event.startAt ? formatShortDateTime(event.startAt, tz) : "日時未設定"}</dd>
          </div>
          <div className="flex items-start gap-1.5">
            <dt className="sr-only">開催場所</dt>
            {event.format === "online" ? (
              <Monitor className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <dd className="line-clamp-1">{placeLabel(event.format, event.location)}</dd>
          </div>
          <div className="flex items-start gap-1.5">
            <dt className="sr-only">応募締切</dt>
            <Timer className="mt-0.5 size-4 shrink-0" aria-hidden />
            <dd>
              <DeadlineText deadline={event.applicationDeadline} phase={event.phase} />
            </dd>
          </div>
        </dl>
        <div className="flex items-center gap-3 border-t pt-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Heart className="size-3.5" aria-hidden /> {event.likeCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" aria-hidden /> {event.commentCount}
          </span>
          {event.organizer && <span className="ml-auto truncate">{event.organizer}</span>}
        </div>
      </div>
    </Link>
  );
}

export function EventGrid({ events }: { events: EventCardData[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
    </div>
  );
}
