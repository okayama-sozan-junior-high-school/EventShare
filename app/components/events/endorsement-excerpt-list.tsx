import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { ENDORSEMENT_AUDIENCE_LABEL } from "~/lib/labels";

export function EndorsementExcerptList({
  items,
}: {
  items: {
    id: string;
    eventId: string;
    eventTitle: string;
    audience: keyof typeof ENDORSEMENT_AUDIENCE_LABEL;
    comment: string | null;
    status?: "visible" | "hidden";
  }[];
}) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {items.map((item) => (
        <li key={item.id} className="grid gap-1.5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/events/${item.eventId}`} className="font-medium text-primary hover:underline">
              {item.eventTitle}
            </Link>
            <Badge variant="secondary" className="font-normal">
              {ENDORSEMENT_AUDIENCE_LABEL[item.audience]}
            </Badge>
            {item.status === "hidden" && (
              <Badge variant="outline" className="font-normal">
                非表示
              </Badge>
            )}
          </div>
          {item.comment && <p className="line-clamp-2 text-sm text-muted-foreground">{item.comment}</p>}
        </li>
      ))}
    </ul>
  );
}
