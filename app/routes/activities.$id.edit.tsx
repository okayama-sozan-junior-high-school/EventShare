import { and, eq, inArray } from "drizzle-orm";
import { Trash2 } from "lucide-react";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { createDb } from "~/.server/db";
import { mediaAssets } from "~/.server/db/schema";
import { deleteMedia } from "~/.server/media/store";
import { getActivity, setActivityStatus, updateActivity } from "~/.server/services/activities";
import { MAX_MEDIA_PER_REPORT, saveActivityMedia } from "~/.server/services/activity-form";
import { enforceRateLimit } from "~/.server/rate-limit";
import { requireUser } from "~/.server/session";
import { flattenErrors, formDataToObject } from "~/.server/validation/common";
import { activitySchema } from "~/.server/validation/user";
import { ActivityForm } from "~/components/activities/activity-form";
import { FormError } from "~/components/form-field";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import type { Route } from "./+types/activities.$id.edit";

export const meta = () => [{ title: "活動報告を編集 | Event Share" }];

async function loadOwned(id: string, context: Route.LoaderArgs["context"], request: Request) {
  const user = requireUser(context, request);
  const db = createDb();
  const activity = await getActivity(db, id);
  if (!activity || activity.status === "deleted") throw data("活動報告が見つかりません", { status: 404 });
  if (activity.userId !== user.id) throw data("編集する権限がありません", { status: 403 });
  return { user, db, activity };
}

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const { activity } = await loadOwned(params.id, context, request);
  return { activity, maxMedia: MAX_MEDIA_PER_REPORT };
}

export async function action({ params, context, request }: Route.ActionArgs) {
  const { user, db, activity } = await loadOwned(params.id, context, request);
  await enforceRateLimit("write", user.id);
  const form = await request.formData();

  if (form.get("intent") === "delete") {
    await setActivityStatus(db, activity.id, "deleted");
    throw redirect("/me");
  }

  const parsed = activitySchema.safeParse({ ...formDataToObject(form), eventId: activity.eventId });
  if (!parsed.success) return data({ errors: flattenErrors(parsed.error) }, { status: 400 });
  const { eventId: _eventId, ...input } = parsed.data;
  await updateActivity(db, activity.id, input);

  const removeIds = form.getAll("removeMedia").filter((v): v is string => typeof v === "string");
  if (removeIds.length > 0) {
    const owned = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, removeIds), eq(mediaAssets.activityReportId, activity.id)));
    await deleteMedia(db, owned.map((m) => m.id));
  }
  const media = await saveActivityMedia(db, form, user.id, activity.id);
  if (media.error) return data({ errors: { media: media.error } as Record<string, string> }, { status: 400 });
  throw redirect(`/activities/${activity.id}`);
}

export default function EditActivity({ loaderData, actionData }: Route.ComponentProps) {
  const { activity, maxMedia } = loaderData;
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const errors = (actionData?.errors ?? {}) as Record<string, string>;
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title="活動報告を編集" description={activity.eventTitle} />
      <Form method="post" encType="multipart/form-data" className="grid gap-6">
        <FormError message={params.get("mediaError")} />
        <ActivityForm
          values={activity}
          errors={errors}
          lockedEvent={{ id: activity.eventId, title: activity.eventTitle }}
          mediaSlotsLeft={maxMedia - activity.media.length}
        />
        {activity.media.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">登録済みの写真・動画（削除するものを選択）</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {activity.media.map((m) => (
                <div key={m.id} className="grid gap-1.5">
                  {m.kind === "image" ? (
                    <img src={m.url} alt="" className="aspect-video w-full rounded-md border object-cover" />
                  ) : (
                    <video src={m.url} preload="metadata" className="aspect-video w-full rounded-md border bg-black" />
                  )}
                  <div className="flex items-center gap-2">
                    <Checkbox id={`rm-${m.id}`} name="removeMedia" value={m.id} />
                    <Label htmlFor={`rm-${m.id}`} className="text-xs font-normal">
                      削除する
                    </Label>
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" asChild>
            <Link to={`/activities/${activity.id}`}>キャンセル</Link>
          </Button>
          <Button type="submit" disabled={navigation.state === "submitting"}>
            {navigation.state === "submitting" ? "保存中…" : "保存する"}
          </Button>
        </div>
      </Form>
      <Form
        method="post"
        className="mt-10 rounded-xl border border-destructive/30 p-5"
        onSubmit={(e) => {
          if (!confirm("この活動報告を削除しますか？")) e.preventDefault();
        }}
      >
        <h2 className="font-semibold">活動報告を削除</h2>
        <Button type="submit" name="intent" value="delete" variant="destructive" className="mt-3">
          <Trash2 /> 削除する
        </Button>
      </Form>
    </PageContainer>
  );
}
