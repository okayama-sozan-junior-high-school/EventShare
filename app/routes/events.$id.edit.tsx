import { Info, Trash2 } from "lucide-react";
import { data, Form, Link, redirect, useNavigation } from "react-router";
import { getConfig } from "~/.server/config";
import { createDb } from "~/.server/db";
import { events } from "~/.server/db/schema";
import { eventToFormValues, parseEventForm, resolveEventImage } from "~/.server/services/event-form";
import {
  addInfoToEvent,
  getActiveCategories,
  getEvent,
  getEventCategoryIds,
  mediaUrl,
  updateEvent,
} from "~/.server/services/events";
import { eventContributions } from "~/.server/db/schema";
import { enforceRateLimit } from "~/.server/rate-limit";
import { isAdmin, requireUser } from "~/.server/session";
import { EVENT_FIELDS } from "~/.server/validation/event";
import { EventForm } from "~/components/events/event-form";
import { FormError } from "~/components/form-field";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/events.$id.edit";

export const meta = () => [{ title: "イベントを編集 | Event Share" }];

async function loadEditable(params: { id: string }, context: Route.LoaderArgs["context"], request: Request) {
  const user = requireUser(context, request);
  const db = createDb();
  const event = await getEvent(db, params.id);
  if (!event || event.status === "merged") throw data("イベントが見つかりません", { status: 404 });
  const fullEdit = event.createdById === user.id || isAdmin(user);
  if (event.status !== "published" && !fullEdit) throw data("イベントが見つかりません", { status: 404 });
  return { user, db, event, fullEdit };
}

export async function loader({ params, context, request }: Route.LoaderArgs) {
  const { db, event, fullEdit } = await loadEditable(params, context, request);
  const { timeZone } = getConfig();
  const [categories, categoryIds] = await Promise.all([
    getActiveCategories(db),
    getEventCategoryIds(db, event.id),
  ]);
  const values = eventToFormValues(event, categoryIds, timeZone);
  const locked = fullEdit
    ? []
    : EVENT_FIELDS.filter((f) => {
        const v = event[f];
        return v !== null && v !== "" && v !== "unknown";
      });
  return {
    event: { id: event.id, title: event.title, status: event.status },
    values,
    categories,
    fullEdit,
    locked,
    imagePreviewUrl: mediaUrl(event.imageMediaId),
  };
}

export async function action({ params, context, request }: Route.ActionArgs) {
  const { user, db, event, fullEdit } = await loadEditable(params, context, request);
  await enforceRateLimit("write", user.id);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "delete") {
    if (!fullEdit) throw data("権限がありません", { status: 403 });
    await db.update(events).set({ status: "hidden", updatedAt: new Date() }).where(eq(events.id, event.id));
    await db.insert(eventContributions).values({
      id: crypto.randomUUID(),
      eventId: event.id,
      userId: user.id,
      type: isAdmin(user) && event.createdById !== user.id ? "moderate" : "edit",
      note: "イベントを非公開にしました",
    });
    throw redirect("/me");
  }

  const { timeZone } = getConfig();
  // Locked (already filled) fields are disabled in the add-info form and not
  // submitted; fill them from the current event so validation passes.
  if (!fullEdit) {
    const current = eventToFormValues(event, await getEventCategoryIds(db, event.id), timeZone);
    for (const f of EVENT_FIELDS) {
      if (!form.has(f)) form.set(f, String(current[f] ?? ""));
    }
  }
  const parsed = parseEventForm(form, timeZone);
  if (!parsed.ok) return data({ errors: parsed.errors }, { status: 400 });

  const image = await resolveEventImage(db, form, user.id, parsed.data);
  if (image.error) return data({ errors: { image: image.error } }, { status: 400 });

  if (fullEdit) {
    await updateEvent(db, event, parsed.data, user.id, {
      imageMediaId: image.mediaId,
      asAdmin: isAdmin(user),
      timeZone,
    });
  } else {
    const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
    await addInfoToEvent(db, event, parsed.data, user.id, {
      imageMediaId: image.mediaId ?? null,
      note,
      timeZone,
    });
  }
  throw redirect(`/events/${event.id}`);
}

export default function EditEvent({ loaderData, actionData }: Route.ComponentProps) {
  const { event, values, categories, fullEdit, locked, imagePreviewUrl } = loaderData;
  const navigation = useNavigation();
  const errors = (actionData?.errors ?? {}) as Record<string, string>;
  const submitting = navigation.state === "submitting";

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title={fullEdit ? "イベントを編集" : "イベントに情報を追加"}
        description={event.title}
      />
      {!fullEdit && (
        <Alert className="mb-6">
          <Info />
          <AlertTitle>まだ登録されていない項目に情報を追加できます</AlertTitle>
          <AlertDescription>
            登録済みの項目は投稿者・管理者のみ変更できます。誤りを見つけた場合は、イベントページの「報告」から「情報が誤っている」を選んで知らせてください。追加した内容は情報提供者として記録されます。
          </AlertDescription>
        </Alert>
      )}
      <Form method="post" encType="multipart/form-data" className="grid gap-8">
        <FormError message={errors._form} />
        <EventForm
          categories={categories}
          values={values}
          errors={errors}
          locked={locked}
          imagePreviewUrl={imagePreviewUrl}
          allowRemoveImage={fullEdit}
        />
        {!fullEdit && (
          <div className="grid gap-1.5">
            <Label htmlFor="note">補足メモ（任意）</Label>
            <Textarea id="note" name="note" rows={3} maxLength={500} placeholder="情報の出典や補足など" />
          </div>
        )}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
          <Button variant="ghost" asChild className="mr-auto">
            <Link to={`/events/${event.id}`}>キャンセル</Link>
          </Button>
          <Button type="submit" name="intent" value="save" size="lg" disabled={submitting}>
            {submitting ? "保存中…" : fullEdit ? "変更を保存" : "情報を追加する"}
          </Button>
        </div>
      </Form>
      {fullEdit && event.status === "published" && (
        <Form
          method="post"
          className="mt-10 rounded-xl border border-destructive/30 p-5"
          onSubmit={(e) => {
            if (!confirm("このイベントを非公開にしますか？（履歴は残ります）")) e.preventDefault();
          }}
        >
          <h2 className="font-semibold">イベントを削除（非公開にする）</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            一覧や検索に表示されなくなります。情報提供の履歴は保持され、管理者は復元できます。
          </p>
          <Button type="submit" name="intent" value="delete" variant="destructive" className="mt-3">
            <Trash2 /> 非公開にする
          </Button>
        </Form>
      )}
    </PageContainer>
  );
}
