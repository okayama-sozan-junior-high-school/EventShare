import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { formatDate, zonedParts } from "~/lib/datetime";
import type { EventPhase } from "~/lib/event-phase";
import { useTimeZone } from "~/lib/hooks";
import { PhaseBadge } from "./phase-badge";

export type TimelineEdition = {
  id: string;
  title: string;
  editionLabel: string | null;
  startAt: Date | null;
  phase: EventPhase;
  hidden?: boolean;
};

export function SeriesTimeline({
  editions,
  currentId,
}: {
  editions: TimelineEdition[];
  currentId?: string;
}) {
  const tz = useTimeZone();
  if (editions.length === 0) {
    return <p className="text-sm text-muted-foreground">公開中の回はまだありません。</p>;
  }

  return (
    <ol className="grid">
      {editions.map((edition) => {
        const year = edition.startAt ? zonedParts(edition.startAt, tz).year : null;
        const label = edition.editionLabel ?? (year ? String(year) : "日程未定");
        const current = edition.id === currentId;
        return (
          <li key={edition.id} className="relative border-l py-3 pl-4">
            <span className="absolute top-5 -left-1 size-2 rounded-full bg-primary" aria-hidden />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{label}</span>
              <PhaseBadge phase={edition.phase} />
              {edition.hidden && (
                <Badge variant="outline" className="font-normal">
                  非公開
                </Badge>
              )}
            </div>
            {current ? (
              <p className="mt-1 text-sm" aria-current="page">
                {edition.title}
              </p>
            ) : (
              <Link to={`/events/${edition.id}`} className="mt-1 block text-sm font-medium text-primary hover:underline">
                {edition.title}
              </Link>
            )}
            {edition.startAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(edition.startAt, tz)}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
