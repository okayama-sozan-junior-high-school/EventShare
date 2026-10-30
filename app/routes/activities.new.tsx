import { data, Form, redirect, useNavigation } from "react-router";
import { createDb } from "~/.server/db";
import { createActivity } from "~/.server/services/activities";
import { eventOptionsFor, MAX_MEDIA_PER_REPORT, saveActivityMedia } from "~/.server/services/activity-form";
import { getEvent } from "~/.server/services/events";
import { enforceRateLimit } from "~/.server/rate-limit";
import { requireUser } from "~/.server/session";
import { flattenErrors, formDataToObject } from "~/.server/validation/common";
import { activitySchema } from "~/.server/validation/user";
import { ActivityForm } from "~/components/activities/activity-form";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Button } from "~/components/ui/button";
import type { Route } from "./+types/activities.new";

export const meta = () => [{ title: "活動報告を書く | Event Share" }];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context, request);
  const db = createDb();
  const eventId = new URL(request.url).searchParams.get("eventId");
  if (eventId) {
    const event = await getEvent(db, eventId);
    if (event && event.status === "published") {
      return { lockedEvent: { id: event.id, title: event.title }, eventOptions: [], maxMedia: MAX_MEDIA_PER_REPORT };
    }
  }
  return {
    lockedEvent: null,
    eventOptions: await eventOptionsFor(db, user.id, new Date()),
    maxMedia: MAX_MEDIA_PER_REPORT,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context, request);
  await enforceRateLimit("write", user.id);
  const db = createDb();
  const form = await request.formData();
  const parsed = activitySchema.safeParse(formDataToObject(form));
  if (!parsed.success) {
    return data({ errors: flattenErrors(parsed.error) }, { status: 400 });
  }
  const event = await getEvent(db, parsed.data.eventId);
  if (!event || event.status !== "published") {
    return data({ errors: { eventId: "イベントが見つかりません" } as Record<string, string> }, { status: 400 });
  }
  const id = await createActivity(db, user.id, parsed.data);
  const media = await saveActivityMedia(db, form, user.id, id);
  throw redirect(media.error ? `/activities/${id}/edit?mediaError=${encodeURIComponent(media.error)}` : `/activities/${id}`);
}

export default function NewActivity({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title="活動報告を書く" description="参加したイベントでの経験を共有しましょう。" />
      <Form method="post" encType="multipart/form-data" className="grid gap-6">
        <ActivityForm
          values={{}}
          errors={(actionData?.errors ?? {}) as Record<string, string>}
          eventOptions={loaderData.eventOptions}
          lockedEvent={loaderData.lockedEvent ?? undefined}
          mediaSlotsLeft={loaderData.maxMedia}
        />
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={navigation.state === "submitting"}>
            {navigation.state === "submitting" ? "投稿中…" : "投稿する"}
          </Button>
        </div>
      </Form>
    </PageContainer>
  );
}
