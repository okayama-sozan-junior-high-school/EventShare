import { FormField } from "~/components/form-field";
import { Input } from "~/components/ui/input";
import { NativeSelect } from "~/components/ui/native-select";
import { Textarea } from "~/components/ui/textarea";
import { formatDate } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";

type Values = {
  eventId?: string;
  title?: string;
  motivation?: string | null;
  activity?: string;
  reflection?: string | null;
  relatedUrl?: string | null;
};

export function ActivityForm({
  values,
  errors,
  eventOptions,
  lockedEvent,
  mediaSlotsLeft,
}: {
  values: Values;
  errors: Record<string, string>;
  eventOptions?: { id: string; title: string; startAt: Date | null }[];
  lockedEvent?: { id: string; title: string };
  mediaSlotsLeft: number;
}) {
  const tz = useTimeZone();
  return (
    <div className="grid gap-5">
      {lockedEvent ? (
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">参加したイベント</p>
          <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm">{lockedEvent.title}</p>
          <input type="hidden" name="eventId" value={lockedEvent.id} />
        </div>
      ) : (
        <FormField
          id="eventId"
          label="参加したイベント"
          error={errors.eventId}
          required
          hint="参加予定・お気に入り・最近開催されたイベントから選べます。見つからない場合はイベントページの「活動報告を書く」から投稿してください。"
        >
          <NativeSelect id="eventId" name="eventId" defaultValue={values.eventId ?? ""}>
            <option value="">選択してください</option>
            {eventOptions?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.startAt ? `${formatDate(e.startAt, tz)} ` : ""}
                {e.title}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      )}
      <FormField id="title" label="タイトル" error={errors.title} required>
        <Input id="title" name="title" defaultValue={values.title ?? ""} maxLength={100} placeholder="例: 初めてのハッカソンでチーム開発に挑戦！" />
      </FormField>
      <FormField id="motivation" label="参加した理由" error={errors.motivation}>
        <Textarea id="motivation" name="motivation" defaultValue={values.motivation ?? ""} rows={3} maxLength={2000} />
      </FormField>
      <FormField id="activity" label="活動内容" error={errors.activity} required>
        <Textarea id="activity" name="activity" defaultValue={values.activity ?? ""} rows={6} maxLength={5000} placeholder="どんなことをしたか、どんな人と出会ったか など" />
      </FormField>
      <FormField id="reflection" label="感想・成果" error={errors.reflection}>
        <Textarea id="reflection" name="reflection" defaultValue={values.reflection ?? ""} rows={4} maxLength={5000} />
      </FormField>
      <FormField id="relatedUrl" label="関連URL（任意）" error={errors.relatedUrl} hint="作品のページや発表資料など">
        <Input id="relatedUrl" name="relatedUrl" type="url" defaultValue={values.relatedUrl ?? ""} placeholder="https://" />
      </FormField>
      {mediaSlotsLeft > 0 && (
        <FormField
          id="media"
          label="写真・動画（任意）"
          error={errors.media}
          hint={`あと${mediaSlotsLeft}件まで。画像は5MB、動画(MP4/WebM/MOV)は50MBまで。人の顔や名札など個人が特定できるものが写っていないか確認してください。`}
        >
          <Input id="media" name="media" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" />
        </FormField>
      )}
    </div>
  );
}
