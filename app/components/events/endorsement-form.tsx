import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { useCurrentUser } from "~/lib/hooks";
import { ENDORSEMENT_AUDIENCE_LABEL } from "~/lib/labels";

const AUDIENCES = ["beginner_ok", "experienced", "anyone"] as const;
type Audience = (typeof AUDIENCES)[number];

export function EndorsementForm({
  eligible,
  mine,
  reports,
}: {
  eligible: boolean;
  mine: {
    audience: Audience;
    comment: string | null;
    activityReportId: string | null;
    status: "visible" | "hidden";
  } | null;
  reports: { id: string; title: string }[];
}) {
  const user = useCurrentUser();
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [audience, setAudience] = useState<Audience | "">(mine?.audience ?? "");
  const [comment, setComment] = useState(mine?.comment ?? "");
  const pending = fetcher.state !== "idle";
  const trimmed = comment.trim();

  if (!user) {
    return (
      <p className="text-sm text-muted-foreground">
        {!eligible && "終了後、または参加済みの方がおすすめできます。"}
        おすすめするには
        <Link to="/login" className="mx-1 font-medium text-primary hover:underline">
          ログイン
        </Link>
        してください。
      </p>
    );
  }

  if (!eligible) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">終了後、または参加済みの方がおすすめできます</p>
        {mine && <RemoveButton pending={pending} fetcher={fetcher} />}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {mine?.status === "hidden" && (
        <p className="text-sm text-muted-foreground">このおすすめは管理者によって非表示になっています。</p>
      )}
      <fetcher.Form method="post" className="grid gap-4">
        <input type="hidden" name="intent" value="endorse" />
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">
            向いている人
            <span className="ml-1 text-xs font-normal text-destructive">必須</span>
          </legend>
          <RadioGroup
            name="audience"
            value={audience}
            onValueChange={(value) => setAudience(value as Audience)}
            className="grid gap-2"
          >
            {AUDIENCES.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <RadioGroupItem value={key} id={`endorsement-audience-${key}`} />
                <Label htmlFor={`endorsement-audience-${key}`} className="font-normal">
                  {ENDORSEMENT_AUDIENCE_LABEL[key]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="endorsement-comment">
            一言
            <span className="ml-1 text-xs font-normal text-destructive">必須</span>
          </Label>
          <Textarea
            id="endorsement-comment"
            name="comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={200}
            rows={3}
            placeholder="参加した人に向けて、一言残してください"
            aria-describedby="endorsement-comment-count"
          />
          <p id="endorsement-comment-count" className="text-right text-xs text-muted-foreground tabular-nums">
            {trimmed.length}/200
          </p>
        </div>
        {reports.length > 0 && (
          <div className="grid gap-1.5">
            <Label htmlFor="endorsement-report">活動報告（任意）</Label>
            <NativeSelect
              id="endorsement-report"
              name="activityReportId"
              defaultValue={mine?.activityReportId ?? ""}
            >
              <option value="">リンクしない</option>
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {report.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <p className="text-xs text-muted-foreground">おすすめすると、「参加した」ことも記録されます。</p>
        {fetcher.data?.error && fetcher.formData?.get("intent") === "endorse" && (
          <p className="text-sm text-destructive" role="alert">
            {fetcher.data.error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!audience || trimmed.length < 1 || trimmed.length > 200 || pending}>
            {mine ? "更新する" : "おすすめする"}
          </Button>
        </div>
      </fetcher.Form>
      {mine && <RemoveButton pending={pending} fetcher={fetcher} />}
    </div>
  );
}

function RemoveButton({
  pending,
  fetcher,
}: {
  pending: boolean;
  fetcher: ReturnType<typeof useFetcher<{ ok: boolean; error?: string }>>;
}) {
  return (
    <fetcher.Form
      method="post"
      onSubmit={(event) => {
        if (!confirm("おすすめを取り消しますか？")) event.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="unendorse" />
      {fetcher.data?.error && fetcher.formData?.get("intent") === "unendorse" && (
        <p className="mb-2 text-sm text-destructive" role="alert">
          {fetcher.data.error}
        </p>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        取り消す
      </Button>
    </fetcher.Form>
  );
}
