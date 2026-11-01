import { Link2 } from "lucide-react";
import { useState } from "react";
import { Form, Link } from "react-router";
import { Button } from "~/components/ui/button";

export type SeriesCandidateView = {
  seriesId: string;
  title: string;
  count: number;
  organizer: string | null;
  eventTitle: string;
};

/**
 * Weak series matches. Shown to the poster instead of attaching automatically.
 * Each button posts `intent=attach_series` to the surrounding route.
 */
export function SeriesCandidatePanel({ candidates }: { candidates: SeriesCandidateView[] }) {
  const [open, setOpen] = useState(true);
  if (!open || candidates.length === 0) return null;

  return (
    <section className="rounded-xl border-2 border-primary/30 bg-brand-soft/50 p-4" aria-labelledby="series-cand-title">
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <div>
          <h2 id="series-cand-title" className="font-semibold">
            過去に同じイベントが登録されています
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            同じイベントの新しい回なら、過去の回とつなげることができます。別のイベントなら、このまま別々にしてください。
          </p>
        </div>
      </div>
      <ul className="mt-3 grid gap-2">
        {candidates.map((candidate) => (
          <li key={candidate.seriesId} className="rounded-lg border bg-card p-3">
            <p className="font-semibold">{candidate.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              全{candidate.count}回
              {candidate.organizer ? ` ・ ${candidate.organizer}` : ""}
            </p>
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">例: {candidate.eventTitle}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Form method="post">
                <input type="hidden" name="intent" value="attach_series" />
                <input type="hidden" name="seriesId" value={candidate.seriesId} />
                <Button type="submit" size="sm">
                  この回の続きです
                </Button>
              </Form>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/series/${candidate.seriesId}`}>シリーズを見る</Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          別のイベント
        </Button>
      </div>
    </section>
  );
}
