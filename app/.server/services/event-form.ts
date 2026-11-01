import { toDateTimeLocalValue } from "~/lib/datetime";
import type { Database } from "../db";
import type { Event } from "../db/schema";
import { getOwnedUnattachedImage, readUpload, storeMedia } from "../media/store";
import type { ImportedDraft } from "../url-import/extract";
import { flattenErrors, formDataToObject, type FieldErrors } from "../validation/common";
import { eventInputSchema, type EventInput } from "../validation/event";

/** Raw string values echoed back into the form (uncontrolled inputs). */
export type EventFormValues = {
  title?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  applicationDeadline?: string;
  location?: string;
  format?: string;
  organizer?: string;
  targetAudience?: string;
  feeType?: string;
  feeDetail?: string;
  officialUrl?: string;
  applicationUrl?: string;
  categoryIds?: string[];
  tags?: string[];
  importedImageId?: string;
  sourceUrl?: string;
};

export function parseEventForm(form: FormData, timeZone: string) {
  const raw = formDataToObject(form, ["categoryIds", "tags"]);
  const parsed = eventInputSchema(timeZone).safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: flattenErrors(parsed.error) as FieldErrors,
      values: raw as EventFormValues,
    };
  }
  return { ok: true as const, data: parsed.data, values: raw as EventFormValues };
}

/**
 * Resolves the event image from an upload or an image imported from a URL.
 * `undefined` = unchanged, `null` = remove.
 */
export async function resolveEventImage(
  db: Database,
  form: FormData,
  userId: string,
  input: EventInput,
): Promise<{ mediaId: string | null | undefined; error?: string }> {
  const upload = await readUpload(form.get("image"));
  if (upload && "tooLarge" in upload) return { mediaId: undefined, error: "画像が大きすぎます（上限5MB）" };
  if (upload) {
    const stored = await storeMedia(db, upload.bytes, { ownerId: userId, allowed: ["image"] });
    if (!stored.ok) return { mediaId: undefined, error: stored.error };
    return { mediaId: stored.media.id };
  }
  if (input.importedImageId) {
    const media = await getOwnedUnattachedImage(db, input.importedImageId, userId);
    if (media) return { mediaId: media.id };
  }
  if (input.removeImage) return { mediaId: null };
  return { mediaId: undefined };
}

export function eventToFormValues(event: Event, categoryIds: number[], timeZone: string): EventFormValues {
  return {
    title: event.title,
    description: event.description ?? "",
    startAt: toDateTimeLocalValue(event.startAt, timeZone),
    endAt: toDateTimeLocalValue(event.endAt, timeZone),
    applicationDeadline: toDateTimeLocalValue(event.applicationDeadline, timeZone),
    location: event.location ?? "",
    format: event.format,
    organizer: event.organizer ?? "",
    targetAudience: event.targetAudience ?? "",
    feeType: event.feeType,
    feeDetail: event.feeDetail ?? "",
    officialUrl: event.officialUrl ?? "",
    applicationUrl: event.applicationUrl ?? "",
    categoryIds: categoryIds.map(String),
  };
}

export function draftToFormValues(draft: ImportedDraft, sourceUrl: string, timeZone: string): EventFormValues {
  return {
    title: draft.title ?? "",
    description: draft.description ?? "",
    startAt: toDateTimeLocalValue(draft.startAt, timeZone),
    endAt: toDateTimeLocalValue(draft.endAt, timeZone),
    applicationDeadline: toDateTimeLocalValue(draft.applicationDeadline, timeZone),
    location: draft.location ?? "",
    format: draft.format ?? "unknown",
    organizer: draft.organizer ?? "",
    targetAudience: draft.targetAudience ?? "",
    feeType: draft.feeType ?? "unknown",
    feeDetail: draft.feeDetail ?? "",
    officialUrl: draft.officialUrl ?? "",
    applicationUrl: draft.applicationUrl ?? "",
    categoryIds: [],
    sourceUrl,
  };
}
