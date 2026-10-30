import { env } from "cloudflare:workers";
import { and, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { Database } from "../db";
import { events, mediaAssets } from "../db/schema";
import { MEDIA_LIMITS, validateMedia, type MediaKind } from "./validate";

export type StoredMedia = { id: string; kind: MediaKind };

export async function storeMedia(
  db: Database,
  bytes: Uint8Array,
  options: {
    ownerId: string;
    allowed: readonly MediaKind[];
    activityReportId?: string;
  },
): Promise<{ ok: true; media: StoredMedia } | { ok: false; error: string }> {
  const result = validateMedia(bytes, options.allowed);
  if (!result.ok) return result;
  const { detected } = result;
  const id = crypto.randomUUID();
  const key = `media/${new Date().getUTCFullYear()}/${id}.${detected.ext}`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: detected.contentType },
  });
  await db.insert(mediaAssets).values({
    id,
    key,
    ownerId: options.ownerId,
    kind: detected.kind,
    contentType: detected.contentType,
    size: bytes.byteLength,
    activityReportId: options.activityReportId ?? null,
  });
  return { ok: true, media: { id, kind: detected.kind } };
}

/** Reads an uploaded `File` from FormData; returns null when no file chosen. */
export async function readUpload(value: FormDataEntryValue | null) {
  if (!value || typeof value === "string" || value.size === 0) return null;
  if (value.size > MEDIA_LIMITS.video) {
    return { tooLarge: true as const };
  }
  return { bytes: new Uint8Array(await value.arrayBuffer()) };
}

export async function getMedia(db: Database, id: string) {
  return db.query.mediaAssets.findFirst({
    where: and(eq(mediaAssets.id, id), eq(mediaAssets.status, "visible")),
  });
}

/** Media owned by `ownerId` and not yet attached to anything (URL import). */
export async function getOwnedUnattachedImage(
  db: Database,
  id: string,
  ownerId: string,
) {
  return db.query.mediaAssets.findFirst({
    where: and(
      eq(mediaAssets.id, id),
      eq(mediaAssets.ownerId, ownerId),
      eq(mediaAssets.kind, "image"),
      isNull(mediaAssets.activityReportId),
    ),
  });
}

export async function deleteMedia(db: Database, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: mediaAssets.id, key: mediaAssets.key })
    .from(mediaAssets)
    .where(inArray(mediaAssets.id, ids));
  if (rows.length === 0) return;
  await env.MEDIA.delete(rows.map((r) => r.key));
  await db.delete(mediaAssets).where(inArray(mediaAssets.id, rows.map((r) => r.id)));
}

/** Removes images that were uploaded/imported but never attached (older than 1 day). */
export async function cleanupOrphanMedia(db: Database, now: Date) {
  const referenced = db
    .select({ id: sql<string>`${events.imageMediaId}` })
    .from(events)
    .where(sql`${events.imageMediaId} IS NOT NULL`);
  const orphans = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        isNull(mediaAssets.activityReportId),
        notInArray(mediaAssets.id, referenced),
        lt(mediaAssets.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    )
    .limit(100);
  await deleteMedia(
    db,
    orphans.map((o) => o.id),
  );
  return orphans.length;
}
