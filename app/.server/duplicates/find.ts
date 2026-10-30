import { and, between, eq, isNull, ne, or, sql } from "drizzle-orm";
import { normalizeUrl } from "~/lib/url";
import type { Database } from "../db";
import { events } from "../db/schema";
import { getDuplicateConfig } from "../services/settings";
import {
  scoreDuplicate,
  type DuplicateComparable,
  type DuplicateScore,
} from "./score";

export type DuplicateCandidate = DuplicateScore & {
  event: {
    id: string;
    title: string;
    startAt: Date | null;
    location: string | null;
    organizer: string | null;
    officialUrl: string | null;
  };
};

const WINDOW_MS = 400 * 86_400_000;

/**
 * Finds existing published events that may be the same as `input`.
 * Never blocks posting; the caller shows the candidates to the user.
 */
export async function findDuplicateCandidates(
  db: Database,
  input: DuplicateComparable,
  options: { excludeId?: string; timeZone: string; limit?: number },
): Promise<DuplicateCandidate[]> {
  const config = await getDuplicateConfig(db);
  const normalizedUrl = normalizeUrl(input.officialUrl);

  const scope = [eq(events.status, "published")];
  if (options.excludeId) scope.push(ne(events.id, options.excludeId));

  const pools = [];
  if (input.startAt) {
    const t = input.startAt.getTime();
    pools.push(
      between(events.startAt, new Date(t - WINDOW_MS), new Date(t + WINDOW_MS)),
    );
    pools.push(isNull(events.startAt));
  } else {
    pools.push(sql`1 = 1`);
  }
  if (normalizedUrl) pools.push(eq(events.normalizedOfficialUrl, normalizedUrl));

  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      startAt: events.startAt,
      organizer: events.organizer,
      location: events.location,
      format: events.format,
      officialUrl: events.officialUrl,
    })
    .from(events)
    .where(and(...scope, or(...pools)))
    .orderBy(sql`${events.createdAt} DESC`)
    .limit(500);

  return rows
    .map((row) => {
      const s = scoreDuplicate(input, row, config, options.timeZone);
      return {
        ...s,
        event: {
          id: row.id,
          title: row.title,
          startAt: row.startAt,
          location: row.location,
          organizer: row.organizer,
          officialUrl: row.officialUrl,
        },
      };
    })
    .filter((c) => c.level !== "low" || (c.urlMatch && !c.differentEdition))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 5);
}
