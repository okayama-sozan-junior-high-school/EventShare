import { CalendarClock, Info, MapPin, Sparkles, Timer } from "lucide-react";
import { Link } from "react-router";
import { placeLabel } from "~/components/events/event-card";
import { PhaseBadge } from "~/components/events/phase-badge";
import { ExternalLink } from "~/components/external-link";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatRange, formatDateTime } from "~/lib/datetime";
import type { EventPhase } from "~/lib/event-phase";
import { useTimeZone } from "~/lib/hooks";
import { FEE_LABEL } from "~/lib/labels";

export type RecommendationCardData = {
  reason: string;
  reasonSource: "ai" | "rule";
  event: {
    id: string;
    title: string;
    excerpt: string;
    startAt: Date | null;
    endAt: Date | null;
    location: string | null;
    format: "offline" | "online" | "hybrid" | "unknown";
    feeType: "free" | "paid" | "unknown";
    applicationDeadline: Date | null;
    officialUrl: string | null;
    applicationUrl: string | null;
    phase: EventPhase;
    categories: string[];
  };
};

function Fact({ icon: Icon, label, children }: { icon: typeof Info; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const unknown = <span className="text-muted-foreground">不明（未登録）</span>;

export function RecommendationCard({ rec }: { rec: RecommendationCardData }) {
  const tz = useTimeZone();
  const e = rec.event;
  return (
    <article className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <PhaseBadge phase={e.phase} />
        {e.categories.slice(0, 3).map((c) => (
          <Badge key={c} variant="secondary" className="font-normal">
            {c}
          </Badge>
        ))}
      </div>
      <h3 className="mt-2 font-semibold leading-snug">
        <Link to={`/events/${e.id}`} className="hover:text-primary hover:underline">
          {e.title}
        </Link>
      </h3>
      {e.excerpt && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{e.excerpt}</p>}

      <p className="mt-3 text-[11px] font-semibold tracking-wide text-muted-foreground">登録されている情報</p>
      <dl className="mt-1 grid gap-1 text-sm">
        <Fact icon={CalendarClock} label="開催日時">
          {e.startAt ? formatRange(e.startAt, e.endAt, tz) : unknown}
        </Fact>
        <Fact icon={MapPin} label="開催場所">
          {e.location || e.format !== "unknown" ? placeLabel(e.format, e.location) : unknown}
          {e.feeType !== "unknown" && <span className="ml-2 text-muted-foreground">・参加費 {FEE_LABEL[e.feeType]}</span>}
        </Fact>
        <Fact icon={Timer} label="応募締切">
          {e.applicationDeadline ? formatDateTime(e.applicationDeadline, tz) : unknown}
        </Fact>
      </dl>

      <div className="mt-3 rounded-lg bg-brand-soft/70 p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <Sparkles className="size-3.5" aria-hidden />
          おすすめする理由
          <span className="font-normal text-muted-foreground">
            {rec.reasonSource === "ai" ? "（AIによる説明・推測を含む場合があります）" : "（検索条件との一致）"}
          </span>
        </p>
        <p className="mt-1 text-sm">{rec.reason}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" asChild>
          <Link to={`/events/${e.id}`}>詳細を見る</Link>
        </Button>
        {e.officialUrl && (
          <Button size="sm" variant="outline" asChild>
            <ExternalLink href={e.officialUrl}>公式サイト</ExternalLink>
          </Button>
        )}
        {e.applicationUrl && (
          <Button size="sm" variant="outline" asChild>
            <ExternalLink href={e.applicationUrl}>応募フォーム</ExternalLink>
          </Button>
        )}
      </div>
    </article>
  );
}
