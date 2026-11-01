import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  buildSearchConditions,
  getActiveCategories,
  getCategoriesForEvents,
  orderFor,
  PAGE_SIZE,
  type EventSearchParams,
} from "~/.server/services/events";
import { createDb } from "~/.server/db";
import {
  activityReports,
  eventEndorsements,
  eventSeries,
  eventSources,
  events,
  eventTags,
  tags,
} from "~/.server/db/schema";
import { seriesStats } from "~/lib/series-stats";
import { TAG_FACETS, type TagFacetKey } from "~/lib/tags";
import { ENDORSEMENT_AUDIENCE_LABEL, FORMAT_LABEL } from "~/lib/labels";
import { truncate } from "~/lib/text";
import type { McpDataSource, McpSearchQuery } from "./server";
import type {
  McpAudienceCount,
  McpEdition,
  McpEventDetail,
  McpEventSummary,
  McpRecommendCandidate,
  McpSeriesDetail,
  McpSeriesStats,
  McpSeriesSummary,
  McpTagRef,
} from "./format";

const DAY = 86_400_000;
const RECENTLY_ENDED_DAYS = 180;
const FACET_ORDER: TagFacetKey[] = ["audience", "participation", "schedule", "outcome", "other"];
const AUDIENCES = ["beginner_ok", "experienced", "anyone"] as const;

type Audience = (typeof AUDIENCES)[number];

function eventColumns() {
  return {
    id: events.id,
    title: events.title,
    description: events.description,
    startAt: events.startAt,
    endAt: events.endAt,
    location: events.location,
    format: events.format,
    organizer: events.organizer,
    targetAudience: events.targetAudience,
    feeType: events.feeType,
    feeDetail: events.feeDetail,
    applicationDeadline: events.applicationDeadline,
    officialUrl: events.officialUrl,
    applicationUrl: events.applicationUrl,
    imageMediaId: events.imageMediaId,
    status: events.status,
    mergedIntoId: events.mergedIntoId,
    seriesId: events.seriesId,
    editionLabel: events.editionLabel,
    startMonth: events.startMonth,
    endorsementCount: events.endorsementCount,
    likeCount: events.likeCount,
    bookmarkCount: events.bookmarkCount,
  };
}

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  startAt: Date | null;
  endAt: Date | null;
  location: string | null;
  format: McpEventSummary["format"];
  organizer: string | null;
  targetAudience: string | null;
  feeType: McpEventSummary["feeType"];
  feeDetail: string | null;
  applicationDeadline: Date | null;
  officialUrl: string | null;
  applicationUrl: string | null;
  imageMediaId: string | null;
  status: "published" | "hidden" | "merged";
  mergedIntoId: string | null;
  seriesId: string | null;
  editionLabel: string | null;
  startMonth: number | null;
  endorsementCount: number;
  likeCount: number;
  bookmarkCount: number;
};

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function excerptOf(description: string | null) {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  return text ? truncate(text, 110) : null;
}

function entries(map: Record<string, string>) {
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}

function audienceCounts(rows: { audience: string; n: number }[]): McpAudienceCount[] {
  const counts: Record<Audience, number> = { beginner_ok: 0, experienced: 0, anyone: 0 };
  for (const row of rows) {
    if (row.audience === "beginner_ok" || row.audience === "experienced" || row.audience === "anyone") {
      counts[row.audience] = Number(row.n);
    }
  }
  return AUDIENCES.map((value) => ({
    value,
    label: ENDORSEMENT_AUDIENCE_LABEL[value],
    count: counts[value],
  }));
}

function toStats(
  editions: { id: string; startAt: Date | null; applicationDeadline: Date | null; status: string }[],
  timeZone: string,
  now: Date,
): McpSeriesStats {
  const stats = seriesStats(editions, timeZone);
  return {
    count: stats.count,
    cadence: stats.cadence,
    typicalStartMonth: stats.typicalStartMonth,
    typicalDeadlineMonth: stats.typicalDeadlineMonth,
    isRecurringSoon: stats.isRecurringSoon(now),
  };
}

function neighbors(editions: { id: string }[], id: string) {
  const index = editions.findIndex((edition) => edition.id === id);
  if (index < 0) return { previousEditionId: null, nextEditionId: null };
  return {
    previousEditionId: editions[index - 1]?.id ?? null,
    nextEditionId: editions[index + 1]?.id ?? null,
  };
}

/**
 * Read-only data source for the MCP server. No user names, emails, or ids
 * are selected.
 */
export function createDbDataSource(options: { now: Date; timeZone: string }): McpDataSource {
  const db = createDb();
  const { now, timeZone } = options;

  function toSummary(
    row: EventRow,
    categories: { slug: string; name: string }[],
    tagList: McpTagRef[],
    series: McpSeriesSummary | null,
  ): McpEventSummary {
    return {
      id: row.id,
      title: row.title,
      excerpt: excerptOf(row.description),
      startAt: row.startAt,
      endAt: row.endAt,
      applicationDeadline: row.applicationDeadline,
      location: emptyToNull(row.location),
      format: row.format,
      feeType: row.feeType,
      organizer: emptyToNull(row.organizer),
      targetAudience: emptyToNull(row.targetAudience),
      officialUrl: emptyToNull(row.officialUrl),
      applicationUrl: emptyToNull(row.applicationUrl),
      imageUrl: row.imageMediaId ? `/media/${row.imageMediaId}` : null,
      categories,
      tags: tagList,
      endorsementCount: row.endorsementCount,
      editionLabel: emptyToNull(row.editionLabel),
      seriesId: row.seriesId,
      series,
    };
  }

  async function tagsFor(eventIds: string[]) {
    const map = new Map<string, McpTagRef[]>();
    if (eventIds.length === 0) return map;
    const rows = await db
      .select({
        eventId: eventTags.eventId,
        slug: tags.slug,
        name: tags.name,
        facet: tags.facet,
      })
      .from(eventTags)
      .innerJoin(tags, eq(tags.id, eventTags.tagId))
      .where(and(inArray(eventTags.eventId, eventIds), eq(tags.status, "active")));
    for (const row of rows) {
      const list = map.get(row.eventId) ?? [];
      list.push({ slug: row.slug, name: row.name, facet: row.facet });
      map.set(row.eventId, list);
    }
    return map;
  }

  async function seriesBriefs(seriesIds: string[]) {
    const map = new Map<string, McpSeriesSummary>();
    if (seriesIds.length === 0) return map;
    const [seriesRows, editionRows] = await Promise.all([
      db
        .select({ id: eventSeries.id, title: eventSeries.title })
        .from(eventSeries)
        .where(inArray(eventSeries.id, seriesIds)),
      db
        .select({
          id: events.id,
          seriesId: events.seriesId,
          startAt: events.startAt,
          applicationDeadline: events.applicationDeadline,
          status: events.status,
        })
        .from(events)
        .where(and(inArray(events.seriesId, seriesIds), eq(events.status, "published"))),
    ]);
    const bySeries = new Map<string, typeof editionRows>();
    for (const row of editionRows) {
      if (!row.seriesId) continue;
      const list = bySeries.get(row.seriesId) ?? [];
      list.push(row);
      bySeries.set(row.seriesId, list);
    }
    for (const series of seriesRows) {
      map.set(series.id, {
        id: series.id,
        title: series.title,
        stats: toStats(bySeries.get(series.id) ?? [], timeZone, now),
      });
    }
    return map;
  }

  async function hydrate(rows: EventRow[]) {
    const ids = rows.map((row) => row.id);
    const seriesIds = [...new Set(rows.map((row) => row.seriesId).filter((id): id is string => !!id))];
    const [catMap, tagMap, seriesMap] = await Promise.all([
      getCategoriesForEvents(db, ids),
      tagsFor(ids),
      seriesBriefs(seriesIds),
    ]);
    return rows.map((row) =>
      toSummary(
        row,
        (catMap.get(row.id) ?? []).map((category) => ({ slug: category.slug, name: category.name })),
        tagMap.get(row.id) ?? [],
        row.seriesId ? (seriesMap.get(row.seriesId) ?? null) : null,
      ),
    );
  }

  async function endorsementRows(eventIds: string[]) {
    if (eventIds.length === 0) return audienceCounts([]);
    const rows = await db
      .select({ audience: eventEndorsements.audience, n: count() })
      .from(eventEndorsements)
      .where(and(inArray(eventEndorsements.eventId, eventIds), eq(eventEndorsements.status, "visible")))
      .groupBy(eventEndorsements.audience);
    return audienceCounts(rows.map((row) => ({ audience: row.audience, n: Number(row.n) })));
  }

  async function loadEditions(seriesId: string) {
    return db
      .select({
        id: events.id,
        title: events.title,
        startAt: events.startAt,
        applicationDeadline: events.applicationDeadline,
        status: events.status,
        editionLabel: events.editionLabel,
      })
      .from(events)
      .where(and(eq(events.seriesId, seriesId), eq(events.status, "published")))
      .orderBy(sql`${events.startAt} IS NULL`, asc(events.startAt));
  }

  function toEdition(row: {
    id: string;
    title: string;
    startAt: Date | null;
    status: string;
    editionLabel: string | null;
  }): McpEdition {
    return {
      id: row.id,
      title: row.title,
      startAt: row.startAt,
      status: row.status,
      editionLabel: emptyToNull(row.editionLabel),
    };
  }

  async function findSeries(id: string) {
    const [row] = await db
      .select({
        id: eventSeries.id,
        title: eventSeries.title,
        description: eventSeries.description,
      })
      .from(eventSeries)
      .where(eq(eventSeries.id, id))
      .limit(1);
    return row ?? null;
  }

  async function resolvePublished(id: string) {
    const seen = new Set<string>();
    let current = id;
    for (let hop = 0; hop < 5; hop++) {
      if (seen.has(current)) return null;
      seen.add(current);
      const [row] = await db.select(eventColumns()).from(events).where(eq(events.id, current)).limit(1);
      if (!row) return null;
      if (row.status === "merged" && row.mergedIntoId) {
        current = row.mergedIntoId;
        continue;
      }
      if (row.status !== "published") return null;
      return { row: row as EventRow, resolvedFrom: row.id === id ? null : id };
    }
    return null;
  }

  return {
    async searchEvents(query: McpSearchQuery) {
      const params: EventSearchParams = {
        q: query.q?.trim() ? query.q.trim().slice(0, 200) : undefined,
        category: (query.category ?? []).slice(0, 10),
        from: query.from,
        to: query.to,
        deadline: query.deadline,
        location: query.location?.trim().slice(0, 200) || undefined,
        format: query.format,
        fee: query.fee,
        audience: query.audience?.trim().slice(0, 200) || undefined,
        status: query.status ?? "upcoming",
        sort: query.sort ?? "start",
        page: Math.min(Math.max(query.page ?? 1, 1), 50),
      };
      const empty = { items: [], total: 0, page: 1, pageCount: 0, pageSize: PAGE_SIZE };
      const base = await buildSearchConditions(db, params, now, timeZone);
      if (!base) return empty;

      const extras: SQL[] = [];
      const months = [...new Set((query.month ?? []).filter((month) => month >= 1 && month <= 12))].slice(0, 12);
      if (months.length > 0) extras.push(inArray(events.startMonth, months));

      const tagSlugs = (query.tag ?? []).map((slug) => slug.trim()).filter(Boolean).slice(0, 10);
      if (tagSlugs.length > 0) {
        const found = await db
          .select({ id: tags.id })
          .from(tags)
          .where(and(inArray(tags.slug, tagSlugs), eq(tags.status, "active")));
        if (found.length === 0) return empty;
        extras.push(
          inArray(
            events.id,
            db
              .select({ id: eventTags.eventId })
              .from(eventTags)
              .where(inArray(eventTags.tagId, found.map((tag) => tag.id))),
          ),
        );
      }

      const where = extras.length > 0 ? and(base, ...extras) : base;
      if (!where) return empty;

      const [{ total }] = await db.select({ total: count() }).from(events).where(where);
      const totalCount = Number(total);
      if (totalCount === 0) return empty;
      const pageCount = Math.ceil(totalCount / PAGE_SIZE);
      const page = Math.min(params.page, pageCount);
      const rows = await db
        .select(eventColumns())
        .from(events)
        .where(where)
        .orderBy(...orderFor(params.sort, now))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE);
      return {
        items: await hydrate(rows as EventRow[]),
        total: totalCount,
        page,
        pageCount,
        pageSize: PAGE_SIZE,
      };
    },

    async getEvent(id: string): Promise<McpEventDetail | null> {
      const resolved = await resolvePublished(id);
      if (!resolved) return null;
      const { row, resolvedFrom } = resolved;
      const [categories, tagMap, sources, counts, comments, activities, seriesRow, editionRows] = await Promise.all([
        getCategoriesForEvents(db, [row.id]),
        tagsFor([row.id]),
        db
          .select({ url: eventSources.url, kind: eventSources.kind })
          .from(eventSources)
          .where(eq(eventSources.eventId, row.id))
          .limit(20),
        endorsementRows([row.id]),
        db
          .select({
            audience: eventEndorsements.audience,
            comment: eventEndorsements.comment,
          })
          .from(eventEndorsements)
          .where(
            and(
              eq(eventEndorsements.eventId, row.id),
              eq(eventEndorsements.status, "visible"),
              isNotNull(eventEndorsements.comment),
            ),
          )
          .orderBy(desc(eventEndorsements.createdAt))
          .limit(5),
        db
          .select({
            title: activityReports.title,
            activity: activityReports.activity,
            reflection: activityReports.reflection,
          })
          .from(activityReports)
          .where(and(eq(activityReports.eventId, row.id), eq(activityReports.status, "visible")))
          .orderBy(desc(activityReports.createdAt))
          .limit(5),
        row.seriesId ? findSeries(row.seriesId) : Promise.resolve(null),
        row.seriesId ? loadEditions(row.seriesId) : Promise.resolve([]),
      ]);

      const editions = editionRows.map(toEdition);
      const series: McpSeriesSummary | null = seriesRow
        ? { id: seriesRow.id, title: seriesRow.title, stats: toStats(editionRows, timeZone, now) }
        : null;
      const around = neighbors(editions, row.id);
      const summary = toSummary(
        row,
        (categories.get(row.id) ?? []).map((category) => ({ slug: category.slug, name: category.name })),
        tagMap.get(row.id) ?? [],
        series,
      );
      const description = emptyToNull(row.description);

      return {
        ...summary,
        description: description ? truncate(description, 4000) : null,
        feeDetail: emptyToNull(row.feeDetail) ? truncate(emptyToNull(row.feeDetail)!, 300) : null,
        sources: sources.map((source) => ({ url: source.url, kind: source.kind })),
        endorsements: {
          total: counts.reduce((sum, item) => sum + item.count, 0),
          byAudience: counts,
          comments: comments
            .map((comment) => ({
              audience: comment.audience,
              comment: comment.comment?.trim() ?? "",
            }))
            .filter((comment) => comment.comment.length > 0)
            .slice(0, 5),
        },
        activities: activities.map((activity) => ({
          title: activity.title,
          summary: truncate(
            [activity.activity, activity.reflection].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
            200,
          ),
        })),
        editions,
        previousEditionId: around.previousEditionId,
        nextEditionId: around.nextEditionId,
        resolvedFrom,
      };
    },

    async getSeries(id: string): Promise<McpSeriesDetail | null> {
      let series = await findSeries(id);
      if (!series) {
        const [event] = await db
          .select({ seriesId: events.seriesId, status: events.status })
          .from(events)
          .where(eq(events.id, id))
          .limit(1);
        if (!event || event.status !== "published" || !event.seriesId) return null;
        series = await findSeries(event.seriesId);
      }
      if (!series) return null;
      const editionRows = await loadEditions(series.id);
      const counts = await endorsementRows(editionRows.map((edition) => edition.id));
      const description = emptyToNull(series.description);
      return {
        id: series.id,
        title: series.title,
        description: description ? truncate(description, 1000) : null,
        stats: toStats(editionRows, timeZone, now),
        editions: editionRows.map(toEdition),
        endorsements: {
          total: counts.reduce((sum, item) => sum + item.count, 0),
          byAudience: counts,
        },
      };
    },

    async listFacets() {
      const [categories, tagRows] = await Promise.all([
        getActiveCategories(db),
        db
          .select({
            name: tags.name,
            slug: tags.slug,
            facet: tags.facet,
            useCount: tags.useCount,
          })
          .from(tags)
          .where(and(eq(tags.status, "active"), or(ne(tags.facet, "other"), gte(tags.useCount, 2))))
          .orderBy(desc(tags.useCount), asc(tags.name)),
      ]);
      return {
        categories: categories.map((category) => ({ slug: category.slug, name: category.name })),
        tagsByFacet: FACET_ORDER.map((facet) => ({
          facet,
          label: TAG_FACETS[facet],
          tags: tagRows
            .filter((tag) => tag.facet === facet)
            .map((tag) => ({ slug: tag.slug, name: tag.name, useCount: tag.useCount })),
        })).filter((group) => group.tags.length > 0),
        audience: entries(ENDORSEMENT_AUDIENCE_LABEL),
        format: entries(FORMAT_LABEL),
        status: [
          { value: "upcoming", label: "開催予定（終了していない）" },
          { value: "ended", label: "終了" },
          { value: "all", label: "すべて" },
        ],
      };
    },

    async loadRecommendCandidates(): Promise<McpRecommendCandidate[]> {
      const cutoff = now.getTime() - RECENTLY_ENDED_DAYS * DAY;
      const effectiveEnd = sql`coalesce(${events.endAt}, ${events.startAt} + ${DAY - 1})`;
      const rows = (await db
        .select(eventColumns())
        .from(events)
        .where(
          and(
            eq(events.status, "published"),
            or(isNull(events.startAt), gte(effectiveEnd, cutoff)),
          ),
        )
        .orderBy(sql`${events.startAt} IS NULL`, asc(events.startAt))
        .limit(300)) as EventRow[];
      const ids = rows.map((row) => row.id);
      const [catMap, tagMap] = await Promise.all([getCategoriesForEvents(db, ids), tagsFor(ids)]);
      return rows.map((row) => {
        const summary = toSummary(
          row,
          (catMap.get(row.id) ?? []).map((category) => ({ slug: category.slug, name: category.name })),
          tagMap.get(row.id) ?? [],
          null,
        );
        const description = emptyToNull(row.description);
        return {
          ...summary,
          description: description ? truncate(description, 4000) : null,
          likeCount: row.likeCount,
          bookmarkCount: row.bookmarkCount,
          startMonth: row.startMonth,
        };
      });
    },
  };
}
