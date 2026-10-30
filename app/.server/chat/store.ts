import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getEventPhase } from "~/lib/event-phase";
import { truncate } from "~/lib/text";
import type { Database } from "../db";
import { chatMessages, chatSessions, events } from "../db/schema";
import { getCategoriesForEvents } from "../services/events";
import { chatStateSchema, type ChatState, type Recommendation } from "./types";

/** Event facts for recommendation cards — always read from the database. */
export async function recommendationCards(db: Database, recs: Recommendation[], now: Date) {
  if (recs.length === 0) return [];
  const rows = await db
    .select()
    .from(events)
    .where(and(inArray(events.id, recs.map((r) => r.eventId)), eq(events.status, "published")));
  const cats = await getCategoriesForEvents(db, rows.map((r) => r.id));
  return recs.flatMap((rec) => {
    const e = rows.find((r) => r.id === rec.eventId);
    if (!e) return [];
    return [
      {
        ...rec,
        event: {
          id: e.id,
          title: e.title,
          excerpt: truncate((e.description ?? "").replace(/\s+/g, " "), 120),
          startAt: e.startAt,
          endAt: e.endAt,
          location: e.location,
          format: e.format,
          feeType: e.feeType,
          applicationDeadline: e.applicationDeadline,
          officialUrl: e.officialUrl,
          applicationUrl: e.applicationUrl,
          phase: getEventPhase(e, now),
          categories: (cats.get(e.id) ?? []).map((c) => c.name),
        },
      },
    ];
  });
}

export type RecommendationCard = Awaited<ReturnType<typeof recommendationCards>>[number];

export async function listChatSessions(db: Database, userId: string) {
  return db
    .select({ id: chatSessions.id, title: chatSessions.title, updatedAt: chatSessions.updatedAt })
    .from(chatSessions)
    .where(eq(chatSessions.userId, userId))
    .orderBy(desc(chatSessions.updatedAt))
    .limit(20);
}

export async function loadChatSession(db: Database, userId: string, sessionId: string, now: Date) {
  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)),
  });
  if (!session) return null;
  const messages = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, session.id))
    .orderBy(asc(chatMessages.createdAt))
    .limit(200);
  const withCards = await Promise.all(
    messages.map(async (m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      recommendations: await recommendationCards(db, m.recommendations ?? [], now),
    })),
  );
  const state = chatStateSchema.safeParse(session.state ?? {});
  return { id: session.id, messages: withCards, state: state.success ? state.data : chatStateSchema.parse({}) };
}

export async function appendChatTurn(
  db: Database,
  userId: string,
  sessionId: string | null,
  input: { userMessage: string; reply: string; recommendations: Recommendation[]; state: ChatState },
) {
  let id = sessionId;
  if (id) {
    const owned = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)),
    });
    if (!owned) id = null;
  }
  if (!id) {
    id = crypto.randomUUID();
    await db.insert(chatSessions).values({
      id,
      userId,
      title: truncate(input.userMessage.replace(/\s+/g, " "), 40),
      state: input.state,
    });
  } else {
    await db
      .update(chatSessions)
      .set({ state: input.state, updatedAt: new Date() })
      .where(eq(chatSessions.id, id));
  }
  const now = Date.now();
  await db.insert(chatMessages).values([
    { id: crypto.randomUUID(), sessionId: id, role: "user", content: input.userMessage, createdAt: new Date(now) },
    {
      id: crypto.randomUUID(),
      sessionId: id,
      role: "assistant",
      content: input.reply,
      recommendations: input.recommendations.length > 0 ? input.recommendations : null,
      createdAt: new Date(now + 1),
    },
  ]);
  return id;
}

export async function deleteChatSession(db: Database, userId: string, sessionId: string) {
  await db
    .delete(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
}
