import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { formatShortDateTime } from "~/lib/datetime";
import type { Database } from "../db";
import {
  comments,
  eventBookmarks,
  eventParticipations,
  events,
  notifications,
  notificationSettings,
  userInterests,
  NOTIFICATION_TYPES,
} from "../db/schema";
import { chunkForD1 } from "../db/utils";

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const SETTING_COLUMN = {
  new_event: notificationSettings.newEvent,
  deadline_soon: notificationSettings.deadlineSoon,
  event_soon: notificationSettings.eventSoon,
  comment: notificationSettings.comment,
  reaction: notificationSettings.reaction,
  new_edition: notificationSettings.newEdition,
} as const;

/** Removes users who switched this notification type off. */
async function filterByPreference(db: Database, userIds: string[], type: NotificationType) {
  if (type === "system" || userIds.length === 0) return userIds;
  const column = SETTING_COLUMN[type];
  const disabled = new Set<string>();
  for (const ids of chunkForD1(userIds, 1, 5)) {
    const rows = await db
      .select({ userId: notificationSettings.userId })
      .from(notificationSettings)
      .where(and(inArray(notificationSettings.userId, ids), eq(column, false)));
    for (const r of rows) disabled.add(r.userId);
  }
  return userIds.filter((id) => !disabled.has(id));
}

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string | null;
  link?: string | null;
  eventId?: string | null;
  actorId?: string | null;
  /** Called per recipient to build a dedupe key (prevents repeated reminders). */
  dedupeKey?: (userId: string) => string;
};

export async function notify(db: Database, userIds: string[], input: NotifyInput) {
  const recipients = await filterByPreference(
    db,
    [...new Set(userIds)].filter((id) => id !== input.actorId),
    input.type,
  );
  const rows = recipients.map((userId) => ({
    id: crypto.randomUUID(),
    userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    eventId: input.eventId ?? null,
    actorId: input.actorId ?? null,
    dedupeKey: input.dedupeKey?.(userId) ?? null,
  }));
  for (const batch of chunkForD1(rows, 9)) {
    await db.insert(notifications).values(batch).onConflictDoNothing();
  }
  return recipients;
}

export async function notifyNewEvent(
  db: Database,
  event: { id: string; title: string },
  categoryIds: number[],
  actorId: string,
  excludeUserIds: Iterable<string> = [],
) {
  if (categoryIds.length === 0) return [];
  const exclude = new Set(excludeUserIds);
  const interested = await db
    .selectDistinct({ userId: userInterests.userId })
    .from(userInterests)
    .where(inArray(userInterests.categoryId, categoryIds))
    .limit(1000);
  return notify(
    db,
    interested.map((r) => r.userId).filter((id) => !exclude.has(id)),
    {
      type: "new_event",
      title: "興味のある分野の新しいイベントが投稿されました",
      body: event.title,
      link: `/events/${event.id}`,
      eventId: event.id,
      actorId,
      dedupeKey: (u) => `new_event:${event.id}:${u}`,
    },
  );
}

export async function notifyComment(
  db: Database,
  event: { id: string; title: string; createdById: string | null },
  commenterId: string,
  commenterName: string,
) {
  const previous = await db
    .selectDistinct({ userId: comments.userId })
    .from(comments)
    .where(and(eq(comments.eventId, event.id), eq(comments.status, "visible")))
    .limit(200);
  const recipients = previous.map((r) => r.userId);
  if (event.createdById) recipients.push(event.createdById);
  return notify(db, recipients, {
    type: "comment",
    title: `${commenterName}さんがコメントしました`,
    body: event.title,
    link: `/events/${event.id}#comments`,
    eventId: event.id,
    actorId: commenterId,
  });
}

export async function notifyReaction(
  db: Database,
  event: { id: string; title: string; createdById: string | null },
  actor: { id: string; name: string },
  kind: "like" | "bookmark",
) {
  if (!event.createdById) return 0;
  return notify(db, [event.createdById], {
    type: "reaction",
    title:
      kind === "like"
        ? `${actor.name}さんがあなたの投稿にいいねしました`
        : `${actor.name}さんがあなたの投稿をお気に入りに追加しました`,
    body: event.title,
    link: `/events/${event.id}`,
    eventId: event.id,
    actorId: actor.id,
    dedupeKey: (u) => `reaction:${kind}:${event.id}:${actor.id}:${u}`,
  });
}

const DAY = 86_400_000;

/** Daily reminders for bookmarked / joined events. Idempotent via dedupe keys. */
export async function sendReminders(db: Database, now: Date, timeZone: string) {
  let sent = 0;

  const deadlines = await db
    .select({
      eventId: events.id,
      title: events.title,
      deadline: events.applicationDeadline,
      userId: eventBookmarks.userId,
    })
    .from(eventBookmarks)
    .innerJoin(events, eq(events.id, eventBookmarks.eventId))
    .where(
      and(
        eq(events.status, "published"),
        gt(events.applicationDeadline, now),
        lte(events.applicationDeadline, new Date(now.getTime() + 3 * DAY)),
      ),
    )
    .limit(5000);
  for (const row of deadlines) {
    sent += (await notify(db, [row.userId], {
      type: "deadline_soon",
      title: "お気に入りイベントの応募締切が近づいています",
      body: `${row.title}（締切 ${formatShortDateTime(row.deadline!, timeZone)}）`,
      link: `/events/${row.eventId}`,
      eventId: row.eventId,
      dedupeKey: (u) => `deadline_soon:${row.eventId}:${u}`,
    })).length;
  }

  const startWindow = and(
    eq(events.status, "published"),
    gt(events.startAt, now),
    lte(events.startAt, new Date(now.getTime() + 2 * DAY)),
  );
  const upcoming = [
    ...(await db
      .select({ eventId: events.id, title: events.title, startAt: events.startAt, userId: eventBookmarks.userId })
      .from(eventBookmarks)
      .innerJoin(events, eq(events.id, eventBookmarks.eventId))
      .where(startWindow)
      .limit(5000)),
    ...(await db
      .select({ eventId: events.id, title: events.title, startAt: events.startAt, userId: eventParticipations.userId })
      .from(eventParticipations)
      .innerJoin(events, eq(events.id, eventParticipations.eventId))
      .where(startWindow)
      .limit(5000)),
  ];
  for (const row of upcoming) {
    sent += (await notify(db, [row.userId], {
      type: "event_soon",
      title: "もうすぐイベントの開催日です",
      body: `${row.title}（${formatShortDateTime(row.startAt!, timeZone)}〜）`,
      link: `/events/${row.eventId}`,
      eventId: row.eventId,
      dedupeKey: (u) => `event_soon:${row.eventId}:${u}`,
    })).length;
  }
  return sent;
}

export async function unreadCount(db: Database, userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export async function listNotifications(db: Database, userId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markRead(db: Database, userId: string, id?: string) {
  const conditions = [eq(notifications.userId, userId), isNull(notifications.readAt)];
  if (id) conditions.push(eq(notifications.id, id));
  await db.update(notifications).set({ readAt: new Date() }).where(and(...conditions));
}

export async function getNotificationSettings(db: Database, userId: string) {
  const row = await db.query.notificationSettings.findFirst({
    where: eq(notificationSettings.userId, userId),
  });
  return {
    newEvent: row?.newEvent ?? true,
    deadlineSoon: row?.deadlineSoon ?? true,
    eventSoon: row?.eventSoon ?? true,
    comment: row?.comment ?? true,
    reaction: row?.reaction ?? true,
    newEdition: row?.newEdition ?? true,
  };
}

export type NotificationPrefs = Awaited<ReturnType<typeof getNotificationSettings>>;

/** An omitted `newEdition` keeps the stored value. */
export async function saveNotificationSettings(
  db: Database,
  userId: string,
  prefs: Omit<NotificationPrefs, "newEdition"> & { newEdition?: boolean },
) {
  await db
    .insert(notificationSettings)
    .values({ userId, ...prefs })
    .onConflictDoUpdate({
      target: notificationSettings.userId,
      set: { ...prefs, updatedAt: new Date() },
    });
}

/** Deletes read notifications older than 90 days. */
export async function pruneNotifications(db: Database, now: Date) {
  await db
    .delete(notifications)
    .where(
      and(
        sql`${notifications.readAt} IS NOT NULL`,
        lte(notifications.createdAt, new Date(now.getTime() - 90 * DAY)),
        ne(notifications.type, "system"),
      ),
    );
}
