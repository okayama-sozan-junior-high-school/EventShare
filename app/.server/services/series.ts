import { stripEditionMarkers } from "~/lib/edition";
import { normalizeForMatch } from "~/lib/text";
import type { Database } from "../db";
import { eventSeries } from "../db/schema";

/** Creates a new single-edition series for an event and returns its id. */
export async function ensureSeriesFor(db: Database, input: { title: string; userId: string | null }) {
  const id = crypto.randomUUID();
  const title = stripEditionMarkers(input.title) || input.title.trim();
  await db.insert(eventSeries).values({
    id,
    title,
    matchKey: normalizeForMatch(title),
    createdById: input.userId,
  });
  return id;
}
