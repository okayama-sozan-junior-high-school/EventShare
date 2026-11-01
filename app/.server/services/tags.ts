import { and, asc, desc, eq, gte, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  groupBySeries,
  groupTagsByFacet,
  mergeTagNames,
  normalizeTagName,
  parseTagInput,
  TAG_FACET_ORDER,
  tagListError,
  type TagFacetKey,
} from "~/lib/tags";
import { escapeLike } from "~/lib/text";
import type { Database } from "../db";
import { eventContributions, events, eventTags, tags, type TagFacet } from "../db/schema";
import { PAGE_SIZE, toEventCards } from "./events";

const FACET_RANK = Object.fromEntries(TAG_FACET_ORDER.map((facet, index) => [facet, index])) as Record<
  string,
  number
>;

export class TagLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagLimitError";
  }
}

const suggestionColumns = {
  name: tags.name,
  slug: tags.slug,
  facet: tags.facet,
};

/** Seed tags (facet assigned) plus user tags that have been used at least twice. */
function browsableTags() {
  return and(eq(tags.status, "active"), or(gte(tags.useCount, 2), ne(tags.facet, "other")))!;
}

export async function getEventTags(db: Database, eventId: string) {
  const rows = await db
    .select({
      name: tags.name,
      slug: tags.slug,
      facet: tags.facet,
      status: tags.status,
    })
    .from(eventTags)
    .innerJoin(tags, eq(tags.id, eventTags.tagId))
    .where(eq(eventTags.eventId, eventId));
  return rows.sort(
    (a, b) => FACET_RANK[a.facet] - FACET_RANK[b.facet] || a.name.localeCompare(b.name, "ja"),
  );
}

export async function getTagBySlug(db: Database, slug: string) {
  const normalized = normalizeTagName(slug);
  if (!normalized) return undefined;
  return db.query.tags.findFirst({ where: eq(tags.slug, normalized) });
}

export async function getTagsBySlugs(db: Database, slugs: string[]) {
  if (slugs.length === 0) return [];
  const rows = await db
    .select({ name: tags.name, slug: tags.slug })
    .from(tags)
    .where(inArray(tags.slug, slugs));
  const names = new Map(rows.map((row) => [row.slug, row.name]));
  return slugs.map((slug) => ({ slug, name: names.get(slug) ?? slug }));
}

/**
 * Active tags worth suggesting. Official (faceted) tags always qualify;
 * `other` tags qualify once `use_count >= 2`. With `q`, prefix matches
 * come before other contains-matches.
 */
export async function listSuggestedTags(
  db: Database,
  options: { q?: string; limit?: number } = {},
) {
  const limit = Math.min(100, Math.max(1, options.limit ?? 10));
  const q = normalizeTagName(options.q ?? "").slice(0, 50);
  if (!q) {
    const rows = await db
      .select(suggestionColumns)
      .from(tags)
      .where(browsableTags())
      .orderBy(desc(tags.useCount), asc(tags.name))
      .limit(limit);
    const rank = new Map(rows.map((row, index) => [row.slug, index]));
    return [...rows].sort((a, b) => {
      const byFacet = (FACET_RANK[a.facet] ?? 0) - (FACET_RANK[b.facet] ?? 0);
      if (byFacet !== 0) return byFacet;
      return (rank.get(a.slug) ?? 0) - (rank.get(b.slug) ?? 0);
    });
  }
  const contains = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;
  return db
    .select(suggestionColumns)
    .from(tags)
    .where(and(browsableTags(), sql`${tags.slug} LIKE ${contains} ESCAPE '\\'`))
    .orderBy(
      sql`case when ${tags.slug} like ${prefix} escape '\\' then 0 else 1 end`,
      desc(tags.useCount),
      asc(tags.name),
    )
    .limit(limit);
}

export async function listPopularTags(db: Database, limit: number) {
  const take = Math.min(50, Math.max(1, limit));
  return db
    .select({
      name: tags.name,
      slug: tags.slug,
      facet: tags.facet,
      useCount: tags.useCount,
    })
    .from(tags)
    .where(and(browsableTags(), gte(tags.useCount, 1)))
    .orderBy(desc(tags.useCount), asc(tags.name))
    .limit(take);
}

export async function listTagsByFacet(db: Database) {
  const rows = await db
    .select({
      name: tags.name,
      slug: tags.slug,
      facet: tags.facet,
      useCount: tags.useCount,
    })
    .from(tags)
    .where(browsableTags())
    .orderBy(desc(tags.useCount), asc(tags.name));
  return groupTagsByFacet(rows);
}

export async function listAllTags(db: Database) {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      facet: tags.facet,
      status: tags.status,
      useCount: tags.useCount,
    })
    .from(tags)
    .orderBy(desc(tags.useCount), asc(tags.name));
  return rows.sort(
    (a, b) =>
      (FACET_RANK[a.facet] ?? 0) - (FACET_RANK[b.facet] ?? 0) ||
      b.useCount - a.useCount ||
      a.name.localeCompare(b.name, "ja"),
  );
}

async function runBatch(db: Database, statements: BatchItem<"sqlite">[]) {
  if (statements.length === 0) return;
  if (statements.length === 1) {
    await statements[0];
    return;
  }
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

/**
 * Replace an event's tags. Names are normalized and de-duplicated.
 * Missing tags are created as `other` / `active`. `use_count` is recounted
 * for every tag that was added or removed. Lookups run first; writes are
 * one batch.
 */
export async function setEventTags(
  db: Database,
  input: { eventId: string; names: readonly string[]; userId: string },
) {
  const slugs = parseTagInput(input.names);
  const message = tagListError(slugs);
  if (message) throw new TagLimitError(message);

  const existing = slugs.length
    ? await db
        .select({ slug: tags.slug })
        .from(tags)
        .where(inArray(tags.slug, slugs))
    : [];
  const have = new Set(existing.map((row) => row.slug));
  const toCreate = slugs.filter((slug) => !have.has(slug));
  const previous = await db
    .select({ tagId: eventTags.tagId })
    .from(eventTags)
    .where(eq(eventTags.eventId, input.eventId));
  const affectedIds = [...new Set(previous.map((row) => row.tagId))];

  const statements: BatchItem<"sqlite">[] = [];
  if (toCreate.length > 0) {
    statements.push(
      db
        .insert(tags)
        .values(
          toCreate.map((slug) => ({
            name: slug,
            slug,
            facet: "other" as const,
            status: "active" as const,
            createdById: input.userId,
          })),
        )
        .onConflictDoNothing(),
    );
  }
  statements.push(db.delete(eventTags).where(eq(eventTags.eventId, input.eventId)));
  if (slugs.length > 0) {
    statements.push(
      db.insert(eventTags).select(
        db
          .select({
            eventId: sql`${input.eventId}`.as("event_id"),
            tagId: tags.id,
            addedById: sql`${input.userId}`.as("added_by_id"),
            createdAt: sql`cast(unixepoch('subsecond') * 1000 as integer)`.as("created_at"),
          })
          .from(tags)
          .where(inArray(tags.slug, slugs)),
      ),
    );
  }
  const recount: SQL[] = [];
  if (affectedIds.length > 0) recount.push(inArray(tags.id, affectedIds));
  if (slugs.length > 0) recount.push(inArray(tags.slug, slugs));
  if (recount.length > 0) {
    statements.push(
      db
        .update(tags)
        .set({
          useCount: sql`(select count(*) from ${eventTags} where ${eventTags.tagId} = ${tags.id})`,
        })
        .where(or(...recount)!),
    );
  }
  await runBatch(db, statements);

  if (slugs.length === 0) return [];
  const rows = await db
    .select({ name: tags.name, slug: tags.slug })
    .from(tags)
    .where(inArray(tags.slug, slugs));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return slugs.map((slug) => bySlug.get(slug) ?? { name: slug, slug });
}

/** Reject a tag set that would exceed the limit. Does not write. */
export async function assertTagUpdate(
  db: Database,
  args: { eventId: string; names: readonly string[]; mode: "replace" | "add" },
) {
  const current =
    args.mode === "add" ? (await getEventTags(db, args.eventId)).map((tag) => tag.name) : [];
  const message = tagListError(mergeTagNames(current, args.names, args.mode));
  if (message) throw new TagLimitError(message);
}

/**
 * Persist tags after the event row is written.
 * `add` unions with the current set (logged-in non-authors).
 * `contributionType` null skips the history row (used on create, which
 * already records a create contribution).
 */
export async function saveEventTags(
  db: Database,
  args: {
    eventId: string;
    names: readonly string[];
    userId: string;
    mode: "replace" | "add";
    contributionType: "edit" | "add_info" | "moderate" | null;
  },
) {
  const current = await getEventTags(db, args.eventId);
  const names = mergeTagNames(
    current.map((tag) => tag.name),
    args.names,
    args.mode,
  );
  const message = tagListError(names);
  if (message) throw new TagLimitError(message);
  const next = await setEventTags(db, { eventId: args.eventId, names, userId: args.userId });
  const changed =
    current
      .map((tag) => tag.slug)
      .sort()
      .join("\0") !==
    next
      .map((tag) => tag.slug)
      .sort()
      .join("\0");
  if (changed && args.contributionType) {
    await db.insert(eventContributions).values({
      id: crypto.randomUUID(),
      eventId: args.eventId,
      userId: args.userId,
      type: args.contributionType,
      changes: {
        tags: { from: current.map((tag) => tag.name), to: next.map((tag) => tag.name) },
      },
    });
  }
  return { changed, from: current.map((tag) => tag.name), to: next.map((tag) => tag.name) };
}

/**
 * Published events carrying this tag, grouped by series.
 * Hidden and unknown slugs return null (the page is a 404).
 */
export async function listEventsForTag(db: Database, input: { slug: string; page: number }) {
  const tag = await getTagBySlug(db, input.slug);
  if (!tag || tag.status !== "active") return null;

  const rows = await db
    .select({ event: events })
    .from(events)
    .innerJoin(eventTags, eq(eventTags.eventId, events.id))
    .where(and(eq(eventTags.tagId, tag.id), eq(events.status, "published")));
  const grouped = groupBySeries(rows.map((row) => row.event));
  const total = grouped.length;
  const pageCount = total === 0 ? 0 : Math.ceil(total / PAGE_SIZE);
  const page = pageCount === 0 ? 1 : Math.min(Math.max(1, input.page), pageCount);
  const slice = grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cards = await toEventCards(
    db,
    slice.map((group) => group.item),
    new Date(),
  );
  return {
    tag: {
      name: tag.name,
      slug: tag.slug,
      facet: tag.facet,
      useCount: tag.useCount,
    },
    items: cards.map((card, index) => ({
      ...card,
      editionCount: slice[index]?.count ?? 1,
    })),
    total,
    page,
    pageCount,
  };
}

export async function updateTagFacet(db: Database, id: number, facet: TagFacet) {
  await db.update(tags).set({ facet }).where(eq(tags.id, id));
}

export async function setTagStatus(db: Database, id: number, status: "active" | "hidden") {
  await db.update(tags).set({ status }).where(eq(tags.id, id));
}

export async function toggleTagStatus(db: Database, id: number) {
  const current = await db.query.tags.findFirst({ where: eq(tags.id, id) });
  if (!current) return false;
  await setTagStatus(db, id, current.status === "active" ? "hidden" : "active");
  return true;
}

/** Move every use of tag A onto tag B, drop duplicates, recount, delete A. */
export async function mergeTags(db: Database, sourceId: number, targetId: number) {
  if (sourceId === targetId) return "same" as const;
  const [source, target] = await Promise.all([
    db.query.tags.findFirst({ where: eq(tags.id, sourceId) }),
    db.query.tags.findFirst({ where: eq(tags.id, targetId) }),
  ]);
  if (!source || !target) return "missing" as const;
  await db.batch([
    db.delete(eventTags).where(
      and(
        eq(eventTags.tagId, sourceId),
        inArray(
          eventTags.eventId,
          db.select({ id: eventTags.eventId }).from(eventTags).where(eq(eventTags.tagId, targetId)),
        ),
      ),
    ),
    db.update(eventTags).set({ tagId: targetId }).where(eq(eventTags.tagId, sourceId)),
    db
      .update(tags)
      .set({
        useCount: sql`(select count(*) from ${eventTags} where ${eventTags.tagId} = ${tags.id})`,
      })
      .where(eq(tags.id, targetId)),
    db.delete(tags).where(eq(tags.id, sourceId)),
  ]);
  return "ok" as const;
}

export type { TagFacet, TagFacetKey };
