import { NotebookPen } from "lucide-react";
import { Link } from "react-router";
import { formatDate } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";

export type ActivityCardData = {
  id: string;
  title: string;
  excerpt: string;
  createdAt: Date;
  user: { id: string; name: string };
  event: { id: string; title: string };
  thumbnailUrl: string | null;
};

export function ActivityCard({ activity }: { activity: ActivityCardData }) {
  const tz = useTimeZone();
  return (
    <Link
      to={`/activities/${activity.id}`}
      className="group flex gap-4 rounded-xl border bg-card p-4 shadow-xs transition hover:shadow-md"
    >
      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary">
        {activity.thumbnailUrl ? (
          <img src={activity.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <NotebookPen className="size-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">{activity.event.title}</p>
        <h3 className="line-clamp-1 font-semibold group-hover:text-primary">{activity.title}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{activity.excerpt}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {activity.user.name} ・ {formatDate(activity.createdAt, tz)}
        </p>
      </div>
    </Link>
  );
}
