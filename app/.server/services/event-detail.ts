import { desc, eq } from "drizzle-orm";
import type { Database } from "../db";
import { eventContributions, eventSources, user } from "../db/schema";
import { getCategoriesForEvents } from "./events";

export async function getEventExtras(db: Database, eventId: string) {
  const [cats, history, sources] = await Promise.all([
    getCategoriesForEvents(db, [eventId]),
    db
      .select({
        id: eventContributions.id,
        type: eventContributions.type,
        note: eventContributions.note,
        changes: eventContributions.changes,
        createdAt: eventContributions.createdAt,
        userId: eventContributions.userId,
        userName: user.name,
      })
      .from(eventContributions)
      .leftJoin(user, eq(user.id, eventContributions.userId))
      .where(eq(eventContributions.eventId, eventId))
      .orderBy(desc(eventContributions.createdAt))
      .limit(100),
    db
      .select({ url: eventSources.url, kind: eventSources.kind })
      .from(eventSources)
      .where(eq(eventSources.eventId, eventId))
      .limit(20),
  ]);

  const contributors = new Map<string, { id: string; name: string; roles: Set<string> }>();
  for (const h of [...history].reverse()) {
    if (!h.userId || !h.userName || h.type === "moderate" || h.type === "merge") continue;
    const entry = contributors.get(h.userId) ?? { id: h.userId, name: h.userName, roles: new Set<string>() };
    entry.roles.add(h.type === "create" ? "投稿" : h.type === "add_info" ? "情報提供" : "編集");
    contributors.set(h.userId, entry);
  }

  return {
    categories: cats.get(eventId) ?? [],
    history,
    sources,
    contributors: [...contributors.values()].map((c) => ({ id: c.id, name: c.name, roles: [...c.roles] })),
  };
}
