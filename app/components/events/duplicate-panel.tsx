import { AlertTriangle, ExternalLink } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { formatDateTime } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";

export type DuplicateCandidateView = {
  score: number;
  level: "high" | "review" | "low";
  urlMatch: boolean;
  breakdown: Record<string, number>;
  event: {
    id: string;
    title: string;
    startAt: Date | null;
    location: string | null;
    organizer: string | null;
  };
};

const LEVEL = {
  high: { label: "重複の可能性が高い", className: "border-red-200 bg-red-50 text-red-700" },
  review: { label: "確認が必要", className: "border-amber-300 bg-amber-50 text-amber-800" },
  low: { label: "URLが一致", className: "border-slate-200 bg-slate-50 text-slate-700" },
} as const;

/**
 * Shown when similar events already exist. Buttons submit the surrounding
 * form so the entered values are sent along with the chosen action.
 */
export function DuplicatePanel({
  candidates,
  onDismiss,
  submitting,
}: {
  candidates: DuplicateCandidateView[];
  onDismiss: () => void;
  submitting: boolean;
}) {
  const tz = useTimeZone();
  return (
    <section
      className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-5"
      aria-labelledby="dup-title"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-700" aria-hidden />
        <div>
          <h2 id="dup-title" className="font-semibold">
            似ているイベントがすでに登録されています
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            同じイベントの場合は、新しく作らずに既存のイベントへ情報を追加してください。別のイベント（別の回・別年度など）であれば、そのまま投稿できます。
          </p>
        </div>
      </div>
      <ul className="mt-4 grid gap-3">
        {candidates.map((c) => (
          <li key={c.event.id} className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={LEVEL[c.level].className}>
                {LEVEL[c.level].label}
              </Badge>
              <span className="text-xs text-muted-foreground">類似度 {c.score}点</span>
              {c.urlMatch && (
                <Badge variant="outline" className="text-xs font-normal">
                  公式URLが一致
                </Badge>
              )}
            </div>
            <p className="mt-2 font-semibold">{c.event.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {c.event.startAt ? formatDateTime(c.event.startAt, tz) : "日時未設定"}
              {c.event.location && ` ・ ${c.event.location}`}
              {c.event.organizer && ` ・ ${c.event.organizer}`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/events/${c.event.id}`} target="_blank" rel="noopener">
                  既存イベントを確認する <ExternalLink />
                </Link>
              </Button>
              <Button type="submit" size="sm" name="addTo" value={c.event.id} disabled={submitting}>
                このイベントに情報を追加する
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-amber-200 pt-4">
        <Button type="submit" variant="secondary" name="intent" value="create_anyway" disabled={submitting}>
          別のイベントとして投稿する
        </Button>
        <Button type="button" variant="ghost" onClick={onDismiss}>
          入力内容を修正する
        </Button>
      </div>
    </section>
  );
}
