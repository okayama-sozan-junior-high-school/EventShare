import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { useCurrentUser } from "~/lib/hooks";
import { REPORT_REASON_LABEL } from "~/lib/labels";

type Target = "event" | "comment" | "activity_report" | "user";
type Reason = keyof typeof REPORT_REASON_LABEL;

export function ReportDialog({
  targetType,
  targetId,
  reasons = ["inappropriate", "personal_info", "spam", "incorrect", "other"],
  defaultReason,
  trigger,
}: {
  targetType: Target;
  targetId: string;
  reasons?: Reason[];
  defaultReason?: Reason;
  trigger?: React.ReactNode;
}) {
  const user = useCurrentUser();
  const fetcher = useFetcher<{ ok: boolean; error: string | null; message?: string }>();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>(defaultReason ?? reasons[0]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      toast.success(fetcher.data.message);
      setOpen(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <Flag /> 報告
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>管理者に報告する</DialogTitle>
          <DialogDescription>
            不適切な内容・個人情報・誤った情報・重複などを管理者に知らせます。報告者が他のユーザーに公開されることはありません。
          </DialogDescription>
        </DialogHeader>
        {user ? (
          <fetcher.Form method="post" action="/api/report" className="grid gap-4">
            <input type="hidden" name="targetType" value={targetType} />
            <input type="hidden" name="targetId" value={targetId} />
            <RadioGroup name="reason" value={reason} onValueChange={(v) => setReason(v as Reason)} className="grid gap-2">
              {reasons.map((r) => (
                <div key={r} className="flex items-center gap-2">
                  <RadioGroupItem value={r} id={`reason-${targetId}-${r}`} />
                  <Label htmlFor={`reason-${targetId}-${r}`} className="font-normal">
                    {REPORT_REASON_LABEL[r]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {reason === "duplicate" && (
              <div className="grid gap-1.5">
                <Label htmlFor={`dup-${targetId}`}>重複している既存イベントのURL（任意）</Label>
                <Input id={`dup-${targetId}`} name="duplicateOfEventId" placeholder="https://…/events/…" />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor={`detail-${targetId}`}>詳しい内容（任意）</Label>
              <Textarea id={`detail-${targetId}`} name="detail" maxLength={1000} rows={3} />
            </div>
            {fetcher.data?.error && <p className="text-sm text-destructive">{fetcher.data.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={fetcher.state !== "idle"}>
                {fetcher.state !== "idle" ? "送信中…" : "報告する"}
              </Button>
            </DialogFooter>
          </fetcher.Form>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm">報告するにはログインしてください。</p>
            <Button asChild>
              <Link to="/login">ログイン</Link>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
