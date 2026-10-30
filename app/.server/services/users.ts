import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db";
import {
  categories,
  eventContributions,
  eventParticipations,
  events,
  user,
  userInterests,
} from "../db/schema";
import { chunkForD1 } from "../db/utils";

export async function getUserById(db: Database, id: string) {
  return db.query.user.findFirst({ where: eq(user.id, id) });
}

export type Visibility = "public" | "members" | "private";

export function canViewProfile(
  visibility: Visibility,
  viewer: { id: string; role?: string | null } | null,
  ownerId: string,
) {
  if (viewer?.id === ownerId || viewer?.role === "admin") return true;
  if (visibility === "public") return true;
  if (visibility === "members") return !!viewer;
  return false;
}

export async function updateProfile(
  db: Database,
  userId: string,
  input: { name: string; grade: string | null; bio: string | null; profileVisibility: Visibility },
) {
  await db
    .update(user)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(user.id, userId));
}

export async function getInterests(db: Database, userId: string) {
  return db
    .select({
      id: userInterests.id,
      label: userInterests.label,
      categoryId: userInterests.categoryId,
      categorySlug: categories.slug,
      source: userInterests.source,
    })
    .from(userInterests)
    .leftJoin(categories, eq(categories.id, userInterests.categoryId))
    .where(eq(userInterests.userId, userId))
    .orderBy(asc(userInterests.createdAt));
}

/** Replace the user's interests (category based + free keywords). */
export async function replaceInterests(
  db: Database,
  userId: string,
  categoryIds: number[],
  keywords: string[],
  source: "manual" | "ai_chat",
) {
  const cats = categoryIds.length
    ? await db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(inArray(categories.id, categoryIds))
    : [];
  await db.delete(userInterests).where(eq(userInterests.userId, userId));
  const rows = [
    ...cats.map((c) => ({ id: crypto.randomUUID(), userId, categoryId: c.id, label: c.name, source })),
    ...[...new Set(keywords)]
      .filter((k) => !cats.some((c) => c.name === k))
      .slice(0, 20)
      .map((label) => ({ id: crypto.randomUUID(), userId, categoryId: null, label, source })),
  ];
  for (const batch of chunkForD1(rows, 5)) {
    await db.insert(userInterests).values(batch).onConflictDoNothing();
  }
}

/** Adds interests (from AI chat, with consent) without removing existing ones. */
export async function addInterests(
  db: Database,
  userId: string,
  categoryIds: number[],
  keywords: string[],
) {
  const existing = await getInterests(db, userId);
  await replaceInterests(
    db,
    userId,
    [...new Set([...existing.flatMap((i) => (i.categoryId ? [i.categoryId] : [])), ...categoryIds])],
    [...existing.filter((i) => !i.categoryId).map((i) => i.label), ...keywords],
    "ai_chat",
  );
}

export async function eventsPostedBy(db: Database, userId: string, limit = 50) {
  return db
    .select()
    .from(events)
    .where(and(eq(events.createdById, userId), eq(events.status, "published")))
    .orderBy(desc(events.createdAt))
    .limit(limit);
}

export async function eventsParticipatedBy(db: Database, userId: string, limit = 50) {
  return db
    .select({ event: events })
    .from(eventParticipations)
    .innerJoin(events, eq(events.id, eventParticipations.eventId))
    .where(and(eq(eventParticipations.userId, userId), eq(events.status, "published")))
    .orderBy(desc(events.startAt))
    .limit(limit)
    .then((rows) => rows.map((r) => r.event));
}

export async function contributionsBy(db: Database, userId: string, limit = 50) {
  return db
    .select({
      id: eventContributions.id,
      type: eventContributions.type,
      createdAt: eventContributions.createdAt,
      eventId: events.id,
      eventTitle: events.title,
    })
    .from(eventContributions)
    .innerJoin(events, eq(events.id, eventContributions.eventId))
    .where(eq(eventContributions.userId, userId))
    .orderBy(desc(eventContributions.createdAt))
    .limit(limit);
}
