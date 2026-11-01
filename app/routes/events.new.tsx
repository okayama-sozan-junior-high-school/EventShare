import { Globe, Link2, Loader2, PencilLine, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { data, Form, Link, redirect, useFetcher, useNavigation } from "react-router";
import { getAiClient } from "~/.server/ai/client";
import { getConfig } from "~/.server/config";
import { createDb } from "~/.server/db";
import { findDuplicateCandidates } from "~/.server/duplicates/find";
import { draftToFormValues, eventToFormValues, parseEventForm, resolveEventImage, type EventFormValues } from "~/.server/services/event-form";
import { addInfoToEvent, createEvent, getActiveCategories, getEvent, getEventCategoryIds } from "~/.server/services/events";
import { notifyNewEvent } from "~/.server/services/notifications";
import { attachToSeries, findSeriesCandidates, getSeriesDetail, notifyNewEdition, pickLatestEdition } from "~/.server/services/series";
import { enforceRateLimit } from "~/.server/rate-limit";
import { getRequestInfo, requireUser } from "~/.server/session";
import { importImage } from "~/.server/url-import/image";
import { importEventFromUrl } from "~/.server/url-import";
import { optionalHttpUrl } from "~/.server/validation/common";
import { DuplicatePanel } from "~/components/events/duplicate-panel";
import { EventForm, type FieldSource } from "~/components/events/event-form";
import { FormError } from "~/components/form-field";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { formatDate } from "~/lib/datetime";
import { suggestNextTitle } from "~/lib/edition";
import type { Route } from "./+types/events.new";

export const meta = () => [{ title: "イベントを投稿 | Event Share" }];

const PREFILL_FIELDS = [
  "title",
  "description",
  "organizer",
  "officialUrl",
  "location",
  "targetAudience",
  "format",
  "feeType",
  "feeDetail",
] as const;

async function loadSeriesPrefill(seriesId: string) {
  const db = createDb();
  const { timeZone } = getConfig();
  const detail = await getSeriesDetail(db, seriesId, null, timeZone);
  if (!detail) return null;
  const latest = pickLatestEdition(detail.editions);
  if (!latest) return null;
  const values = eventToFormValues(latest, await getEventCategoryIds(db, latest.id), timeZone);
  values.title = suggestNextTitle(latest.title);
  values.startAt = "";
  values.endAt = "";
  values.applicationDeadline = "";
  values.applicationUrl = "";
  const sources: Partial<Record<string, "previous">> = {};
  for (const field of PREFILL_FIELDS) {
    const value = values[field];
    if (typeof value === "string" && value.trim() && value !== "unknown") sources[field] = "previous";
  }
  const hint = [
    latest.startAt ? `${formatDate(latest.startAt, timeZone)} 開催` : null,
    latest.applicationDeadline ? `締切 ${formatDate(latest.applicationDeadline, timeZone)}` : null,
  ].filter(Boolean);
  return {
    seriesId: detail.id,
    seriesTitle: detail.displayTitle,
    values,
    sources,
    dateHint: hint.length > 0 ? `前回: ${hint.join("、")}` : null,
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  requireUser(context, request);
  const seriesId = new URL(request.url).searchParams.get("seriesId");
  const [categories, seriesPrefill] = await Promise.all([
    getActiveCategories(createDb()),
    seriesId ? loadSeriesPrefill(seriesId) : Promise.resolve(null),
  ]);
  return { categories, seriesPrefill };
}

async function handleImport(form: FormData, userId: string) {
  const parsed = optionalHttpUrl.safeParse(form.get("url") ?? "");
  if (!parsed.success || !parsed.data) {
    return { importError: "http:// または https:// から始まるURLを入力してください" };
  }
  const url = parsed.data;
  const { timeZone } = getConfig();
  const result = await importEventFromUrl(url, {
    ai: getAiClient(),
    timeZone,
    now: new Date(),
  });
  if (!result.ok) return { importError: result.error };

  const values = draftToFormValues(result.draft, url, timeZone);
  const sources: Record<string, string> = { ...result.sources };
  let imagePreviewUrl: string | null = null;
  if (result.draft.imageUrl) {
    const mediaId = await importImage(createDb(), result.draft.imageUrl, userId);
    if (mediaId) {
      values.importedImageId = mediaId;
      imagePreviewUrl = `/media/${mediaId}`;
    }
  }
  return {
    imported: { values, sources, imagePreviewUrl, usedAi: result.usedAi, key: crypto.randomUUID() },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "submit");
  const db = createDb();
  const { timeZone } = getConfig();

  if (intent === "import") {
    await enforceRateLimit("fetch", user.id);
    return handleImport(form, user.id);
  }

  await enforceRateLimit("write", user.id);
  const parsed = parseEventForm(form, timeZone);
  if (!parsed.ok) {
    return data({ errors: parsed.errors, values: parsed.values }, { status: 400 });
  }
  const input = parsed.data;

  const addTo = form.get("addTo");
  if (typeof addTo === "string" && addTo) {
    const target = await getEvent(db, addTo);
    if (!target || target.status !== "published") {
      return data({ errors: { _form: "追加先のイベントが見つかりません" }, values: parsed.values }, { status: 400 });
    }
    const image = await resolveEventImage(db, form, user.id, input);
    await addInfoToEvent(db, target, input, user.id, {
      imageMediaId: image.mediaId ?? null,
      note: "重複候補から情報を追加",
      timeZone,
    });
    throw redirect(`/events/${target.id}?contributed=1`);
  }

  if (intent !== "create_anyway") {
    const duplicates = await findDuplicateCandidates(db, input, {
      timeZone,
      excludeSeriesId: input.seriesId,
    });
    if (duplicates.length > 0) {
      return { duplicates, values: parsed.values };
    }
  }

  const image = await resolveEventImage(db, form, user.id, input);
  if (image.error) {
    return data({ errors: { image: image.error }, values: parsed.values }, { status: 400 });
  }
  const id = await createEvent(db, input, user.id, image.mediaId ?? null, timeZone);
  const created = await getEvent(db, id);
  let linked = false;
  if (created?.seriesId && created.seriesId !== (input.seriesId || null)) {
    const found = await findSeriesCandidates(db, {
      title: input.title,
      organizer: input.organizer,
      sourceUrl: input.officialUrl || input.sourceUrl,
      excludeEventId: id,
    });
    if (found.strong && found.strong.seriesId !== created.seriesId) {
      const attached = await attachToSeries(db, {
        eventId: id,
        seriesId: found.strong.seriesId,
        userId: user.id,
      });
      linked = attached.ok && attached.changed;
    }
  }
  getRequestInfo(context).waitUntil(
    (async () => {
      const latest = await getEvent(db, id);
      const recipients = latest?.seriesId
        ? await notifyNewEdition(db, { seriesId: latest.seriesId, newEventId: id })
        : [];
      await notifyNewEvent(db, { id, title: input.title }, input.categoryIds, user.id, recipients);
    })(),
  );
  throw redirect(linked ? `/events/${id}?linked=1` : `/events/${id}`);
}

type Imported = {
  values: EventFormValues;
  sources: Record<string, string>;
  imagePreviewUrl: string | null;
  usedAi: boolean;
  key: string;
};

type SeriesPrefill = NonNullable<Route.ComponentProps["loaderData"]["seriesPrefill"]>;

function filled(value: unknown) {
  return typeof value === "string" && value.trim() !== "" && value !== "unknown";
}

/** URL import wins where it found a value; everything else stays from the previous edition. */
function mergePrefill(prefill: SeriesPrefill, imported: Imported): Imported {
  const values: EventFormValues = { ...prefill.values };
  for (const [key, value] of Object.entries(imported.values)) {
    if (key === "categoryIds") {
      if (Array.isArray(value) && value.length > 0) values.categoryIds = value;
      continue;
    }
    if (filled(value)) (values as Record<string, unknown>)[key] = value;
  }
  const sources: Record<string, string> = {};
  for (const [key, source] of Object.entries(prefill.sources)) {
    if (source) sources[key] = source;
  }
  for (const [key, source] of Object.entries(imported.sources)) {
    if (filled(imported.values[key as keyof EventFormValues])) sources[key] = source;
  }
  return { ...imported, values, sources };
}

function UrlImport({ onImported }: { onImported: (imported: Imported) => void }) {
  const fetcher = useFetcher<{ importError?: string; imported?: Imported }>();
  const loading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.imported) onImported(fetcher.data.imported);
  }, [fetcher.state, fetcher.data, onImported]);

  return (
    <fetcher.Form method="post" className="grid gap-3">
      <input type="hidden" name="intent" value="import" />
      <Label htmlFor="import-url">イベントページのURL</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="import-url"
          name="url"
          type="url"
          inputMode="url"
          required
          placeholder="https://example.com/events/..."
          className="h-10 flex-1"
        />
        <Button type="submit" className="h-10" disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <Globe />}
          {loading ? "取得中…" : "情報を取得"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        公式サイトなどのページから、イベント名・日時・場所などを読み取ります。取得した内容はそのまま公開されず、次の画面で確認・修正できます。サイトが自動取得を禁止している場合は取得しません。
      </p>
      {fetcher.data?.importError && (
        <Alert variant="destructive">
          <AlertTitle>情報を取得できませんでした</AlertTitle>
          <AlertDescription>
            {fetcher.data.importError}
            <span className="block">「手動で入力」から投稿できます。</span>
          </AlertDescription>
        </Alert>
      )}
    </fetcher.Form>
  );
}

export default function NewEvent({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const prefill = loaderData.seriesPrefill;
  const [imported, setImported] = useState<Imported | null>(null);
  const [tab, setTab] = useState("url");
  const [showDuplicates, setShowDuplicates] = useState(true);
  const [detached, setDetached] = useState(false);
  const submitting = navigation.state === "submitting";
  const seriesActive = !!prefill && !detached;

  const errors = actionData && "errors" in actionData ? (actionData.errors as Record<string, string>) : {};
  const duplicates = actionData && "duplicates" in actionData ? actionData.duplicates : null;
  const echoed = actionData && "values" in actionData ? actionData.values : null;

  useEffect(() => {
    if (duplicates) setShowDuplicates(true);
  }, [duplicates]);

  const acceptImport = useCallback(
    (next: Imported) => {
      setImported(prefill && !detached ? mergePrefill(prefill, next) : next);
      setTab("manual");
    },
    [prefill, detached],
  );

  const values = echoed ?? imported?.values ?? (seriesActive ? prefill.values : {});
  const formKey = imported?.key ?? (prefill ? "series" : "manual");
  const sources = (imported?.sources ?? (seriesActive ? prefill.sources : undefined)) as
    | Partial<Record<string, FieldSource>>
    | undefined;
  const importedDates =
    !!imported &&
    (["startAt", "endAt", "applicationDeadline"] as const).some((key) => filled(imported.values[key]));

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="イベントを投稿"
        description="学校外のイベント情報をみんなに共有しましょう。わからない項目は空欄のままで大丈夫です。"
      />

      {seriesActive && (
        <Alert className="mb-6 border-primary/30 bg-brand-soft/60">
          <Link2 />
          <AlertTitle>「{prefill.seriesTitle}」の次の回として登録しています</AlertTitle>
          <AlertDescription>
            <Link to={`/series/${prefill.seriesId}`} className="font-medium text-primary">
              シリーズを見る
            </Link>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-2 h-7"
              onClick={() => {
                setDetached(true);
                setTab("manual");
              }}
            >
              外す
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!imported && !echoed && !seriesActive && (
        <Tabs value={tab} onValueChange={setTab} className="mb-8">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="url">
              <Link2 /> URLから取得
            </TabsTrigger>
            <TabsTrigger value="manual">
              <PencilLine /> 手動で入力
            </TabsTrigger>
          </TabsList>
          <TabsContent value="url" className="mt-4 rounded-xl border bg-card p-5">
            <UrlImport onImported={acceptImport} />
          </TabsContent>
          <TabsContent value="manual" />
        </Tabs>
      )}

      {seriesActive && !imported && !echoed && (
        <div className="mb-8 rounded-xl border bg-card p-5">
          <UrlImport onImported={acceptImport} />
        </div>
      )}

      {imported && !echoed && (
        <Alert className="mb-6 border-primary/30 bg-brand-soft/60">
          <Sparkles />
          <AlertTitle>ページから情報を取得しました。内容を確認・修正してから投稿してください</AlertTitle>
          <AlertDescription>
            取得できなかった項目は空欄になっています。「要確認」の項目は特に、公式サイトと照らし合わせてください。
            {imported.usedAi && " 一部の項目はAIが本文から整理しました。"}
          </AlertDescription>
        </Alert>
      )}

      {(tab === "manual" || imported || echoed || seriesActive) && (
        <Form method="post" encType="multipart/form-data" className="grid gap-8" key={formKey}>
          {seriesActive && <input type="hidden" name="seriesId" value={prefill.seriesId} />}
          <FormError message={errors._form} />
          {duplicates && showDuplicates && (
            <DuplicatePanel
              candidates={duplicates}
              onDismiss={() => setShowDuplicates(false)}
              submitting={submitting}
            />
          )}
          <EventForm
            categories={loaderData.categories}
            values={values}
            errors={errors}
            sources={sources}
            dateHint={seriesActive && !importedDates ? (prefill.dateHint ?? undefined) : undefined}
            imagePreviewUrl={imported?.imagePreviewUrl}
          />
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
            <p className="mr-auto hidden text-xs text-muted-foreground sm:block">
              投稿すると、投稿者として表示名が公開されます。
            </p>
            <Button type="submit" name="intent" value="submit" size="lg" disabled={submitting}>
              {submitting ? "送信中…" : "内容を確認して投稿"}
            </Button>
          </div>
        </Form>
      )}
    </PageContainer>
  );
}
