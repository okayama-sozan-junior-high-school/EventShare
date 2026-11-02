import { and, count, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { canEndorse, endorsementCommentError, pickRecurringSoon } from "~/lib/endorsement";
import { getEventPhase } from "~/lib/event-phase";
import { seriesStats } from "~/lib/series-stats";
import type { Database } from "../db";
import {
  activityReports,
  ENDORSEMENT_AUDIENCES,
  eventEndorsements,
  eventParticipations,
  events,
  user,
  type EndorsementAudience,
} from "../db/schema";
import { eventCounterUpdate, participationInsert } from "./interactions";
import { orderFor, toEventCards, type EventCard } from "./events";

const LIST_LIMIT = 50;

export type AudienceCounts = Record<EndorsementAudience, number>;

export type EndorsementResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

function emptyCounts(): AudienceCounts {
  const counts = {} as AudienceCounts;
  for (const audience of ENDORSEMENT_AUDIENCES) counts[audience] = 0;
  return counts;
}

export async function getEndorsementState(db: Database, input: { eventId: string; userId: string }) {
  const [row] = await db
    .select({
      id: eventEndorsements.id,
      audience: eventEndorsements.audience,
      comment: eventEndorsements.comment,
      activityReportId: eventEndorsements.activityReportId,
      status: eventEndorsements.status,
    })
    .from(eventEndorsements)
    .where(and(eq(eventEndorsements.eventId, input.eventId), eq(eventEndorsements.userId, input.userId)))
    .limit(1);
  return row ?? null;
}

export async function listEndorsements(
  db: Database,
  input: { eventId: string; viewerIsAdmin: boolean },
) {
  const where = [eq(eventEndorsements.eventId, input.eventId)];
  if (!input.viewerIsAdmin) where.push(eq(eventEndorsements.status, "visible"));

  const rows = await db
    .select({
      id: eventEndorsements.id,
      userId: eventEndorsements.userId,
      userName: user.name,
      audience: eventEndorsements.audience,
      comment: eventEndorsements.comment,
      status: eventEndorsements.status,
      createdAt: eventEndorsements.createdAt,
      activityReportId: eventEndorsements.activityReportId,
      reportTitle: activityReports.title,
      reportStatus: activityReports.status,
    })
    .from(eventEndorsements)
    .innerJoin(user, eq(user.id, eventEndorsements.userId))
    .leftJoin(activityReports, eq(activityReports.id, eventEndorsements.activityReportId))
    .where(and(...where))
    .orderBy(desc(eventEndorsements.createdAt), desc(eventEndorsements.id))
    .limit(LIST_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    audience: row.audience,
    comment: row.comment,
    status: row.status,
    createdAt: row.createdAt,
    activityReport:
      row.activityReportId &&
      row.reportTitle &&
      (input.viewerIsAdmin || row.reportStatus === "visible")
        ? { id: row.activityReportId, title: row.reportTitle }
        : null,
  }));
}

async function hasParticipated(db: Database, userId: string, eventId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(eventParticipations)
    .where(and(eq(eventParticipations.userId, userId), eq(eventParticipations.eventId, eventId)));
  return row.n > 0;
}

export async function upsertEndorsement(
  db: Database,
  input: {
    eventId: string;
    userId: string;
    audience: EndorsementAudience;
    comment: string;
    activityReportId?: string | null;
  },
): Promise<EndorsementResult> {
  const commentError = endorsementCommentError(input.comment);
  if (commentError) return { ok: false, status: 400, error: commentError };
  if (!ENDORSEMENT_AUDIENCES.includes(input.audience)) {
    return { ok: false, status: 400, error: "向いている人を選んでください" };
  }

  const event = await db.query.events.findFirst({ where: eq(events.id, input.eventId) });
  if (!event || event.status !== "published") {
    return { ok: false, status: 404, error: "イベントが見つかりません" };
  }
  const participated = await hasParticipated(db, input.userId, input.eventId);
  if (!canEndorse(getEventPhase(event, new Date()), participated)) {
    return { ok: false, status: 403, error: "終了後、または参加済みの方がおすすめできます" };
  }

  const activityReportId = input.activityReportId ?? null;
  if (activityReportId) {
    const report = await db.query.activityReports.findFirst({
      where: eq(activityReports.id, activityReportId),
    });
    if (
      !report ||
      report.userId !== input.userId ||
      report.eventId !== input.eventId ||
      report.status !== "visible"
    ) {
      return { ok: false, status: 400, error: "このイベントの自分の活動報告を選んでください" };
    }
  }

  const comment = input.comment.trim();
  await db.batch([
    db
      .insert(eventEndorsements)
      .values({
        id: crypto.randomUUID(),
        eventId: input.eventId,
        userId: input.userId,
        audience: input.audience,
        comment,
        activityReportId,
      })
      .onConflictDoUpdate({
        target: [eventEndorsements.userId, eventEndorsements.eventId],
        set: {
          audience: input.audience,
          comment,
          activityReportId,
          updatedAt: new Date(),
        },
      }),
    participationInsert(db, input.userId, input.eventId),
    eventCounterUpdate(db, input.eventId),
  ]);
  return { ok: true };
}

export async function removeEndorsement(db: Database, input: { eventId: string; userId: string }) {
  await db.batch([
    db
      .delete(eventEndorsements)
      .where(and(eq(eventEndorsements.eventId, input.eventId), eq(eventEndorsements.userId, input.userId))),
    eventCounterUpdate(db, input.eventId),
  ]);
}

/** Visible endorsement counts per audience. One query for every id. */
export async function endorsementSummary(db: Database, eventIds: string[]) {
  const summary: Record<string, AudienceCounts> = {};
  if (eventIds.length === 0) return summary;
  for (const id of eventIds) summary[id] = emptyCounts();

  const rows = await db
    .select({
      eventId: eventEndorsements.eventId,
      audience: eventEndorsements.audience,
      n: count(),
    })
    .from(eventEndorsements)
    .where(and(inArray(eventEndorsements.eventId, eventIds), eq(eventEndorsements.status, "visible")))
    .groupBy(eventEndorsements.eventId, eventEndorsements.audience);

  for (const row of rows) {
    const counts = summary[row.eventId];
    if (counts) counts[row.audience] = Number(row.n);
  }
  return summary;
}

async function setEndorsementVisibility(db: Database, id: string, status: "visible" | "hidden") {
  const row = await db.query.eventEndorsements.findFirst({ where: eq(eventEndorsements.id, id) });
  if (!row) return false;
  await db.batch([
    db
      .update(eventEndorsements)
      .set({ status, updatedAt: new Date() })
      .where(eq(eventEndorsements.id, row.id)),
    eventCounterUpdate(db, row.eventId),
  ]);
  return true;
}

export const hideEndorsement = (db: Database, id: string) => setEndorsementVisibility(db, id, "hidden");
export const unhideEndorsement = (db: Database, id: string) => setEndorsementVisibility(db, id, "visible");

export async function listMyEndorsements(
  db: Database,
  userId: string,
  options: { includeHidden?: boolean } = {},
) {
  const where = [eq(eventEndorsements.userId, userId), eq(events.status, "published")];
  if (!options.includeHidden) where.push(eq(eventEndorsements.status, "visible"));
  return db
    .select({
      id: eventEndorsements.id,
      audience: eventEndorsements.audience,
      comment: eventEndorsements.comment,
      status: eventEndorsements.status,
      eventId: events.id,
      eventTitle: events.title,
    })
    .from(eventEndorsements)
    .innerJoin(events, eq(events.id, eventEndorsements.eventId))
    .where(and(...where))
    .orderBy(desc(eventEndorsements.createdAt))
    .limit(LIST_LIMIT);
}

export async function listOwnReportsForEvent(db: Database, userId: string, eventId: string) {
  return db
    .select({ id: activityReports.id, title: activityReports.title })
    .from(activityReports)
    .where(
      and(
        eq(activityReports.userId, userId),
        eq(activityReports.eventId, eventId),
        eq(activityReports.status, "visible"),
      ),
    )
    .orderBy(desc(activityReports.createdAt))
    .limit(LIST_LIMIT);
}

/** Published events (including ones that have ended) with at least one visible endorsement. */
export async function listRecommendedEvents(db: Database, options: { limit: number; now?: Date }) {
  const now = options.now ?? new Date();
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.status, "published"), gt(events.endorsementCount, 0)))
    .orderBy(...orderFor("recommended", now))
    .limit(options.limit);
  return toEventCards(db, rows, now);
}

export type RecurringSoonCard = {
  event: EventCard;
  typicalDeadlineMonth: number;
};

/**
 * Latest edition of series that are due for another round.
 * Candidates are the 50 series with the newest edition among those that
 * already have two published editions.
 */
export async function listRecurringSoonEvents(
  db: Database,
  options: { now: Date; timeZone: string; limit: number },
): Promise<RecurringSoonCard[]> {
  const candidates = await db
    .select({ seriesId: events.seriesId })
    .from(events)
    .where(and(eq(events.status, "published"), isNotNull(events.seriesId)))
    .groupBy(events.seriesId)
    .having(sql`count(*) >= 2`)
    .orderBy(desc(sql`max(coalesce(${events.startAt}, ${events.createdAt}))`))
    .limit(50);

  const seriesIds = candidates.flatMap((row) => (row.seriesId ? [row.seriesId] : []));
  if (seriesIds.length === 0) return [];

  const editions = await db
    .select({
      id: events.id,
      seriesId: events.seriesId,
      startAt: events.startAt,
      endAt: events.endAt,
      applicationDeadline: events.applicationDeadline,
      status: events.status,
    })
    .from(events)
    .where(and(inArray(events.seriesId, seriesIds), eq(events.status, "published")));

  const bySeries = new Map<string, typeof editions>();
  for (const edition of editions) {
    if (!edition.seriesId) continue;
    const list = bySeries.get(edition.seriesId) ?? [];
    list.push(edition);
    bySeries.set(edition.seriesId, list);
  }

  const picked = pickRecurringSoon(
    seriesIds.map((id) => ({ id, editions: bySeries.get(id) ?? [] })),
    options.now,
    options.timeZone,
  ).slice(0, options.limit);

  const meta = picked.flatMap((series) => {
    const stats = seriesStats(series.editions, options.timeZone);
    if (!stats.latest || stats.typicalDeadlineMonth == null) return [];
    return [{ eventId: stats.latest.id, typicalDeadlineMonth: stats.typicalDeadlineMonth }];
  });
  if (meta.length === 0) return [];

  const rows = await db
    .select()
    .from(events)
    .where(
      inArray(
        events.id,
        meta.map((item) => item.eventId),
      ),
    );
  const cards = await toEventCards(db, rows, options.now);
  const cardById = new Map(cards.map((card) => [card.id, card]));
  return meta.flatMap((item) => {
    const event = cardById.get(item.eventId);
    return event ? [{ event, typicalDeadlineMonth: item.typicalDeadlineMonth }] : [];
  });
}

export async function adminListEndorsements(db: Database) {
  return db
    .select({
      id: eventEndorsements.id,
      audience: eventEndorsements.audience,
      comment: eventEndorsements.comment,
      status: eventEndorsements.status,
      createdAt: eventEndorsements.createdAt,
      eventId: events.id,
      eventTitle: events.title,
      userId: user.id,
      userName: user.name,
    })
    .from(eventEndorsements)
    .innerJoin(events, eq(events.id, eventEndorsements.eventId))
    .innerJoin(user, eq(user.id, eventEndorsements.userId))
    .orderBy(desc(eventEndorsements.createdAt))
    .limit(100);
}
